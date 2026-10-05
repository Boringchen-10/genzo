//! Isolated HTTP service with authentication, strong ETags and controllable faults.
use std::{
    collections::BTreeMap,
    io::{Read, Write},
    net::{TcpListener, TcpStream},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    thread,
};

#[derive(Default)]
pub struct Faults {
    pub ignore_conditions: bool,
    pub lose_put_response: bool,
    pub fail_get: bool,
    pub weak_etag: bool,
    pub unauthorized: bool,
}
pub struct Server {
    pub url: String,
    pub faults: Arc<Mutex<Faults>>,
    files: Arc<Mutex<BTreeMap<String, (Vec<u8>, usize)>>>,
    stopped: Arc<AtomicBool>,
    thread: Option<thread::JoinHandle<()>>,
}
impl Server {
    pub fn start() -> Self {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://{}/", listener.local_addr().unwrap());
        let faults = Arc::new(Mutex::new(Faults::default()));
        let files = Arc::new(Mutex::new(BTreeMap::new()));
        let stopped = Arc::new(AtomicBool::new(false));
        let f = faults.clone();
        let data = files.clone();
        let stop = stopped.clone();
        let thread = thread::spawn(move || {
            for stream in listener.incoming() {
                if stop.load(Ordering::Relaxed) {
                    break;
                }
                if let Ok(stream) = stream {
                    serve(stream, &f, &data);
                }
            }
        });
        Self {
            url,
            faults,
            files,
            stopped,
            thread: Some(thread),
        }
    }
    pub fn document(&self) -> Vec<u8> {
        self.files.lock().unwrap()["/state.json"].0.clone()
    }
    pub fn replace(&self, bytes: Vec<u8>) {
        self.files
            .lock()
            .unwrap()
            .insert("/state.json".into(), (bytes, 9999));
    }
}
impl Drop for Server {
    fn drop(&mut self) {
        self.stopped.store(true, Ordering::Relaxed);
        let address = self.url.trim_start_matches("http://").trim_end_matches('/');
        let _ = TcpStream::connect(address);
        if let Some(handle) = self.thread.take() {
            let _ = handle.join();
        }
    }
}
fn serve(
    mut stream: TcpStream,
    faults: &Mutex<Faults>,
    files: &Mutex<BTreeMap<String, (Vec<u8>, usize)>>,
) {
    stream
        .set_read_timeout(Some(std::time::Duration::from_secs(5)))
        .unwrap();
    let mut bytes = Vec::new();
    let mut buf = [0u8; 4096];
    let end = loop {
        let Ok(n) = stream.read(&mut buf) else {
            return;
        };
        if n == 0 {
            return;
        }
        bytes.extend_from_slice(&buf[..n]);
        if let Some(at) = bytes.windows(4).position(|w| w == b"\r\n\r\n") {
            break at + 4;
        }
    };
    let headers = String::from_utf8_lossy(&bytes[..end]).to_string();
    let mut lines = headers.lines();
    let first: Vec<_> = lines.next().unwrap().split(' ').collect();
    let method = first[0];
    let path = first[1];
    let headers: BTreeMap<_, _> = lines
        .filter_map(|s| s.split_once(':'))
        .map(|(k, v)| (k.to_lowercase(), v.trim().to_string()))
        .collect();
    let length: usize = headers
        .get("content-length")
        .and_then(|s| s.parse().ok())
        .unwrap_or(0);
    while bytes.len() < end + length {
        let Ok(n) = stream.read(&mut buf) else {
            return;
        };
        if n == 0 {
            return;
        }
        bytes.extend_from_slice(&buf[..n]);
    }
    let mut f = faults.lock().unwrap();
    let mut data = files.lock().unwrap();
    let mut code = 200;
    let mut body = Vec::new();
    let mut etag = String::new();
    if f.unauthorized || headers.get("authorization").map(String::as_str) != Some("Basic dTpw") {
        code = 401;
    } else {
        let current = data.get(path).map(|v| format!("\"{}\"", v.1));
        match method {
            "GET" => {
                if path == "/state.json" && f.fail_get {
                    f.fail_get = false;
                    code = 503;
                } else if let Some((value, rev)) = data.get(path) {
                    body = value.clone();
                    etag = format!("{}\"{rev}\"", if f.weak_etag { "W/" } else { "" });
                } else {
                    code = 404;
                }
            }
            "PUT" => {
                if !f.ignore_conditions
                    && ((headers.get("if-none-match").is_some() && current.is_some())
                        || headers
                            .get("if-match")
                            .is_some_and(|v| Some(v) != current.as_ref()))
                {
                    code = 412;
                } else {
                    let rev = data.get(path).map(|v| v.1 + 1).unwrap_or(1);
                    data.insert(path.into(), (bytes[end..end + length].to_vec(), rev));
                    code = 201;
                    if path == "/state.json" && f.lose_put_response {
                        f.lose_put_response = false;
                        return;
                    }
                }
            }
            "DELETE" => {
                data.remove(path);
                code = 204;
            }
            _ => code = 405,
        }
    }
    let extra = if etag.is_empty() {
        String::new()
    } else {
        format!("ETag: {etag}\r\n")
    };
    let header = format!(
        "HTTP/1.1 {code} Test\r\nContent-Length: {}\r\n{extra}Connection: close\r\n\r\n",
        body.len()
    );
    let _ = stream.write_all(header.as_bytes());
    let _ = stream.write_all(&body);
}
