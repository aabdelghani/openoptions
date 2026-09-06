"""Tiny JSON-lines RPC over a UNIX socket, shared by daemon, CLI and UI."""
from __future__ import annotations

import json
import os
import socket
import threading
from typing import Callable

SOCKET_PATH = os.path.join(os.environ.get("XDG_RUNTIME_DIR", f"/run/user/{os.getuid()}"), "logimx.sock")


class Server:
    def __init__(self, handler: Callable[[str, dict], object], path: str = SOCKET_PATH):
        self.handler = handler
        self.path = path
        self._stop = threading.Event()
        try:
            os.unlink(path)
        except FileNotFoundError:
            pass
        self.sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self.sock.bind(path)
        os.chmod(path, 0o600)
        self.sock.listen(8)
        self.sock.settimeout(0.5)
        self._thread = threading.Thread(target=self._accept, daemon=True, name="ipc-accept")
        self._thread.start()

    def close(self):
        self._stop.set()
        try:
            self.sock.close()
            os.unlink(self.path)
        except OSError:
            pass

    def _accept(self):
        while not self._stop.is_set():
            try:
                conn, _ = self.sock.accept()
            except socket.timeout:
                continue
            except OSError:
                return
            threading.Thread(target=self._serve, args=(conn,), daemon=True).start()

    def _serve(self, conn: socket.socket):
        f = conn.makefile("rwb", buffering=0)
        try:
            for line in f:
                try:
                    req = json.loads(line)
                    result = self.handler(req.get("method", ""), req.get("params") or {})
                    resp = {"id": req.get("id"), "result": result}
                except Exception as e:  # report, keep serving
                    resp = {"id": None, "error": f"{type(e).__name__}: {e}"}
                f.write((json.dumps(resp, default=str) + "\n").encode())
        except (OSError, ValueError):
            pass
        finally:
            conn.close()


class Client:
    def __init__(self, path: str = SOCKET_PATH):
        self.path = path
        self.sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self.sock.settimeout(5.0)
        self.sock.connect(path)
        self.f = self.sock.makefile("rwb", buffering=0)
        self._id = 0

    def call(self, method: str, **params):
        self._id += 1
        self.f.write((json.dumps({"id": self._id, "method": method, "params": params}) + "\n").encode())
        while True:
            line = self.f.readline()
            if not line:
                raise ConnectionError("daemon closed the connection")
            resp = json.loads(line)
            if "event" not in resp:  # skip broadcasts on a request socket
                break
        if "error" in resp:
            raise RuntimeError(resp["error"])
        return resp["result"]

    def close(self):
        try:
            self.sock.close()
        except OSError:
            pass
