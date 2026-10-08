// COPY catalog conventions: caolib/kira (MIT), see THIRD_PARTY_NOTICES.md.
use crate::{comic_explore::{self as catalog, ComicItem}, db::AppState, error::{AppError, AppResult}};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::State;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ComicSection { Recommended, Ranking, HotUpdates, NewArrivals, Completed }

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum RankPeriod { Day, Week, Month }

impl RankPeriod {
    fn query(self) -> &'static str { match self { Self::Day => "day", Self::Week => "week", Self::Month => "month" } }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum RankAudience { Male, Female }

impl RankAudience {
    fn query(self) -> &'static str { match self { Self::Male => "male", Self::Female => "female" } }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ComicFeedEntry {
    pub item: ComicItem,
    pub popularity: Option<u64>,
    pub rank_popularity: Option<u64>,
    pub rank: Option<u64>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ComicHomeSection {
    pub section: ComicSection,
    pub period: Option<RankPeriod>,
    pub audience: Option<RankAudience>,
    pub items: Vec<ComicFeedEntry>,
    pub total: Option<u64>,
    pub supports_paging: bool,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ComicHome { pub sections: Vec<ComicHomeSection>, pub stale: bool, #[serde(default)] pub warnings: Vec<String> }

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ComicSectionQuery {
    pub section: ComicSection,
    pub period: Option<RankPeriod>,
    pub audience: Option<RankAudience>,
    pub offset: u32,
    pub limit: u32,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ComicSectionPage {
    pub items: Vec<ComicFeedEntry>,
    pub total: u64,
    pub offset: u32,
    pub limit: u32,
    pub has_more: bool,
    pub stale: bool,
}

fn invalid_data() -> AppError { AppError::Network("漫画首页没有返回有效分组资料，请稍后重试".into()) }

fn parse_entry(row: &Value, ranking: bool) -> AppResult<ComicFeedEntry> {
    let comic = if row.get("comic").is_some() { &row["comic"] } else { row };
    let mut item = catalog::parse_item(comic)?;
    if row.get("comic").is_some() {
        if item.latest_chapter.is_empty() { item.latest_chapter = row["name"].as_str().unwrap_or_default().into(); }
        if item.updated_at.is_empty() { item.updated_at = row["datetime_created"].as_str().unwrap_or_default().into(); }
    }
    Ok(ComicFeedEntry { item, popularity: comic["popular"].as_u64(),
        rank_popularity: if ranking { row["popular"].as_u64() } else { None },
        rank: if ranking { row["sort"].as_u64() } else { None } })
}

fn parse_home(value: Value) -> AppResult<ComicHome> {
    let groups = [
        ("recComics", ComicSection::Recommended, None),
        ("rankDayComics", ComicSection::Ranking, Some(RankPeriod::Day)),
        ("rankWeekComics", ComicSection::Ranking, Some(RankPeriod::Week)),
        ("rankMonthComics", ComicSection::Ranking, Some(RankPeriod::Month)),
        ("hotComics", ComicSection::HotUpdates, None),
        ("newComics", ComicSection::NewArrivals, None),
        ("finishComics", ComicSection::Completed, None),
    ];
    let sections = groups.into_iter().map(|(key, section, period)| {
        let group = value.get(key).ok_or_else(invalid_data)?;
        let (rows, total) = if matches!(section, ComicSection::HotUpdates | ComicSection::NewArrivals) {
            (group.as_array().ok_or_else(invalid_data)?, None)
        } else {
            (group["list"].as_array().ok_or_else(invalid_data)?, Some(group["total"].as_u64().ok_or_else(invalid_data)?))
        };
        let items = rows.iter().map(|row| parse_entry(row, section == ComicSection::Ranking)).collect::<AppResult<Vec<_>>>()?;
        if total.is_some_and(|total| total < items.len() as u64) { return Err(invalid_data()); }
        Ok(ComicHomeSection { section, period,
            audience: period.map(|_| RankAudience::Male), items, total,
            supports_paging: section != ComicSection::HotUpdates })
    }).collect::<AppResult<Vec<_>>>()?;
    if sections.iter().all(|section| section.items.is_empty()) { return Err(invalid_data()); }
    Ok(ComicHome { sections, stale: false, warnings:vec![] })
}

fn section_params(input: &ComicSectionQuery) -> AppResult<(&'static str, Vec<(String, String)>)> {
    if input.offset > 1_000_000 || !(1..=100).contains(&input.limit)
        || (input.section != ComicSection::Ranking && (input.period.is_some() || input.audience.is_some())) {
        return Err(AppError::Validation("漫画分组分页或榜单参数无效".into()));
    }
    let mut params = vec![("platform".into(), "3".into()), ("limit".into(), input.limit.to_string()), ("offset".into(), input.offset.to_string())];
    let path = match input.section {
        ComicSection::Recommended => { params.push(("pos".into(), "3200102".into())); "/api/v3/recs" }
        ComicSection::Ranking => {
            let period = input.period.ok_or_else(|| AppError::Validation("请选择日榜、周榜或月榜".into()))?;
            params.extend([("type".into(), "1".into()), ("date_type".into(), period.query().into()),
                ("audience_type".into(), input.audience.unwrap_or(RankAudience::Male).query().into())]);
            "/api/v3/ranks"
        }
        ComicSection::NewArrivals => { params.push(("date".into(), String::new())); "/api/v3/update/newest" }
        ComicSection::Completed => {
            params.extend([("top".into(), "finish".into()), ("ordering".into(), "-datetime_updated".into()), ("free_type".into(), "1".into())]);
            "/api/v3/comics"
        }
        ComicSection::HotUpdates => return Err(AppError::Validation("热门更新仅提供首页分组，请读取漫画首页接口".into())),
    };
    Ok((path, params))
}

fn parse_page(value: Value, input: &ComicSectionQuery) -> AppResult<ComicSectionPage> {
    let rows = value["list"].as_array().ok_or_else(invalid_data)?;
    let total = value["total"].as_u64().ok_or_else(invalid_data)?;
    if rows.len() > input.limit as usize || total < rows.len() as u64 { return Err(invalid_data()); }
    let items = rows.iter().map(|row| parse_entry(row, input.section == ComicSection::Ranking)).collect::<AppResult<Vec<_>>>()?;
    let has_more = !items.is_empty() && u64::from(input.offset) + (items.len() as u64) < total;
    Ok(ComicSectionPage { items, total, offset: input.offset, limit: input.limit, has_more, stale: false })
}

async fn home(pool: &sqlx::SqlitePool, refresh: bool) -> AppResult<ComicHome> {
    if let Ok((mut result,stale)) = catalog::cached_request_for("copymanga-home",pool,catalog::CATALOG_HOST,
        "/api/v3/h5/homeIndex2",&[("platform".into(),"3".into())],1,refresh,parse_home).await {
        if result.sections.iter().any(|section|!section.items.is_empty()) { result.stale = stale; return Ok(result); }
    }
    // These are the source's actual group APIs. HotUpdates has no equivalent and is not fabricated.
    let groups = [(ComicSection::Recommended,None),(ComicSection::Ranking,Some(RankPeriod::Day)),
        (ComicSection::Ranking,Some(RankPeriod::Week)),(ComicSection::Ranking,Some(RankPeriod::Month)),
        (ComicSection::NewArrivals,None),(ComicSection::Completed,None)];
    let mut tasks = tokio::task::JoinSet::new();
    for (index,(group,period)) in groups.into_iter().enumerate() {
        let pool = pool.clone();
        tasks.spawn(async move {
            let input = ComicSectionQuery {section:group,period,audience:period.map(|_|RankAudience::Male),offset:0,limit:12};
            (index,section(&pool,&input,refresh).await.map(|page|ComicHomeSection {
                section:group,period,audience:input.audience,items:page.items,total:Some(page.total),supports_paging:true,
            }))
        });
    }
    let mut sections = Vec::new();
    while let Some(result) = tasks.join_next().await {
        if let Ok((index,Ok(section))) = result { sections.push((index,section)); }
    }
    sections.sort_by_key(|(index,_)|*index);
    if sections.iter().all(|(_,section)|section.items.is_empty()) { return Err(invalid_data()); }
    Ok(ComicHome {sections:sections.into_iter().map(|(_,section)|section).collect(),stale:false,warnings:vec!["部分首页分组暂不可用，可重试。".into()]})
}

async fn section(pool: &sqlx::SqlitePool, input: &ComicSectionQuery, refresh: bool) -> AppResult<ComicSectionPage> {
    let (path, params) = section_params(input)?;
    let (mut result, stale) = catalog::cached_request_for("copymanga-home", pool, catalog::CATALOG_HOST,
        path, &params, 1, refresh, |value| parse_page(value, input)).await?;
    result.stale = stale;
    Ok(result)
}

async fn annotate(state: &AppState, app: &tauri::AppHandle, entries: &mut [&mut ComicFeedEntry]) -> AppResult<()> {
    let mut items = entries.iter().map(|entry| entry.item.clone()).collect::<Vec<_>>();
    catalog::local_states(&state.pool, &mut items).await?;
    catalog::cached_covers(app, &state.cover_cache_path, &mut items);
    for (entry, item) in entries.iter_mut().zip(items) { entry.item = item; }
    Ok(())
}

#[tauri::command]
pub async fn get_comic_explore_home(refresh: bool, state: State<'_, AppState>, app: tauri::AppHandle) -> AppResult<ComicHome> {
    let mut result = home(&state.pool, refresh).await?;
    annotate(&state, &app, &mut result.sections.iter_mut().flat_map(|section| section.items.iter_mut()).collect::<Vec<_>>()).await?;
    Ok(result)
}

#[tauri::command]
pub async fn list_comic_explore_section(input: ComicSectionQuery, refresh: bool, state: State<'_, AppState>, app: tauri::AppHandle) -> AppResult<ComicSectionPage> {
    let mut result = section(&state.pool, &input, refresh).await?;
    annotate(&state, &app, &mut result.items.iter_mut().collect::<Vec<_>>()).await?;
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn comic(id: &str) -> Value { json!({"path_word":id,"name":format!("作品{id}"),"popular":900,"author":[{"name":"作者"}]}) }
    fn fixture() -> Value {
        let nested = json!({"comic":comic("one"),"name":"第2话","datetime_created":"2026-10-07"});
        let rank = json!({"comic":comic("two"),"sort":1,"popular":30});
        json!({
            "recComics":{"list":[nested.clone()],"total":20},
            "rankDayComics":{"list":[rank.clone()],"total":200},
            "rankWeekComics":{"list":[rank.clone()],"total":200},
            "rankMonthComics":{"list":[rank],"total":200},
            "hotComics":[nested.clone()],"newComics":[nested],
            "finishComics":{"list":[comic("finished")],"total":100}
        })
    }
    fn query(section: ComicSection) -> ComicSectionQuery {
        ComicSectionQuery { section, period:None, audience:None, offset:0, limit:24 }
    }

    #[test]
    fn home_keeps_native_groups_titles_chapters_and_distinct_rank_metrics() {
        let result = parse_home(fixture()).unwrap();
        assert_eq!(result.sections.len(),7);
        assert_eq!(result.sections[0].section,ComicSection::Recommended);
        assert_eq!(result.sections[0].items[0].item.title,"作品one");
        assert_eq!(result.sections[0].items[0].item.latest_chapter,"第2话");
        assert_eq!(result.sections[0].items[0].item.updated_at,"2026-10-07");
        assert_eq!(result.sections[1].period,Some(RankPeriod::Day));
        assert_eq!(result.sections[2].period,Some(RankPeriod::Week));
        assert_eq!(result.sections[3].period,Some(RankPeriod::Month));
        assert_eq!(result.sections[1].audience,Some(RankAudience::Male));
        assert_eq!(result.sections[1].items[0].popularity,Some(900));
        assert_eq!(result.sections[1].items[0].rank_popularity,Some(30));
        assert_eq!(result.sections[1].items[0].rank,Some(1));
        assert!(!result.sections[4].supports_paging);
        assert!(result.sections[4].total.is_none());
        assert_eq!(result.sections[6].items[0].item.path_word,"finished");
        assert!(result.sections[6].items[0].item.status.is_empty());
        let mut value = fixture();
        value["recComics"]["list"] = json!([{ "comic":comic("z") }, { "comic":comic("a") }]);
        let result = parse_home(value).unwrap();
        assert_eq!(result.sections[0].items.iter().map(|entry| entry.item.path_word.as_str()).collect::<Vec<_>>(),["z","a"]);
        assert!(result.sections[0].items[0].rank_popularity.is_none());
    }

    #[test]
    fn empty_success_envelope_is_not_a_usable_homepage() {
        let mut value = fixture();
        for key in ["recComics","rankDayComics","rankWeekComics","rankMonthComics","finishComics"] { value[key]["list"] = serde_json::json!([]); }
        for key in ["hotComics","newComics"] { value[key] = serde_json::json!([]); }
        assert!(parse_home(value).is_err());
    }

    #[test]
    fn rejects_missing_groups_and_malformed_items_but_accepts_empty_lists() {
        assert!(parse_home(Value::Null).is_err());
        let mut value = fixture(); value.as_object_mut().unwrap().remove("rankDayComics");
        assert!(parse_home(value).is_err());
        let mut value = fixture(); value["hotComics"][0]["comic"]["path_word"] = json!("../escape");
        assert!(parse_home(value).is_err());
        let mut value = fixture(); value["hotComics"] = json!([]);
        assert!(parse_home(value).unwrap().sections[4].items.is_empty());
    }

    #[test]
    fn pagination_selects_real_endpoints_and_rejects_unsupported_options() {
        assert_eq!(section_params(&query(ComicSection::Recommended)).unwrap().0,"/api/v3/recs");
        assert_eq!(section_params(&query(ComicSection::NewArrivals)).unwrap().0,"/api/v3/update/newest");
        let (_,params) = section_params(&query(ComicSection::Completed)).unwrap();
        assert!(params.contains(&("top".into(),"finish".into())));
        assert!(section_params(&query(ComicSection::HotUpdates)).is_err());
        let mut rank = query(ComicSection::Ranking);
        assert!(section_params(&rank).is_err());
        rank.period = Some(RankPeriod::Week);
        let (_,male) = section_params(&rank).unwrap();
        assert!(male.contains(&("audience_type".into(),"male".into())));
        rank.audience = Some(RankAudience::Female);
        let (_,female) = section_params(&rank).unwrap(); assert_ne!(male,female);
        rank.section = ComicSection::Recommended; assert!(section_params(&rank).is_err());
        for limit in [0,101] { let mut input = query(ComicSection::Recommended); input.limit=limit; assert!(section_params(&input).is_err()); }
        assert!(serde_json::from_value::<ComicSectionQuery>(json!({"section":"anything","offset":0,"limit":24})).is_err());
        let mut input = query(ComicSection::Recommended); input.offset=18;
        let last = parse_page(json!({"list":[{"comic":comic("last")}],"total":19}),&input).unwrap();
        assert!(!last.has_more);
        input.offset=0;
        assert!(parse_page(json!({"list":[{"comic":comic("first")}],"total":19}),&input).unwrap().has_more);
    }

    #[tokio::test]
    async fn failed_refresh_preserves_cached_home_and_personal_records() {
        use chrono::{Duration,Utc};
        let pool = crate::db::test_pool().await.unwrap();
        let host = "http://127.0.0.1:1";
        let old = parse_home(fixture()).unwrap();
        sqlx::query("INSERT INTO metadata_cache(provider,cache_key,response_json,fetched_at,expires_at) VALUES('copymanga-home',?,?,'now',?)")
            .bind(format!("v1:{host}/home:[]")).bind(serde_json::to_string(&old).unwrap())
            .bind((Utc::now()+Duration::hours(1)).to_rfc3339()).execute(&pool).await.unwrap();
        sqlx::query("INSERT INTO works(id,title,type,status,notes,favorite,created_at,updated_at) VALUES('local','我的标题','comic','in_progress','我的笔记',1,'now','now')").execute(&pool).await.unwrap();
        sqlx::query("INSERT INTO work_external_ids(work_id,provider,external_id,created_at,updated_at) VALUES('local','copymanga','one','now','now')").execute(&pool).await.unwrap();
        let (mut cached,stale) = catalog::cached_request_for("copymanga-home",&pool,host,"/home",&[],1,true,parse_home).await.unwrap();
        assert!(stale);
        let item = &mut cached.sections[0].items[0].item;
        catalog::local_states(&pool,std::slice::from_mut(item)).await.unwrap();
        assert_eq!(item.local_work_id.as_deref(),Some("local")); assert!(item.favorite);
        let notes: String = sqlx::query_scalar("SELECT notes FROM works WHERE id='local'").fetch_one(&pool).await.unwrap();
        assert_eq!(notes,"我的笔记");
        assert!(catalog::cached_request_for("copymanga-home",&pool,host,"/other",&[],1,true,parse_home).await.is_err());
    }

    #[tokio::test]
    #[ignore = "explicit live public catalog metadata smoke test; no chapter content or user database"]
    async fn live_discovery_feeds_copy() {
        let pool = crate::db::test_pool().await.unwrap();
        let result = home(&pool,true).await.unwrap();
        for group in &result.sections {
            assert!(!group.items.is_empty());
            println!("{:?} {:?}: {} / {:?}",group.section,group.period,group.items.len(),group.total);
            if !group.supports_paging { continue; }
            let input = ComicSectionQuery { section:group.section, period:group.period, audience:group.audience, offset:0, limit:3 };
            let page = section(&pool,&input,true).await.unwrap();
            assert_eq!(page.items[0].item.path_word,group.items[0].item.path_word);
            assert_eq!(page.items.len(),3);
            assert!(!page.stale);
        }
    }
}
