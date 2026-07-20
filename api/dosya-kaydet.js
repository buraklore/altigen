// ============================================================
// Vercel serverless — admin panelindeki "guncelle.py'yi Kaydet"
// butonu bu dosyayı çağırır ve düzenlenen içeriği GitHub'a commit'ler.
//
// KURULUM: Bu dosyayı reponuza  api/dosya-kaydet.js  olarak ekleyin.
// (Mevcut api/reklam-kaydet.js ile aynı klasör.)
//
// GÜVENLİK: Yalnızca IZINLI listesindeki dosyalar düzenlenebilir.
// ============================================================

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, hata: "Yalnızca POST" });
  }

  let body = req.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch { body = {}; }
  }
  const { sifre, yol, icerik } = body || {};

  // --- Şifre doğrulaması (reklam-kaydet.js ile AYNI env değişkenini kullanın) ---
  const ADMIN = process.env.ADMIN_SIFRE || process.env.PANEL_SIFRE || process.env.ADMIN_PASSWORD;
  if (!ADMIN || sifre !== ADMIN) {
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

  // === Kendi reponuza göre ayarlayın ===
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
    // Mevcut dosyanın SHA'sını al (güncelleme için gerekli)
    let sha;
    const cur = await fetch(`${api}?ref=${BRANCH}`, { headers: ghHeaders });
    if (cur.ok) {
      const cj = await cur.json();
      sha = cj.sha;
    }

    // UTF-8 güvenli base64
    const b64 = Buffer.from(icerik, "utf8").toString("base64");

    const put = await fetch(api, {
      method: "PUT",
      headers: { ...ghHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({
        message: "guncelle.py: yönetim panelinden güncellendi",
        content: b64,
        sha, // varsa günceller, yoksa yeni oluşturur
        branch: BRANCH,
      }),
    });

    if (put.ok) return res.status(200).json({ ok: true });
    const txt = await put.text().catch(() => "");
    return res.status(502).json({ ok: false, hata: `GitHub ${put.status}: ${txt.slice(0, 200)}` });
  } catch (e) {
    return res.status(500).json({ ok: false, hata: String(e).slice(0, 200) });
  }
}
