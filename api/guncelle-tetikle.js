// ============================================================
// Vercel serverless — admin panelindeki "Veriyi Şimdi Güncelle"
// butonuna basılınca veri toplayıcıyı (GitHub Actions) tetikler.
//
// KURULUM: Bu dosyayı reponuza  api/guncelle-tetikle.js  olarak ekleyin.
// (Mevcut api/reklam-kaydet.js ile aynı klasör.)
// ============================================================

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, hata: "Yalnızca POST" });
  }

  // Gövdeyi oku
  let body = req.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch { body = {}; }
  }
  const sifre = body && body.sifre;

  // --- Şifre doğrulaması ---
  // ÖNEMLİ: Burada, mevcut api/reklam-kaydet.js dosyanızın kullandığı
  // ŞİFRE ortam değişkeninin AYNISINI kullanın. (Genelde ADMIN_SIFRE.)
  // reklam-kaydet.js'i açıp hangi env adını okuduğuna bakın ve buraya yazın.
  const ADMIN = process.env.ADMIN_SIFRE || process.env.PANEL_SIFRE || process.env.ADMIN_PASSWORD;
  if (!ADMIN || sifre !== ADMIN) {
    return res.status(401).json({ ok: false, hata: "Yetkisiz" });
  }

  // --- GitHub token ---
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    return res.status(503).json({ ok: false, hata: "GITHUB_TOKEN eksik" });
  }

  // === Kendi reponuza göre ayarlayın ===
  const OWNER = "buraklore";        // GitHub kullanıcı adınız
  const REPO = "altigen";           // repo adı
  const WORKFLOW = "guncelle.yml";  // .github/workflows/ içindeki dosya adı
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

    // GitHub başarılı tetiklemede 204 döndürür
    if (gh.status === 204) {
      return res.status(200).json({ ok: true });
    }
    const txt = await gh.text().catch(() => "");
    return res.status(502).json({ ok: false, hata: `GitHub ${gh.status}: ${txt.slice(0, 200)}` });
  } catch (e) {
    return res.status(500).json({ ok: false, hata: String(e).slice(0, 200) });
  }
}
