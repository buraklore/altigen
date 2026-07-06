const IZINLI_HOST = new Set(["tr1","euw1","eun1","na1","kr","europe","americas","asia"]);

module.exports = async (req, res) => {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");

  const key = process.env.RIOT_API_KEY || "";
  const u = (req.query && req.query.u) ||
            new URL(req.url, "http://x").searchParams.get("u") || "";

  if (!u) {
    return res.status(200).send(JSON.stringify({
      durum: "ok — fonksiyon yayında",
      anahtar: key.startsWith("RGAPI-")
        ? "tanımlı"
        : "YOK — Settings > Environment Variables > RIOT_API_KEY ekleyip Redeploy yapın"
    }));
  }
  if (!key.startsWith("RGAPI-")) {
    return res.status(500).send(JSON.stringify({
      hata: "RIOT_API_KEY tanımlı değil. Vercel > Settings > Environment Variables'a ekleyin ve Redeploy yapın."
    }));
  }
  const i = u.indexOf("/");
  const host = i > 0 ? u.slice(0, i) : "";
  const rest = i > 0 ? u.slice(i + 1) : "";
  if (!IZINLI_HOST.has(host) || !(rest.startsWith("tft/") || rest.startsWith("riot/account"))) {
    return res.status(400).send(JSON.stringify({ hata: "İzin verilmeyen uç nokta" }));
  }
  try {
    const r = await fetch(`https://${host}.api.riotgames.com/${rest}`, {
      headers: { "X-Riot-Token": key }
    });
    return res.status(r.status).send(await r.text());
  } catch (e) {
    return res.status(502).send(JSON.stringify({ hata: String(e) }));
  }
};
