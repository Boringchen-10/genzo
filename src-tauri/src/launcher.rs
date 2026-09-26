use crate::error::{AppError, AppResult};
use std::path::{Path, PathBuf};
use std::process::Command;

#[derive(Debug, Clone)]
pub struct TemplateContext<'a> {
    pub file: &'a str,
    pub folder: &'a str,
    pub title: &'a str,
}

pub fn expand_arguments(template: &str, context: &TemplateContext<'_>) -> AppResult<Vec<String>> {
    if template.trim().is_empty() {
        return Ok(vec![context.file.to_string()]);
    }

    let mut arguments = Vec::new();
    let mut current = String::new();
    let mut quoted = false;
    let mut token_started = false;
    let mut characters = template.chars().peekable();

    while let Some(character) = characters.next() {
        match character {
            '"' => {
                quoted = !quoted;
                token_started = true;
            }
            '\\' if characters.peek() == Some(&'"') => {
                characters.next();
                current.push('"');
                token_started = true;
            }
            value if value.is_whitespace() && !quoted => {
                if token_started {
                    arguments.push(replace_placeholders(&current, context));
                    current.clear();
                    token_started = false;
                }
            }
            value => {
                current.push(value);
                token_started = true;
            }
        }
    }

    if quoted {
        return Err(AppError::Validation(
            "参数模板中存在未闭合的双引号".to_string(),
        ));
    }
    if token_started {
        arguments.push(replace_placeholders(&current, context));
    }
    Ok(arguments)
}

fn replace_placeholders(value: &str, context: &TemplateContext<'_>) -> String {
    value
        .replace("{file}", context.file)
        .replace("{folder}", context.folder)
        .replace("{title}", context.title)
}

pub fn launch_executable(
    executable_path: &str,
    arguments: &[String],
    working_directory: Option<&str>,
) -> AppResult<()> {
    spawn_executable(executable_path, arguments, working_directory).map(|_| ())
}

pub fn spawn_executable(
    executable_path: &str,
    arguments: &[String],
    working_directory: Option<&str>,
) -> AppResult<std::process::Child> {
    let executable = Path::new(executable_path);
    if !executable.is_file() {
        return Err(AppError::PathNotFound(executable.to_path_buf()));
    }
    let mut command = Command::new(executable);
    command.args(arguments);
    if let Some(directory) = working_directory.filter(|value| !value.trim().is_empty()) {
        command.current_dir(directory);
    }
    command
        .spawn()
        .map_err(|error| AppError::Launch(format!("{}（{error}）", executable.display())))
}

pub fn launch_game(path: &str) -> AppResult<()> {
    let shell_path = shell_compatible_path(path);
    let file = Path::new(&shell_path);
    if !file.is_file() {
        return Err(AppError::PathNotFound(file.to_path_buf()));
    }
    match file
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase()
        .as_str()
    {
        "exe" => launch_executable(&shell_path, &[], file.parent().and_then(Path::to_str)),
        "lnk" | "bat" | "cmd" => shell_open(file),
        _ => Err(AppError::Validation(
            "该文件不是受支持的游戏启动项".to_string(),
        )),
    }
}

pub fn open_with_system(path: &str) -> AppResult<()> {
    let shell_path = shell_compatible_path(path);
    let file = Path::new(&shell_path);
    if !file.exists() {
        return Err(AppError::PathNotFound(file.to_path_buf()));
    }
    shell_open(file)
}

pub fn open_directory(path: &str) -> AppResult<()> {
    let shell_path = shell_compatible_path(path);
    let file = Path::new(&shell_path);
    if !file.exists() {
        return Err(AppError::PathNotFound(file.to_path_buf()));
    }
    let directory = if file.is_dir() {
        file.to_path_buf()
    } else {
        file.parent()
            .map(Path::to_path_buf)
            .ok_or_else(|| AppError::Validation("无法确定文件所在目录".to_string()))?
    };
    shell_open(&directory)
}

/// Windows file APIs accept extended paths (`\\?\UNC\...`), but Explorer and
/// ShellExecute expect the ordinary UNC form. Keep the extended form in the
/// index for scanning, and normalize only at the external application boundary.
pub(crate) fn shell_compatible_path(path: &str) -> String {
    if let Some(unc) = path.strip_prefix(r"\\?\UNC\") {
        return format!(r"\\{unc}");
    }
    if let Some(local) = path.strip_prefix(r"\\?\") {
        return local.to_string();
    }
    path.to_string()
}

#[cfg(windows)]
fn shell_open(path: &Path) -> AppResult<()> {
    use windows::core::{HSTRING, PCWSTR};
    use windows::Win32::UI::Shell::ShellExecuteW;
    use windows::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;

    let operation = HSTRING::from("open");
    let target = HSTRING::from(path.as_os_str());
    let result = unsafe {
        ShellExecuteW(
            None,
            PCWSTR(operation.as_ptr()),
            PCWSTR(target.as_ptr()),
            PCWSTR::null(),
            PCWSTR::null(),
            SW_SHOWNORMAL,
        )
    };
    if result.0 as isize <= 32 {
        Err(AppError::Launch(format!(
            "Windows 无法打开 {}（错误代码 {}）",
            path.display(),
            result.0 as isize
        )))
    } else {
        Ok(())
    }
}

#[cfg(not(windows))]
fn shell_open(_path: &Path) -> AppResult<()> {
    Err(AppError::System(
        "v0.1 的系统默认打开功能仅支持 Windows".to_string(),
    ))
}

pub fn parent_folder(path: &str) -> String {
    PathBuf::from(path)
        .parent()
        .map(|value| value.to_string_lossy().to_string())
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn expands_template_to_structured_arguments() {
        let context = TemplateContext {
            file: r#"D:\Anime\Episode 01.mkv"#,
            folder: r#"D:\Anime"#,
            title: "示例动画",
        };
        let arguments = expand_arguments(
            r#"--fullscreen "{file}" --title="{title}" "{folder}""#,
            &context,
        )
        .expect("expand template");
        assert_eq!(
            arguments,
            vec![
                "--fullscreen",
                r#"D:\Anime\Episode 01.mkv"#,
                "--title=示例动画",
                r#"D:\Anime"#
            ]
        );
    }

    #[test]
    fn uses_file_as_default_argument() {
        let context = TemplateContext {
            file: "C:\\book.pdf",
            folder: "C:\\",
            title: "Book",
        };
        assert_eq!(
            expand_arguments("", &context).expect("default arguments"),
            vec!["C:\\book.pdf"]
        );
    }

    #[test]
    fn rejects_unclosed_quote() {
        let context = TemplateContext {
            file: "file",
            folder: "folder",
            title: "title",
        };
        assert!(expand_arguments("\"{file}", &context).is_err());
    }

    #[test]
    fn converts_extended_unc_paths_for_windows_shell() {
        assert_eq!(
            shell_compatible_path(r"\\?\UNC\RaiDrive-Administrator\夸克\电影\file.mkv"),
            r"\\RaiDrive-Administrator\夸克\电影\file.mkv"
        );
        assert_eq!(shell_compatible_path(r"\\?\C:\Anime\file.mkv"), r"C:\Anime\file.mkv");
    }
}
