// ============================================================
// Vercel serverless — admin panelindeki "Veriyi Şimdi Güncelle"
// butonuna basılınca veri toplayıcıyı (GitHub Actions) tetikler.
//
// KURULUM: Bu dosyayı reponuza  api/guncelle-tetikle.js  olarak ekleyin.
//
// GÜVENLİK:
// - Şifre SUNUCU TARAFINDA SHA-256 + sabit zamanlı karşılaştırma ile doğrulanır.
// - IP başına hız sınırı ile kaba kuvvet yavaşlatılır.
// - GitHub token yalnızca ortam değişkeninde tutulur.
// ============================================================

const crypto = require("crypto");

// Admin panelindeki ADMIN_HASH ile AYNI (index.html). Ortam değişkeniyle de geçilebilir.
const VARSAYILAN_HASH = "fbe0895bc886090ef519ebc96a3f459e94b329c2cd3aa2f8eeb7351682052530";

const PENCERE_MS = 60_000, LIMIT = 10;
const kova = new Map();
function hizSiniriAsildi(ip){
  const now = Date.now();
  const dizi = (kova.get(ip) || []).filter(t => now - t < PENCERE_MS);
  dizi.push(now); kova.set(ip, dizi);
  if (kova.size > 5000) for (const [k, v] of kova) if (!v.length || now - v[v.length-1] > PENCERE_MS) kova.delete(k);
  return dizi.length > LIMIT;
}

function sifreDogru(sifre){
  const beklenen = process.env.ADMIN_HASH || VARSAYILAN_HASH;
  const hash = crypto.createHash("sha256").update(String(sifre || ""), "utf8").digest("hex");
  const a = Buffer.from(hash), b = Buffer.from(beklenen);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, hata: "Yalnızca POST" });
  }

  const ip = (req.headers["x-forwarded-for"] || "").split(",")[0].trim() || "bilinmiyor";
  if (hizSiniriAsildi(ip)) {
    return res.status(429).json({ ok: false, hata: "Çok fazla istek. Lütfen biraz bekleyin." });
  }

  let body = req.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch { body = {}; }
  }
  const sifre = body && body.sifre;

  if (!sifreDogru(sifre)) {
    return res.status(401).json({ ok: false, hata: "Yetkisiz" });
  }

  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    return res.status(503).json({ ok: false, hata: "GITHUB_TOKEN eksik" });
  }

  const OWNER = "buraklore";
  const REPO = "altigen";
  const WORKFLOW = "guncelle.yml";
  const BRANCH = "main";

  try {
    const gh = await fetch(
      `https://api.github.com/repos/${OWNER}/${REPO}/actions/workflows/${WORKFLOW}/dispatches`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
          "Content-Type": "application/json",
          "User-Agent": "tftradar-admin",
          "X-GitHub-Api-Version": "2022-11-28",
        },
        body: JSON.stringify({ ref: BRANCH }),
      }
    );

    if (gh.status === 204) {
      return res.status(200).json({ ok: true });
    }
    const txt = await gh.text().catch(() => "");
    return res.status(502).json({ ok: false, hata: `GitHub ${gh.status}: ${txt.slice(0, 200)}` });
  } catch (e) {
    return res.status(500).json({ ok: false, hata: String(e).slice(0, 200) });
  }
};
