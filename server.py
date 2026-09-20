#!/usr/bin/env python3
"""Petit serveur local pour le convertisseur Yuno 300.

Améliorations par rapport à `python -m http.server` :
- sert ffmpeg-core.wasm compressé en gzip (≈10 Mo au lieu de 31 Mo) ;
- types MIME corrects (.wasm -> application/wasm, .js -> text/javascript) ;
- Cache-Control : no-cache sur vendor/ (revalidation rapide, jamais un vieux
  moteur), no-store sur l'application ;
- CORS ouvert (pratique pour tester).
"""
import gzip
import http.server
import os
import socketserver
import sys

ROOT = os.path.dirname(os.path.abspath(__file__))
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8080
WASM = os.path.join(ROOT, 'vendor', 'core', 'ffmpeg-core.wasm')
WASM_GZ = WASM + '.gz'

# Pré-compression du moteur (une seule fois) : réduit fortement le temps de
# chargement à travers un proxy / une connexion lente.
if os.path.exists(WASM) and not os.path.exists(WASM_GZ):
    print('Compression du moteur (une seule fois)…')
    with open(WASM, 'rb') as f_in, gzip.open(WASM_GZ, 'wb', compresslevel=6) as f_out:
        f_out.write(f_in.read())

Handler = http.server.SimpleHTTPRequestHandler


class H(Handler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    extensions_map = {
        **http.server.SimpleHTTPRequestHandler.extensions_map,
        '.wasm': 'application/wasm',
        '.js': 'text/javascript',
        '.mjs': 'text/javascript',
    }

    def send_head(self):
        # Version gzip du wasm si le navigateur l'accepte (toujours le cas).
        if self.translate_path(self.path) == WASM and os.path.exists(WASM_GZ):
            if 'gzip' in self.headers.get('Accept-Encoding', ''):
                f = open(WASM_GZ, 'rb')
                self.send_response(200)
                self.send_header('Content-Type', 'application/wasm')
                self.send_header('Content-Encoding', 'gzip')
                self.send_header('Content-Length', str(os.path.getsize(WASM_GZ)))
                self.end_headers()
                return f
        return super().send_head()

    def end_headers(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        p = self.path.split('?')[0]
        self.send_header('Cache-Control',
                         'no-cache' if p.startswith('/vendor/') else 'no-store')
        super().end_headers()

    def log_message(self, *args):
        pass


socketserver.ThreadingTCPServer.allow_reuse_address = True
with socketserver.ThreadingTCPServer(('0.0.0.0', PORT), H) as srv:
    print(f'Convertisseur Yuno 300 : http://localhost:{PORT}/')
    srv.serve_forever()
