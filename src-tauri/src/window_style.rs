#[cfg(windows)]
mod windows_style {
    use std::mem::size_of;
    use std::sync::atomic::{AtomicBool, Ordering};

    use windows::Win32::{
        Foundation::{HWND, LPARAM, LRESULT, POINT, RECT, WPARAM},
        Graphics::{
            Dwm::{
                DwmSetWindowAttribute, DWMWA_BORDER_COLOR, DWMWA_COLOR_NONE,
                DWMWA_WINDOW_CORNER_PREFERENCE, DWMWCP_ROUND,
            },
            Gdi::ScreenToClient,
        },
        UI::{
            HiDpi::GetDpiForWindow,
            Shell::{DefSubclassProc, SetWindowSubclass},
            WindowsAndMessaging::{GetClientRect, HTMAXBUTTON, WM_NCHITTEST},
        },
    };

    const TITLEBAR_HEIGHT: i32 = 40;
    const CAPTION_BUTTON_WIDTH: i32 = 46;
    const SUBCLASS_ID: usize = 0x4745_4e5a;
    static NATIVE_MATERIAL_SUPPORTED: AtomicBool = AtomicBool::new(false);

    unsafe extern "system" fn snap_layout_subclass(
        hwnd: HWND,
        message: u32,
        wparam: WPARAM,
        lparam: LPARAM,
        _subclass_id: usize,
        _reference_data: usize,
    ) -> LRESULT {
        if message == WM_NCHITTEST {
            let mut point = POINT {
                x: lparam.0 as i16 as i32,
                y: (lparam.0 >> 16) as i16 as i32,
            };
            let mut client_rect = RECT::default();
            let dpi = unsafe { GetDpiForWindow(hwnd) }.max(96) as i32;
            let titlebar_height = TITLEBAR_HEIGHT * dpi / 96;
            let button_width = CAPTION_BUTTON_WIDTH * dpi / 96;

            if unsafe { ScreenToClient(hwnd, &mut point) }.as_bool()
                && unsafe { GetClientRect(hwnd, &mut client_rect) }.is_ok()
                && point.y >= 0
                && point.y < titlebar_height
                && point.x >= client_rect.right - button_width * 2
                && point.x < client_rect.right - button_width
            {
                return LRESULT(HTMAXBUTTON as isize);
            }
        }

        unsafe { DefSubclassProc(hwnd, message, wparam, lparam) }
    }

    pub fn apply(window: &tauri::WebviewWindow) {
        let Ok(hwnd) = window.hwnd() else {
            return;
        };

        unsafe {
            let border_color = DWMWA_COLOR_NONE;
            let supports_windows_11_frame = DwmSetWindowAttribute(
                hwnd,
                DWMWA_BORDER_COLOR,
                &border_color as *const _ as _,
                size_of::<u32>() as u32,
            )
            .is_ok();

            // Windows 10 keeps the stable borderless fallback. Windows 11 can retain
            // the native shadow and rounded corners without drawing a full frame.
            if supports_windows_11_frame {
                NATIVE_MATERIAL_SUPPORTED.store(true, Ordering::Relaxed);
                let _ = window.set_shadow(true);
                let corner = DWMWCP_ROUND;
                let _ = DwmSetWindowAttribute(
                    hwnd,
                    DWMWA_WINDOW_CORNER_PREFERENCE,
                    &corner as *const _ as _,
                    size_of_val(&corner) as u32,
                );
                let _ = DwmSetWindowAttribute(
                    hwnd,
                    DWMWA_BORDER_COLOR,
                    &border_color as *const _ as _,
                    size_of::<u32>() as u32,
                );

                // Returning HTMAXBUTTON for the matching HTML control lets Windows 11
                // expose its familiar Snap Layout flyout while keyboard activation
                // continues to use the accessible React button.
                let _ = SetWindowSubclass(hwnd, Some(snap_layout_subclass), SUBCLASS_ID, 0);
            }
        }
    }

    pub fn native_material_supported() -> bool {
        NATIVE_MATERIAL_SUPPORTED.load(Ordering::Relaxed)
    }
}

#[cfg(windows)]
pub use windows_style::{apply, native_material_supported};

#[cfg(not(windows))]
pub fn apply(_window: &tauri::WebviewWindow) {}

#[cfg(not(windows))]
pub fn native_material_supported() -> bool {
    false
}

#[tauri::command]
pub fn window_material_supported() -> bool {
    native_material_supported()
}
