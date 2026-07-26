// Vercel Serverless Function — Riot API proxy'si.
// OBS overlay'i buraya "Riot ID + bolge" ile sorar; RIOT_API_KEY yalnizca
// SUNUCUDA durur, asla tarayiciya/yayina gitmez. (betojitft'te kullanici kendi
// anahtarini girip her gun yeniliyor; burada anahtar bizde, izleyici hic ugrasmaz.)
//
// Ortam degiskeni: Vercel > Project > Settings > Environment Variables > RIOT_API_KEY
// Kullanim:  /api/oyuncu?riotId=isim%23TFT1&bolge=euw1&adet=10

const ROTA = {
  na1: 'americas', br1: 'americas', la1: 'americas', la2: 'americas',
  kr: 'asia', jp1: 'asia',
  eun1: 'europe', euw1: 'europe', tr1: 'europe', me1: 'europe', ru: 'europe',
  oc1: 'sea', sg2: 'sea', tw2: 'sea', vn2: 'sea',
};

const TR_TIER = {
  IRON: 'Demir', BRONZE: 'Bronz', SILVER: 'Gümüş', GOLD: 'Altın',
  PLATINUM: 'Platin', EMERALD: 'Zümrüt', DIAMOND: 'Elmas',
  MASTER: 'Usta', GRANDMASTER: 'Büyük Usta', CHALLENGER: 'Şampiyon',
};

async function riot(host, path, key) {
  const url = `https://${host}.api.riotgames.com/${path}`;
  const r = await fetch(url, { headers: { 'X-Riot-Token': key } });
  if (!r.ok) { const e = new Error(`Riot ${r.status}`); e.status = r.status; throw e; }
  return r.json();
}

// IP başına hız sınırı — Riot API kotasını kötüye kullanıma karşı korur.
// Her istek birden çok Riot çağrısı yaptığı için sınır düşük tutulur.
const RL_PENCERE_MS = 60_000, RL_LIMIT = 20;
const rlKova = new Map();
function rlAsildi(ip){
  const now = Date.now();
  const dizi = (rlKova.get(ip) || []).filter(t => now - t < RL_PENCERE_MS);
  dizi.push(now); rlKova.set(ip, dizi);
  if (rlKova.size > 5000) for (const [k, v] of rlKova) if (!v.length || now - v[v.length-1] > RL_PENCERE_MS) rlKova.delete(k);
  return dizi.length > RL_LIMIT;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Cache-Control', 's-maxage=45, stale-while-revalidate=90');
  if (req.method === 'OPTIONS') return res.status(204).end();

  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'bilinmiyor';
  if (rlAsildi(ip)) return res.status(429).json({ hata: 'Çok fazla istek. Lütfen biraz bekleyin.' });

  const key = process.env.RIOT_API_KEY;
  if (!key) return res.status(500).json({ hata: 'RIOT_API_KEY tanimli degil (Vercel ortam degiskeni).' });

  const riotId = String(req.query.riotId || '').trim();
  const bolge = String(req.query.bolge || 'tr1').toLowerCase();
  const adet = Math.min(Math.max(parseInt(req.query.adet, 10) || 10, 1), 20);

  if (!riotId.includes('#')) return res.status(400).json({ hata: 'Riot ID "isim#etiket" biçiminde olmalı.' });
  const rota = ROTA[bolge];
  if (!rota) return res.status(400).json({ hata: `Geçersiz bölge: ${bolge}` });

  const [gameName, tagLine] = riotId.split('#');

  try {
    // 1) Riot ID -> PUUID
    const hesap = await riot(rota, `riot/account/v1/accounts/by-riot-id/${encodeURIComponent(gameName)}/${encodeURIComponent(tagLine)}`, key);
    const puuid = hesap.puuid;

    // 2) Lig / LP / galibiyet
    let lig = null;
    try {
      const girisler = await riot(bolge, `tft/league/v1/by-puuid/${puuid}`, key);
      const solo = (girisler || []).find(x => x.queueType === 'RANKED_TFT') || (girisler || [])[0] || null;
      if (solo && solo.tier) {
        const w = solo.wins || 0, l = solo.losses || 0, top = w + l;
        // Master / Grandmaster / Challenger'da BOLUM (I/II/III/IV) yoktur; sadece LP vardir.
        // Riot yine de rank="I" dondurur -> "Sampiyon I" gibi yanlis gorunur. Temizle.
        const ustLig = ['MASTER', 'GRANDMASTER', 'CHALLENGER'].indexOf(solo.tier) >= 0;
        lig = {
          tier: solo.tier, tierTr: TR_TIER[solo.tier] || solo.tier,
          rank: ustLig ? '' : (solo.rank || ''), lp: solo.leaguePoints || 0,
          birincilik: w, toplam: top,
        };
      }
    } catch (e) { /* derecesiz */ }

    // 3) Son maclarin sirasi
    const ids = await riot(rota, `tft/match/v1/matches/by-puuid/${puuid}/ids?count=${adet}`, key);
    const maclar = [];
    for (const id of (ids || []).slice(0, adet)) {
      try {
        const m = await riot(rota, `tft/match/v1/matches/${id}`, key);
        const info = m.info || {};
        if (info.queue_id !== undefined && info.queue_id !== 1100) continue;
        const ben = (info.participants || []).find(p => p.puuid === puuid);
        if (!ben) continue;
        maclar.push({ pl: ben.placement, lvl: ben.level, dt: info.game_datetime || null });
      } catch (e) {}
    }

    const n = maclar.length;
    const ort = n ? +(maclar.reduce((s, x) => s + x.pl, 0) / n).toFixed(2) : null;
    const ilk4 = maclar.filter(x => x.pl <= 4).length;
    const birinci = maclar.filter(x => x.pl === 1).length;

    return res.status(200).json({
      riotId: `${hesap.gameName}#${hesap.tagLine}`, bolge, lig, maclar,
      ozet: { n, ort, ilk4, birinci, ilk4Oran: n ? Math.round((ilk4 / n) * 100) : 0 },
      guncelleme: Date.now(),
    });
  } catch (e) {
    const kod = e.status || 500;
    const mesaj = kod === 404 ? 'Oyuncu bulunamadı — Riot ID veya bölgeyi kontrol edin.'
      : kod === 401 || kod === 403 ? 'API anahtarı geçersiz veya süresi dolmuş.'
      : kod === 429 ? 'Riot API kotası doldu, biraz sonra tekrar deneyin.'
      : `Riot API hatası (${kod}).`;
    return res.status(kod === 404 ? 404 : 502).json({ hata: mesaj });
  }
};
