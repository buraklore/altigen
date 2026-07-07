# Altıgen — Türkçe TFT Rehberi (Set 17)

Resmî Riot verisiyle (Data Dragon + Community Dragon + Riot API) çalışan Türkçe
Teamfight Tactics sitesi. Şampiyonlar, özellikler, eşyalar, augmentler; TR1
Challenger maçlarından hesaplanan gerçek komplar (tier, erken oyun,
alternatifler); canlı oyuncu arama ve TR1 liderlik tablosu.

## Yapı
- `index.html` — sitenin tamamı (görseller gömülü, tek dosya)
- `api/riot/[...seg].js` — Vercel serverless fonksiyonu: Riot API vekili.
  Anahtar yalnızca sunucu tarafında, `RIOT_API_KEY` ortam değişkeninden okunur.
- `sunucu.py` — aynı vekilin yerel karşılığı (geliştirme için)
- `anahtar.ornek.txt` — yerel anahtar dosyası şablonu (`anahtar.txt` git'e girmez)

## 1) GitHub'a gönderme
```bash
cd altigen
git init
git add .
git commit -m "Altıgen v0.4 — canlı Riot API + gerçek komplar"
git branch -M main
git remote add origin https://github.com/KULLANICI_ADINIZ/altigen.git
git push -u origin main
```

## 2) Vercel'e deploy
1. vercel.com → **Add New… → Project** → GitHub deposunu içe aktarın.
2. Framework Preset: **Other** (hiçbir build ayarı gerekmez) → **Deploy**.
3. Project → **Settings → Environment Variables**:
   - Name: `RIOT_API_KEY`  Value: `RGAPI-...`  (Production + Preview işaretli)
4. **Deployments → ⋯ → Redeploy** (ortam değişkeni ancak yeniden dağıtımda etkinleşir).
5. Siteniz `https://<proje>.vercel.app` adresinde; Oyuncu araması ve Liderlik
   YENİLE artık canlıdır.

## 3) Yerelde çalıştırma
```bash
cp anahtar.ornek.txt anahtar.txt   # içine kendi RGAPI-... anahtarınızı yazın
python sunucu.py                   # Windows: py sunucu.py
# http://localhost:8017
```
(`RIOT_API_KEY` ortam değişkeni tanımlıysa anahtar.txt gerekmez.)

## Anahtar güvenliği ve Riot politikası — ÖNEMLİ
- Anahtarı **asla** koda/GitHub'a koymayın; bu depo `anahtar.txt`'yi zaten yok sayar.
- Geliştirme anahtarı **24 saatte bir** ölür → developer.riotgames.com'dan
  Regenerate → Vercel'de değişkeni güncelle → Redeploy.
- Riot kuralı: geliştirme anahtarı **herkese açık üründe kullanılamaz.**
  Kişisel test dağıtımı için kısa süreli kullanın; siteyi paylaşmadan önce
  developer.riotgames.com → Register Product ile süresi dolmayan **Personal
  API Key** alın (bu sitenin kendisi başvuru için yeterli bir prototiptir).
  Anahtar değişince tek yapılacak şey Vercel'deki değişkeni güncellemektir.



## Otomatik güncelleme (kendi kendini yenileyen veri)
Depoda `.github/workflows/guncelle.yml` her gün 06:00'da (TR) `scripts/guncelle.py`
betiğini çalıştırır: TR1'in 6 liginden maçları toplar, kompları/istatistikleri
yeniden hesaplar ve `veri/snap.json` dosyasını commit'ler. Vercel bu push'u
görünce siteyi otomatik yeniden dağıtır; sayfa açılışta `veri/snap.json`'u
okuyup en güncel veriyi gösterir.

Kurulum (tek seferlik):
1. GitHub deposu > **Settings > Secrets and variables > Actions > New repository secret**
   - Name: `RIOT_API_KEY`  ·  Value: `RGAPI-...`
2. **Actions** sekmesinde workflow'ları etkinleştirin. "Veri guncelle" >
   **Run workflow** ile istediğiniz an elle de tetikleyebilirsiniz.

Önemli gerçek: geliştirme anahtarı 24 saatte öldüğü için zamanlanmış çalıştırma
ertesi gün 401 ile durur (log'da açıkça yazar). O güne kadar akış: sabah yeni
anahtarı Secret'a yapıştır -> Run workflow. **Tam otomasyon için süresi dolmayan
Personal API Key şart** — onaylandığında Secret'ı bir kez güncellersiniz ve
sistem tamamen kendi kendine döner. Yeni set/yama çıktığında şampiyon-eşya
kataloğunun (veri/oyun.json + görseller) yenilenmesi ayrı bir derlemedir.

## Sorun giderme (404 vb.)
1. Tarayıcıda açın: `https://SITENIZ.vercel.app/api/riot`
   - `{"durum":"ok..."}` görüyorsanız fonksiyon yayında; `anahtar` alanı YOK
     diyorsa ortam değişkenini ekleyip **Redeploy** yapın.
   - **404 görüyorsanız `api/` klasörü deploya girmemiştir.** GitHub deposunda
     kökte `api/riot.js` dosyasının göründüğünü doğrulayın (GitHub web
     arayüzünden dosya sürüklerken klasörler sık atlanır — `git push` en
     sağlamı) ve Vercel'de Deployments > son deploy > Build Logs içinde
     "Serverless Functions" listesinde `api/riot` satırını kontrol edin.
2. Ortam değişkeni eklendikten sonra **mutlaka Redeploy** gerekir.
3. `401 Unknown apikey` → anahtarın 24 saatlik süresi dolmuş; yenileyin.

---
Altıgen, Riot Games tarafından onaylanmamıştır ve Riot Games'in görüşlerini
yansıtmaz. Riot Games ve ilgili tüm unvanlar Riot Games, Inc. ticari markalarıdır.

## Güvenlik

Bu proje internete açık bir uygulama olarak sertleştirilmiştir:

- **API anahtarı istemciye asla ulaşmaz.** Tüm Riot API çağrıları `api/riot.js`
  serverless vekilinden geçer; anahtar yalnızca Vercel Environment Variables'ta
  (`RIOT_API_KEY`) tutulur, `.gitignore` ile depo dışında bırakılır.
- **Vekil sertleştirmesi:** yalnızca GET, yalnızca Riot'un resmi ana bilgisayarları,
  yalnızca beyaz-listedeki TFT/hesap uç noktaları (regex ile). SSRF, yol kaçışı ve
  kodlama hilelerine karşı korumalı. IP başına dakikada 40 istek hız sınırı.
  Hata ve anahtar durumu istemciye sızdırılmaz.
- **HTTP güvenlik başlıkları** `vercel.json` ile: Content-Security-Policy, HSTS,
  X-Frame-Options: DENY (clickjacking), X-Content-Type-Options, Referrer-Policy,
  Permissions-Policy.
- **XSS savunması:** tüm dinamik metin `esc()` ile kaçışlanır; blog gövdesi ayrıca
  beyaz-liste tabanlı `sanitizeHTML()` temizleyiciden geçer. `eval`, `document.write`,
  `dangerouslySetInnerHTML`, tarayıcı depolama (localStorage/sessionStorage) kullanılmaz.
- **Girdi doğrulama:** oyuncu arama girdisi uzunluk ve karakter sınırlıdır; API'ye
  giden tüm parametreler `encodeURIComponent` ile kodlanır.
- **Gizli veri yok:** depoda hiçbir anahtar, token veya parola bulunmaz
  (`anahtar.ornek.txt` yalnızca yer tutucudur). Liderlikte gösterilen puuid'ler
  Riot'un halka açık Challenger listesinden gelir.

Anahtar sızıntısı olursa: developer.riotgames.com üzerinden anahtarı iptal edip
yenisini Vercel + GitHub Secret olarak güncelleyin.
