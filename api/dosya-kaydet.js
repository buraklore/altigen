// ============================================================
// Vercel serverless — admin panelindeki "guncelle.py'yi Kaydet"
// butonu bu dosyayı çağırır ve düzenlenen içeriği GitHub'a commit'ler.
//
// KURULUM: Bu dosyayı reponuza  api/dosya-kaydet.js  olarak ekleyin.
//
// GÜVENLİK:
// - Yalnızca IZINLI listesindeki dosyalar düzenlenebilir (path/whitelist).
// - Şifre SUNUCU TARAFINDA SHA-256 + sabit zamanlı karşılaştırma (timingSafeEqual)
//   ile doğrulanır — timing attack'a kapalı.
// - IP başına hız sınırı ile kaba kuvvet (brute-force) yavaşlatılır.
// - GitHub token YALNIZCA ortam değişkeninde (GITHUB_TOKEN) tutulur.
// ============================================================

const crypto = require("crypto");

// Admin panelindeki ADMIN_HASH ile AYNI (index.html). Ortam değişkeniyle de geçilebilir.
const VARSAYILAN_HASH = "fbe0895bc886090ef519ebc96a3f459e94b329c2cd3aa2f8eeb7351682052530";

// IP başına hız sınırı — brute-force yavaşlatma
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
  const { sifre, yol, icerik } = body || {};

  // --- Şifre doğrulaması (sabit zamanlı, hash tabanlı) ---
  if (!sifreDogru(sifre)) {
    return res.status(401).json({ ok: false, hata: "Yetkisiz" });
  }

  // --- Sadece izin verilen dosyalar düzenlenebilir (güvenlik) ---
  const IZINLI = ["guncelle.py"];
  if (!IZINLI.includes(yol)) {
    return res.status(400).json({ ok: false, hata: "Bu dosya düzenlenemez" });
  }
  if (typeof icerik !== "string" || icerik.length > 500000) {
    return res.status(400).json({ ok: false, hata: "Geçersiz içerik" });
  }

  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    return res.status(503).json({ ok: false, hata: "GITHUB_TOKEN eksik" });
  }

  const OWNER = "buraklore";
  const REPO = "altigen";
  const BRANCH = "main";

  const api = `https://api.github.com/repos/${OWNER}/${REPO}/contents/${yol}`;
  const ghHeaders = {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "User-Agent": "tftradar-admin",
    "X-GitHub-Api-Version": "2022-11-28",
  };

  try {
    let sha;
    const cur = await fetch(`${api}?ref=${BRANCH}`, { headers: ghHeaders });
    if (cur.ok) {
      const cj = await cur.json();
      sha = cj.sha;
    }

    const b64 = Buffer.from(icerik, "utf8").toString("base64");

    const put = await fetch(api, {
      method: "PUT",
      headers: { ...ghHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({
        message: "guncelle.py: yönetim panelinden güncellendi",
        content: b64,
        sha,
        branch: BRANCH,
      }),
    });

    if (put.ok) return res.status(200).json({ ok: true });
    const txt = await put.text().catch(() => "");
    return res.status(502).json({ ok: false, hata: `GitHub ${put.status}: ${txt.slice(0, 200)}` });
  } catch (e) {
    return res.status(500).json({ ok: false, hata: String(e).slice(0, 200) });
  }
};
