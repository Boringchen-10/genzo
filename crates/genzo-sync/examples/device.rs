//! Isolated desktop-side fixture driver for native Android / shared-core WebDAV QA.
use genzo_sync::{store,transport::DavTransport};
use sqlx::sqlite::{SqliteConnectOptions,SqlitePoolOptions};

#[tokio::main]
async fn main() -> Result<(),Box<dyn std::error::Error>> {
    let path=std::env::var("GENZO_SYNC_QA_DB")?;
    let action=std::env::args().nth(1).ok_or("missing action")?;
    let pool=SqlitePoolOptions::new().max_connections(1).connect_with(SqliteConnectOptions::new().filename(&path).create_if_missing(true)).await?;
    if action=="seed" {
        let exists:i64=sqlx::query_scalar("SELECT COUNT(*) FROM sqlite_schema WHERE name='works'").fetch_one(&pool).await?;
        if exists!=0 { return Err("Choose a fresh QA database".into()); }
        let mut migrations=std::fs::read_dir("src-tauri/migrations")?.collect::<Result<Vec<_>,_>>()?;
        migrations.sort_by_key(|entry|entry.file_name());
        for migration in migrations { if migration.path().extension().is_some_and(|extension|extension=="sql") {sqlx::raw_sql(&std::fs::read_to_string(migration.path())?).execute(&pool).await?;} }
        sqlx::query("INSERT INTO works(id,title,type,notes,created_at,updated_at) VALUES('sync-qa-film','Genzo 多设备合成验收','video','电脑创建的合成笔记','t','t')").execute(&pool).await?;
        sqlx::query("INSERT INTO work_external_ids(work_id,provider,external_id,created_at,updated_at) VALUES('sync-qa-film','tmdb','movie/999991357','t','t')").execute(&pool).await?;
        store::initialize(&pool).await?;
    } else if action=="document" {
        println!("{}",serde_json::to_string(&store::freeze(&pool).await?)?);
    } else if action=="status" {
        println!("{}",serde_json::to_string(&store::status(&pool,false).await?)?);
    } else {
        let endpoint=std::env::var("GENZO_SYNC_QA_ENDPOINT")?;
        let username=std::env::var("GENZO_SYNC_QA_USERNAME")?;
        let password=std::env::var("GENZO_SYNC_QA_PASSWORD")?;
        let dav=DavTransport::new(&endpoint,username,password,true)?;
        match action.as_str() {
            "create"=>store::connect(&pool,&dav,&endpoint,"qa-local-only","Windows QA",true,true).await?,
            "sync"=>store::synchronize(&pool,&dav).await?,
            "change"=>{sqlx::query("UPDATE works SET favorite=1,rating=8,notes='电脑后续修改' WHERE id='sync-qa-film'").execute(&pool).await?;store::synchronize(&pool,&dav).await?;}
            "read"=>{}
            _=>return Err("unknown action".into()),
        }
        let works:Vec<(String,String,bool,f64,String)>=sqlx::query_as("SELECT id,title,favorite,rating,notes FROM works WHERE type='video' ORDER BY id").fetch_all(&pool).await?;
        println!("{}",serde_json::to_string(&works)?);
    }
    pool.close().await; Ok(())
}
