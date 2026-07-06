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

---
Altıgen, Riot Games tarafından onaylanmamıştır ve Riot Games'in görüşlerini
yansıtmaz. Riot Games ve ilgili tüm unvanlar Riot Games, Inc. ticari markalarıdır.
