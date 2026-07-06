#!/usr/bin/env python3
# Altıgen yerel geliştirme sunucusu — Vercel'deki /api/riot fonksiyonunun birebir yerel karşılığı.
# Çalıştırma:  python sunucu.py   (Windows: py sunucu.py)  ->  http://localhost:8017
import json, os, sys, urllib.request, urllib.error
from http.server import HTTPServer, SimpleHTTPRequestHandler

PORT = 8017
KLASOR = os.path.dirname(os.path.abspath(__file__))
os.chdir(KLASOR)

def anahtar_oku():
    ortam = os.environ.get('RIOT_API_KEY', '').strip()
    if ortam.startswith('RGAPI-'):
        return ortam
    yol = os.path.join(KLASOR, 'anahtar.txt')
    try:
        k = open(yol, encoding='utf-8').read().strip()
    except FileNotFoundError:
        sys.exit('Anahtar yok: RIOT_API_KEY ortam degiskeni ya da anahtar.txt gerekli. '
                 'anahtar.ornek.txt dosyasini anahtar.txt yapip icine RGAPI-... yazin.')
    if not k.startswith('RGAPI-'):
        sys.exit('anahtar.txt icerigi RGAPI- ile baslamali.')
    return k

KEY = anahtar_oku()
IZINLI_HOST = {'tr1','euw1','eun1','na1','kr','europe','americas','asia'}

class Vekil(SimpleHTTPRequestHandler):
    def do_GET(self):
        yol = self.path
        if yol.startswith('/riot/'):          # eski yol da desteklenir
            yol = '/api' + yol
        if yol.startswith('/api/riot?'):      # yeni sorgu bicimi: ?u=host/yol
            from urllib.parse import urlparse, parse_qs, unquote
            u = unquote(parse_qs(urlparse(yol).query).get('u', [''])[0])
            yol = '/api/riot/' + u
        if yol == '/api/riot':
            self.send_response(200); self.send_header('Content-Type','application/json'); self.end_headers()
            self.wfile.write(b'{"durum":"ok - yerel sunucu","anahtar":"tanimli"}'); return
        if not yol.startswith('/api/riot/'):
            return super().do_GET()
        parca = yol[len('/api/riot/'):].split('/', 1)
        if len(parca) != 2 or parca[0] not in IZINLI_HOST or not parca[1].startswith(('tft/', 'riot/account')):
            self.send_error(400, 'Gecersiz yol'); return
        url = f'https://{parca[0]}.api.riotgames.com/{parca[1]}'
        istek = urllib.request.Request(url, headers={'X-Riot-Token': KEY, 'User-Agent': 'Altigen-yerel/0.4'})
        try:
            with urllib.request.urlopen(istek, timeout=15) as y:
                veri, kod = y.read(), y.status
        except urllib.error.HTTPError as e:
            veri, kod = e.read(), e.code
        except Exception as e:
            veri, kod = json.dumps({'hata': str(e)}).encode(), 502
        self.send_response(kod)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        self.wfile.write(veri)
    def log_message(self, *a): pass

if __name__ == '__main__':
    print(f'Altigen calisiyor -> http://localhost:{PORT}   (durdurmak icin Ctrl+C)')
    HTTPServer(('127.0.0.1', PORT), Vekil).serve_forever()
