#!/usr/bin/env python3
# Altıgen otomatik güncelleyici — GitHub Actions içinde çalışır.
# veri/oyun.json (statik oyun verisi) okur, Riot API'den maçları toplar,
# analiz eder ve veri/snap.json dosyasını yeniden yazar.
import json, os, re, sys, time, urllib.request, urllib.error
from collections import Counter, defaultdict
from datetime import datetime, timezone, timedelta

KOK = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
KEY = os.environ.get('RIOT_API_KEY', '').strip()
if not KEY.startswith('RGAPI-'):
    sys.exit('RIOT_API_KEY tanımlı değil (GitHub > Settings > Secrets and variables > Actions).')

def guncel_yama_cek():
    """Riot'un resmi TFT yama notlari sayfasindan guncel yamayi OTOMATIK ayiklar.
    Set 18 gelince 18.1'i secer. Basarisiz olursa None -> YAMA env / mevcut deger kullanilir."""
    try:
        _ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36'
        req = urllib.request.Request(
            'https://teamfighttactics.leagueoflegends.com/en-us/news/game-updates/',
            headers={'User-Agent': _ua})
        with urllib.request.urlopen(req, timeout=25) as r:
            html = r.read().decode('utf-8', 'ignore')
        nums = re.findall(r'[Pp]atch[-\s]?(\d{1,2})\.(\d{1,2})', html)
        if not nums:
            return None
        best = max((int(a), int(b)) for a, b in nums)
        return f'{best[0]}.{best[1]}'
    except Exception as e:
        print(f'Yama cekme basarisiz ({e}); yedege dusuluyor.', flush=True)
        return None

window = []
def riot(host, path, tries=4):
    for t in range(tries):
        now = time.time()
        while len([x for x in window if now-x < 120]) >= 88 or len([x for x in window if now-x < 1]) >= 15:
            time.sleep(0.35); now = time.time()
        window.append(now)
        req = urllib.request.Request(f'https://{host}.api.riotgames.com/{path}',
                                     headers={'X-Riot-Token': KEY, 'User-Agent': 'Altigen-guncelleyici/1.0'})
        try:
            with urllib.request.urlopen(req, timeout=15) as y:
                return json.loads(y.read())
        except urllib.error.HTTPError as e:
            if e.code == 429:
                time.sleep(12*(t+1)); continue
            if e.code == 401:
                sys.exit('401 Unknown apikey — anahtarın süresi dolmuş. Secret\'ı yenileyip tekrar çalıştırın.')
            return None
        except Exception:
            time.sleep(2)
    return None

oyun = json.load(open(os.path.join(KOK, 'veri', 'oyun.json'), encoding='utf-8'))
champ_by_id = {c['id']: c for c in oyun['champs']}
trait_tr = {t['id']: t['name'] for t in oyun['traits']}
tr_to_traitid = {t['name']: t['id'] for t in oyun['traits']}
champ_traits = {c['id']: set(c['traits']) for c in oyun['champs']}
item_ids = {i['id'] for i in oyun['items']}
# --- Esya sinifi: bilesenlerine gore saldiri / tank ayrimi (tasiyici tespiti icin) ---
_OFF_COMP = {'TFT_Item_BFSword', 'TFT_Item_NeedlesslyLargeRod', 'TFT_Item_RecurveBow', 'TFT_Item_SparringGloves'}
_DEF_COMP = {'TFT_Item_ChainVest', 'TFT_Item_NegatronCloak', 'TFT_Item_GiantsBelt', 'TFT_Item_FryingPan'}
_item_rec = {i['id']: (i.get('rec') or []) for i in oyun['items']}
def hasar_esyasi_mi(it):
    """True=saldiri, False=tank, None=notr (bilesenlere gore)."""
    r = _item_rec.get(it, [])
    if not r:
        return None
    o = sum(1 for c in r if c in _OFF_COMP)
    d = sum(1 for c in r if c in _DEF_COMP)
    if o >= 1 and o >= d:
        return True
    if d >= 1 and d > o:
        return False
    return None
pool12 = [c for c in oyun['champs'] if c['cost'] <= 2]
def cost(cid): return champ_by_id[cid]['cost'] if cid in champ_by_id else 0

def board_of(m):
    info = m.get('info', {})
    if info.get('tft_set_number') != 17 or info.get('queue_id') != 1100: return None
    dt = info.get('game_datetime')
    return [{"pl": p['placement'], "lvl": p.get('level'), "dt": dt, "augs": p.get('augments') or [],
             "units": [{"c": u.get('character_id'), "s": u.get('tier'), "it": u.get('itemNames') or []}
                       for u in p.get('units', [])],
             "traits": [{"n": t.get('name'), "u": t.get('num_units'), "t": t.get('tier_current')}
                        for t in p.get('traits', []) if t.get('tier_current', 0) >= 1]}
            for p in info.get('participants', [])]

CACHE = {}
def collect(puuids, per, cap):
    ids = []
    for p in puuids:
        r = riot('europe', f'tft/match/v1/matches/by-puuid/{p}/ids?count={per}')
        if isinstance(r, list): ids += r
    boards, kept, scanned = [], 0, 0
    for mid in dict.fromkeys(ids):
        if kept >= cap or scanned >= 90: break
        scanned += 1
        m = CACHE.get(mid) or riot('europe', f'tft/match/v1/matches/{mid}')
        if not m: continue
        CACHE[mid] = m
        b = board_of(m)
        if b: kept += 1; boards += b
    return boards, kept

def analyze(boards):
    def key_traits(b):
        cand = [t for t in b['traits'] if 'Unique' not in t['n'] and t['n'] in trait_tr]
        cand.sort(key=lambda t: (-t['u'], -t['t']))
        return tuple(x['n'] for x in cand[:2]) if len(cand) >= 2 else None
    mn = max(8, round(0.02 * len(boards)))
    clusters = defaultdict(list)
    for b in boards:
        k = key_traits(b)
        if k: clusters[k].append(b)
    merged = defaultdict(list)
    for k, v in clusters.items():
        merged[k if len(v) >= mn else (k[0],)].extend(v)
    out = []
    for k, bs in {k: v for k, v in merged.items() if len(v) >= mn}.items():
        n = len(bs); avg = sum(b['pl'] for b in bs)/n
        uf = Counter(); items_per = defaultdict(Counter); itemcnt = defaultdict(list); star3 = defaultdict(int)
        for b in bs:
            seen = set()
            for u in b['units']:
                c = u['c']
                if c not in champ_by_id or c in seen: continue
                seen.add(c); uf[c] += 1; itemcnt[c].append(len(u['it']))
                if u['s'] == 3: star3[c] += 1
                for it in u['it']:
                    if it in item_ids: items_per[c][it] += 1
        core = [c for c, _ in uf.most_common(10) if uf[c] >= 0.25*n][:8]
        if len(core) < 5: continue
        core.sort(key=lambda c: (cost(c), -uf[c]))
        # Tasiyici = en cok SALDIRI esyasi tasiyan birim (tanklar tasiyici sayilmasin)
        def _saldiri_skoru(c):
            return sum(cnt for it, cnt in items_per[c].items() if hasar_esyasi_mi(it) is True)
        def _ort_esya(c):
            return sum(itemcnt[c]) / len(itemcnt[c]) if itemcnt[c] else 0
        cr = sorted(core, key=lambda c: (-_saldiri_skoru(c), -_ort_esya(c)))
        if _saldiri_skoru(cr[0]) == 0:  # hic saldiri esyasi yoksa eski mantik
            cr = sorted(core, key=lambda c: -_ort_esya(c))
        carry = cr[0]; carryish = cr[:2]
        unit_objs = [{"c": c, "it": [i for i, _ in items_per[c].most_common(3)] if (c in carryish or _ort_esya(c) >= 1.5) else [],
                      "s3": star3[c] >= 0.25*uf[c]} for c in core]
        sb = sorted(bs, key=lambda b: b.get('dt') or 0)
        half = len(sb)//2
        trend, tdelta = None, 0
        if half >= 8:
            oa = sum(b['pl'] for b in sb[:half])/half
            na = sum(b['pl'] for b in sb[half:])/(len(sb)-half)
            tdelta = round(oa - na, 2)
            if tdelta >= 0.3: trend = 'up'
            elif tdelta <= -0.3: trend = 'down'
        tcount = Counter()
        for c in core:
            for t in champ_traits[c]:
                if t in tr_to_traitid: tcount[t] += 1
        tbadges = [[tr_to_traitid[t], cnt] for t, cnt in tcount.most_common(6) if cnt >= 2]
        avlvl = sum(b['lvl'] or 0 for b in bs)/n
        s3dom = Counter()
        for b in bs:
            for u in b['units']:
                if u['s'] == 3 and cost(u['c']) in (1, 2, 3): s3dom[cost(u['c'])] += 1
        dom = s3dom.most_common(1)
        if dom and dom[0][1] >= 0.5*n:
            lvl = {1: 5, 2: 6, 3: 7}[dom[0][0]]; style = f"Yavaş Roll ({lvl})"
        elif avlvl >= 8.4: style, lvl = "Hızlı 9", 9
        elif avlvl >= 7.55: style, lvl = "Hızlı 8", 8
        else: style, lvl = "Standart", 8
        tier = "S" if avg <= 4.10 else "A" if avg <= 4.35 else "B" if avg <= 4.60 else "C"
        prim = trait_tr[k[0]]; sec = trait_tr[k[1]] if len(k) > 1 else None
        early = [c['id'] for c in sorted(pool12, key=lambda c: (
            -(prim in c['traits']), -(1 if sec and sec in c['traits'] else 0), c['cost'], -uf[c['id']]))
            if prim in c['traits'] or (sec and sec in c['traits'])][:4]
        if len(early) < 4:
            coreT = set().union(*[champ_traits[c] for c in core])
            extra = sorted((c for c in pool12 if c['id'] not in early),
                           key=lambda c: (-len(set(c['traits']) & coreT), c['cost'], -uf[c['id']]))
            early += [c['id'] for c in extra[:4-len(early)]]
        alts, used = [], set()
        for cu in core:
            without = [b for b in bs if cu not in {u['c'] for u in b['units']}]
            if len(without) < 5: continue
            cand = Counter()
            for b in without:
                for u in b['units']:
                    c2 = u['c']
                    if (c2 in champ_by_id and c2 not in core and abs(cost(c2)-cost(cu)) <= 1
                            and champ_traits[c2] & champ_traits[cu]): cand[c2] += 1
            best = cand.most_common(1)
            if best and best[0][1] >= max(3, 0.12*len(without)) and best[0][0] not in used:
                alts.append([cu, best[0][0], best[0][1]]); used.add(best[0][0]); used.add(cu)
        alts.sort(key=lambda a: -a[2]); alts = [a[:2] for a in alts[:4]]
        if len(alts) < 3:
            for cu in sorted(core, key=lambda c: -cost(c)):
                if any(cu == a[0] for a in alts): continue
                pool = [c for c in oyun['champs'] if c['id'] not in core and c['id'] not in used
                        and champ_traits[c['id']] & champ_traits[cu]]
                pool.sort(key=lambda c: (abs(c['cost']-cost(cu)), -(prim in c['traits']), -uf[c['id']]))
                if pool: alts.append([cu, pool[0]['id']]); used.add(pool[0]['id']); used.add(cu)
                if len(alts) >= 3: break
        cname = champ_by_id[carry]['name']
        earlyN = ", ".join(champ_by_id[e]['name'] for e in early[:3])
        hi = max(core, key=cost)
        threes = [champ_by_id[u['c']]['name'] for u in unit_objs if u['s3']][:2]
        if style.startswith("Yavaş"):
            stages = [f"Erken birimlerle ({earlyN}) sıralamayı koru; eşyaları beklemeden bas, ekonomi kur.",
                      f"Seviye {lvl}'te dur, 50 altının üstünde roll yap: hedef {cname} 3★" + (f" ve {threes[1]} 3★" if len(threes) > 1 else "") + ".",
                      f"3★'lar tamamlanınca seviye atla; tahtayı {champ_by_id[hi]['name']} ve yüksek maliyetlilerle kapla."]
        elif style == "Hızlı 9":
            stages = [f"Az roll, çok faiz: ({earlyN}) ile ayakta kal, 50 altını koru.",
                      f"Seviye 7-8'de yalnızca güçlenecek kadar roll yap; {cname} için eşyaları hazırla.",
                      f"Seviye 9'a bas ve {champ_by_id[hi]['name']} dahil 5 maliyetlileri ekle; {cname} 2★ tamamla."]
        else:
            stages = [f"({earlyN}) ile sağlam açılış yap, eşyaları erken bas.",
                      f"Seviye 8'e hızlı çık, {cname} 2★ için agresif roll yap.",
                      f"Kalan altınla tahtayı {champ_by_id[hi]['name']} gibi yüksek maliyetlilerle güçlendir."]
        out.append({"name": " + ".join(trait_tr[t] for t in k), "tier": tier, "style": style, "n": n,
                    "avg": round(avg, 2), "top4": round(100*sum(1 for b in bs if b['pl'] <= 4)/n),
                    "win": round(100*sum(1 for b in bs if b['pl'] == 1)/n),
                    "carry": carry, "traits": tbadges, "units": unit_objs,
                    "early": early, "alts": alts, "stages": stages,
                    "tr": trend, "td": tdelta, "kt": list(k)})
    out.sort(key=lambda c: c['avg'])
    return out

tinfo = [(t['id'], t['id'].split('_', 1)[1].lower(), t['name'].lower()) for t in oyun['traits']]
alow = [(a['id'], a['id'].lower(), a['name'].lower(), a['d'].lower()) for a in oyun['augments']]
def augs_for(trait_ids):
    toks = [(a, tok, nm) for tid in trait_ids for a, tok, nm in tinfo if a == tid]
    hits = []
    for aid, al, anm, ad in alow:
        sc = 0
        for tid, tok, nm in toks:
            if (len(tok) >= 4 and tok in al) or (len(nm) >= 4 and nm in anm): sc = max(sc, 2)
            elif len(nm) >= 5 and nm in ad: sc = max(sc, 1)
        if sc: hits.append((sc, aid))
    hits.sort(key=lambda x: (-x[0], x[1]))
    return [h[1] for h in hits[:8]]

# ---- toplama planı ----
chall = riot('tr1', 'tft/league/v1/challenger') or {'entries': []}
top = sorted(chall['entries'], key=lambda x: -x['leaguePoints'])
HIZLI = os.environ.get('ALTIGEN_HIZLI') == '1'
def K(x): return max(6, x//4) if HIZLI else x
plans = [('CHALLENGER', [e['puuid'] for e in top[:(6 if HIZLI else 20)]], 8, K(100))]
for tier, ep in (('GRANDMASTER', 'tft/league/v1/grandmaster'), ('MASTER', 'tft/league/v1/master')):
    d = riot('tr1', ep) or {}
    es = sorted(d.get('entries', []), key=lambda x: -x.get('leaguePoints', 0))[:10]
    plans.append((tier, [e['puuid'] for e in es[:(4 if HIZLI else 10)]], 6, K(40)))
for tier in ('DIAMOND', 'EMERALD', 'PLATINUM'):
    d = riot('tr1', f'tft/league/v1/entries/{tier}/I') or []
    es = sorted([e for e in (d if isinstance(d, list) else []) if e.get('puuid')],
                key=lambda e: -(e.get('wins', 0)+e.get('losses', 0)))[:12]
    plans.append((tier, [e['puuid'] for e in es[:(4 if HIZLI else 12)]], 20, K(28)))

leagues, allb = {}, []
for tier, pu, per, cap in plans:
    boards, kept = collect(pu, per, cap)
    allb += boards
    comps = analyze(boards)
    for c in comps:
        c['augs'] = augs_for(c.pop('kt') + [t for t, _ in c['traits'][:3]])
    leagues[tier] = {"comps": comps, "sample": {"m": kept, "b": len(boards)}}
    print(f"{tier:12s} {kept:3d} maç, {len(boards):4d} tahta, {len(comps):2d} komp", flush=True)

# ---- liderlik + örnek profil ----

ladder = []
for e in top[:10]:
    acc = riot('europe', f"riot/account/v1/accounts/by-puuid/{e['puuid']}") or {}
    ladder.append({"name": acc.get('gameName', '?'), "tag": acc.get('tagLine', 'TR1'),
                   "lp": e['leaguePoints'], "w": e['wins'], "l": e['losses'], "pu": e['puuid']})
matches = []
if top:
    ids = riot('europe', f"tft/match/v1/matches/by-puuid/{top[0]['puuid']}/ids?count=5") or []
    for mid in ids:
        m = CACHE.get(mid) or riot('europe', f'tft/match/v1/matches/{mid}')
        if not m or 'info' not in m: continue
        me = next((x for x in m['info']['participants'] if x['puuid'] == top[0]['puuid']), None)
        if not me: continue
        matches.append({"p": me['placement'], "lvl": me.get('level'), "g": me.get('gold_left'),
                        "dmg": me.get('total_damage_to_players'), "dt": m['info'].get('game_datetime'),
                        "augs": me.get('augments') or [],
                        "units": [{"c": u.get('character_id'), "s": u.get('tier'), "it": u.get('itemNames') or []}
                                  for u in me.get('units', [])]})

# ---- eşya kullanım istatistikleri ----
snap_yolu = os.path.join(KOK, 'veri', 'snap.json')
snap = json.load(open(snap_yolu, encoding='utf-8')) if os.path.exists(snap_yolu) else {}
lb = [b for b in allb if (b.get('lvl') or 0) >= 6]
base = defaultdict(lambda: [0, 0]); pair = defaultdict(lambda: defaultdict(lambda: [0, 0]))
for b in lb:
    seen = set()
    for u in b['units']:
        c = u['c']
        if c not in champ_by_id or c in seen: continue
        seen.add(c)
        base[c][0] += 1; base[c][1] += b['pl']
        for it in set(u['it']):
            if it in item_ids:
                pair[it][c][0] += 1; pair[it][c][1] += b['pl']
snap['itemStats'] = {}
for it, per in pair.items():
    num = den = tot = 0
    for c, (n, s) in per.items():
        if n < 8 or base[c][0] < 12: continue
        d = s/n - base[c][1]/base[c][0]
        num += n*d; den += n; tot += n
    if den >= 25:
        d = round(num/den, 2)
        raw = sum(s for n, s in per.values())/sum(n for n, s in per.values())
        t = "S" if d <= -0.35 else "A" if d <= -0.12 else "B" if d <= 0.08 else "C"
        snap['itemStats'][it] = {"n": tot, "avg": round(raw, 2), "d": d, "t": t}

snap['leagues'] = leagues
snap['ladder'] = ladder
if ladder:
    snap['profile'] = {"name": ladder[0]['name'], "tag": ladder[0]['tag'], "tier": "Challenger",
                       "lp": top[0]['leaguePoints'], "w": top[0]['wins'], "l": top[0]['losses']}
if matches: snap['matches'] = matches
snap['ts'] = datetime.now(timezone(timedelta(hours=3))).strftime('%d.%m.%Y %H:%M')
snap['sampleAll'] = {"b": len(allb)}
# Yama etiketi: GitHub repo degiskeni YAMA'dan (yoksa mevcut/varsayilan). Boylece snap.json donmaz.
snap['patch'] = guncel_yama_cek() or os.environ.get('YAMA') or snap.get('patch') or '17.7'
snap['set'] = int(snap['patch'].split('.')[0])  # yamadan turet (17.7 -> 17, 18.1 -> 18)

# --- Veri kalitesi koruması: cok az tahta toplandiysa ESKI veriyi KORU, hata ver ---
# Boylece bir daha "sessizce basarili ama bos" durumu olusmaz; Actions kirmizi yanar.
ESIK = 200
if len(allb) < ESIK:
    sys.exit(f"HATA: yalnizca {len(allb)} tahta toplandi (esik {ESIK}). "
             f"Riot API kismi/bos donmus olabilir. snap.json DEGISTIRILMEDI, eski veri korundu.")

json.dump(snap, open(snap_yolu, 'w', encoding='utf-8'), ensure_ascii=False)
print(f"snap.json yazıldı — {snap['ts']} · toplam {len(allb)} tahta")
