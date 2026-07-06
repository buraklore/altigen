// Altıgen — Riot API vekili (Vercel Serverless Function)
// Anahtar YALNIZCA sunucu tarafındaki RIOT_API_KEY ortam değişkeninden okunur.
const IZINLI_HOST = new Set(["tr1","euw1","eun1","na1","kr","europe","americas","asia"]);

module.exports = async (req, res) => {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");

  const key = process.env.RIOT_API_KEY;
  if (!key || !key.startsWith("RGAPI-")) {
    return res.status(500).send(JSON.stringify({
      hata: "RIOT_API_KEY tanımlı değil. Vercel > Project > Settings > Environment Variables bölümünden ekleyip Redeploy yapın."
    }));
  }

  const m = (req.url || "").match(/^\/api\/riot\/([^/]+)\/(.+)$/);
  if (!m) return res.status(400).send(JSON.stringify({ hata: "Geçersiz yol" }));
  const host = m[1];
  const rest = m[2]; // sorgu dizesi dahil (?count=5 gibi)
  if (!IZINLI_HOST.has(host) || !(rest.startsWith("tft/") || rest.startsWith("riot/account"))) {
    return res.status(400).send(JSON.stringify({ hata: "İzin verilmeyen uç nokta" }));
  }

  try {
    const r = await fetch(`https://${host}.api.riotgames.com/${rest}`, {
      headers: { "X-Riot-Token": key }
    });
    const body = await r.text();
    return res.status(r.status).send(body);
  } catch (e) {
    return res.status(502).send(JSON.stringify({ hata: String(e) }));
  }
};
