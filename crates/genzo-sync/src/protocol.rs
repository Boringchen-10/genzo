use crate::{Error, Result};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{BTreeMap, BTreeSet};
use uuid::Uuid;

pub const MAX_BYTES: usize = 16 * 1024 * 1024;
pub type Clock = BTreeMap<String, u64>;

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Origin {
    #[default]
    Manual,
    Metadata,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Change {
    pub id: String,
    pub device_id: String,
    pub counter: u64,
    pub context: Clock,
    pub entity: String,
    pub field: String,
    pub value: Value,
    pub observed_at: String,
    #[serde(default)]
    pub origin: Origin,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Document {
    pub protocol_version: u32,
    pub library_id: String,
    pub revision: u64,
    pub operations: BTreeMap<String, Change>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Conflict {
    pub entity: String,
    pub field: String,
    pub candidates: Vec<Change>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ViewingSession {
    pub episode_key: String,
    pub version_key: Option<String>,
    pub started_at: String,
    pub observed_at: String,
    pub position_ms: i64,
    pub duration_ms: i64,
    pub completed: bool,
    pub ended: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Episode {
    pub number: Option<i64>,
    pub sort: i64,
    pub episode_type: i64,
    pub title: String,
    pub original_title: Option<String>,
    pub description: String,
    pub air_date: Option<String>,
    pub duration: Option<String>,
}

#[derive(Debug)]
pub struct WorkView {
    pub entity: String,
    pub aliases: Vec<String>,
    pub fields: BTreeMap<String, Value>,
    pub conflicts: Vec<Conflict>,
}

fn uuid(value: &str) -> bool {
    Uuid::parse_str(value).is_ok_and(|id| id.to_string() == value)
}
pub fn valid_anchor(value: &str) -> bool {
    let parts: Vec<_> = value.split('/').collect();
    let positive = |s: &str| s.parse::<u64>().is_ok_and(|v| v > 0 && v.to_string() == s);
    match parts.as_slice() {
        ["bangumi", id] | ["tmdb", "movie", id] => positive(id),
        ["tmdb", "tv", id, "season", season] => {
            positive(id)
                && season
                    .parse::<u16>()
                    .is_ok_and(|n| n <= 999 && n.to_string() == *season)
        }
        _ => false,
    }
}
pub fn public_url(value: &str) -> bool {
    reqwest::Url::parse(value).is_ok_and(|url| {
        url.scheme() == "https"
            && url.host_str().is_some()
            && url.username().is_empty()
            && url.password().is_none()
            && url.query().is_none()
            && url.fragment().is_none()
    })
}
pub fn valid_version(value: &str) -> bool {
    if let Some(id) = value.strip_prefix("manual:") {
        return uuid(id);
    }
    let p: Vec<_> = value.split(':').collect();
    matches!(p.as_slice(), ["sha256", hash, size] if hash.len()==64
        && hash.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
        && size.parse::<u64>().is_ok_and(|n| n>0))
}
fn episode_key(key: &str) -> bool {
    key == "movie" || key.strip_prefix("bangumi/").is_some_and(|s| s.parse::<u64>().is_ok_and(|n| n > 0))
        || key.strip_prefix("tmdb/").is_some_and(|s| {
            let p: Vec<_> = s.split('/').collect();
            matches!(p.as_slice(), ["tv", id, "season", season, "episode", episode]
                if id.parse::<u64>().is_ok_and(|v| v>0) && season.parse::<u16>().is_ok_and(|v| v<=999)
                && episode.parse::<u16>().is_ok_and(|v| v>0))
        })
}
fn time(value: &str) -> bool {
    chrono::DateTime::parse_from_rfc3339(value).is_ok()
}
pub fn validate_value(field: &str, value: &Value) -> Result<()> {
    if serde_json::to_vec(value).map_err(|_| Error::Invalid)?.len() > 256 * 1024 {
        return Err(Error::Limit);
    }
    let valid = match field {
        "title" => value.as_str().is_some_and(|s| !s.trim().is_empty()),
        "description" | "notes" => value.is_string(),
        "originalTitle" => value.is_null() || value.is_string(),
        "year" => value.is_null() || value.as_i64().is_some_and(|n| (1900..=2200).contains(&n)),
        "favorite" => value.is_boolean(),
        "deleted" => value == &Value::Bool(true),
        "rating" => {
            value.is_null()
                || value
                    .as_f64()
                    .is_some_and(|n| n.is_finite() && (0.0..=10.0).contains(&n))
        }
        "status" => value.as_str().is_some_and(|s| {
            matches!(
                s,
                "planned" | "in_progress" | "completed" | "paused" | "dropped"
            )
        }),
        "coverUrl" | "bannerUrl" => value.is_null() || value.as_str().is_some_and(public_url),
        "anchor" => value.as_str().is_some_and(valid_anchor),
        s if s.starts_with("tag.") => {
            s.len() > 4 && s.len() <= 164 && !s.chars().any(char::is_control) && value.is_boolean()
        }
        s if s.starts_with("lock.") => editable_field(&s[5..]) && value.is_boolean(),
        s if s.starts_with("source.") => {
            editable_field(&s[7..])
                && value.as_str().is_some_and(|v| {
                    matches!(v, "manual" | "bangumi" | "tmdb" | "anilist" | "sync")
                })
        }
        s if s.starts_with("id.") => {
            matches!(&s[3..], "bangumi" | "tmdb" | "anilist")
                && (value.is_null()
                    || value.as_str().is_some_and(|v| {
                        !v.is_empty()
                            && v.len() <= 100
                            && v.chars().all(|c| c.is_ascii_alphanumeric() || c == '/')
                    }))
        }
        s if s.starts_with("watched.") => episode_key(&s[8..]) && value.is_boolean(),
        s if s.starts_with("episode.") => {
            episode_key(&s[8..])
                && s != "episode.movie"
                && serde_json::from_value::<Episode>(value.clone()).is_ok_and(|e| {
                    e.number.is_none_or(|n| (0..=9999).contains(&n))
                        && (0..=9999).contains(&e.sort)
                        && (0..=6).contains(&e.episode_type)
                })
        }
        s if s.starts_with("session.") => {
            uuid(&s[8..])
                && serde_json::from_value::<ViewingSession>(value.clone()).is_ok_and(|v| {
                    episode_key(&v.episode_key)
                        && v.version_key.as_deref().is_none_or(valid_version)
                        && v.duration_ms > 0
                        && v.position_ms > 0
                        && v.position_ms <= v.duration_ms
                        && time(&v.started_at)
                        && time(&v.observed_at)
                })
        }
        _ => false,
    };
    if valid {
        Ok(())
    } else {
        Err(Error::Invalid)
    }
}
pub fn editable_field(field: &str) -> bool {
    matches!(
        field,
        "title" | "originalTitle" | "description" | "year" | "coverUrl" | "bannerUrl" | "tags"
    )
}
impl Change {
    pub fn validate(&self) -> Result<()> {
        if !uuid(&self.device_id)
            || self.counter == 0
            || self.counter > i64::MAX as u64
            || self.id != format!("{}:{}", self.device_id, self.counter)
            || !self.entity.strip_prefix("work/").is_some_and(uuid)
            || !time(&self.observed_at)
            || self.context.len() > 256
            || self
                .context
                .iter()
                .any(|(id, n)| !uuid(id) || *n > i64::MAX as u64)
            || self.context.get(&self.device_id).copied().unwrap_or(0) >= self.counter
        {
            return Err(Error::Invalid);
        }
        validate_value(&self.field, &self.value)
    }
}
fn frontier(mut values: Vec<&Change>) -> Vec<&Change> {
    let mut seen = Clock::new();
    for value in &values {
        for (device, counter) in &value.context {
            seen.entry(device.clone())
                .and_modify(|n| *n = (*n).max(*counter))
                .or_insert(*counter);
        }
    }
    values.retain(|a| seen.get(&a.device_id).copied().unwrap_or(0) < a.counter);
    values.sort_by(|a, b| (a.counter, &a.device_id).cmp(&(b.counter, &b.device_id)));
    values
}
impl Document {
    pub fn empty(library_id: String) -> Self {
        Self {
            protocol_version: 1,
            library_id,
            revision: 0,
            operations: BTreeMap::new(),
        }
    }
    pub fn parse(bytes: &[u8]) -> Result<Self> {
        if bytes.len() > MAX_BYTES {
            return Err(Error::Limit);
        }
        let value: Value = serde_json::from_slice(bytes).map_err(|_| Error::Invalid)?;
        if value.get("protocolVersion").and_then(Value::as_u64) != Some(1) {
            return Err(Error::Protocol);
        }
        let document: Self = serde_json::from_value(value).map_err(|_| Error::Invalid)?;
        document.validate()?;
        Ok(document)
    }
    pub fn validate(&self) -> Result<()> {
        if self.protocol_version != 1 {
            return Err(Error::Protocol);
        }
        if !uuid(&self.library_id) || self.revision > i64::MAX as u64 {
            return Err(Error::Invalid);
        }
        for (key, change) in &self.operations {
            change.validate()?;
            if key != &change.id {
                return Err(Error::Invalid);
            }
            for (device, counter) in &change.context {
                if *counter == 0 {
                    continue;
                }
                let seen = self
                    .operations
                    .get(&format!("{device}:{counter}"))
                    .ok_or(Error::Invalid)?;
                if seen
                    .context
                    .iter()
                    .any(|(id, n)| change.context.get(id).copied().unwrap_or(0) < *n)
                {
                    return Err(Error::Invalid);
                }
            }
        }
        self.views()?;
        Ok(())
    }
    pub fn bytes(&self) -> Result<Vec<u8>> {
        self.validate()?;
        let bytes = serde_json::to_vec(self).map_err(|_| Error::Invalid)?;
        if bytes.len() > MAX_BYTES {
            return Err(Error::Limit);
        }
        Ok(bytes)
    }
    pub fn clock(&self) -> Clock {
        let mut clock = Clock::new();
        for op in self.operations.values() {
            clock
                .entry(op.device_id.clone())
                .and_modify(|n| *n = (*n).max(op.counter))
                .or_insert(op.counter);
        }
        clock
    }
    pub fn merge(&mut self, other: &Self) -> Result<()> {
        other.validate()?;
        if self.library_id != other.library_id {
            return Err(Error::Identity);
        }
        for (id, op) in &other.operations {
            if let Some(existing) = self.operations.get(id) {
                if existing != op {
                    return Err(Error::Invalid);
                }
            } else {
                self.operations.insert(id.clone(), op.clone());
            }
        }
        self.revision = self.revision.max(other.revision);
        self.validate()
    }
    pub fn views(&self) -> Result<Vec<WorkView>> {
        let mut entities: BTreeMap<&str, Vec<&Change>> = BTreeMap::new();
        for op in self.operations.values() {
            entities.entry(&op.entity).or_default().push(op);
        }
        let mut groups: BTreeMap<String, Vec<(&str, Vec<&Change>)>> = BTreeMap::new();
        for (entity, ops) in entities {
            let anchors: BTreeSet<_> = ops
                .iter()
                .filter(|v| v.field == "anchor")
                .map(|v| &v.value)
                .collect::<Vec<_>>()
                .into_iter()
                .filter_map(|v| v.as_str())
                .collect();
            if anchors.len() > 1 {
                return Err(Error::Identity);
            }
            groups
                .entry(
                    anchors
                        .first()
                        .map(|s| format!("anchor:{s}"))
                        .unwrap_or_else(|| entity.into()),
                )
                .or_default()
                .push((entity, ops));
        }
        let mut views = Vec::new();
        for mut group in groups.into_values() {
            group.sort_by_key(|v| v.0);
            let entity = group[0].0.to_string();
            let aliases = group.iter().map(|v| v.0.to_string()).collect();
            let mut by_field: BTreeMap<&str, Vec<&Change>> = BTreeMap::new();
            for (_, ops) in group {
                for op in ops {
                    by_field.entry(&op.field).or_default().push(op);
                }
            }
            let mut fields = BTreeMap::new();
            let mut conflicts = Vec::new();
            let locks: BTreeSet<_> = by_field
                .iter()
                .filter_map(|(key, ops)| {
                    key.strip_prefix("lock.").filter(|_| {
                        frontier(ops.clone())
                            .last()
                            .is_some_and(|v| v.value == Value::Bool(true))
                    })
                })
                .collect();
            for (field, mut ops) in by_field {
                if locks.contains(field) && ops.iter().any(|v| v.origin == Origin::Manual) {
                    ops.retain(|v| v.origin == Origin::Manual);
                }
                let candidates = frontier(ops);
                if let Some(op) = candidates.last() {
                    fields.insert(field.into(), op.value.clone());
                }
                if candidates.len() > 1 && candidates.iter().any(|v| v.value != candidates[0].value)
                {
                    conflicts.push(Conflict {
                        entity: entity.clone(),
                        field: field.into(),
                        candidates: candidates.into_iter().cloned().collect(),
                    });
                }
            }
            // Deletion is monotonic, regardless of unrelated edits or note conflicts.
            if fields.contains_key("deleted") {
                fields.insert("deleted".into(), Value::Bool(true));
            }
            views.push(WorkView {
                entity,
                aliases,
                fields,
                conflicts,
            });
        }
        Ok(views)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn shared_fixtures_and_causal_resolution() {
        let mut d = Document::parse(include_bytes!(
            "../../../docs/sync-v1/fixtures/concurrent-notes.json"
        ))
        .unwrap();
        let view = d.views().unwrap().remove(0);
        assert_eq!(view.conflicts.len(), 1);
        let device = Uuid::new_v4().to_string();
        let op = Change {
            id: format!("{device}:1"),
            device_id: device,
            counter: 1,
            context: d.clock(),
            entity: view.entity,
            field: "notes".into(),
            value: "合并双方".into(),
            observed_at: "2026-10-04T01:00:00Z".into(),
            origin: Origin::Manual,
        };
        d.operations.insert(op.id.clone(), op);
        assert!(d.views().unwrap()[0].conflicts.is_empty());
        assert_eq!(d.views().unwrap()[0].fields["notes"], "合并双方");
    }
    #[test]
    fn unknown_protocol_and_private_paths_are_rejected() {
        assert!(matches!(
            Document::parse(br#"{"protocolVersion":2}"#),
            Err(Error::Protocol)
        ));
        assert!(validate_value("coverUrl", &Value::String("H:/secret.jpg".into())).is_err());
        assert!(validate_value("password", &Value::String("secret".into())).is_err());
        assert!(!valid_version("sample-fingerprint"));
    }
}
