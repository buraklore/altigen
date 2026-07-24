/* TFTRadar Yayın Overlay'i — istemci mantigi.
 *
 * Iki mod, tek dosya:
 *   1) ?id=isim%23TFT1&bolge=euw1  -> SEFFAF OVERLAY (OBS tarayici kaynagi)
 *   2) parametresiz                 -> LINK OLUSTURUCU (yayinci burada linkini yapar)
 *
 * Overwolf YOK. Saf web. Riot API anahtari sunucudaki proxy'de (/api/oyuncu).
 */
(function () {
  "use strict";

  // Yeni domaine gecince tek yeri burasi. Overlay'in cektigi proxy adresi.
  var API_KOK = location.origin.indexOf("http") === 0 && location.origin.indexOf("file") < 0
    ? location.origin
    : "https://altigen.vercel.app";

  var YENILE_MS = 60000;   // overlay verisini kac ms'de bir tazele (60 sn)

  var TIER_RENK = {
    Demir: "#8A8D91", Bronz: "#B4805B", "Gümüş": "#9FB0C3", "Altın": "#F0B441",
    Platin: "#4FC4B0", "Zümrüt": "#4FD18B", Elmas: "#59B3F0",
    Usta: "#B06AF0", "Büyük Usta": "#E0565B", "Şampiyon": "#3FC9D8",
  };

  var $ = function (id) { return document.getElementById(id); };

  function parametre(ad) {
    return new URLSearchParams(location.search).get(ad);
  }

  // ---- tier amblemi (SVG, tier rengine gore) --------------------------------
  // Riot amblem gorselleri yerine kendi SVG'miz: telif yok, harici baglanti yok.
  function amblemSVG(renk) {
    return '<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">' +
      '<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0" stop-color="' + renk + '"/>' +
      '<stop offset="1" stop-color="' + koyult(renk) + '"/></linearGradient></defs>' +
      // dis kalkan
      '<path d="M32 3 L57 13 L57 34 Q57 52 32 61 Q7 52 7 34 L7 13 Z" ' +
      'fill="url(#g)" stroke="rgba(255,255,255,.35)" stroke-width="1.5"/>' +
      // ic kalkan
      '<path d="M32 11 L49 18 L49 33 Q49 45 32 52 Q15 45 15 33 L15 18 Z" ' +
      'fill="rgba(8,16,28,.55)" stroke="rgba(255,255,255,.25)" stroke-width="1"/>' +
      // yildiz
      '<path d="M32 20 l3.2 6.8 7.3 .9 -5.4 5 1.4 7.3 L32 43.5 l-6.5 3.5 1.4 -7.3 -5.4 -5 7.3 -.9 Z" ' +
      'fill="' + renk + '" stroke="rgba(255,255,255,.5)" stroke-width=".6"/>' +
      '</svg>';
  }
  function koyult(hex) {
    try {
      var n = parseInt(hex.slice(1), 16);
      var r = Math.max(0, ((n >> 16) & 255) - 70), g = Math.max(0, ((n >> 8) & 255) - 70), b = Math.max(0, (n & 255) - 70);
      return "#" + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
    } catch (e) { return "#0A1628"; }
  }

  // ---- veri cek + ciz --------------------------------------------------------
  function veriCek(riotId, bolge) {
    var url = API_KOK + "/api/oyuncu?riotId=" + encodeURIComponent(riotId) +
      "&bolge=" + encodeURIComponent(bolge) + "&adet=10";
    return fetch(url, { cache: "no-store" })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (res) {
        if (!res.ok || res.j.hata) throw new Error(res.j.hata || "Veri alınamadı");
        cizOverlay(res.j);
        return res.j;
      });
  }

  function cizOverlay(d) {
    $("miniDurum").style.display = "none";
    $("kartIcerik").style.display = "block";

    var tierTr = d.lig ? d.lig.tierTr : null;
    var renk = TIER_RENK[tierTr] || "#3FC9D8";
    // sol kenar isigi + rozet rengi
    $("kart").style.setProperty("--tier", renk + "59");   // %35 alpha
    $("rozet").innerHTML = amblemSVG(renk);

    $("ovIsim").textContent = (d.riotId || "").split("#")[0];
    $("ovBolge").textContent = (d.bolge || "").toUpperCase();

    if (d.lig) {
      $("ovTier").textContent = d.lig.tierTr + (d.lig.rank ? " " + d.lig.rank : "");
      $("ovTier").style.color = renk;
      $("ovLp").textContent = d.lig.lp;
      $("ovLp").parentNode.style.display = "";
    } else {
      $("ovTier").textContent = "Derecesiz";
      $("ovTier").style.color = "#B9C6D8";
      $("ovLp").parentNode.style.display = "none";
    }

    // son maclar + ort
    var o = d.ozet || {};
    var s = $("ovMaclar");
    s.innerHTML = "";
    (d.maclar || []).slice(0, 8).forEach(function (m) {
      var el = document.createElement("div");
      el.className = "pul p" + m.pl;
      el.textContent = m.pl;
      s.appendChild(el);
    });
    var ob = $("ovOrt");
    if (o.ort != null) {
      ob.textContent = o.ort.toFixed(2);
      ob.className = o.ort <= 4.0 ? "iyi" : o.ort >= 5.0 ? "kotu" : "";
    } else {
      ob.textContent = "—"; ob.className = "";
    }
    // hic mac yoksa orta satiri gizle (kart daha derli toplu dursun)
    $("ovOrta").style.display = (d.maclar || []).length ? "flex" : "none";
  }

  function overlayHata(mesaj) {
    $("kartIcerik").style.display = "none";
    var m = $("miniDurum");
    m.style.display = "block";
    m.textContent = mesaj;
  }

  // ---- MOD 1: OVERLAY --------------------------------------------------------
  function overlayModu(riotId, bolge) {
    $("overlay").classList.add("acik");
    document.title = riotId + " · TFTRadar";
    function tazele() {
      veriCek(riotId, bolge).catch(function (e) {
        // Ilk yuklemede hata goster; sonraki tazelemelerde eski karti koru
        if ($("kartIcerik").style.display === "none") overlayHata(e.message || "Bağlanılamadı");
      });
    }
    tazele();
    setInterval(tazele, YENILE_MS);
  }

  // ---- MOD 2: LINK OLUSTURUCU ------------------------------------------------
  function olusturModu() {
    $("olustur").classList.add("acik");

    function link(riotId, bolge) {
      return API_KOK + "/overlay.html?id=" + encodeURIComponent(riotId) +
        "&bolge=" + encodeURIComponent(bolge);
    }

    $("olusturBtn").addEventListener("click", function () {
      var riotId = $("riotId").value.trim();
      var bolge = $("bolge").value;
      var h = $("olusturHata");
      h.textContent = "";
      if (riotId.indexOf("#") < 0) {
        h.textContent = 'Riot ID "isim#etiket" biçiminde olmalı (ör. Faker#TR1).';
        return;
      }
      $("olusturBtn").disabled = true;
      // Once dogrula: oyuncu gercekten var mi?
      veriCek(riotId, bolge)
        .then(function (d) {
          var u = link(d.riotId, bolge);
          $("linkText").value = u;
          $("onizlikFrame").src = u;
          $("sonuc").classList.add("acik");
        })
        .catch(function (e) { h.textContent = e.message || "Oyuncu bulunamadı."; })
        .then(function () { $("olusturBtn").disabled = false; });
    });

    $("riotId").addEventListener("keydown", function (e) {
      if (e.key === "Enter") $("olusturBtn").click();
    });

    $("kopyalaBtn").addEventListener("click", function () {
      var t = $("linkText");
      t.select();
      try {
        navigator.clipboard.writeText(t.value);
      } catch (e) { document.execCommand("copy"); }
      var b = $("kopyalaBtn");
      b.textContent = "Kopyalandı ✓"; b.classList.add("ok");
      setTimeout(function () { b.textContent = "Kopyala"; b.classList.remove("ok"); }, 1600);
    });
  }

  // ---- baslat: parametreye gore mod sec --------------------------------------
  (function baslat() {
    var id = parametre("id");
    var bolge = parametre("bolge") || "euw1";
    if (id && id.indexOf("#") >= 0) overlayModu(id, bolge);
    else olusturModu();
  })();
})();
