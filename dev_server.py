#!/usr/bin/env python3
# ============================================================
# 彼方への手紙 — 開発サーバー
# 静的配信 + エディタ(?debug)の焼き込み書き出しAPI
#
# 使い方:  python3 dev_server.py [port]   （既定: 8000）
#   GET  /api/contents-list  assets/contents 内のファイル名一覧
#   POST /api/bake           画像(base64)と js/baked.js を直接書き込む
#
# ※ 公開ファイルではない（GitHub Pages には不要）
# ============================================================
import base64
import json
import re
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent
CONTENTS_DIR = ROOT / 'assets' / 'contents'
BAKED_JS = ROOT / 'js' / 'baked.js'
NAME_RE = re.compile(r'^[A-Za-z0-9._-]+$')  # パス区切りを含む名前は拒否


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def end_headers(self):
        # 開発用: 静的ファイルをキャッシュさせない（画像差し替え等を常に即反映）
        self.send_header('Cache-Control', 'no-cache')
        super().end_headers()

    def _json(self, code, obj):
        body = json.dumps(obj, ensure_ascii=False).encode('utf-8')
        self.send_response(code)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path.split('?')[0] == '/api/contents-list':
            CONTENTS_DIR.mkdir(parents=True, exist_ok=True)
            names = sorted(p.name for p in CONTENTS_DIR.iterdir() if p.is_file())
            self._json(200, {'ok': True, 'files': names})
            return
        super().do_GET()

    def do_POST(self):
        if self.path.split('?')[0] != '/api/bake':
            self._json(404, {'ok': False, 'error': 'not found'})
            return
        try:
            length = int(self.headers.get('Content-Length', 0))
            payload = json.loads(self.rfile.read(length).decode('utf-8'))
            written = []

            CONTENTS_DIR.mkdir(parents=True, exist_ok=True)
            for f in payload.get('files', []):
                name = f.get('name', '')
                if not NAME_RE.match(name):
                    raise ValueError(f'不正なファイル名: {name!r}')
                data = base64.b64decode(f['dataBase64'])
                (CONTENTS_DIR / name).write_bytes(data)
                written.append(f'assets/contents/{name}')

            baked = payload.get('baked')
            if isinstance(baked, str) and baked.strip():
                BAKED_JS.write_text(baked, encoding='utf-8')
                written.append('js/baked.js')

            self._json(200, {'ok': True, 'written': written})
            print(f'[bake] {len(written)} ファイル書き込み: {", ".join(written)}')
        except Exception as e:  # noqa: BLE001 — エラー内容をそのままエディタへ返す
            self._json(500, {'ok': False, 'error': str(e)})


if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    server = ThreadingHTTPServer(('127.0.0.1', port), Handler)
    print(f'配信中: http://localhost:{port}/  （エディタ: http://localhost:{port}/?debug）')
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
