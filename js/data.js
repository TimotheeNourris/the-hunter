/* =========================================================================
   The Hunter — jeu de données de DÉMONSTRATION
   -------------------------------------------------------------------------
   Toutes les marques, produits, marchands et prix sont FICTIFS.
   Ils servent uniquement à tester le parcours et le moteur de verdict
   (Phase 1 — prototype UX). Aucune donnée réelle n'est collectée.
   Les observations sont générées de façon déterministe (graine fixe)
   et datées relativement à l'heure d'ouverture de la page.
   ========================================================================= */
(function () {
  const DAY = 86400000;
  const NOW = Date.now();

  function rng(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* ---------------- Marchands (fictifs) ---------------- */
  const merchants = {
    m1: {
      id: 'm1', name: 'TechDépôt', kind: 'Boutique en ligne',
      signals: { identified: true, since: 2011, returns: '30 jours', support: 'Téléphone et chat', marketplace: false },
      affiliate: true,
    },
    m2: {
      id: 'm2', name: 'Numéris', kind: 'Boutique en ligne',
      signals: { identified: true, since: 2016, returns: '14 jours', support: 'Formulaire', marketplace: false },
      affiliate: false,
    },
    m3: {
      id: 'm3', name: 'ElectroPlus', kind: 'Enseigne magasin + web',
      signals: { identified: true, since: 2004, returns: '30 jours', support: 'Magasins et téléphone', marketplace: false },
      affiliate: true,
    },
    m4: {
      id: 'm4', name: 'GadgetZone', kind: 'Vendeur tiers sur place de marché',
      signals: { identified: false, since: 2024, returns: '14 jours', support: 'Messagerie de la plateforme', marketplace: true },
      affiliate: true,
    },
    m5: {
      id: 'm5', name: 'Atelier Hi-Fi', kind: 'Boutique spécialisée',
      signals: { identified: true, since: 2009, returns: '30 jours', support: 'Téléphone', marketplace: false },
      affiliate: false,
    },
  };

  /* ---------------- Produits (fictifs) ----------------
     pattern :
       drop        → baisse réelle récente, nettement sous la médiane
       normal      → prix proche de l'habituel
       fakepromo   → remise affichée importante, mais prix ≥ habitude
       rising      → prix en hausse au-dessus de l'habitude
       short       → historique trop court
       stale       → dernière collecte trop ancienne
  ------------------------------------------------------ */
  const productDefs = [
    {
      id: 'volta-x14', name: 'Volta X14 Pro', brand: 'Volta', category: 'portables',
      variant: '14″ · 16 Go RAM · SSD 1 To', mpn: 'VX14P-16-1T', ean: '2000000000145',
      specs: ['Écran 14″ 2,8K 120 Hz', 'Processeur 8 cœurs', '16 Go RAM', 'SSD 1 To', '1,4 kg'],
      attrs: { ecran_pouces: 14, ram_go: 16, stockage_go: 1000, poids_kg: 1.4, autonomie_h: 12 },
      base: 1099, pattern: 'drop', days: 180, seed: 11,
      offers: [
        { m: 'm1', off: -0.02, ship: 0, stock: 'En stock', delay: '24–48 h', strike: 1299 },
        { m: 'm3', off: 0.01, ship: 0, stock: 'En stock', delay: '2–3 jours', strike: null, pickup: true },
        { m: 'm2', off: 0.03, ship: 9.9, stock: 'Stock limité', delay: '3–5 jours', strike: null },
        { m: 'm4', off: -0.06, ship: null, stock: 'Expédié sous 7 jours', delay: '7–12 jours', strike: 1399 },
      ],
    },
    {
      id: 'aurio-nc700', name: 'Aurio NC700', brand: 'Aurio', category: 'audio',
      variant: 'Casque sans fil à réduction de bruit · Noir', mpn: 'NC700-BK', ean: '2000000000701',
      specs: ['Réduction de bruit active', 'Autonomie 32 h', 'Bluetooth 5.3 multipoint', 'Charge USB-C'],
      attrs: { autonomie_h: 32, reduction_bruit: true, multipoint: true, etancheite_ipx: 0 },
      base: 279, pattern: 'fakepromo', days: 180, seed: 22, dip: 0.12,
      offers: [
        { m: 'm4', off: 0.0, ship: 4.99, stock: 'En stock', delay: '3–6 jours', strike: 399 },
        { m: 'm1', off: 0.02, ship: 0, stock: 'En stock', delay: '24–48 h', strike: 349 },
        { m: 'm5', off: 0.0, ship: 0, stock: 'En stock', delay: '2–4 jours', strike: null, pickup: true },
      ],
    },
    {
      id: 'nova-s9', name: 'Nova S9', brand: 'Nova', category: 'smartphones',
      variant: '6,4″ · 256 Go · Graphite', mpn: 'NS9-256-GR', ean: '2000000000909',
      specs: ['Écran OLED 6,4″ 120 Hz', '256 Go', 'Triple capteur 50 Mpx', '5G', 'Batterie 4 700 mAh'],
      attrs: { ecran_pouces: 6.4, stockage_go: 256, frequence_hz: 120, batterie_mah: 4700, capteur_mpx: 50 },
      base: 649, pattern: 'normal', days: 180, seed: 33, dip: 0.13,
      offers: [
        { m: 'm3', off: 0.0, ship: 0, stock: 'En stock', delay: '24 h', strike: 699, pickup: true },
        { m: 'm1', off: 0.01, ship: 0, stock: 'En stock', delay: '24–48 h', strike: null },
        { m: 'm2', off: -0.015, ship: 6.9, stock: 'En stock', delay: '2–4 jours', strike: null },
      ],
    },
    {
      id: 'lumen-27q', name: 'Lumen 27Q', brand: 'Lumen', category: 'ecrans',
      variant: 'Écran 27″ QHD 165 Hz', mpn: 'L27Q-165', ean: '2000000002712',
      specs: ['Dalle IPS 27″ 2560×1440', '165 Hz · 1 ms', 'HDR400', 'USB-C 65 W'],
      attrs: { diagonale_pouces: 27, definition_px: 2560, frequence_hz: 165, ports_hdmi21: 0 },
      base: 329, pattern: 'rising', days: 180, seed: 44,
      offers: [
        { m: 'm2', off: 0.0, ship: 12.9, stock: 'En stock', delay: '3–5 jours', strike: 379 },
        { m: 'm3', off: 0.03, ship: 0, stock: 'En stock', delay: '2–3 jours', strike: null, pickup: true },
      ],
    },
    {
      id: 'kora-ssd2', name: 'Kora Rapid 2 To', brand: 'Kora', category: 'stockage',
      variant: 'SSD NVMe M.2 PCIe 4.0', mpn: 'KR-NV4-2T', ean: '2000000002200',
      specs: ['2 To', 'Lecture 7 000 Mo/s', 'Format M.2 2280', 'Garantie 5 ans'],
      attrs: { capacite_go: 2000, lecture_mo_s: 7000, garantie_ans: 5 },
      base: 139, pattern: 'drop', days: 180, seed: 55,
      offers: [
        { m: 'm1', off: 0.0, ship: 0, stock: 'En stock', delay: '24–48 h', strike: 149 },
        { m: 'm2', off: 0.02, ship: 4.9, stock: 'En stock', delay: '2–4 jours', strike: null },
        { m: 'm3', off: 0.04, ship: 0, stock: 'En stock', delay: '24 h', strike: null, pickup: true },
      ],
    },
    {
      id: 'orbit-buds', name: 'Orbit Buds 3', brand: 'Orbit', category: 'audio',
      variant: 'Écouteurs sans fil · Blanc', mpn: 'OB3-WH', ean: '2000000000305',
      specs: ['Réduction de bruit', 'Autonomie 7 h (+ 24 h boîtier)', 'IPX4', 'Charge sans fil'],
      attrs: { autonomie_h: 7, reduction_bruit: true, multipoint: false, etancheite_ipx: 4 },
      base: 129, pattern: 'short', days: 12, seed: 66,
      offers: [
        { m: 'm1', off: 0.0, ship: 0, stock: 'Précommande', delay: 'Sortie annoncée', strike: null },
        { m: 'm3', off: 0.0, ship: 0, stock: 'En stock', delay: '2–3 jours', strike: null, pickup: true },
      ],
    },
    {
      id: 'volta-air13', name: 'Volta Air 13', brand: 'Volta', category: 'portables',
      variant: '13″ · 8 Go RAM · SSD 512 Go', mpn: 'VA13-8-512', ean: '2000000000138',
      specs: ['Écran 13,3″ Full HD', '8 Go RAM', 'SSD 512 Go', '1,1 kg', 'Autonomie annoncée 14 h'],
      attrs: { ecran_pouces: 13.3, ram_go: 8, stockage_go: 512, poids_kg: 1.1, autonomie_h: 14 },
      base: 699, pattern: 'stale', days: 180, seed: 77, staleDays: 6,
      offers: [
        { m: 'm2', off: 0.0, ship: 0, stock: 'En stock', delay: '3–5 jours', strike: 849 },
        { m: 'm4', off: -0.08, ship: null, stock: 'Inconnu', delay: 'Inconnu', strike: 999 },
      ],
    },
    {
      id: 'vista-55', name: 'Vista 55 OLED', brand: 'Vista', category: 'ecrans',
      variant: 'Téléviseur 55″ OLED 4K', mpn: 'V55-OLED-24', ean: '2000000005522',
      specs: ['OLED 55″ 4K', '120 Hz · HDMI 2.1 ×4', 'Dolby Vision', 'Smart TV'],
      attrs: { diagonale_pouces: 55, definition_px: 3840, frequence_hz: 120, ports_hdmi21: 4 },
      base: 1299, pattern: 'drop', days: 180, seed: 88,
      offers: [
        { m: 'm3', off: 0.0, ship: 59, stock: 'En stock', delay: 'Livraison sur RDV', strike: 1599, pickup: true },
        { m: 'm1', off: 0.02, ship: 29.9, stock: 'En stock', delay: '3–5 jours', strike: null },
        { m: 'm5', off: 0.05, ship: 0, stock: 'Sur commande', delay: '8–10 jours', strike: null, pickup: true },
      ],
    },
    {
      id: 'nova-a5', name: 'Nova A5', brand: 'Nova', category: 'smartphones',
      variant: '6,6″ · 128 Go · Bleu', mpn: 'NA5-128-BL', ean: '2000000000503',
      specs: ['Écran LCD 6,6″ 90 Hz', '128 Go', 'Double capteur 50 Mpx', 'Batterie 5 000 mAh'],
      attrs: { ecran_pouces: 6.6, stockage_go: 128, frequence_hz: 90, batterie_mah: 5000, capteur_mpx: 50 },
      base: 229, pattern: 'normal', days: 180, seed: 99, dip: 0.13,
      offers: [
        { m: 'm2', off: -0.01, ship: 3.9, stock: 'En stock', delay: '2–4 jours', strike: null },
        { m: 'm3', off: 0.0, ship: 0, stock: 'En stock', delay: '24 h', strike: 259, pickup: true },
        { m: 'm4', off: -0.04, ship: 6.9, stock: 'En stock', delay: '5–8 jours', strike: 299 },
      ],
    },
  ];

  /* ---------------- Génération de l'historique ---------------- */
  function marketSeries(def) {
    const r = rng(def.seed);
    const n = def.days;
    const series = new Array(n); // index 0 = le plus ancien
    let level = 1.0;
    for (let i = 0; i < n; i++) {
      level += (r() - 0.5) * 0.012;           // marche aléatoire douce
      level += (1.0 - level) * 0.04;          // retour vers la moyenne
      let v = level;
      // promotions ponctuelles (≈ 3 épisodes sur 180 j)
      if (n > 60 && (i % 57 > 50)) v -= def.dip || 0.06;
      series[i] = v;
    }
    const last = n - 1;
    const tailLen = Math.min(10, n);
    for (let k = 0; k < tailLen; k++) {
      const i = last - k;
      const fade = 1 - k / tailLen;
      switch (def.pattern) {
        case 'drop':      series[i] = series[i] * (1 - 0.15 * Math.min(1, fade * 1.6)); break;
        case 'fakepromo': series[i] = series[i] * (1 + 0.04 * fade); break;
        case 'rising':    series[i] = series[i] * (1 + 0.09 * fade); break;
        case 'normal':    series[i] = series[i] * (1 - 0.015 * fade); break;
        default: break;
      }
    }
    return series;
  }

  function round(v) {
    if (v >= 200) return Math.round(v) - 0.01;
    return Math.round(v * 2) / 2 - 0.01;
  }

  /* ---------- Sortie au format commun thehunter.dataset/1 ---------- */
  const iso = (t) => new Date(t).toISOString();
  const dataset = {
    schema: 'thehunter.dataset/1',
    kind: 'demo',
    name: 'Démonstration (fictif)',
    merchants: Object.values(merchants).map((m) => ({
      id: m.id, name: m.name, kind: m.kind, affiliate: m.affiliate,
      identified: m.signals.identified, since: m.signals.since, returns: m.signals.returns,
      support: m.signals.support, marketplace: m.signals.marketplace,
    })),
    products: [],
    offers: [],
    observations: [],
    // Un emplacement sponsorisé, clairement identifié et sans effet sur le verdict
    sponsored: { productId: 'nova-s9', label: 'Sponsorisé', by: 'ElectroPlus' },
  };

  productDefs.forEach((def) => {
    const series = marketSeries(def);
    const r = rng(def.seed * 7 + 3);
    const shiftDays = def.staleDays || 0;
    dataset.products.push({
      id: def.id, name: def.name, brand: def.brand, category: def.category,
      variant: def.variant, mpn: def.mpn, ean: def.ean, specs: def.specs, attrs: def.attrs,
    });
    def.offers.forEach((o, idx) => {
      const merchant = merchants[o.m];
      const offerId = def.id + '-' + o.m;
      dataset.offers.push({
        id: offerId, productId: def.id, merchantId: o.m, url: null,
        stock: o.stock, delay: o.delay, strikePrice: o.strike, pickup: !!o.pickup,
        source: merchant.affiliate ? 'Flux partenaire (démo)' : 'Flux marchand (démo)',
        method: 'Génération déterministe',
      });
      for (let i = 0; i < series.length; i++) {
        const daysAgo = series.length - 1 - i + shiftDays;
        const noise = (r() - 0.5) * 0.01;
        const price = round(def.base * series[i] * (1 + o.off + noise));
        const hourJitter = Math.floor(r() * 5) * 3600000;
        dataset.observations.push({
          offerId, collectedAt: iso(NOW - daysAgo * DAY - (2 * 3600000) - hourJitter - idx * 600000),
          price, shipping: o.ship, currency: 'EUR',
        });
      }
    });
  });

  window.HunterDemoDataset = dataset;
  // Horloge partagée ; le contenu (produits, marchands…) est chargé par app.js
  window.HunterData = { NOW, DAY };
})();
