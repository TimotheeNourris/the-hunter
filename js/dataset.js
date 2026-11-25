/* =========================================================================
   The Hunter — format de jeu de données « thehunter.dataset/1 »
   -------------------------------------------------------------------------
   Un seul format pour la démo et pour les relevés réels (cadrage §7) :
     merchants[]     marchands
     products[]      produits canoniques (EAN et/ou référence fabricant)
     offers[]        une offre = un produit chez un marchand
     observations[]  un relevé horodaté de prix pour une offre
   Le module fonctionne dans le navigateur (window.HunterDataset)
   et dans Node (require) pour les outils de conversion et de validation.
   ========================================================================= */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.HunterDataset = api;
})(typeof self !== 'undefined' ? self : this, function () {
  const SCHEMA = 'thehunter.dataset/1';
  const HOUR = 3600000;

  const CATEGORIES = [
    { id: 'portables', name: 'Ordinateurs portables', icon: 'laptop' },
    { id: 'smartphones', name: 'Smartphones', icon: 'phone' },
    { id: 'audio', name: 'Casques & audio', icon: 'audio' },
    { id: 'ecrans', name: 'Écrans & TV', icon: 'screen' },
    { id: 'stockage', name: 'Stockage', icon: 'storage' },
  ];

  /* Caractéristiques structurées par catégorie (v0.5).
     better : 'higher' (plus = mieux), 'lower' (moins = mieux) ou null (affaire de goût).
     unitPrice : prix par unité utile affiché pour la catégorie. */
  const CATEGORY_ATTRS = {
    portables: {
      attrs: [
        { key: 'ecran_pouces', label: 'Écran', unit: '″', better: null },
        { key: 'ram_go', label: 'Mémoire vive', unit: 'Go', better: 'higher' },
        { key: 'stockage_go', label: 'Stockage', unit: 'Go', better: 'higher' },
        { key: 'poids_kg', label: 'Poids', unit: 'kg', better: 'lower' },
        { key: 'autonomie_h', label: 'Autonomie annoncée', unit: 'h', better: 'higher' },
      ],
    },
    smartphones: {
      attrs: [
        { key: 'ecran_pouces', label: 'Écran', unit: '″', better: null },
        { key: 'stockage_go', label: 'Stockage', unit: 'Go', better: 'higher' },
        { key: 'frequence_hz', label: 'Rafraîchissement', unit: 'Hz', better: 'higher' },
        { key: 'batterie_mah', label: 'Batterie', unit: 'mAh', better: 'higher' },
        { key: 'capteur_mpx', label: 'Capteur principal', unit: 'Mpx', better: 'higher' },
      ],
      unitPrice: { key: 'stockage_go', per: 128, label: '€ / 128 Go' },
    },
    audio: {
      attrs: [
        { key: 'autonomie_h', label: 'Autonomie', unit: 'h', better: 'higher' },
        { key: 'reduction_bruit', label: 'Réduction de bruit', type: 'bool', better: 'higher' },
        { key: 'multipoint', label: 'Multipoint Bluetooth', type: 'bool', better: 'higher' },
        { key: 'etancheite_ipx', label: 'Étanchéité (IPX)', unit: '', better: 'higher' },
      ],
    },
    ecrans: {
      attrs: [
        { key: 'diagonale_pouces', label: 'Diagonale', unit: '″', better: null },
        { key: 'definition_px', label: 'Définition horizontale', unit: 'px', better: 'higher' },
        { key: 'frequence_hz', label: 'Rafraîchissement', unit: 'Hz', better: 'higher' },
        { key: 'ports_hdmi21', label: 'Ports HDMI 2.1', unit: '', better: 'higher' },
      ],
      unitPrice: { key: 'diagonale_pouces', per: 1, label: '€ / pouce' },
    },
    stockage: {
      attrs: [
        { key: 'capacite_go', label: 'Capacité', unit: 'Go', better: 'higher' },
        { key: 'lecture_mo_s', label: 'Lecture', unit: 'Mo/s', better: 'higher' },
        { key: 'garantie_ans', label: 'Garantie', unit: 'ans', better: 'higher' },
      ],
      unitPrice: { key: 'capacite_go', per: 1000, label: '€ / To' },
    },
  };

  /* ---------------- utilitaires ---------------- */
  function eanValid(code) {
    if (!/^\d{8}$|^\d{12,14}$/.test(code)) return false;
    const digits = code.split('').map(Number);
    const check = digits.pop();
    let sum = 0;
    digits.reverse().forEach((d, i) => { sum += d * (i % 2 === 0 ? 3 : 1); });
    return (10 - (sum % 10)) % 10 === check;
  }
  const isNum = (v) => typeof v === 'number' && isFinite(v);
  const parseTime = (v) => (typeof v === 'number' ? v : Date.parse(v));

  /* ---------------- validation ---------------- */
  function validate(ds, now = Date.now()) {
    const errors = [];
    const warnings = [];
    const err = (m) => errors.push(m);
    const warn = (m) => warnings.push(m);

    if (!ds || typeof ds !== 'object') return { ok: false, errors: ['Le fichier n’est pas un objet JSON.'], warnings };
    if (ds.schema !== SCHEMA) err(`Schéma attendu « ${SCHEMA} », reçu « ${ds.schema} ».`);
    for (const k of ['merchants', 'products', 'offers', 'observations']) {
      if (!Array.isArray(ds[k])) err(`Le tableau « ${k} » est absent.`);
    }
    if (errors.length) return { ok: false, errors, warnings };

    const uniq = (arr, label) => {
      const seen = new Set();
      arr.forEach((x) => {
        if (!x.id) err(`${label} sans identifiant.`);
        else if (seen.has(x.id)) err(`${label} en double : « ${x.id} ».`);
        seen.add(x.id);
      });
      return seen;
    };
    const merchantIds = uniq(ds.merchants, 'Marchand');
    const productIds = uniq(ds.products, 'Produit');
    const offerIds = uniq(ds.offers, 'Offre');

    ds.merchants.forEach((m) => { if (!m.name) err(`Marchand « ${m.id} » sans nom.`); });

    const eans = new Map();
    ds.products.forEach((p) => {
      if (!p.name) err(`Produit « ${p.id} » sans nom.`);
      if (!CATEGORIES.some((c) => c.id === p.category)) err(`Produit « ${p.id} » : catégorie inconnue « ${p.category} ».`);
      if (p.attrs != null) {
        if (typeof p.attrs !== 'object' || Array.isArray(p.attrs)) err(`Produit « ${p.id} » : « attrs » doit être un objet.`);
        else {
          const schema = (CATEGORY_ATTRS[p.category] || { attrs: [] }).attrs;
          Object.entries(p.attrs).forEach(([k, v]) => {
            const def = schema.find((a) => a.key === k);
            if (!def) { warn(`Produit « ${p.id} » : caractéristique « ${k} » inconnue pour la catégorie, ignorée.`); return; }
            if (def.type === 'bool' ? typeof v !== 'boolean' : !(isNum(v) && v >= 0)) err(`Produit « ${p.id} » : valeur invalide pour « ${k} » (${JSON.stringify(v)}).`);
          });
        }
      }
      if (!p.ean && !p.mpn) err(`Produit « ${p.id} » sans EAN ni référence fabricant : impossible de l’identifier sans risque de confusion.`);
      if (p.ean) {
        if (!eanValid(String(p.ean))) warn(`Produit « ${p.id} » : EAN « ${p.ean} » invalide (clé de contrôle).`);
        if (eans.has(p.ean)) err(`EAN « ${p.ean} » partagé par « ${eans.get(p.ean)} » et « ${p.id} ».`);
        eans.set(p.ean, p.id);
      }
    });

    ds.offers.forEach((o) => {
      if (!productIds.has(o.productId)) err(`Offre « ${o.id} » : produit inconnu « ${o.productId} ».`);
      if (!merchantIds.has(o.merchantId)) err(`Offre « ${o.id} » : marchand inconnu « ${o.merchantId} ».`);
      if (o.url && !/^https?:\/\//.test(o.url)) warn(`Offre « ${o.id} » : URL non http(s).`);
      if (!o.source) warn(`Offre « ${o.id} » : source non renseignée (provenance obligatoire, §7).`);
    });

    const obsCount = new Map();
    const lastObs = new Map();
    ds.observations.forEach((x, i) => {
      const where = `Relevé n° ${i + 1} (offre « ${x.offerId} »)`;
      if (!offerIds.has(x.offerId)) { err(`${where} : offre inconnue.`); return; }
      const t = parseTime(x.collectedAt);
      if (!isFinite(t)) err(`${where} : date de collecte invalide « ${x.collectedAt} ».`);
      else if (t > now + HOUR) warn(`${where} : date dans le futur.`);
      if (!isNum(x.price) || x.price <= 0) err(`${where} : prix invalide « ${x.price} ».`);
      if (x.currency && x.currency !== 'EUR') err(`${where} : devise « ${x.currency} » non prise en charge (EUR uniquement).`);
      if (x.shipping != null && (!isNum(x.shipping) || x.shipping < 0)) err(`${where} : livraison invalide « ${x.shipping} ».`);
      if (x.strikePrice != null && isNum(x.price) && x.strikePrice <= x.price) warn(`${where} : prix barré inférieur ou égal au prix.`);
      obsCount.set(x.offerId, (obsCount.get(x.offerId) || 0) + 1);
      if (isFinite(t) && t > (lastObs.get(x.offerId) || 0)) lastObs.set(x.offerId, t);
    });

    ds.offers.forEach((o) => {
      if (!obsCount.get(o.id)) warn(`Offre « ${o.id} » sans aucun relevé : elle sera ignorée.`);
      else if (now - lastObs.get(o.id) > 72 * HOUR) warn(`Offre « ${o.id} » : dernier relevé de plus de 72 h.`);
    });
    ds.products.forEach((p) => {
      const offers = ds.offers.filter((o) => o.productId === p.id && obsCount.get(o.id));
      if (!offers.length) warn(`Produit « ${p.id} » sans offre relevée : il sera ignoré.`);
      else if (offers.length < 2) warn(`Produit « ${p.id} » : un seul marchand, comparaison limitée.`);
      const times = ds.observations.filter((x) => offers.some((o) => o.id === x.offerId)).map((x) => parseTime(x.collectedAt));
      if (times.length) {
        const span = Math.floor((Math.max(...times) - Math.min(...times)) / (24 * HOUR)) + 1;
        if (span < 30) warn(`Produit « ${p.id} » : ${span} jour(s) d’historique, verdict « Données insuffisantes » tant qu’il y en a moins de 30.`);
      }
    });

    return { ok: errors.length === 0, errors, warnings };
  }

  /* Ne garde que les caractéristiques connues et valides de la catégorie */
  function cleanAttrs(p) {
    const out = {};
    const schema = (CATEGORY_ATTRS[p.category] || { attrs: [] }).attrs;
    if (!p.attrs || typeof p.attrs !== 'object') return out;
    schema.forEach((def) => {
      const v = p.attrs[def.key];
      if (def.type === 'bool' ? typeof v === 'boolean' : isNum(v) && v >= 0) out[def.key] = v;
    });
    return out;
  }

  /* ---------------- normalisation → modèle interne du moteur ---------------- */
  function normalize(ds) {
    const merchants = {};
    ds.merchants.forEach((m) => {
      merchants[m.id] = {
        id: m.id, name: m.name, kind: m.kind || 'Marchand',
        signals: {
          identified: m.identified == null ? null : !!m.identified,
          since: m.since || null,
          returns: m.returns || null,
          support: m.support || null,
          marketplace: !!m.marketplace,
        },
        affiliate: !!m.affiliate,
      };
    });

    const obsByOffer = new Map();
    ds.observations.forEach((x) => {
      const t = parseTime(x.collectedAt);
      if (!isFinite(t) || !isNum(x.price)) return;
      if (!obsByOffer.has(x.offerId)) obsByOffer.set(x.offerId, []);
      obsByOffer.get(x.offerId).push({
        t, price: x.price,
        shipping: x.shipping === undefined ? undefined : x.shipping,
        strikePrice: x.strikePrice ?? null, stock: x.stock ?? null,
      });
    });

    const products = ds.products.map((p) => {
      const offers = ds.offers
        .filter((o) => o.productId === p.id && obsByOffer.has(o.id) && merchants[o.merchantId])
        .map((o) => {
          const observations = obsByOffer.get(o.id).sort((a, b) => a.t - b.t);
          const last = observations[observations.length - 1];
          const shipping = last.shipping !== undefined ? last.shipping : (o.shipping ?? null);
          const merchant = merchants[o.merchantId];
          return {
            id: o.id, merchantId: o.merchantId, merchant,
            price: last.price, currency: 'EUR', shipping,
            total: shipping == null ? null : Math.round((last.price + shipping) * 100) / 100,
            strikePrice: last.strikePrice ?? o.strikePrice ?? null,
            stock: last.stock || o.stock || 'Non renseignée',
            delay: o.delay || '',
            collectedAt: last.t,
            source: o.source || 'Non renseignée',
            method: o.method || null,
            verification: o.verification || (shipping == null ? 'Partielle' : 'Vérifiée'),
            url: o.url || '#',
            affiliate: o.affiliate != null ? !!o.affiliate : merchant.affiliate,
            pickup: !!o.pickup, // retrait gratuit en magasin possible
            observations,
          };
        });
      const cat = CATEGORIES.find((c) => c.id === p.category) || CATEGORIES[0];
      return {
        id: p.id, name: p.name, brand: p.brand || '', category: p.category,
        variant: p.variant || '', mpn: p.mpn || '', ean: p.ean || '', specs: p.specs || [],
        attrs: cleanAttrs(p),
        icon: cat.icon, offers,
      };
    }).filter((p) => p.offers.length);

    const allTimes = products.flatMap((p) => p.offers.flatMap((o) => o.observations.map((x) => x.t)));
    return {
      merchants, categories: CATEGORIES, products,
      sponsored: ds.sponsored && products.some((p) => p.id === ds.sponsored.productId) ? ds.sponsored : null,
      meta: {
        kind: ds.kind || 'sample', name: ds.name || 'Jeu de données',
        from: allTimes.length ? Math.min(...allTimes) : null,
        to: allTimes.length ? Math.max(...allTimes) : null,
        productCount: products.length,
      },
    };
  }

  return { SCHEMA, CATEGORIES, CATEGORY_ATTRS, eanValid, validate, normalize };
});
