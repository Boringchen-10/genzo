//! PotPlayer's public Windows-message control protocol (InternalSimpleCmd.h).
//! Only query the process started by Genzo; never attach to an arbitrary player.
use crate::error::{AppError, AppResult};
use std::cell::RefCell;
use windows::{
    core::w,
    Win32::{
        Foundation::{HWND, LPARAM, LRESULT, WPARAM},
        System::{DataExchange::COPYDATASTRUCT, LibraryLoader::GetModuleHandleW},
        UI::WindowsAndMessaging::*,
    },
};

const COMMAND: u32 = WM_USER;
const FILE_NAME: usize = 0x6020;
thread_local! { static REPLY: RefCell<Option<String>> = const { RefCell::new(None) }; }

unsafe extern "system" fn receive(hwnd: HWND, msg: u32, wp: WPARAM, lp: LPARAM) -> LRESULT {
    if msg == WM_COPYDATA && lp.0 != 0 {
        let data = &*(lp.0 as *const COPYDATASTRUCT);
        if data.dwData == FILE_NAME
            && data.cbData > 0
            && data.cbData <= 65536
            && !data.lpData.is_null()
        {
            let bytes = std::slice::from_raw_parts(data.lpData as *const u8, data.cbData as usize);
            if let Ok(value) = std::str::from_utf8(bytes) {
                REPLY.with(|reply| {
                    *reply.borrow_mut() = Some(value.trim_end_matches('\0').to_string())
                });
            }
            return LRESULT(1);
        }
    }
    DefWindowProcW(hwnd, msg, wp, lp)
}

pub struct Client {
    receiver: HWND,
    player: HWND,
    pid: u32,
}
pub struct Sample {
    pub path: String,
    pub position: i64,
    pub duration: i64,
    pub status: i64,
}

impl Client {
    pub fn connect(pid: u32) -> AppResult<Self> {
        unsafe {
            let instance = GetModuleHandleW(None).map_err(|e| AppError::System(e.to_string()))?;
            let class = WNDCLASSW {
                lpfnWndProc: Some(receive),
                hInstance: instance.into(),
                lpszClassName: w!("GenzoPotPlayerProgress"),
                ..Default::default()
            };
            // Already registered by another session is harmless.
            RegisterClassW(&class);
            let receiver = CreateWindowExW(
                WINDOW_EX_STYLE::default(),
                class.lpszClassName,
                w!(""),
                WINDOW_STYLE::default(),
                0,
                0,
                0,
                0,
                Some(HWND_MESSAGE),
                None,
                Some(instance.into()),
                None,
            )
            .map_err(|e| AppError::System(format!("无法创建播放进度接收窗口：{e}")))?;
            Ok(Self {
                receiver,
                player: HWND::default(),
                pid,
            })
        }
    }

    fn find_player(&mut self) -> bool {
        struct Search {
            pid: u32,
            hwnd: HWND,
        }
        unsafe extern "system" fn visit(hwnd: HWND, param: LPARAM) -> windows::core::BOOL {
            let search = &mut *(param.0 as *mut Search);
            let mut pid = 0;
            GetWindowThreadProcessId(hwnd, Some(&mut pid));
            if pid == search.pid {
                let mut class = [0u16; 128];
                let length = GetClassNameW(hwnd, &mut class);
                if String::from_utf16_lossy(&class[..length.max(0) as usize])
                    .starts_with("PotPlayer")
                {
                    search.hwnd = hwnd;
                    return false.into();
                }
            }
            true.into()
        }
        unsafe {
            let mut search = Search {
                pid: self.pid,
                hwnd: HWND::default(),
            };
            let _ = EnumWindows(Some(visit), LPARAM(&mut search as *mut _ as isize));
            self.player = search.hwnd;
            !self.player.is_invalid()
        }
    }

    fn query(&self, command: usize, argument: isize) -> Option<i64> {
        let mut result = 0usize;
        unsafe {
            // No SMTO_BLOCK: allow the synchronous WM_COPYDATA reply to re-enter.
            let ok = SendMessageTimeoutW(
                self.player,
                COMMAND,
                WPARAM(command),
                LPARAM(argument),
                SMTO_ABORTIFHUNG,
                250,
                Some(&mut result),
            );
            (ok.0 != 0).then_some(result as isize as i64)
        }
    }

    pub fn sample(&mut self) -> Option<Sample> {
        if !self.find_player() {
            return None;
        }
        REPLY.with(|reply| *reply.borrow_mut() = None);
        self.query(FILE_NAME, self.receiver.0 as isize)?;
        let path = REPLY.with(|reply| reply.borrow_mut().take())?;
        let status = self.query(0x5006, 0)?;
        let duration = self.query(0x5002, 0)?;
        let position = self.query(0x5004, 0)?;
        // A playlist transition between the queries must not mix two files.
        self.query(FILE_NAME, self.receiver.0 as isize)?;
        let after = REPLY.with(|reply| reply.borrow_mut().take())?;
        if path != after {
            return None;
        }
        Some(Sample {
            path,
            position,
            duration,
            status,
        })
    }

    #[cfg(test)]
    pub fn next(&mut self) {
        if self.find_player() {
            self.query(0x5008, 1);
        }
    }

    #[cfg(test)]
    pub fn pause(&mut self) {
        if self.find_player() {
            self.query(0x5007, 1);
        }
    }

    #[cfg(test)]
    pub fn close(&mut self) {
        if self.find_player() {
            unsafe {
                let _ = PostMessageW(Some(self.player), WM_CLOSE, WPARAM(0), LPARAM(0));
            }
        }
    }
}

impl Drop for Client {
    fn drop(&mut self) {
        unsafe {
            let _ = DestroyWindow(self.receiver);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    #[ignore = "Set GENZO_POTPLAYER and GENZO_PLAYBACK_FIXTURE to generated test media; opens a test player"]
    fn installed_player_reports_file_and_seek_position() {
        let exe = std::env::var("GENZO_POTPLAYER").expect("test player path");
        let path = std::env::var("GENZO_PLAYBACK_FIXTURE").expect("generated test fixture");
        let mut child = crate::launcher::spawn_executable(
            &exe,
            &[path.clone(), "/new".into(), "/seek=10".into()],
            None,
        )
        .unwrap();
        struct Cleanup<'a>(&'a mut std::process::Child);
        impl Drop for Cleanup<'_> {
            fn drop(&mut self) {
                let _ = self.0.kill();
                let _ = self.0.wait();
            }
        }
        let cleanup = Cleanup(&mut child);
        let mut client = Client::connect(cleanup.0.id()).unwrap();
        let start = std::time::Instant::now();
        while start.elapsed().as_secs() < 20 {
            if let Some(sample) = client.sample() {
                eprintln!(
                    "fixture sample: position={} duration={} status={} identity={}",
                    sample.position,
                    sample.duration,
                    sample.status,
                    crate::playback::same_resource(&path, &sample.path)
                );
                if sample.duration > 0 && sample.position >= 9_000 {
                    assert!(crate::playback::same_resource(&path, &sample.path));
                    assert!(sample.position < 25_000);
                    return;
                }
            }
            std::thread::sleep(std::time::Duration::from_millis(300));
        }
        panic!("PotPlayer did not return a verified fixture sample within 20 seconds");
    }
}
