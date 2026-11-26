/* =========================================================================
   The Hunter — saisie du relevé quotidien (page interne #/releve)
   -------------------------------------------------------------------------
   Lit la feuille produite par « npm run kit -- feuille » (CSV ;), aide à la
   remplir (liens de recherche par marchand, contrôle des saisies, adresses
   retenues d'un jour à l'autre) et la réécrit dans le même format, prête pour
   « npm run releve ». Aucun prix n'est collecté automatiquement : c'est une
   personne qui consulte chaque page et note ce qu'elle voit.
   Module UMD : navigateur (window.HunterReleve) et Node (tests).
   ========================================================================= */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.HunterReleve = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const EDITABLE = ['prix', 'livraison', 'prix_barre', 'disponibilite', 'delai', 'url'];
  const STOCK = ['En stock', 'Stock limité', 'Sur commande', 'Précommande', 'Rupture'];

  /* Recherche par EAN (ou référence) sur le site du marchand : simple lien, ouvert par la personne. */
  const SEARCH = [
    [/amazon/i, 'https://www.amazon.fr/s?k={q}'],
    [/fnac/i, 'https://www.fnac.com/SearchResult/ResultList.aspx?Search={q}'],
    [/ldlc/i, 'https://www.ldlc.com/recherche/{q}/'],
    [/cdiscount/i, 'https://www.cdiscount.com/search/10/{q}.html'],
    [/darty/i, 'https://www.darty.com/nav/recherche?text={q}'],
    [/boulanger/i, 'https://www.boulanger.com/resultats?tr={q}'],
    [/rue du commerce/i, 'https://www.rueducommerce.fr/r/{q}.html'],
    [/materiel\.net|matériel\.net/i, 'https://www.materiel.net/recherche/{q}/'],
  ];
  function searchUrl(merchant, query) {
    const q = encodeURIComponent(String(query || '').trim());
    const hit = SEARCH.find(([re]) => re.test(merchant || ''));
    return hit ? hit[1].replace('{q}', q) : `https://www.google.com/search?q=${q}+${encodeURIComponent(merchant || '')}`;
  }

  /* ---------- CSV (séparateur ;, guillemets, BOM) ---------- */
  function parse(text) {
    text = String(text || '').replace(/^﻿/, '');
    const rows = [];
    let row = [], field = '', quoted = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (quoted) {
        if (c === '"' && text[i + 1] === '"') { field += '"'; i++; } else if (c === '"') quoted = false; else field += c;
      } else if (c === '"') quoted = true;
      else if (c === ';') { row.push(field); field = ''; }
      else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(field); rows.push(row); row = []; field = ''; }
      else field += c;
    }
    if (field !== '' || row.length) { row.push(field); rows.push(row); }
    const lines = rows.filter((r) => r.some((v) => v.trim() !== ''));
    if (!lines.length) return { error: 'Fichier vide.' };
    const header = lines[0].map((h) => h.trim().toLowerCase());
    const missing = ['date_collecte', 'ean', 'marchand', 'prix'].filter((k) => !header.includes(k));
    if (missing.length) return { error: `Ce n’est pas une feuille de relevé : colonne(s) ${missing.join(', ')} absente(s).` };
    const data = lines.slice(1).map((r) => { const o = {}; header.forEach((h, j) => { o[h] = (r[j] || '').trim(); }); return o; });
    return { header, rows: data };
  }

  const cell = (v) => { const s = String(v ?? ''); return /[;"\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  function serialize(header, rows) {
    return '﻿' + [header.join(';'), ...rows.map((r) => header.map((h) => cell(r[h])).join(';'))].join('\r\n') + '\r\n';
  }

  /* ---------- contrôles ---------- */
  const num = (v) => { const s = String(v || '').replace(/[€\s ]/g, '').replace(',', '.'); return /^\d+(\.\d{1,2})?$/.test(s) ? Number(s) : NaN; };
  /* Retourne { level: 'ok'|'vide'|'erreur'|'attention', messages[] } pour une ligne. */
  function checkRow(r) {
    const msgs = [];
    let level = 'ok';
    const bad = (m) => { msgs.push(m); level = 'erreur'; };
    const warn = (m) => { msgs.push(m); if (level === 'ok') level = 'attention'; };
    if (!String(r.prix || '').trim()) {
      if (/rupture/i.test(r.disponibilite || '')) return { level: 'vide', messages: ['rupture : pas de prix à noter'] };
      return { level: 'vide', messages: [] };
    }
    const p = num(r.prix);
    if (!(p > 0)) bad(`prix « ${r.prix} » illisible (ex. 89,99)`);
    if (String(r.livraison || '').trim() && !(num(r.livraison) >= 0)) bad(`livraison « ${r.livraison} » illisible (0 si offerte)`);
    if (String(r.prix_barre || '').trim()) {
      const b = num(r.prix_barre);
      if (!(b > 0)) bad(`prix barré « ${r.prix_barre} » illisible`);
      else if (p > 0 && b <= p) bad('le prix barré doit être supérieur au prix');
    }
    if (!String(r.livraison || '').trim()) warn('livraison non notée (laisser vide seulement si elle n’est pas affichée avant la commande)');
    if (!String(r.disponibilite || '').trim()) warn('disponibilité non notée');
    if (String(r.url || '').trim() && !/^https:\/\//i.test(r.url)) warn('adresse de page sans https://');
    return { level, messages: msgs };
  }

  function progress(rows) {
    const c = { total: rows.length, ok: 0, attention: 0, erreur: 0, vide: 0, rupture: 0 };
    rows.forEach((r) => { const k = checkRow(r); c[k.level]++; if (k.level === 'vide' && /rupture/i.test(r.disponibilite || '')) c.rupture++; });
    c.saisis = c.ok + c.attention + c.erreur;
    c.restants = c.vide - c.rupture;
    return c;
  }

  /* Change l'heure de la colonne date_collecte (JJ/MM/AAAA HH:MM) */
  function setHour(rows, hour) {
    if (!/^\d{1,2}:\d{2}$/.test(hour)) return rows;
    return rows.map((r) => ({ ...r, date_collecte: String(r.date_collecte || '').replace(/(\d{2}\/\d{2}\/\d{4})(\s+\d{1,2}:\d{2})?/, `$1 ${hour.padStart(5, '0')}`) }));
  }

  const key = (r) => `${r.ean}|${r.marchand}`;
  /* Reprend les adresses de pages notées les jours précédents */
  function applyUrls(rows, memory) {
    return rows.map((r) => (!r.url && memory[key(r)] ? { ...r, url: memory[key(r)] } : r));
  }
  function rememberUrls(rows, memory) {
    const m = { ...memory };
    rows.forEach((r) => { if (/^https:\/\//i.test(r.url || '')) m[key(r)] = r.url; });
    return m;
  }

  /* Produits regroupés (une carte par produit, une ligne par marchand) */
  function group(rows) {
    const map = new Map();
    rows.forEach((r, i) => {
      const k = r.ean || r.produit;
      if (!map.has(k)) map.set(k, { ean: r.ean, mpn: r.mpn, marque: r.marque, produit: r.produit, variante: r.variante, lines: [] });
      map.get(k).lines.push(i);
    });
    return [...map.values()];
  }

  function fileDate(rows) {
    const m = String((rows[0] || {}).date_collecte || '').match(/(\d{2})\/(\d{2})\/(\d{4})/);
    return m ? `${m[3]}-${m[2]}-${m[1]}` : '';
  }

  return { EDITABLE, STOCK, searchUrl, parse, serialize, checkRow, progress, setHour, applyUrls, rememberUrls, group, fileDate, key };
});
