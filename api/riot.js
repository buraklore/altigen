// Altıgen — Riot API vekili (Vercel Serverless Function, sabit yol: /api/riot)
// Kullanım:  /api/riot?u=tr1/tft/league/v1/challenger
// Sağlık:    /api/riot            -> { durum } (anahtar durumu sızdırılmaz)
//
// GÜVENLİK NOTLARI:
// - Yalnızca Riot'un resmi ana bilgisayarlarına, yalnızca izin verilen TFT/hesap
//   uç noktalarına, yalnızca GET ile proxy yapar. Yol kaçışı ve SSRF'e karşı katı doğrulama.
// - Basit bellek-içi hız sınırı (IP başına) API anahtarını kötüye kullanıma karşı korur.
// - Ayrıntılı hata/anahtar durumu istemciye sızdırılmaz.

const IZINLI_HOST = new Set(["tr1","euw1","eun1","na1","kr","jp1","br1","la1","la2","oc1","tr","ru","europe","americas","asia","sea"]);
// İzin verilen uç nokta desenleri (yalnızca okuma amaçlı TFT + hesap çözümleme)
const IZINLI_YOL = [
  /^tft\/league\/v1\/(challenger|grandmaster|master)$/,
  /^tft\/league\/v1\/entries\/(IRON|BRONZE|SILVER|GOLD|PLATINUM|EMERALD|DIAMOND)\/(I|II|III|IV)(\?.*)?$/,
  /^tft\/league\/v1\/by-puuid\/[A-Za-z0-9_-]{1,120}$/,
  /^tft\/match\/v1\/matches\/by-puuid\/[A-Za-z0-9_-]{1,120}\/ids(\?.*)?$/,
  /^tft\/match\/v1\/matches\/[A-Za-z0-9_-]{1,120}$/,
  /^tft\/summoner\/v1\/summoners\/by-puuid\/[A-Za-z0-9_-]{1,120}$/,
  /^riot\/account\/v1\/accounts\/by-riot-id\/[^/]{1,120}\/[^/]{1,120}$/,
  /^riot\/account\/v1\/accounts\/by-puuid\/[A-Za-z0-9_-]{1,120}$/
];

// Basit bellek-içi hız sınırı (aynı sunucu örneği yaşadığı sürece)
const PENCERE_MS = 60_000, LIMIT = 40;
const kova = new Map();
function hizSiniriAsildi(ip){
  const now = Date.now();
  const dizi = (kova.get(ip) || []).filter(t => now - t < PENCERE_MS);
  dizi.push(now);
  kova.set(ip, dizi);
  if (kova.size > 5000) { // bellek sızıntısına karşı süpürme
    for (const [k, v] of kova) if (!v.length || now - v[v.length-1] > PENCERE_MS) kova.delete(k);
  }
  return dizi.length > LIMIT;
}

module.exports = async (req, res) => {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");

  if (req.method !== "GET") {
    return res.status(405).send(JSON.stringify({ hata: "Yalnızca GET" }));
  }

  const key = process.env.RIOT_API_KEY || "";
  const u = (req.query && req.query.u) ||
            new URL(req.url, "http://x").searchParams.get("u") || "";

  if (!u) {
    // Anahtarın tanımlı olup olmadığını SIZDIRMA — yalnızca canlı olduğunu bildir.
    return res.status(200).send(JSON.stringify({ durum: "ok" }));
  }
  if (!key.startsWith("RGAPI-")) {
    // Genel hata — yapılandırma ayrıntısı sızdırma.
    return res.status(503).send(JSON.stringify({ hata: "Servis geçici olarak kullanılamıyor" }));
  }

  const ip = (req.headers["x-forwarded-for"] || "").split(",")[0].trim() || "?";
  if (hizSiniriAsildi(ip)) {
    res.setHeader("Retry-After", "60");
    return res.status(429).send(JSON.stringify({ hata: "Çok fazla istek, biraz sonra tekrar deneyin" }));
  }

  const i = u.indexOf("/");
  const host = i > 0 ? u.slice(0, i) : "";
  const rest = i > 0 ? u.slice(i + 1) : "";

  // Yol kaçışı / kodlama hilelerine karşı sertleştirme
  if (rest.includes("..") || rest.includes("//") || rest.includes("%2e") || rest.includes("\\") || rest.includes("@")) {
    return res.status(400).send(JSON.stringify({ hata: "Geçersiz istek" }));
  }
  if (!IZINLI_HOST.has(host) || !IZINLI_YOL.some(re => re.test(rest))) {
    return res.status(400).send(JSON.stringify({ hata: "İzin verilmeyen uç nokta" }));
  }

  try {
    const ctrl = new AbortController();
    const zaman = setTimeout(() => ctrl.abort(), 12_000);
    const r = await fetch(`https://${host}.api.riotgames.com/${rest}`, {
      headers: { "X-Riot-Token": key },
      signal: ctrl.signal
    });
    clearTimeout(zaman);
    const govde = await r.text();
    // Riot'un ham hata gövdesini aynen geçirme; yalnızca durum kodunu yansıt.
    if (!r.ok) {
      return res.status(r.status).send(JSON.stringify({ hata: "Riot API " + r.status }));
    }
    return res.status(200).send(govde);
  } catch (e) {
    // İç ayrıntı (String(e)) sızdırma.
    return res.status(502).send(JSON.stringify({ hata: "Yukarı akış hatası" }));
  }
};
