//! Lexical comparison only. Stored paths retain their original representation.
pub fn normalized(path: &str) -> String {
    let path = path.replace('\\', "/");
    let path = if path
        .get(..8)
        .is_some_and(|p| p.eq_ignore_ascii_case("//?/UNC/"))
    {
        format!("//{}", &path[8..])
    } else if path.starts_with("//?/") && path.as_bytes().get(5) == Some(&b':') {
        path[4..].to_string()
    } else {
        path
    };
    path.trim_end_matches('/').to_string()
}

pub fn key(path: &str) -> String {
    normalized(path).to_lowercase()
}

pub fn relative(path: &str, root: &str) -> Option<String> {
    let path = normalized(path);
    let root = normalized(root);
    if key(&path) == key(&root) {
        return Some(String::new());
    }
    let prefix = path.get(..root.len())?;
    if prefix.eq_ignore_ascii_case(&root) && path.as_bytes().get(root.len()) == Some(&b'/') {
        Some(path[root.len() + 1..].to_string())
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn unc_drive_and_webdav_roots() {
        assert_eq!(
            relative(r"\\?\UNC\Server\Share\Show\[01].mkv", r"\\server\share\"),
            Some("Show/[01].mkv".into())
        );
        assert_eq!(
            relative(r"\\?\R:\Anime\Show\01.mkv", "r:/anime/"),
            Some("Show/01.mkv".into())
        );
        assert_eq!(
            relative("webdav://root/ab/cd", "webdav://root/"),
            Some("ab/cd".into())
        );
        assert_eq!(relative(r"R:\Anime2\01.mkv", r"R:\Anime"), None);
    }
}
