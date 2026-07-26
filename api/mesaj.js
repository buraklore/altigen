// TFTRadar — İletişim mesajları API'si (Vercel Serverless, /api/mesaj)
//
// İki tür istek:
//   POST { name, email, konu, mesaj }        → yeni mesaj kaydet (HERKESE AÇIK, hız sınırlı)
//   POST { sifre, islem:"listele" }          → tüm mesajları getir (ŞİFRE KORUMALI)
//   POST { sifre, islem:"okundu", id }        → mesajı okundu işaretle (ŞİFRE KORUMALI)
//   POST { sifre, islem:"sil", id }           → mesajı sil (ŞİFRE KORUMALI)
//
// GÜVENLİK:
// - Yönetim işlemleri (listele/okundu/sil) şifreyi SUNUCU TARAFINDA SHA-256 ile doğrular.
// - Mesaj gönderme herkese açık ama IP başına hız sınırı ile spam yavaşlatılır + alan uzunlukları sınırlı.
// - Veritabanı bağlantısı yalnızca Vercel ortam değişkeninde (POSTGRES_URL) tutulur.
// - SQL enjeksiyonu imkânsız: tüm değerler parametreli sorgu (sql tagged template) ile geçer.

const crypto = require("crypto");
const { sql } = require("@vercel/postgres");

// Şifre hash'i (admin paneliyle aynı; ortam değişkeniyle de geçilebilir)
const VARSAYILAN_HASH = "751b056252d721a4b502803373ade9228e97d28d3daae14ea5a44a5ba25976cf";

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

// Tablo yoksa oluştur (ilk çağrıda otomatik kurulur)
let tabloHazir = false;
async function tabloyuHazirla(){
  if (tabloHazir) return;
  await sql`
    CREATE TABLE IF NOT EXISTS iletisim_mesajlari (
      id BIGSERIAL PRIMARY KEY,
      ad TEXT NOT NULL,
      email TEXT NOT NULL,
      konu TEXT NOT NULL,
      mesaj TEXT NOT NULL,
      okundu BOOLEAN NOT NULL DEFAULT FALSE,
      olusturma TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`;
  tabloHazir = true;
}

module.exports = async (req, res) => {
  res.setHeader("Content-Type", "application/json");
  if (req.method !== "POST") return res.status(405).send(JSON.stringify({ hata: "Yalnızca POST" }));

  let govde = req.body;
  if (typeof govde === "string") { try { govde = JSON.parse(govde); } catch(e){ govde = {}; } }
  govde = govde || {};

  const ip = (req.headers["x-forwarded-for"] || "").split(",")[0].trim() || "bilinmiyor";

  try {
    await tabloyuHazirla();

    const islem = String(govde.islem || "");

    // ── YÖNETİM İŞLEMLERİ (şifre korumalı) ──
    if (islem === "listele" || islem === "okundu" || islem === "sil") {
      if (!sifreDogru(govde)) return res.status(401).send(JSON.stringify({ hata: "Yetkisiz" }));

      if (islem === "listele") {
        const { rows } = await sql`
          SELECT id, ad, email, konu, mesaj, okundu, olusturma
          FROM iletisim_mesajlari ORDER BY olusturma DESC LIMIT 500`;
        return res.status(200).send(JSON.stringify({ ok: true, mesajlar: rows }));
      }

      const id = parseInt(govde.id, 10);
      if (!id || id < 1) return res.status(400).send(JSON.stringify({ hata: "Geçersiz id" }));

      if (islem === "okundu") {
        await sql`UPDATE iletisim_mesajlari SET okundu = TRUE WHERE id = ${id}`;
        return res.status(200).send(JSON.stringify({ ok: true }));
      }
      if (islem === "sil") {
        await sql`DELETE FROM iletisim_mesajlari WHERE id = ${id}`;
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

    await sql`
      INSERT INTO iletisim_mesajlari (ad, email, konu, mesaj)
      VALUES (${ad}, ${email}, ${konu}, ${mesaj})`;

    return res.status(200).send(JSON.stringify({ ok: true, success: true }));
  } catch (e) {
    return res.status(500).send(JSON.stringify({ hata: "Sunucu hatası", detay: String(e && e.message || e).slice(0, 200) }));
  }
};
