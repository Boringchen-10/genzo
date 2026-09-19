use crate::error::{AppError, AppResult};
use std::path::Path;

/// Only visible cards request extraction. Hold the permit inside the blocking
/// task: timing out the caller must not allow unlimited stuck Shell handlers.
pub async fn extract_on_demand(
    source: std::path::PathBuf,
    destination: std::path::PathBuf,
) -> AppResult<Option<bool>> {
    use std::sync::{Arc, OnceLock};
    use std::time::Duration;
    static SLOTS: OnceLock<Arc<tokio::sync::Semaphore>> = OnceLock::new();
    let slots = SLOTS
        .get_or_init(|| Arc::new(tokio::sync::Semaphore::new(2)))
        .clone();
    let Ok(Ok(permit)) = tokio::time::timeout(Duration::from_secs(20), slots.acquire_owned()).await
    else {
        return Ok(None);
    };
    let task = tauri::async_runtime::spawn_blocking(move || {
        let _permit = permit;
        extract_video_thumbnail(&source, &destination)
    });
    match tokio::time::timeout(Duration::from_secs(20), task).await {
        Ok(Ok(result)) => result.map(Some),
        Ok(Err(error)) => Err(AppError::System(format!("视频缩略图任务失败：{error}"))),
        Err(_) => Ok(None),
    }
}

fn shell_thumbnail_path(path: &Path) -> std::path::PathBuf {
    let value = path.to_string_lossy();
    if value
        .get(..8)
        .is_some_and(|prefix| prefix.eq_ignore_ascii_case(r"\\?\UNC\"))
    {
        std::path::PathBuf::from(format!(r"\\{}", &value[8..]))
    } else if value.starts_with(r"\\?\") && value.as_bytes().get(5) == Some(&b':') {
        std::path::PathBuf::from(&value[4..])
    } else {
        path.to_path_buf()
    }
}

#[cfg(windows)]
pub fn extract_video_thumbnail(source: &Path, destination: &Path) -> AppResult<bool> {
    use std::os::windows::ffi::OsStrExt;
    use windows::core::{Interface, PCWSTR};
    use windows::Win32::Foundation::{RPC_E_CHANGED_MODE, SIZE};
    use windows::Win32::System::Com::{
        CoCreateInstance, CoInitializeEx, CoUninitialize, CLSCTX_INPROC_SERVER,
        COINIT_APARTMENTTHREADED,
    };
    use windows::Win32::UI::Shell::{
        ISharedBitmap, IShellItem, IShellItemImageFactory, IThumbnailCache, LocalThumbnailCache,
        SHCreateItemFromParsingName, SIIGBF, SIIGBF_BIGGERSIZEOK, SIIGBF_INCACHEONLY,
        SIIGBF_SCALEUP, SIIGBF_THUMBNAILONLY, WTS_INCACHEONLY,
    };

    if !source.is_file() {
        return Ok(false);
    }
    let shell_path = shell_thumbnail_path(source);
    let mut wide = shell_path.as_os_str().encode_wide().collect::<Vec<_>>();
    wide.push(0);
    let initialize = unsafe { CoInitializeEx(None, COINIT_APARTMENTTHREADED) };
    let should_uninitialize = initialize.is_ok();
    if initialize.is_err() && initialize != RPC_E_CHANGED_MODE {
        return Err(AppError::System(format!(
            "无法初始化 Windows 缩略图服务：{}",
            initialize.message()
        )));
    }

    let result = (|| -> AppResult<bool> {
        let item: IShellItem = unsafe {
            SHCreateItemFromParsingName(PCWSTR(wide.as_ptr()), None)
                .map_err(|error| AppError::System(format!("无法读取视频缩略图：{error}")))?
        };
        if let Ok(cache) = unsafe {
            CoCreateInstance::<_, IThumbnailCache>(&LocalThumbnailCache, None, CLSCTX_INPROC_SERVER)
        } {
            let mut shared: Option<ISharedBitmap> = None;
            if unsafe {
                cache.GetThumbnail(
                    &item,
                    640,
                    WTS_INCACHEONLY,
                    Some(&raw mut shared),
                    None,
                    None,
                )
            }
            .is_ok()
            {
                if let Some(shared) = shared {
                    if let Ok(bitmap) = unsafe { shared.GetSharedBitmap() } {
                        return bitmap_to_jpeg(bitmap, destination);
                    }
                }
            }
        }
        let factory: IShellItemImageFactory = item
            .cast()
            .map_err(|error| AppError::System(format!("无法初始化视频缩略图处理器：{error}")))?;
        let requests = [
            (
                SIZE { cx: 256, cy: 256 },
                SIIGBF(SIIGBF_THUMBNAILONLY.0 | SIIGBF_INCACHEONLY.0),
            ),
            (
                SIZE { cx: 640, cy: 360 },
                SIIGBF(SIIGBF_THUMBNAILONLY.0 | SIIGBF_BIGGERSIZEOK.0 | SIIGBF_SCALEUP.0),
            ),
            (SIZE { cx: 320, cy: 180 }, SIIGBF_THUMBNAILONLY),
            (SIZE { cx: 256, cy: 256 }, SIIGBF_THUMBNAILONLY),
        ];
        let mut last_error = None;
        let bitmap = requests.into_iter().find_map(|(size, flags)| {
            match unsafe { factory.GetImage(size, flags) } {
                Ok(bitmap) => Some(bitmap),
                Err(error) => {
                    last_error = Some(error);
                    None
                }
            }
        });
        let Some(bitmap) = bitmap else {
            #[cfg(test)]
            if let Some(error) = last_error {
                eprintln!("Windows Shell thumbnail unavailable: {error}");
            }
            return Ok(false);
        };
        let converted = bitmap_to_jpeg(bitmap, destination);
        unsafe {
            use windows::Win32::Graphics::Gdi::{DeleteObject, HGDIOBJ};
            let _ = DeleteObject(HGDIOBJ(bitmap.0));
        }
        converted
    })();
    if should_uninitialize {
        unsafe { CoUninitialize() };
    }
    result
}

#[cfg(windows)]
fn bitmap_to_jpeg(
    bitmap: windows::Win32::Graphics::Gdi::HBITMAP,
    destination: &Path,
) -> AppResult<bool> {
    use image::codecs::jpeg::JpegEncoder;
    use image::RgbImage;
    use std::ffi::c_void;
    use std::fs::File;
    use std::io::BufWriter;
    use std::mem::size_of;
    use windows::Win32::Graphics::Gdi::{
        GetDC, GetDIBits, GetObjectW, ReleaseDC, BITMAP, BITMAPINFO, BITMAPINFOHEADER, BI_RGB,
        DIB_RGB_COLORS, HGDIOBJ,
    };

    let mut metadata = BITMAP::default();
    let object_size = i32::try_from(size_of::<BITMAP>())
        .map_err(|_| AppError::System("Windows 位图结构尺寸无效".to_string()))?;
    if unsafe {
        GetObjectW(
            HGDIOBJ(bitmap.0),
            object_size,
            Some((&raw mut metadata).cast::<c_void>()),
        )
    } == 0
    {
        return Err(AppError::System("Windows 缩略图返回了无效位图".to_string()));
    }
    let width = metadata.bmWidth.unsigned_abs();
    let height = metadata.bmHeight.unsigned_abs();
    if width < 80 || height < 45 || width > 4096 || height > 4096 {
        return Ok(false);
    }
    let byte_len = usize::try_from(u64::from(width) * u64::from(height) * 4)
        .map_err(|_| AppError::System("视频缩略图尺寸超出限制".to_string()))?;
    let mut pixels = vec![0_u8; byte_len];
    let mut info = BITMAPINFO {
        bmiHeader: BITMAPINFOHEADER {
            biSize: u32::try_from(size_of::<BITMAPINFOHEADER>()).unwrap_or_default(),
            biWidth: i32::try_from(width).unwrap_or_default(),
            biHeight: -i32::try_from(height).unwrap_or_default(),
            biPlanes: 1,
            biBitCount: 32,
            biCompression: BI_RGB.0,
            ..Default::default()
        },
        ..Default::default()
    };
    let hdc = unsafe { GetDC(None) };
    if hdc.0.is_null() {
        return Err(AppError::System("无法读取 Windows 缩略图像素".to_string()));
    }
    let copied = unsafe {
        GetDIBits(
            hdc,
            bitmap,
            0,
            height,
            Some(pixels.as_mut_ptr().cast::<c_void>()),
            &mut info,
            DIB_RGB_COLORS,
        )
    };
    unsafe { ReleaseDC(None, hdc) };
    if copied == 0 {
        return Err(AppError::System("Windows 缩略图像素读取失败".to_string()));
    }
    let mut rgb = Vec::with_capacity(
        usize::try_from(u64::from(width) * u64::from(height) * 3).unwrap_or_default(),
    );
    for pixel in pixels.as_chunks::<4>().0 {
        rgb.extend_from_slice(&[pixel[2], pixel[1], pixel[0]]);
    }
    let image = RgbImage::from_raw(width, height, rgb)
        .ok_or_else(|| AppError::System("Windows 缩略图像素布局无效".to_string()))?;
    if let Some(parent) = destination.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let output = File::create(destination)?;
    JpegEncoder::new_with_quality(BufWriter::new(output), 86)
        .encode_image(&image)
        .map_err(|error| AppError::System(format!("视频缩略图写入失败：{error}")))?;
    Ok(true)
}

#[cfg(not(windows))]
pub fn extract_video_thumbnail(_source: &Path, _destination: &Path) -> AppResult<bool> {
    Ok(false)
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;

    #[test]
    fn converts_extended_paths_only_for_shell_thumbnail_boundary() {
        assert_eq!(
            shell_thumbnail_path(Path::new(r"\\?\UNC\server\share\01.mkv")),
            Path::new(r"\\server\share\01.mkv")
        );
        assert_eq!(
            shell_thumbnail_path(Path::new(r"\\?\R:\Anime\01.mkv")),
            Path::new(r"R:\Anime\01.mkv")
        );
        assert_eq!(
            shell_thumbnail_path(Path::new(r"R:\Anime\01.mkv")),
            Path::new(r"R:\Anime\01.mkv")
        );
    }

    #[test]
    #[ignore = "requires GENZO_THUMBNAIL_TEST_FILE pointing to a local video"]
    fn extracts_real_windows_shell_video_thumbnail() {
        let source = std::env::var("GENZO_THUMBNAIL_TEST_FILE").expect("test video path");
        let directory = tempfile::tempdir().expect("temporary thumbnail directory");
        let destination = directory.path().join("thumbnail.jpg");
        assert!(
            extract_video_thumbnail(Path::new(&source), &destination).expect("extract thumbnail")
        );
        assert!(destination.metadata().expect("thumbnail metadata").len() > 1_000);
    }
}
