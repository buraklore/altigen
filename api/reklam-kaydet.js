// TFTRadar — Reklam/SEO ayarını GitHub'a kaydeden vekil (Vercel Serverless, /api/reklam-kaydet)
//
// Panel "Kaydet ve Yayınla" dediğinde buraya POST atar: { sifre, ayar }.
// Bu fonksiyon şifreyi SUNUCU TARAFINDA doğrular, ayarı temizler ve reklam-ayar.json'u
// GitHub'a commit'ler. Commit → Vercel otomatik yeniden yayın → değişiklik canlıya geçer.
//
// GÜVENLİK:
// - GitHub token YALNIZCA Vercel ortam değişkeninde (GITHUB_TOKEN) tutulur; tarayıcıya
//   veya depoya asla yazılmaz.
// - Şifre sunucuda SHA-256 ile doğrulanır (istemcideki kapı atlansa bile buradan geçemez).
// - Gelen ayar körü körüne yazılmaz; beyaz-liste ile temizlenip yeniden kurulur (yol/şema
//   enjeksiyonu imkânsız — yalnızca sabit reklam-ayar.json dosyasına yazılır).
// - IP başına hız sınırı ile kaba kuvvet yavaşlatılır.

const crypto = require("crypto");

// Şifre hash'i (istemcidekiyle aynı; ortam değişkeniyle da geçilebilir)
const VARSAYILAN_HASH = "751b056252d721a4b502803373ade9228e97d28d3daae14ea5a44a5ba25976cf";

// Basit bellek-içi hız sınırı
const PENCERE_MS = 60_000, LIMIT = 15;
const kova = new Map();
function hizSiniriAsildi(ip){
  const now = Date.now();
  const dizi = (kova.get(ip) || []).filter(t => now - t < PENCERE_MS);
  dizi.push(now); kova.set(ip, dizi);
  if (kova.size > 5000) for (const [k, v] of kova) if (!v.length || now - v[v.length-1] > PENCERE_MS) kova.delete(k);
  return dizi.length > LIMIT;
}

// Gelen ayarı beyaz-liste ile temizle ve yeniden kur (arbitrary içerik yazılmasını engeller)
function temizle(a){
  a = a || {};
  const b = a.banner || {}, ads = a.adsense || {}, seo = a.seo || {}, al = a.alanlar || {};
  const s = (v, n) => String(v == null ? "" : v).slice(0, n);
  const bx = k => { const o = b[k] || {}; return { aktif: true, gorsel: s(o.gorsel, 500), link: s(o.link, 500) }; };
  const mod = ["demo", "adsense", "banner"].includes(a.mod) ? a.mod : "demo";
  return {
    aktif: !!a.aktif,
    mod,
    adsense: {
      yayinciId: s(ads.yayinciId, 60),
      slotUst: s(ads.slotUst, 40), slotYan: s(ads.slotYan, 40),
      slotIci: s(ads.slotIci, 40), slotMobil: s(ads.slotMobil, 40)
    },
    banner: { ust: bx("ust"), yan: bx("yan"), ici: bx("ici"), mobil: bx("mobil") },
    alanlar: { ust: !!al.ust, yan: !!al.yan, ici: !!al.ici, mobil: !!al.mobil },
    seo: {
      aciklamaTR: s(seo.aciklamaTR, 400), aciklamaEN: s(seo.aciklamaEN, 400),
      anahtarlar: s(seo.anahtarlar, 600), ogGorsel: s(seo.ogGorsel, 500),
      gaId: s(seo.gaId, 40), gscKod: s(seo.gscKod, 200)
    }
  };
}

async function govdeAl(req){
  if (req.body){
    if (typeof req.body === "object") return req.body;
    try { return JSON.parse(req.body); } catch (e){ return null; }
  }
  return await new Promise(resolve => {
    let d = ""; req.on("data", c => { d += c; if (d.length > 1e6) req.destroy(); });
    req.on("end", () => { try { resolve(JSON.parse(d)); } catch (e){ resolve(null); } });
    req.on("error", () => resolve(null));
  });
}

async function githubYaz(icerikJson){
  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPO || "buraklore/altigen";
  const branch = process.env.GITHUB_BRANCH || "main";
  const yol = "reklam-ayar.json";
  const api = `https://api.github.com/repos/${repo}/contents/${yol}`;
  const ortak = {
    "Authorization": "Bearer " + token,
    "Accept": "application/vnd.github+json",
    "User-Agent": "tftradar-admin",
    "X-GitHub-Api-Version": "2022-11-28"
  };
  // 1) Mevcut dosyanın SHA'sını al (güncelleme için gerekli)
  let sha;
  const g = await fetch(`${api}?ref=${encodeURIComponent(branch)}`, { headers: ortak });
  if (g.ok) { const j = await g.json(); sha = j.sha; }
  else if (g.status !== 404) throw new Error("get " + g.status);
  // 2) Yeni içeriği commit'le
  const body = {
    message: "reklam-ayar.json güncellendi (yönetim paneli)",
    content: Buffer.from(icerikJson, "utf-8").toString("base64"),
    branch
  };
  if (sha) body.sha = sha;
  const p = await fetch(api, { method: "PUT", headers: { ...ortak, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!p.ok) throw new Error("put " + p.status);
  return true;
}

module.exports = async (req, res) => {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");

  if (req.method !== "POST") return res.status(405).send(JSON.stringify({ hata: "Yalnızca POST" }));

  const ip = (req.headers["x-forwarded-for"] || "").split(",")[0].trim() || "?";
  if (hizSiniriAsildi(ip)) { res.setHeader("Retry-After", "60"); return res.status(429).send(JSON.stringify({ hata: "Çok fazla deneme" })); }

  if (!process.env.GITHUB_TOKEN) return res.status(503).send(JSON.stringify({ hata: "Otomatik kaydetme yapılandırılmamış" }));

  const govde = await govdeAl(req);
  if (!govde || typeof govde !== "object") return res.status(400).send(JSON.stringify({ hata: "Geçersiz istek" }));

  // Şifre doğrulama (sabit zamanlı karşılaştırma)
  const sifre = String(govde.sifre || "");
  const beklenen = process.env.ADMIN_HASH || VARSAYILAN_HASH;
  const hash = crypto.createHash("sha256").update(sifre, "utf8").digest("hex");
  const a = Buffer.from(hash), b = Buffer.from(beklenen);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return res.status(401).send(JSON.stringify({ hata: "Yetkisiz" }));

  try {
    const temiz = temizle(govde.ayar);
    await githubYaz(JSON.stringify(temiz, null, 2));
    return res.status(200).send(JSON.stringify({ ok: true }));
  } catch (e) {
    // İç ayrıntı sızdırma
    return res.status(502).send(JSON.stringify({ hata: "Kaydedilemedi (GitHub)" }));
  }
};
