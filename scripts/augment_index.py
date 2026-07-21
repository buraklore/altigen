"""
Augment -> Komp indeksi olusturucu.
Amac: kullanici bir augment sectiginde, o augment ile en cok oynanan komplari
(ve gercek augment-ozel performansini) gosterebilmek.

Bu modul bilerek guncelle.py'den ayri tutuldu (kod sismesin). guncelle.py yalnizca
`build(leagues, oyun)` cagirir ve sonucu veri/augments.json'a yazar.

Iki uretim yolu var:
  - build(leagues, oyun): GERCEK veri. Her kompun `_aug` alanindaki augment-ozel
    sayaclarindan (n / yerlesim toplami / top4) turetilir. En dogru sonuc budur.
  - build_interim(snap, oyun): GECICI. Henuz `_aug` yokken (ilk kurulum), mevcut
    snap.json'daki kompun heuristik `augs` listesini tersine cevirir. Kapsama zayiftir
    ama ayni formatta calisir; bir sonraki guncellemede build() ile degisir.

Cikti formati (augments.json):
{
  "ts": "...",
  "mode": "real" | "interim",
  "augList": [ {"id": augId, "n": toplamKullanim}, ... ],   # secici/otomatik tamamlama icin
  "byAug": { augId: [ {"lg","ci","name","carry","tier","n","avg","top4"}, ... ] }  # komp basi
}
Not: "lg" + "ci" ile arayuz SNAP.leagues[lg].comps[ci]'yi bulup tam build'i (compDetail) render eder.
"""

from collections import defaultdict

# Bir augment icin gosterilecek maksimum komp sayisi
MAX_KOMP_PER_AUG = 12
# Bir kompun bir augment icin sayilmasi icin gereken minimum ornek
MIN_N = 2


def _augen_list(oyun):
    return [a.get("id") for a in (oyun.get("augments") or []) if a.get("id")]


def build(leagues, oyun, ts=""):
    """GERCEK: kompun `_aug` (augment-ozel sayaclar) alanindan indeks kur."""
    byAug = defaultdict(list)
    for lg_key, lg in (leagues or {}).items():
        for ci, c in enumerate(lg.get("comps", []) or []):
            astat = c.get("_aug") or {}
            for aid, v in astat.items():
                # v = [n, yerlesim_toplami, top4_sayisi]
                try:
                    nn, plsum, t4 = int(v[0]), float(v[1]), int(v[2])
                except (TypeError, ValueError, IndexError):
                    continue
                if nn < MIN_N:
                    continue
                byAug[aid].append({
                    "lg": lg_key, "ci": ci,
                    "name": c.get("name", ""), "carry": c.get("carry", ""),
                    "tier": c.get("tier", "C"),
                    "n": nn, "avg": round(plsum / nn, 2), "top4": round(100 * t4 / nn),
                })
    return _finalize(byAug, "real", ts)


def build_interim(snap, oyun, ts=""):
    """GECICI: mevcut snap.json'daki heuristik kompun `augs` listesini tersine cevir."""
    byAug = defaultdict(list)
    leagues = (snap or {}).get("leagues", {}) or {}
    for lg_key, lg in leagues.items():
        for ci, c in enumerate(lg.get("comps", []) or []):
            for aid in (c.get("augs") or []):
                byAug[aid].append({
                    "lg": lg_key, "ci": ci,
                    "name": c.get("name", ""), "carry": c.get("carry", ""),
                    "tier": c.get("tier", "C"),
                    # augment-ozel veri yok; kompun genel istatistigi yer tutucu olarak
                    "n": int(c.get("n", 0) or 0),
                    "avg": round(float(c.get("avg", 0) or 0), 2),
                    "top4": int(c.get("top4", 0) or 0),
                })
    return _finalize(byAug, "interim", ts)


def _finalize(byAug, mode, ts):
    out = {}
    for aid, lst in byAug.items():
        # once sik oynanan (n) sonra dusuk yerlesim (avg) -> en iyi build ustte
        lst.sort(key=lambda x: (-x["n"], x["avg"]))
        out[aid] = lst[:MAX_KOMP_PER_AUG]
    totals = {aid: sum(x["n"] for x in lst) for aid, lst in byAug.items()}
    aug_list = [{"id": aid, "n": totals[aid]} for aid in sorted(totals, key=lambda a: -totals[a])]
    return {"ts": ts, "mode": mode, "augList": aug_list, "byAug": out}
