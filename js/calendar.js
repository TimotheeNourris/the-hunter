/* =========================================================================
   The Hunter — calendrier commercial (v0.8)
   -------------------------------------------------------------------------
   Soldes : dates nationales fixées par l'arrêté du 27 mai 2019
   (art. L. 310-3 du code de commerce), applicables aussi à la vente en ligne :
     - hiver : 2e mercredi de janvier à 8 h, avancé au 1er mercredi si le
       2e tombe après le 12 ; durée 4 semaines ;
     - été : dernier mercredi de juin à 8 h, avancé à l'avant-dernier si le
       dernier tombe après le 28 ; durée 4 semaines.
   Certains départements (zones frontalières, Corse, outre-mer) ont d'autres
   dates : non gérées ici, le site utilise les dates nationales.
   Black Friday : usage commercial, pas une période légale. Le vendredi qui
   suit le 4e jeudi de novembre ; on retient la semaine du lundi au Cyber
   Monday inclus.
   ========================================================================= */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.HunterCalendar = api;
})(typeof self !== 'undefined' ? self : this, function () {
  const DAY = 86400000;

  /* Exceptions ponctuelles décidées par les pouvoirs publics, à renseigner
     après vérification sur le site officiel. Format :
     { 2026: { 'soldes-ete': { end: '2026-07-29' } } }  (fin exclusive) */
  const OVERRIDES = {};

  const at = (y, m, d, h = 0) => new Date(y, m, d, h, 0, 0, 0);
  function weekdaysOf(y, m, weekday) {
    const out = [];
    for (let d = 1; d <= 31; d++) {
      const dt = at(y, m, d);
      if (dt.getMonth() !== m) break;
      if (dt.getDay() === weekday) out.push(d);
    }
    return out;
  }

  function winterSalesStart(y) {
    const w = weekdaysOf(y, 0, 3);
    return at(y, 0, w[1] > 12 ? w[0] : w[1], 8);
  }
  function summerSalesStart(y) {
    const w = weekdaysOf(y, 5, 3);
    const last = w[w.length - 1];
    return at(y, 5, last > 28 ? w[w.length - 2] : last, 8);
  }
  function blackFriday(y) {
    const thursdays = weekdaysOf(y, 10, 4);
    return at(y, 10, thursdays[3] + 1);
  }
  const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n, d.getHours());
  /* 4 semaines : du mercredi 8 h au mardi suivant inclus (fin exclusive = mercredi 0 h) */
  const endOfSales = (start) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + 28);

  function eventsOfYear(y) {
    const bf = blackFriday(y);
    const list = [
      {
        id: 'soldes-hiver', name: 'Soldes d’hiver', legal: true,
        start: winterSalesStart(y), end: endOfSales(winterSalesStart(y)),
      },
      {
        id: 'soldes-ete', name: 'Soldes d’été', legal: true,
        start: summerSalesStart(y), end: endOfSales(summerSalesStart(y)),
      },
      {
        id: 'black-friday', name: 'Semaine du Black Friday', legal: false,
        start: addDays(bf, -4), end: addDays(bf, 4), // lundi → Cyber Monday inclus
        day: bf,
      },
    ];
    const ov = OVERRIDES[y] || {};
    return list.map((e) => {
      const o = ov[e.id];
      return Object.assign({}, e, o && o.start ? { start: new Date(o.start) } : {}, o && o.end ? { end: new Date(o.end) } : {});
    });
  }

  /* Occurrences qui chevauchent [fromMs, toMs[ */
  function eventsBetween(fromMs, toMs) {
    const out = [];
    for (let y = new Date(fromMs).getFullYear() - 1; y <= new Date(toMs).getFullYear() + 1; y++) {
      eventsOfYear(y).forEach((e) => { if (e.start.getTime() < toMs && e.end.getTime() > fromMs) out.push(e); });
    }
    return out.sort((a, b) => a.start - b.start);
  }

  /* Événement en cours, ou le prochain qui commence dans `withinDays` jours */
  function nextEvent(nowMs, withinDays) {
    const list = eventsBetween(nowMs, nowMs + withinDays * DAY);
    if (!list.length) return null;
    const e = list[0];
    const ongoing = e.start.getTime() <= nowMs;
    return {
      event: e,
      ongoing,
      startsInDays: ongoing ? 0 : Math.ceil((e.start.getTime() - nowMs) / DAY),
      endsInDays: Math.ceil((e.end.getTime() - nowMs) / DAY),
    };
  }

  const fmtDay = (d) => d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });

  return { OVERRIDES, eventsOfYear, eventsBetween, nextEvent, winterSalesStart, summerSalesStart, blackFriday, fmtDay };
});
