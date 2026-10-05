"""Loopback-only DAV fixture. Test credentials u/p. Never deploy this service publicly."""
import argparse
import hashlib
import hmac
import json
import pathlib
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

parser = argparse.ArgumentParser()
parser.add_argument("--port", type=int, default=18485)
parser.add_argument("--directory", type=pathlib.Path, required=True)
args = parser.parse_args()
args.directory.mkdir(parents=True, exist_ok=True)
lock = threading.Lock()

class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_):
        pass

    def handle_dav(self, method):
        if not hmac.compare_digest(self.headers.get("Authorization", ""), "Basic dTpw"):
            self.send_response(401); self.send_header("WWW-Authenticate", 'Basic realm="Genzo isolated test"'); self.end_headers(); return
        name = self.path.removeprefix("/")
        if "/" in name or not (name == "state.json" or name.startswith("probe-")) or not name.endswith(".json"):
            self.send_response(404); self.end_headers(); return
        target = args.directory / name
        with lock:
            data = target.read_bytes() if target.exists() else None
            etag = '"' + hashlib.sha256(data).hexdigest() + '"' if data is not None else None
            if method == "GET":
                if data is None: self.send_response(404); self.end_headers(); return
                self.send_response(200); self.send_header("ETag", etag); self.send_header("Content-Length", str(len(data))); self.end_headers(); self.wfile.write(data)
            elif method == "PUT":
                if (self.headers.get("If-None-Match") == "*" and data is not None) or (self.headers.get("If-Match") is not None and self.headers["If-Match"] != etag):
                    self.send_response(412); self.end_headers(); return
                length = int(self.headers.get("Content-Length", "0"))
                if length > 16 * 1024 * 1024: self.send_response(413); self.end_headers(); return
                payload = self.rfile.read(length)
                if len(payload) != length: return
                try: json.loads(payload)
                except ValueError: self.send_response(400); self.end_headers(); return
                temporary = target.with_suffix(".tmp")
                temporary.write_bytes(payload); temporary.replace(target)
                self.send_response(201); self.end_headers()
            else:
                target.unlink(missing_ok=True); self.send_response(204); self.end_headers()

    def do_GET(self): self.handle_dav("GET")
    def do_PUT(self): self.handle_dav("PUT")
    def do_DELETE(self): self.handle_dav("DELETE")

print(f"Genzo isolated DAV: http://127.0.0.1:{args.port}/", flush=True)
ThreadingHTTPServer(("127.0.0.1", args.port), Handler).serve_forever()
