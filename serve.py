#!/usr/bin/env python3
"""
Static server for local development only (the deployed app does not use it).

`python3 -m http.server` only queues 5 connections; Chrome requests every
module at once and macOS drops the ones that do not fit (ERR_CONNECTION_RESET),
so app.js never runs. This server enlarges the queue, listens on IPv4 and
IPv6 and disables caching so the latest version is always served.

Usage:
    python3 serve.py            # http://localhost:8000
    python3 serve.py 8080
"""

import socket
import sys
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


class Handler(SimpleHTTPRequestHandler):
    extensions_map = {**SimpleHTTPRequestHandler.extensions_map, ".js": "text/javascript"}

    def end_headers(self):
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()


class Server(ThreadingHTTPServer):
    address_family = socket.AF_INET6
    request_queue_size = 128

    def server_bind(self):
        # Dual stack: also accepts IPv4 (127.0.0.1)
        self.socket.setsockopt(socket.IPPROTO_IPV6, socket.IPV6_V6ONLY, 0)
        super().server_bind()


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    handler = partial(Handler, directory=str(Path(__file__).resolve().parent))
    with Server(("::", port), handler) as server:
        print(f"Treadwise: http://localhost:{port}  (Ctrl+C to quit)")
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass


if __name__ == "__main__":
    main()
