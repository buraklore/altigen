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

  // Tier renkleri — ham (Riot) tier anahtarlariyla, dilden bagimsiz.
  var TIER_RENK = {
    IRON: "#8A8D91", BRONZE: "#B4805B", SILVER: "#9FB0C3", GOLD: "#F0B441",
    PLATINUM: "#4FC4B0", EMERALD: "#4FD18B", DIAMOND: "#59B3F0",
    MASTER: "#B06AF0", GRANDMASTER: "#E0565B", CHALLENGER: "#3FC9D8",
  };

  // ---- dil (i18n) ------------------------------------------------------------
  // Tier adlari her iki dilde. Overlay ve olusturucu dile gore metin secer.
  var TIER_AD = {
    tr: { IRON: "Demir", BRONZE: "Bronz", SILVER: "Gümüş", GOLD: "Altın",
      PLATINUM: "Platin", EMERALD: "Zümrüt", DIAMOND: "Elmas",
      MASTER: "Usta", GRANDMASTER: "Büyük Usta", CHALLENGER: "Şampiyon" },
    en: { IRON: "Iron", BRONZE: "Bronze", SILVER: "Silver", GOLD: "Gold",
      PLATINUM: "Platinum", EMERALD: "Emerald", DIAMOND: "Diamond",
      MASTER: "Master", GRANDMASTER: "Grandmaster", CHALLENGER: "Challenger" },
  };
  var USTLIG = ["MASTER", "GRANDMASTER", "CHALLENGER"];  // bolumu (I/II..) olmayan ligler

  var METIN = {
    tr: {
      baslik: 'Yayın Overlay\'i', altAciklama: 'Rankını, LP\'ni ve son maçlarını yayınında göster. İndirme yok, API anahtarı derdi yok — Riot ID\'ni gir, OBS linkini al.',
      riotId: 'Riot ID', bolge: 'Bölge', dil: 'Dil',
      olusturBtn: '⚔️ Overlay Linkini Oluştur', linkLabel: 'OBS\'ye ekleyeceğin link',
      kopyala: 'Kopyala', kopyalandi: 'Kopyalandı ✓', onizleme: 'Önizleme',
      ortSira: 'Ort. Sıra', derecesiz: 'Derecesiz', lp: 'LP',
      yardimBaslik: '🎬 OBS\'ye nasıl eklenir?',
      yardim1: 'OBS\'de <b>Kaynaklar → Ekle → Tarayıcı</b> (Browser)',
      yardim2: 'URL kısmına yukarıdaki linki yapıştır',
      yardim3: 'Genişlik <code>424</code>, Yükseklik <code>200</code>',
      yardim4: 'Arka plan şeffaf gelir — oyunun üstünde durur',
      k1b: 'Rankın canlı görünür', k1d: 'Şampiyon 784 LP mi? İzleyicilerin anlık olarak görsün. Maç bitince otomatik güncellenir.',
      k2b: 'Son maçların ve ortalaman', k2d: 'Son 8 maçtaki sıraların renkli pullarla, ortalama sıran tek bakışta.',
      k3b: 'İndirme yok, şeffaf', k3d: 'Overwolf gerekmez. OBS\'de tarayıcı kaynağı olarak eklenir, oyunun üstüne oturur.',
      k4b: 'API anahtarı bizde', k4d: 'Başka trackerların aksine kendi Riot anahtarını girip her gün yenilemek zorunda değilsin.',
      hataId: 'Riot ID "isim#etiket" biçiminde olmalı (ör. Faker#TR1).',
      hataBaglanti: 'Bağlanılamadı.', hataVeri: 'Veri alınamadı',
    },
    en: {
      baslik: 'Stream Overlay', altAciklama: 'Show your rank, LP and recent games on stream. No download, no API key hassle — enter your Riot ID, get an OBS link.',
      riotId: 'Riot ID', bolge: 'Region', dil: 'Language',
      olusturBtn: '⚔️ Generate Overlay Link', linkLabel: 'Link to add in OBS',
      kopyala: 'Copy', kopyalandi: 'Copied ✓', onizleme: 'Preview',
      ortSira: 'Avg. Place', derecesiz: 'Unranked', lp: 'LP',
      yardimBaslik: '🎬 How to add to OBS?',
      yardim1: 'In OBS: <b>Sources → Add → Browser</b>',
      yardim2: 'Paste the link above into the URL field',
      yardim3: 'Width <code>424</code>, Height <code>200</code>',
      yardim4: 'Background is transparent — sits on top of the game',
      k1b: 'Your rank, live', k1d: 'Challenger at 784 LP? Let your viewers see it in real time. Auto-updates after each game.',
      k2b: 'Recent games & average', k2d: 'Your last 8 placements in colored chips, average place at a glance.',
      k3b: 'No download, transparent', k3d: 'No Overwolf needed. Added as a browser source in OBS, sits on top of your game.',
      k4b: 'We hold the API key', k4d: 'Unlike other trackers, you don\'t have to enter your own Riot key and renew it every day.',
      hataId: 'Riot ID must be in "name#tag" format (e.g. Faker#TR1).',
      hataBaglanti: 'Could not connect.', hataVeri: 'Could not fetch data',
    },
  };

  function parametre(ad) {
    return new URLSearchParams(location.search).get(ad);
  }

  // Aktif dil: URL ?dil= veya ?lang=, yoksa tarayici, yoksa tr.
  function dilSec() {
    var d = (parametre("dil") || parametre("lang") || "").toLowerCase();
    if (d === "en" || d === "tr") return d;
    var nav = (navigator.language || "tr").toLowerCase();
    return nav.indexOf("tr") === 0 ? "tr" : "en";
  }
  var DIL = dilSec();
  function T(anahtar) { return (METIN[DIL] || METIN.tr)[anahtar]; }
  // Tier ham anahtarini aktif dilde metne cevir.
  function tierMetni(ham) { return (TIER_AD[DIL] || TIER_AD.tr)[ham] || ham; }

  var $ = function (id) { return document.getElementById(id); };

  // Oluşturucu ekranı için kayan yıldız/parıltı üret (TFT "yıldız tozu" hissi)
  function yildizUret() {
    var kap = $("yildizlar");
    if (!kap) return;
    var simgeler = ["✦", "✧", "⭑", "✵", "◆"];
    for (var i = 0; i < 18; i++) {
      var y = document.createElement("span");
      y.className = "yildiz";
      y.textContent = simgeler[i % simgeler.length];
      y.style.left = Math.random() * 100 + "%";
      y.style.fontSize = (9 + Math.random() * 12) + "px";
      y.style.animationDuration = (7 + Math.random() * 9) + "s";
      y.style.animationDelay = (-Math.random() * 12) + "s";
      kap.appendChild(y);
    }
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
  // cizMi=true ise overlay modu (kart dogrudan cizilir). Olusturucu modu false
  // gonderir; onizlemeyi cagiran taraf kendisi cizer.
  function veriCek(riotId, bolge, cizMi) {
    var url = API_KOK + "/api/oyuncu?riotId=" + encodeURIComponent(riotId) +
      "&bolge=" + encodeURIComponent(bolge) + "&adet=10";
    return fetch(url, { cache: "no-store" })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (res) {
        if (!res.ok || res.j.hata) throw new Error(res.j.hata || T("hataVeri"));
        if (cizMi) cizOverlay(res.j);
        return res.j;
      });
  }

  // Overlay kartinin ic HTML'ini uretir — hem gercek overlay hem onizleme kullanir.
  function kartHTML(d) {
    var ham = d.lig ? d.lig.tier : null;               // ham tier: CHALLENGER
    var renk = TIER_RENK[ham] || "#3FC9D8";
    var isim = (d.riotId || "").split("#")[0];
    var bolge = (d.bolge || "").toUpperCase();

    var tierBlok, lpBlok;
    if (d.lig) {
      var ustLig = USTLIG.indexOf(ham) >= 0;           // Master+ -> bolum yok
      var rankMetni = (!ustLig && d.lig.rank) ? " " + d.lig.rank : "";
      tierBlok = '<div class="tier" style="color:' + renk + '">' + esc(tierMetni(ham) + rankMetni) + '</div>';
      lpBlok = '<div class="lp"><span>' + d.lig.lp + '</span><small>' + T("lp") + '</small></div>';
    } else {
      tierBlok = '<div class="tier" style="color:#B9C6D8">' + T("derecesiz") + '</div>';
      lpBlok = '';
    }

    var o = d.ozet || {};
    var maclar = (d.maclar || []).slice(0, 8).map(function (m) {
      return '<div class="pul p' + m.pl + '">' + m.pl + '</div>';
    }).join("");
    var ortSinif = o.ort != null ? (o.ort <= 4.0 ? "iyi" : o.ort >= 5.0 ? "kotu" : "") : "";
    var ortMetin = o.ort != null ? o.ort.toFixed(2) : "—";
    var ortaBlok = (d.maclar || []).length
      ? '<div class="orta"><div class="maclar">' + maclar + '</div>' +
        '<div class="ortkutu"><b class="' + ortSinif + '">' + ortMetin + '</b><span>' + T("ortSira") + '</span></div></div>'
      : '';

    return '<div class="kart" style="--tier:' + renk + '59">' +
      '<div class="ust"><div class="rozet">' + amblemSVG(renk) + '</div>' +
      '<div class="bilgi"><div class="isim">' + esc(isim) + '<span class="bolge">' + esc(bolge) + '</span></div>' +
      tierBlok + lpBlok + '</div></div>' +
      ortaBlok +
      '<div class="marka"><span class="logo">R</span><b>TFT<span>RADAR</span>.COM</b></div></div>';
  }

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }

  // Overlay modu: karti kartHTML ile ciz (dil + tier mantigi tek yerde).
  function cizOverlay(d) {
    var kap = $("overlay");
    if (!kap) return;
    kap.innerHTML = kartHTML(d);
  }

  function overlayHata(mesaj) {
    var kap = $("overlay");
    if (kap) kap.innerHTML = '<div class="kart"><div class="mini-durum">' + esc(mesaj) + '</div></div>';
  }

  // ---- MOD 1: OVERLAY --------------------------------------------------------
  function overlayModu(riotId, bolge) {
    $("overlay").classList.add("acik");
    document.title = riotId + " · TFTRadar";
    var ilkYuklemeYapildi = false;
    function tazele() {
      veriCek(riotId, bolge, true)
        .then(function () { ilkYuklemeYapildi = true; })
        .catch(function (e) {
          // Ilk yuklemede hata goster; sonraki tazelemelerde eski karti koru
          if (!ilkYuklemeYapildi) overlayHata(e.message || T("hataBaglanti"));
        });
    }
    tazele();
    setInterval(tazele, YENILE_MS);
  }

  // ---- MOD 2: LINK OLUSTURUCU ------------------------------------------------
  function olusturModu() {
    $("olustur").classList.add("acik");
    yildizUret();
    olusturMetinleri();   // arayuz metinlerini aktif dile gore yaz

    function link(riotId, bolge) {
      return API_KOK + "/overlay.html?id=" + encodeURIComponent(riotId) +
        "&bolge=" + encodeURIComponent(bolge) + "&dil=" + DIL;
    }

    $("olusturBtn").addEventListener("click", function () {
      var riotId = $("riotId").value.trim();
      var bolge = $("bolge").value;
      var h = $("olusturHata");
      h.textContent = "";
      if (riotId.indexOf("#") < 0) {
        h.textContent = T("hataId");
        return;
      }
      $("olusturBtn").disabled = true;
      // Once dogrula: oyuncu gercekten var mi?
      veriCek(riotId, bolge, false)
        .then(function (d) {
          var u = link(d.riotId, bolge);
          $("linkText").value = u;
          // Onizlemeyi iframe yerine DOGRUDAN ciz — X-Frame-Options / CSP engeline takilmaz.
          $("onizlikKart").innerHTML = kartHTML(d);
          $("sonuc").classList.add("acik");
        })
        .catch(function (e) { h.textContent = e.message || T("hataVeri"); })
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
      b.textContent = T("kopyalandi"); b.classList.add("ok");
      setTimeout(function () { b.textContent = T("kopyala"); b.classList.remove("ok"); }, 1600);
    });

    // Dil butonlari
    var butonlar = document.querySelectorAll(".dil-btn");
    for (var i = 0; i < butonlar.length; i++) {
      butonlar[i].addEventListener("click", function () {
        var yeni = this.getAttribute("data-dil");
        if (yeni === DIL) return;
        // URL'e dil ekleyip yeniden yukle — en temiz, tum metinler guncellenir.
        var u = new URL(location.href);
        u.searchParams.set("dil", yeni);
        location.href = u.toString();
      });
    }
  }

  // Olusturucu ekranindaki tum sabit metinleri aktif dile gore yaz.
  function olusturMetinleri() {
    var yaz = function (id, deger, html) {
      var e = $(id); if (!e) return;
      if (html) e.innerHTML = deger; else e.textContent = deger;
    };
    yaz("mBaslik", T("baslik"));
    yaz("mAlt", T("altAciklama"));
    yaz("mRiotLbl", T("riotId"));
    yaz("mBolgeLbl", T("bolge"));
    yaz("mDilLbl", T("dil"));
    yaz("olusturBtn", T("olusturBtn"));
    yaz("mLinkLbl", T("linkLabel"));
    yaz("kopyalaBtn", T("kopyala"));
    yaz("mOnizLbl", T("onizleme"));
    yaz("mYardimBaslik", T("yardimBaslik"));
    yaz("mY1", T("yardim1"), true);
    yaz("mY2", T("yardim2"), true);
    yaz("mY3", T("yardim3"), true);
    yaz("mY4", T("yardim4"), true);
    yaz("mK1b", T("k1b")); yaz("mK1d", T("k1d"));
    yaz("mK2b", T("k2b")); yaz("mK2d", T("k2d"));
    yaz("mK3b", T("k3b")); yaz("mK3d", T("k3d"));
    yaz("mK4b", T("k4b")); yaz("mK4d", T("k4d"));
    // tier renk seridindeki lig adlarini aktif dile gore yaz
    var tierSpanlari = document.querySelectorAll("[data-tier]");
    for (var j = 0; j < tierSpanlari.length; j++) {
      tierSpanlari[j].textContent = tierMetni(tierSpanlari[j].getAttribute("data-tier"));
    }
    // aktif dil butonunu isaretle
    var butonlar = document.querySelectorAll(".dil-btn");
    for (var i = 0; i < butonlar.length; i++) {
      butonlar[i].classList.toggle("aktif", butonlar[i].getAttribute("data-dil") === DIL);
    }
    // html lang
    document.documentElement.lang = DIL;
  }

  // ---- baslat: parametreye gore mod sec --------------------------------------
  (function baslat() {
    var id = parametre("id");
    var bolge = parametre("bolge") || "euw1";
    if (id && id.indexOf("#") >= 0) overlayModu(id, bolge);
    else olusturModu();
  })();
})();
