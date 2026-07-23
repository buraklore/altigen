#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""TFTRadar — veri gudumlu blog ureteci.

veri/snap.json (canli TFT verisi) + veri/oyun.json (statik oyun verisi) okur,
gunun meta raporunu TR + EN olarak uretir ve veri/blog.json dosyasina yazar.

TAMAMEN SABLON + VERI tabanlidir: harici API, LLM ya da baska bir sitenin
icerigi KULLANILMAZ. Uretilen her cumle kendi olctugun sayilardan gelir.

Kullanim:  python3 scripts/blog_uret.py
"""
import json, os, re, sys, html
from datetime import datetime, timezone, timedelta

KOK = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SNAP_YOLU = os.path.join(KOK, 'veri', 'snap.json')
BLOG_YOLU = os.path.join(KOK, 'veri', 'blog.json')
OYUN_YOLU = os.path.join(KOK, 'veri', 'oyun.json')

TUT = 24          # blog.json'da tutulacak en fazla otomatik yazi
RENKLER = ["var(--cyan)", "var(--gold)", "#B06AF0", "var(--c2)", "#E0565B"]


def e(s):
    """HTML metin kacisi."""
    return html.escape(str(s), quote=False)


def bin_ayrac(n):
    """1234567 -> '1.234.567' (Turkce binlik ayraci)."""
    return f"{int(n):,}".replace(',', '.')


def yukle(yol, varsayilan=None):
    try:
        with open(yol, encoding='utf-8') as f:
            return json.load(f)
    except Exception:
        return varsayilan


# ---------------------------------------------------------------- veri hazirlik
def komplari_birlestir(leagues):
    """Ayni isimli kompu ligler arasi agirlikli ortalama ile birlestirir."""
    harita = {}
    for L in leagues.values():
        for c in (L.get('comps') or []):
            ad = c.get('name')
            if not ad:
                continue
            n = c.get('n') or 0
            h = harita.setdefault(ad, {'ad': ad, 'n': 0, 'avgW': 0.0, 'top4W': 0.0,
                                       'winW': 0.0, 'tdW': 0.0, 'tdN': 0, 'up': 0,
                                       'down': 0, 'ornek': c, 'lig': 0})
            h['n'] += n
            h['avgW'] += (c.get('avg') or 0) * n
            h['top4W'] += (c.get('top4') or 0) * n
            h['winW'] += (c.get('win') or 0) * n
            h['lig'] += 1
            if c.get('tr') == 'up':
                h['up'] += 1
            elif c.get('tr') == 'down':
                h['down'] += 1
            if c.get('td'):
                h['tdW'] += c['td'] * n
                h['tdN'] += n
            # en dolgun ornegi sakla (kadro/tasiyici icin)
            if len(c.get('units') or []) >= len(h['ornek'].get('units') or []):
                h['ornek'] = c

    out = []
    for h in harita.values():
        n = h['n'] or 1
        out.append({
            'ad': h['ad'],
            'n': h['n'],
            'lig': h['lig'],
            'avg': round(h['avgW'] / n, 2),
            'top4': round(h['top4W'] / n),
            'win': round(h['winW'] / n),
            'td': round(h['tdW'] / h['tdN'], 2) if h['tdN'] else 0.0,
            'up': h['up'],
            'down': h['down'],
            'carry': h['ornek'].get('carry'),
            'style': h['ornek'].get('style') or '',
            'traits': h['ornek'].get('traits') or [],
        })
    return out


def tier_of(avg):
    return 'S' if avg <= 3.85 else 'A' if avg <= 4.15 else 'B' if avg <= 4.45 else 'C'


# ---------------------------------------------------------------- yazi uretimi
def rapor_uret(snap, oyun, bugun):
    champ_ad = {c['id']: c['name'] for c in oyun.get('champs', [])}
    champ_ad_en = {c['id']: c.get('name_en') or c['name'] for c in oyun.get('champs', [])}
    trait_ad = {t['id']: t['name'] for t in oyun.get('traits', [])}
    trait_ad_en = {t['id']: t.get('name_en') or t['name'] for t in oyun.get('traits', [])}
    item_ad = {i['id']: i['name'] for i in oyun.get('items', [])}
    item_ad_en = {i['id']: i.get('name_en') or i['name'] for i in oyun.get('items', [])}

    leagues = snap.get('leagues') or {}
    komplar = komplari_birlestir(leagues)
    if len(komplar) < 4:
        return None  # anlamli rapor icin yeterli veri yok

    yama = snap.get('patch') or '?'
    bolgeler = (snap.get('regions') or {}).get('list') or ['TR1']
    bolge_str = ' + '.join(bolgeler)
    toplam_tahta = (snap.get('sampleAll') or {}).get('b') or 0
    lig_sayisi = len(leagues)

    # --- siralamalar ---
    # ORNEKLEM ESIGI: az tahtada oynanmis komp istatistiksel gurultudur; 13 tahtalik bir komp
    # 2.4 ortalamayla zirvede gorunebilir. Esik toplam veriyle olceklenir (min 25 tahta).
    MIN_N = max(25, round(0.01 * toplam_tahta))
    saglam = [c for c in komplar if c['n'] >= MIN_N]
    if len(saglam) < 5:                      # veri azsa esigi gevset ama sirala
        saglam = sorted(komplar, key=lambda c: -c['n'])[:max(5, len(komplar) // 2)]

    guclu = sorted(saglam, key=lambda c: (c['avg'], -c['n']))[:5]
    # Yukselenler: yalnizca HALA OYNANABILIR komplar (ort. 4.60 alti). Kotu bir kompun
    # "daha az kotu" olmasi tavsiye degildir.
    yukselen = sorted([c for c in saglam if c['td'] >= 0.3 and c['avg'] <= 4.60],
                      key=lambda c: -c['td'])[:4]
    dusen = sorted([c for c in saglam if c['td'] <= -0.3],
                   key=lambda c: c['td'])[:4]
    populer = sorted(saglam, key=lambda c: -c['n'])[:3]

    itemStats = snap.get('itemStats') or {}
    esyalar = sorted([(k, v) for k, v in itemStats.items() if v.get('n', 0) >= 60],
                     key=lambda kv: kv[1].get('d', 0))[:5]

    def kn(cid, en=False):
        return (champ_ad_en if en else champ_ad).get(cid, cid or '?')

    def komp_satiri(c, en=False):
        car = kn(c['carry'], en)
        t = tier_of(c['avg'])
        if en:
            return (f"<li><b>{e(c['ad'])}</b> — {t} tier · avg. placement <b>{c['avg']:.2f}</b> · "
                    f"Top 4 {c['top4']}% · carry {e(car)} · {c['n']} boards</li>")
        return (f"<li><b>{e(c['ad'])}</b> — {t} kademe · ort. sıra <b>{c['avg']:.2f}</b> · "
                f"İlk 4 %{c['top4']} · taşıyıcı {e(car)} · {c['n']} tahta</li>")

    def trend_satiri(c, en=False):
        car = kn(c['carry'], en)
        ok = '▲' if c['td'] > 0 else '▼'
        if en:
            return (f"<li>{ok} <b>{e(c['ad'])}</b> — {abs(c['td']):.2f} placement shift · "
                    f"carry {e(car)} · avg. {c['avg']:.2f} · {c['n']} boards</li>")
        return (f"<li>{ok} <b>{e(c['ad'])}</b> — {abs(c['td']):.2f} basamak oynama · "
                f"taşıyıcı {e(car)} · ort. {c['avg']:.2f} · {c['n']} tahta</li>")

    def esya_satiri(kv, en=False):
        iid, v = kv
        ad = (item_ad_en if en else item_ad).get(iid, iid)
        d = v.get('d', 0)
        isaret = '+' if d >= 0 else ''
        if en:
            return (f"<li><b>{e(ad)}</b> — Δ{isaret}{d} · avg. {v.get('avg')} · "
                    f"{v.get('n')} uses · tier {v.get('t')}</li>")
        return (f"<li><b>{e(ad)}</b> — Δ{isaret}{d} · ort. {v.get('avg')} · "
                f"{v.get('n')} kullanım · {v.get('t')} kademe</li>")

    en_iyi = guclu[0]
    en_pop = populer[0]

    # --- govde: TR ---
    g = []
    g.append(f"<p>Bu rapor <b>{bolge_str}</b> sunucularından toplanan <b>{bin_ayrac(toplam_tahta)}</b> "
             f"gerçek tahtanın {bugun} tarihli analizidir. Yama {e(yama)}, {lig_sayisi} lig "
             f"(Challenger→Platinum). Tüm sayılar TFTRadar'ın kendi topladığı maç verisinden "
             f"hesaplanmıştır — tahmin ya da elle girilmiş tier listesi değildir.</p>")

    g.append("<h3>Zirvedeki komplar</h3>")
    g.append(f"<p>Ortalama sıralaması en düşük beş komp aşağıda. Ortalama sıra 4.50'nin altı "
             f"pozitif LP demektir; 4.00'ün altı ise güçlü bir İlk 4 tutarlılığı gösterir. "
             f"Listeye yalnızca <b>en az {MIN_N} tahtada</b> oynanmış komplar girer — "
             f"birkaç maçlık örneklem yanıltıcı biçimde iyi görünebilir.</p>")
    g.append("<ul>" + "".join(komp_satiri(c) for c in guclu) + "</ul>")
    g.append(f"<div class=\"callout\">Listenin başındaki <b>{e(en_iyi['ad'])}</b>, "
             f"{en_iyi['n']} tahtada {en_iyi['avg']:.2f} ortalamayla kapanıyor — "
             f"İlk 4 oranı %{en_iyi['top4']}. En çok oynanan komp ise "
             f"<b>{e(en_pop['ad'])}</b> ({en_pop['n']} tahta): popülerlik ile güç her zaman "
             f"aynı şey değildir, kalabalık komplar contested olur.</div>")

    if yukselen:
        g.append("<h3>Yükselenler</h3>")
        g.append("<p>Aşağıdaki komplar örneklemin ikinci yarısında ilk yarısına göre belirgin "
                 "biçimde daha iyi kapanıyor. Bu, metanın gün içinde nasıl kaydığını gösterir.</p>")
        g.append("<ul>" + "".join(trend_satiri(c) for c in yukselen) + "</ul>")

    if dusen:
        g.append("<h3>Düşenler</h3>")
        g.append("<p>Bu komplar ise ivme kaybediyor — genelde ya çok kalabalıklaştıkları ya da "
                 "karşı oyunun oturduğu anlamına gelir.</p>")
        g.append("<ul>" + "".join(trend_satiri(c) for c in dusen) + "</ul>")

    if esyalar:
        g.append("<h3>Eşya Δ analizi</h3>")
        g.append("<p>Δ değeri, bir eşyanın taşındığı birimin <i>o eşya olmadan</i> elde ettiği "
                 "ortalamaya kıyasla farkını gösterir. Negatif Δ daha iyidir: eşya sıralamayı "
                 "yukarı taşıyor demektir.</p>")
        g.append("<ul>" + "".join(esya_satiri(kv) for kv in esyalar) + "</ul>")
        g.append("<p>Eşyaların birim bazlı tam listesi için "
                 "<button class=\"blink\" data-goto=\"items\">Eşyalar</button> sekmesine bakabilirsin.</p>")

    g.append("<h3>Nasıl kullanmalı</h3>")
    g.append("<p>Tier listesi bir başlangıç noktasıdır, reçete değil. Açılıştaki eşya "
             "bileşenlerin ve gördüğün augmentler kompu belirler; yukarıdaki tablo yalnızca "
             "hangi yönlerin şu an ödüllendirdiğini söyler. Kadro, augment önceliği ve aşama "
             "planı için <button class=\"blink\" data-goto=\"ai\">AI Kompları</button>, "
             "canlı tier listesi için <button class=\"blink\" data-goto=\"comps\">Komplar</button> "
             "sayfasını kullan.</p>")
    g.append(f"<p class=\"bkaynak\">Veri kaynağı: Riot Games TFT API · {bolge_str} · "
             f"{toplam_tahta} tahta · {e(snap.get('ts') or '')} itibarıyla.</p>")

    # --- govde: EN ---
    ge = []
    ge.append(f"<p>This report analyses <b>{toplam_tahta:,}</b> real boards collected from the "
              f"<b>{bolge_str}</b> servers, as of {bugun}. Patch {e(yama)}, {lig_sayisi} leagues "
              f"(Challenger→Platinum). Every number here is computed from match data TFTRadar "
              f"collects itself — not a hand-written tier list.</p>")
    ge.append("<h3>Top comps</h3>")
    ge.append(f"<p>The five comps with the lowest average placement. Below 4.50 means positive LP; "
              f"below 4.00 indicates strong Top 4 consistency. Only comps played on "
              f"<b>at least {MIN_N} boards</b> qualify — a handful of games can look "
              f"misleadingly good.</p>")
    ge.append("<ul>" + "".join(komp_satiri(c, True) for c in guclu) + "</ul>")
    ge.append(f"<div class=\"callout\">Leading the list, <b>{e(en_iyi['ad'])}</b> closes at "
              f"{en_iyi['avg']:.2f} across {en_iyi['n']} boards with a {en_iyi['top4']}% Top 4 rate. "
              f"The most played comp is <b>{e(en_pop['ad'])}</b> ({en_pop['n']} boards) — "
              f"popularity and strength are not the same thing; crowded comps get contested.</div>")
    if yukselen:
        ge.append("<h3>Rising</h3>")
        ge.append("<p>These comps close noticeably better in the second half of the sample than "
                  "the first — a snapshot of how the meta shifts within the day.</p>")
        ge.append("<ul>" + "".join(trend_satiri(c, True) for c in yukselen) + "</ul>")
    if dusen:
        ge.append("<h3>Falling</h3>")
        ge.append("<p>These are losing momentum, usually because they got crowded or the counter-play "
                  "settled in.</p>")
        ge.append("<ul>" + "".join(trend_satiri(c, True) for c in dusen) + "</ul>")
    if esyalar:
        ge.append("<h3>Item Δ analysis</h3>")
        ge.append("<p>Δ compares a unit's average placement holding the item against its average "
                  "<i>without</i> it. Negative is better: the item pulls placement up.</p>")
        ge.append("<ul>" + "".join(esya_satiri(kv, True) for kv in esyalar) + "</ul>")
        ge.append("<p>See the <button class=\"blink\" data-goto=\"items\">Items</button> tab for the "
                  "full per-unit breakdown.</p>")
    ge.append("<h3>How to use this</h3>")
    ge.append("<p>A tier list is a starting point, not a recipe. Your opening components and the "
              "augments you are offered decide the comp; the table above only tells you which "
              "directions are being rewarded right now. For rosters, augment priority and stage "
              "plans see <button class=\"blink\" data-goto=\"ai\">AI Comps</button>, and "
              "<button class=\"blink\" data-goto=\"comps\">Comps</button> for the live tier list.</p>")
    ge.append(f"<p class=\"bkaynak\">Data source: Riot Games TFT API · {bolge_str} · "
              f"{toplam_tahta} boards · as of {e(snap.get('ts') or '')}.</p>")

    # --- kapak: en guclu uc kompun tasiyicilari ---
    kapak = []
    for c in guclu:
        ad = champ_ad.get(c['carry'])
        if ad and ad not in kapak:
            kapak.append(ad)
        if len(kapak) == 3:
            break

    gun_no = int(bugun.split('.')[0])
    iso = f"{bugun.split('.')[2]}-{bugun.split('.')[1]}-{bugun.split('.')[0]}"

    return {
        'slug': f"meta-raporu-{iso}",
        'tarih': bugun,
        'tarihISO': iso,
        'renk': RENKLER[gun_no % len(RENKLER)],
        'kapakN': kapak,
        'otomatik': True,
        'baslik': f"Meta Raporu {bugun}: Yükselen ve Düşen Komplar (Yama {yama})",
        'baslik_en': f"Meta Report {bugun}: Rising and Falling Comps (Patch {yama})",
        'ozet': (f"{bolge_str} sunucularından {toplam_tahta} tahtanın günlük analizi: "
                 f"zirvedeki komplar, ivme kazananlar, düşüşe geçenler ve Δ-pozitif eşyalar."),
        'ozet_en': (f"Daily analysis of {toplam_tahta} boards from {bolge_str}: top comps, "
                    f"risers, fallers and Δ-positive items."),
        'etiket': ["meta raporu", f"yama {yama}", "veri analizi"],
        'etiket_en': ["meta report", f"patch {yama}", "data analysis"],
        'govde': "\n".join(g),
        'govde_en': "\n".join(ge),
    }


def sitemap_yaz(oto_yazilar):
    """sitemap.xml'i yeniden uretir: statik sayfalar + elle yazilan bloglar +
    OTOMATIK uretilen meta raporlari. Otomatik yazilar her gun degistigi icin
    sitemap'in de her gun guncellenmesi gerekir, yoksa yeni yazilar taranmaz."""
    KOK_URL = "https://tftradar.com"
    statik = [("/", "daily", "1.0"), ("/komplar", "daily", "0.9"),
              ("/ai-komplari", "daily", "0.9"), ("/set-rehberi", "weekly", "0.8"),
              ("/esyalar", "daily", "0.8"), ("/augmentler", "daily", "0.8"),
              ("/oyuncu", "weekly", "0.6"), ("/tft-bilgi", "weekly", "0.7"),
              ("/roll-hesaplayici", "monthly", "0.7"), ("/takim-kurucu", "monthly", "0.7"),
              ("/blog", "daily", "0.8")]
    # Elle yazilan blog slug'lari index.html'deki BLOG_ELLE dizisinden okunur
    elle = []
    try:
        h = open(os.path.join(KOK, 'index.html'), encoding='utf-8').read()
        bas = h.index('const BLOG_ELLE = [')
        son = h.index('\n];', bas)
        elle = re.findall(r'slug:\s*"([^"]+)"', h[bas:son])
    except Exception:
        elle = ["set-17-meta-rehberi", "tft-ekonomi-rehberi", "esya-delta-analizi"]

    sat = ['<?xml version="1.0" encoding="UTF-8"?>',
           '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">']
    for yol, sik, onc in statik:
        sat.append(f'  <url><loc>{KOK_URL}{yol}</loc><changefreq>{sik}</changefreq>'
                   f'<priority>{onc}</priority></url>')
    for sl in elle:
        sat.append(f'  <url><loc>{KOK_URL}/blog/{sl}</loc><changefreq>monthly</changefreq>'
                   f'<priority>0.6</priority></url>')
    for y in oto_yazilar:
        lm = y.get('tarihISO') or ''
        lmx = f'<lastmod>{lm}</lastmod>' if lm else ''
        sat.append(f'  <url><loc>{KOK_URL}/blog/{y["slug"]}</loc>{lmx}'
                   f'<changefreq>monthly</changefreq><priority>0.7</priority></url>')
    sat.append('</urlset>')
    with open(os.path.join(KOK, 'sitemap.xml'), 'w', encoding='utf-8') as f:
        f.write('\n'.join(sat) + '\n')
    return len(statik) + len(elle) + len(oto_yazilar)


def main():
    snap = yukle(SNAP_YOLU)
    oyun = yukle(OYUN_YOLU)
    if not snap or not oyun:
        print("HATA: veri/snap.json veya veri/oyun.json okunamadi.", flush=True)
        return 1

    bugun = datetime.now(timezone(timedelta(hours=3))).strftime('%d.%m.%Y')
    yazi = rapor_uret(snap, oyun, bugun)
    if not yazi:
        print("Yeterli veri yok, yazi uretilmedi.", flush=True)
        return 0

    mevcut = yukle(BLOG_YOLU, []) or []
    if not isinstance(mevcut, list):
        mevcut = []

    # ayni gunun raporu varsa uzerine yaz (gun icinde tekrar calisirsa cogaltmasin)
    mevcut = [p for p in mevcut if p.get('slug') != yazi['slug']]
    mevcut.insert(0, yazi)
    mevcut = mevcut[:TUT]

    os.makedirs(os.path.dirname(BLOG_YOLU), exist_ok=True)
    with open(BLOG_YOLU, 'w', encoding='utf-8') as f:
        json.dump(mevcut, f, ensure_ascii=False)

    kelime = len(yazi['govde'].replace('<', ' <').split())
    print(f"blog.json yazildi — '{yazi['slug']}' (~{kelime} kelime), toplam {len(mevcut)} otomatik yazi",
          flush=True)
    try:
        adet = sitemap_yaz(mevcut)
        print(f"sitemap.xml yazildi — {adet} URL", flush=True)
    except Exception as ex:
        print(f"sitemap yazilamadi: {ex}", flush=True)
    return 0


if __name__ == '__main__':
    sys.exit(main())
