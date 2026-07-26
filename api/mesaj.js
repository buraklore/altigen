// TFTRadar — İletişim mesajları API'si (Vercel Serverless, /api/mesaj) — SUPABASE
//
// İstek türleri:
//   POST { name, email, konu, mesaj }        → yeni mesaj kaydet (HERKESE AÇIK, hız sınırlı)
//   POST { sifre, islem:"listele" }          → tüm mesajları getir (ŞİFRE KORUMALI)
//   POST { sifre, islem:"okundu", id }        → mesajı okundu işaretle (ŞİFRE KORUMALI)
//   POST { sifre, islem:"sil", id }           → mesajı sil (ŞİFRE KORUMALI)
//
// GÜVENLİK:
// - Yönetim işlemleri (listele/okundu/sil) şifreyi SUNUCU TARAFINDA SHA-256 ile doğrular.
// - Mesaj gönderme herkese açık ama IP başına hız sınırı ile spam yavaşlatılır + alanlar sınırlı.
// - Supabase service_role anahtarı YALNIZCA sunucu tarafında (env: SUPABASE_SERVICE_KEY) kullanılır;
//   asla tarayıcıya/koda gömülmez. RLS açık olsa bile service_role tam erişime sahiptir.
//
// GEREKLİ ORTAM DEĞİŞKENLERİ (Vercel → Settings → Environment Variables):
//   SUPABASE_URL          = https://xxxx.supabase.co
//   SUPABASE_SERVICE_KEY  = (service_role secret anahtarı)

const crypto = require("crypto");
const { createClient } = require("@supabase/supabase-js");

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const TABLO = "iletisim_mesajlari";

const db = (SUPABASE_URL && SUPABASE_KEY)
  ? createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } })
  : null;

// Şifre hash'i (admin paneliyle aynı; ortam değişkeniyle de geçilebilir)
const VARSAYILAN_HASH = "fbe0895bc886090ef519ebc96a3f459e94b329c2cd3aa2f8eeb7351682052530";

// Basit bellek-içi hız sınırı (mesaj gönderme için)
const PENCERE_MS = 60_000, LIMIT = 5;
const kova = new Map();
function hizSiniriAsildi(ip){
  const now = Date.now();
  const dizi = (kova.get(ip) || []).filter(t => now - t < PENCERE_MS);
  dizi.push(now); kova.set(ip, dizi);
  if (kova.size > 5000) for (const [k, v] of kova) if (!v.length || now - v[v.length-1] > PENCERE_MS) kova.delete(k);
  return dizi.length > LIMIT;
}

function sifreDogru(govde){
  const sifre = String(govde.sifre || "");
  const beklenen = process.env.ADMIN_HASH || VARSAYILAN_HASH;
  const hash = crypto.createHash("sha256").update(sifre, "utf8").digest("hex");
  const a = Buffer.from(hash), b = Buffer.from(beklenen);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

module.exports = async (req, res) => {
  res.setHeader("Content-Type", "application/json");
  if (req.method !== "POST") return res.status(405).send(JSON.stringify({ hata: "Yalnızca POST" }));
  if (!db) return res.status(500).send(JSON.stringify({ hata: "Supabase yapılandırılmamış (SUPABASE_URL / SUPABASE_SERVICE_KEY env eksik)" }));

  let govde = req.body;
  if (typeof govde === "string") { try { govde = JSON.parse(govde); } catch(e){ govde = {}; } }
  govde = govde || {};

  const ip = (req.headers["x-forwarded-for"] || "").split(",")[0].trim() || "bilinmiyor";

  try {
    const islem = String(govde.islem || "");

    // ── YÖNETİM İŞLEMLERİ (şifre korumalı) ──
    if (islem === "listele" || islem === "okundu" || islem === "sil") {
      if (!sifreDogru(govde)) return res.status(401).send(JSON.stringify({ hata: "Yetkisiz" }));

      if (islem === "listele") {
        const { data, error } = await db
          .from(TABLO)
          .select("id, ad, email, konu, mesaj, okundu, olusturma")
          .order("olusturma", { ascending: false })
          .limit(500);
        if (error) throw error;
        return res.status(200).send(JSON.stringify({ ok: true, mesajlar: data || [] }));
      }

      const id = parseInt(govde.id, 10);
      if (!id || id < 1) return res.status(400).send(JSON.stringify({ hata: "Geçersiz id" }));

      if (islem === "okundu") {
        const { error } = await db.from(TABLO).update({ okundu: true }).eq("id", id);
        if (error) throw error;
        return res.status(200).send(JSON.stringify({ ok: true }));
      }
      if (islem === "sil") {
        const { error } = await db.from(TABLO).delete().eq("id", id);
        if (error) throw error;
        return res.status(200).send(JSON.stringify({ ok: true }));
      }
    }

    // ── YENİ MESAJ (herkese açık, hız sınırlı) ──
    if (hizSiniriAsildi(ip)) return res.status(429).send(JSON.stringify({ hata: "Çok fazla istek. Lütfen biraz bekleyin." }));

    const kirp = (v, n) => String(v == null ? "" : v).trim().slice(0, n);
    const ad = kirp(govde.name || govde.ad, 80);
    const email = kirp(govde.email, 120);
    const konu = kirp(govde.konu, 120);
    const mesaj = kirp(govde.mesaj || govde.message, 3000);

    if (!ad || !email || !konu || !mesaj) return res.status(400).send(JSON.stringify({ hata: "Tüm alanlar zorunlu" }));
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).send(JSON.stringify({ hata: "Geçersiz e-posta" }));

    const { error } = await db.from(TABLO).insert({ ad, email, konu, mesaj });
    if (error) throw error;

    return res.status(200).send(JSON.stringify({ ok: true, success: true }));
  } catch (e) {
    return res.status(500).send(JSON.stringify({ hata: "Sunucu hatası", detay: String(e && e.message || e).slice(0, 200) }));
  }
};
