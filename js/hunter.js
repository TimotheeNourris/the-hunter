/* =========================================================================
   The Hunter — moteur d'analyse v1 (règles explicites, cf. §6 du cadrage)
   Pas de score opaque : un verdict, ses critères, son niveau de confiance.
   ========================================================================= */
(function () {
  const { NOW, DAY } = window.HunterData;

  const RULES = {
    minHistoryDays: 30,        // en dessous : données insuffisantes
    staleHours: 72,            // dernière collecte trop ancienne
    freshHours: 24,            // collecte considérée comme fraîche
    greatRatio: 0.90,          // ≤ 90 % de la médiane 90 j → très intéressant
    fairRatio: 1.02,           // ≤ 102 % de la médiane 90 j → prix correct
    confirmWindowDays: 3,      // fenêtre de confirmation des observations
    confirmMinObs: 2,          // nb mini d'observations confirmant la baisse
    marketingTolerance: 0.98,  // remise affichée alors que prix ≥ 98 % de l'habitude
  };

  const VERDICTS = {
    great: { key: 'great', label: 'Très intéressant', short: 'Très intéressant' },
    fair: { key: 'fair', label: 'Prix correct', short: 'Prix correct' },
    bad: { key: 'bad', label: 'Pas une bonne affaire', short: 'Pas une affaire' },
    insufficient: { key: 'insufficient', label: 'Données insuffisantes', short: 'Données insuffisantes' },
  };

  /* ---------------- utilitaires ---------------- */
  const median = (arr) => {
    if (!arr.length) return null;
    const s = [...arr].sort((a, b) => a - b);
    const m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  };
  const effectiveCost = (o) => (o.total != null ? o.total : o.price);

  /* Mode de réception choisi par l'utilisateur (v0.5) :
     'domicile' (livraison) ou 'retrait' (retrait gratuit en magasin quand
     le marchand le propose). */
  const costMode = () => (window.HunterData.costMode === 'retrait' ? 'retrait' : 'domicile');
  const pickupApplies = (o) => costMode() === 'retrait' && !!o.pickup;
  /* Vue d'une offre avec le mode appliqué : livraison et total recalculés */
  function offerView(o) {
    if (!pickupApplies(o)) return o;
    return Object.assign({}, o, { shipping: 0, total: o.price, pickupApplied: true });
  }
  /* Coût d'un relevé : retrait gratuit si applicable, sinon livraison du
     relevé si connue, sinon celle de l'offre */
  const obsCost = (o, obs) => (pickupApplies(o)
    ? obs.price
    : obs.price + (obs.shipping != null ? obs.shipping : (o.shipping || 0)));

  const fmtPrice = (v) =>
    v == null ? '—' : v.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' });
  const fmtPct = (v) => {
    const n = Math.round(v * 100);
    return (n > 0 ? '+' : n < 0 ? '−' : '') + Math.abs(n) + ' %';
  };
  function fmtAgo(t) {
    const h = (NOW - t) / 3600000;
    if (h < 1) return 'il y a moins d’une heure';
    if (h < 24) return 'il y a ' + Math.round(h) + ' h';
    const d = Math.round(h / 24);
    return 'il y a ' + d + ' jour' + (d > 1 ? 's' : '');
  }
  const fmtDate = (t) =>
    new Date(t).toLocaleString('fr-FR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });

  /* Série journalière du meilleur coût connu, tous marchands confondus.
     index 0 = aujourd'hui (jour 0), puis jour -1, etc. */
  function dailyBest(product) {
    const byDay = new Map();
    product.offers.forEach((o) => {
      o.observations.forEach((obs) => {
        const d = Math.floor((NOW - obs.t) / DAY);
        const cost = obsCost(o, obs);
        if (!byDay.has(d) || byDay.get(d) > cost) byDay.set(d, cost);
      });
    });
    return [...byDay.entries()].sort((a, b) => a[0] - b[0]).map(([d, v]) => ({ daysAgo: d, value: v }));
  }

  function windowStats(series, days) {
    const vals = series.filter((p) => p.daysAgo < days).map((p) => p.value);
    if (!vals.length) return null;
    return { median: median(vals), min: Math.min(...vals), max: Math.max(...vals), count: vals.length };
  }

  /* ---------------- évaluation ---------------- */
  function assess(product) {
    const offers = product.offers.map(offerView).sort((a, b) => effectiveCost(a) - effectiveCost(b));
    const best = offers[0];
    const second = offers[1] || null;
    const series = dailyBest(product);
    const historyDays = series.length;
    const lastCollect = Math.max(...product.offers.map((o) => o.collectedAt));
    const ageHours = (NOW - lastCollect) / 3600000;
    const bestCost = effectiveCost(best);

    const w30 = windowStats(series, 30);
    const w90 = windowStats(series, 90);
    const w180 = windowStats(series, 180);
    const baseline = w90 && historyDays >= RULES.minHistoryDays ? w90.median : null;
    const ratio = baseline ? bestCost / baseline : null;

    // confirmations : observations récentes (tous marchands) sous le seuil
    let confirmations = 0;
    if (baseline) {
      product.offers.forEach((o) => {
        o.observations.forEach((obs) => {
          if (NOW - obs.t < RULES.confirmWindowDays * DAY &&
              obsCost(o, obs) <= baseline * (RULES.greatRatio + 0.02)) confirmations++;
        });
      });
    }

    const reasons = [];
    const limits = [];

    /* ---- verdict ---- */
    let verdict;
    if (historyDays < RULES.minHistoryDays) {
      verdict = VERDICTS.insufficient;
      reasons.push({ kind: 'info', text: `Historique de ${historyDays} jours seulement : il en faut au moins ${RULES.minHistoryDays} pour savoir si le prix est habituel.` });
    } else if (ageHours > RULES.staleHours) {
      verdict = VERDICTS.insufficient;
      reasons.push({ kind: 'info', text: `Dernière collecte ${fmtAgo(lastCollect)} : le prix et le stock ont pu changer depuis. Nous préférons ne pas conclure.` });
    } else if (ratio <= RULES.greatRatio && confirmations >= RULES.confirmMinObs) {
      verdict = VERDICTS.great;
    } else if (ratio <= RULES.fairRatio) {
      verdict = VERDICTS.fair;
    } else {
      verdict = VERDICTS.bad;
    }

    /* ---- critères expliqués ---- */
    if (baseline) {
      const delta = ratio - 1;
      reasons.push({
        kind: delta <= -0.05 ? 'plus' : delta <= 0.02 ? 'neutral' : 'minus',
        text: `Meilleur coût actuel ${fmtPrice(bestCost)}, soit ${fmtPct(delta)} par rapport au prix habituel sur 90 jours (médiane ${fmtPrice(baseline)}).`,
      });
      if (w180 && historyDays >= 120) {
        const atLow = bestCost <= w180.min * 1.01;
        reasons.push({
          kind: atLow ? 'plus' : 'neutral',
          text: atLow
            ? `C’est le prix le plus bas observé sur 180 jours.`
            : `Le plus bas observé sur 180 jours était ${fmtPrice(w180.min)}.`,
        });
      }
      if (verdict === VERDICTS.great || ratio <= RULES.greatRatio) {
        reasons.push({
          kind: confirmations >= RULES.confirmMinObs ? 'plus' : 'minus',
          text: confirmations >= RULES.confirmMinObs
            ? `${confirmations} observations sur les ${RULES.confirmWindowDays} derniers jours confirment ce niveau de prix.`
            : `Baisse vue sur trop peu d’observations récentes pour être confirmée.`,
        });
      }
    }

    if (second) {
      const gap = effectiveCost(second) - bestCost;
      reasons.push({
        kind: gap > 0 ? 'plus' : 'neutral',
        text: gap > 0.5
          ? `${fmtPrice(gap)} de moins que l’offre suivante (${second.merchant.name}).`
          : `Prix au même niveau que chez ${second.merchant.name} : peu d’écart entre marchands.`,
      });
    } else {
      limits.push('Un seul marchand suivi pour ce produit : la comparaison est limitée.');
    }

    // remises marketing
    const marketing = product.offers.filter(
      (o) => o.strikePrice && baseline && o.price >= baseline * RULES.marketingTolerance
    );
    marketing.forEach((o) => {
      const shown = 1 - o.price / o.strikePrice;
      const truth = strikeTruth(o);
      const when = truth.seen
        ? `ce prix n’a plus été pratiqué depuis ${truth.lastDaysAgo} jours`
        : `ce prix barré n’a jamais été observé sur ${truth.windowDays} jours`;
      reasons.push({
        kind: 'minus',
        text: `${o.merchant.name} affiche −${Math.round(shown * 100)} % par rapport à ${fmtPrice(o.strikePrice)}, mais ${when} : le prix actuel reste au niveau habituel.`,
      });
    });

    // coût total
    if (best.shipping == null) {
      reasons.push({ kind: 'minus', text: `Frais de livraison inconnus chez ${best.merchant.name} : le coût total peut être plus élevé.` });
      limits.push('Coût total incomplet pour la meilleure offre.');
    } else {
      reasons.push({ kind: 'neutral', text: best.pickupApplied
        ? `Retrait gratuit en magasin chez ${best.merchant.name} : coût total connu.`
        : best.shipping === 0 ? `Livraison offerte chez ${best.merchant.name} : coût total connu.` : `Coût total connu, livraison de ${fmtPrice(best.shipping)} incluse.` });
    }

    // vendeur
    if (best.merchant.signals.marketplace) {
      reasons.push({ kind: 'minus', text: `Meilleure offre chez un vendeur tiers de place de marché (${best.merchant.name}), ${best.merchant.signals.since ? `en activité depuis ${best.merchant.signals.since}` : 'ancienneté inconnue'}. Vérifiez ses conditions avant d’acheter.` });
    }

    /* ---- niveau de confiance ---- */
    let points = 0;
    if (historyDays >= 90) points++;
    if (product.offers.length >= 2) points++;
    if (ageHours <= RULES.freshHours) points++;
    if (best.shipping != null) points++;
    if (historyDays < 90) limits.push(`Historique de ${historyDays} jours (moins de 90).`);
    if (ageHours > RULES.freshHours) limits.push(`Dernière collecte ${fmtAgo(lastCollect)}.`);
    const meta = window.HunterData.meta;
    if (!meta || meta.kind === 'demo') limits.push('Données de démonstration : prix, marchands et produits sont fictifs.');
    else limits.push(`Échantillon de relevés (${meta.name}) : couverture limitée aux marchands relevés.`);
    const confidence = points >= 4 ? 'Élevée' : points >= 2 ? 'Moyenne' : 'Faible';

    /* ---- v0.2 : seuil de vraie affaire et historique des baisses ---- */
    const greatThreshold = baseline ? Math.floor(baseline * RULES.greatRatio) : null;
    const drops = greatThreshold ? dropHistory(series, greatThreshold, 180) : null;
    const cycle = historyDays >= RULES.minHistoryDays ? detectCycle(series) : null;
    const calNow = NOW - (product._asOfDays || 0) * DAY;
    const calendar = calendarInfo(series, calNow);

    return {
      product, verdict, confidence, confidencePoints: points, reasons, limits,
      best, second, offers, series, historyDays, lastCollect, ageHours,
      baseline, ratio, stats: { w30, w90, w180 }, confirmations, bestCost,
      greatThreshold, drops, cycle, calendar,
    };
  }

  /* Épisodes passés sous un seuil (jours consécutifs) sur une fenêtre donnée.
     On décrit le passé, on ne prédit pas le futur. */
  function dropHistory(series, threshold, windowDays) {
    const pts = series.filter((p) => p.daysAgo < windowDays).sort((x, y) => y.daysAgo - x.daysAgo);
    if (!pts.length) return { threshold, windowDays: 0, count: 0, avgDays: null, lastDaysAgo: null, ongoing: null };
    const newest = pts[pts.length - 1].daysAgo;
    const episodes = [];
    let cur = null;
    pts.forEach((p) => {
      if (p.value <= threshold) {
        if (!cur) { cur = { from: p.daysAgo, to: p.daysAgo, min: p.value }; episodes.push(cur); }
        else { cur.to = p.daysAgo; cur.min = Math.min(cur.min, p.value); }
      } else cur = null;
    });
    const last = episodes[episodes.length - 1];
    const ongoing = last && last.to === newest ? last : null;
    const past = episodes.filter((e) => e !== ongoing);
    const len = (e) => e.from - e.to + 1;
    return {
      threshold,
      windowDays: pts[0].daysAgo + 1,
      count: past.length,
      avgDays: past.length ? Math.round(past.reduce((s, e) => s + len(e), 0) / past.length) : null,
      lastDaysAgo: past.length ? past[past.length - 1].to : null,
      ongoing: ongoing ? { days: len(ongoing), min: ongoing.min } : null,
    };
  }

  /* =======================================================================
     v0.7 — Promotions récurrentes (détection prudente)
     Une « promotion » = au moins 2 jours consécutifs où le meilleur coût est
     au moins 5 % sous la médiane de l'historique. Un cycle n'est retenu que
     si au moins 3 promotions ont commencé à intervalles réguliers (écart
     relatif ≤ 25 %), sur une période de 3 semaines à 4 mois.
     ======================================================================= */
  const CYCLE = {
    depth: 0.05,        // promo = au moins 5 % sous la médiane
    minLength: 2,       // jours consécutifs (on ignore les pics d'un jour)
    maxGap: 1,          // un jour manquant ou au-dessus ne coupe pas l'épisode
    minEpisodes: 3,     // au moins 3 promotions observées (2 intervalles)
    maxSpread: 0.25,    // intervalles réguliers : (max − min) / moyenne ≤ 25 %
    minPeriod: 21,
    maxPeriod: 120,
    soonMargin: 7,      // tolérance autour de la date attendue
  };

  function promoEpisodes(series) {
    if (series.length < 2) return { median: null, episodes: [] };
    const med = median(series.map((p) => p.value));
    const limit = med * (1 - CYCLE.depth);
    const pts = [...series].sort((x, y) => y.daysAgo - x.daysAgo); // du plus ancien au plus récent
    const episodes = [];
    let cur = null;
    pts.forEach((p) => {
      if (p.value <= limit) {
        if (cur && cur.end - p.daysAgo <= CYCLE.maxGap + 1) {
          cur.end = p.daysAgo; cur.days++; cur.min = Math.min(cur.min, p.value);
        } else {
          cur = { start: p.daysAgo, end: p.daysAgo, days: 1, min: p.value };
          episodes.push(cur);
        }
      }
    });
    return { median: med, episodes: episodes.filter((e) => e.days >= CYCLE.minLength) };
  }

  function detectCycle(series) {
    const { median: med, episodes } = promoEpisodes(series);
    if (episodes.length < CYCLE.minEpisodes) return null;
    const starts = episodes.map((e) => e.start);           // jours écoulés, décroissants
    const gaps = starts.slice(1).map((d, i) => starts[i] - d);
    const mean = gaps.reduce((s, g) => s + g, 0) / gaps.length;
    const spread = (Math.max(...gaps) - Math.min(...gaps)) / mean;
    if (spread > CYCLE.maxSpread || mean < CYCLE.minPeriod || mean > CYCLE.maxPeriod) return null;
    const period = Math.round(mean);
    const last = episodes[episodes.length - 1];
    const newest = Math.min(...series.map((p) => p.daysAgo));
    const ongoing = last.end <= newest + CYCLE.maxGap;
    const sinceStart = last.start - newest;
    return {
      period,
      count: episodes.length,
      avgDepth: episodes.reduce((s, e) => s + (1 - e.min / med), 0) / episodes.length,
      avgDays: Math.round(episodes.reduce((s, e) => s + (e.start - e.end + 1), 0) / episodes.length),
      ongoing,
      lastStartDaysAgo: sinceStart,
      nextInDays: ongoing ? 0 : period - sinceStart, // négatif = en retard sur le rythme
      median: med,
    };
  }

  /* =======================================================================
     v0.8 — Calendrier commercial (soldes légales, semaine du Black Friday)
     ======================================================================= */
  const CAL = {
    lookAhead: 45,     // on annonce les événements à venir dans 45 jours
    before: 30,        // référence : médiane des 30 jours avant l'événement
    minEffect: 0.03,   // en dessous de 3 % de baisse, l'événement « n'a pas joué »
  };
  const Cal = () => window.HunterCalendar || (typeof HunterCalendar !== 'undefined' ? HunterCalendar : null);

  /* Effet observé sur ce produit lors des événements passés couverts par l'historique */
  function eventEffects(series, calNow) {
    const C = Cal();
    if (!C || !series.length) return [];
    const oldest = Math.max(...series.map((p) => p.daysAgo));
    const from = calNow - oldest * DAY;
    const agoOf = (ms) => (calNow - ms) / DAY;
    return C.eventsBetween(from, calNow)
      .filter((e) => e.end.getTime() <= calNow)
      .map((e) => {
        const s0 = agoOf(e.start.getTime()), s1 = agoOf(e.end.getTime());
        const before = series.filter((p) => p.daysAgo > s0 && p.daysAgo <= s0 + CAL.before).map((p) => p.value);
        const during = series.filter((p) => p.daysAgo <= s0 && p.daysAgo > s1).map((p) => p.value);
        if (before.length < 7 || during.length < 3) return null;
        const ref = median(before);
        const low = Math.min(...during);
        return { event: e, ref, low, effect: 1 - low / ref, daysAgo: Math.round(s0) };
      })
      .filter(Boolean);
  }

  function calendarInfo(series, calNow) {
    const C = Cal();
    if (!C || window.HunterData.useCalendar === false) return null;
    const upcoming = C.nextEvent(calNow, CAL.lookAhead);
    const history = eventEffects(series, calNow);
    const lastSame = upcoming ? [...history].reverse().find((h) => h.event.id === upcoming.event.id) || null : null;
    return { upcoming, history, lastSame };
  }

  /* L'événement à venir justifie-t-il d'attendre ? (dans `withinDays`, et sans
     preuve qu'il n'a eu aucun effet la dernière fois sur ce produit) */
  function eventSoon(cal, withinDays) {
    if (!cal || !cal.upcoming || cal.upcoming.ongoing || cal.upcoming.startsInDays > withinDays) return false;
    return !(cal.lastSame && cal.lastSame.effect < CAL.minEffect);
  }

  function calendarText(cal) {
    if (!cal || !cal.upcoming) return null;
    const C = Cal();
    const u = cal.upcoming;
    const name = u.event.name;
    let t = u.ongoing
      ? `${name} en cours, jusqu’au ${C.fmtDay(new Date(u.event.end.getTime() - 1))}.`
      : `${name} : à partir du ${C.fmtDay(u.event.start)} (dans ${u.startsInDays} jour${u.startsInDays > 1 ? 's' : ''}).`;
    if (cal.lastSame) {
      const pct = Math.round(cal.lastSame.effect * 100);
      t += cal.lastSame.effect >= CAL.minEffect
        ? ` La dernière fois, ce produit a baissé jusqu’à −${pct} %.`
        : ` La dernière fois, ce produit n’a pas vraiment baissé (${pct <= 0 ? 'aucune baisse' : '−' + pct + ' %'}).`;
    } else if (!u.event.legal) {
      t += ' Effet sur ce produit encore jamais observé.';
    } else {
      t += ' Effet sur ce produit encore jamais observé : les soldes concernent surtout les fins de série.';
    }
    return t;
  }

  /* =======================================================================
     v0.9 — Vérificateur de remises
     Pour chaque offre : remise affichée (prix barré) contre remise réelle,
     c'est-à-dire l'écart avec le prix habituel CHEZ CE MARCHAND (médiane de
     ses relevés sur 90 jours). Le prix barré n'est jamais pris pour argent
     comptant (§6).
     ======================================================================= */
  const DISCOUNT = {
    window: 90,          // jours de relevés du marchand pris en compte
    minDays: 30,         // en dessous, impossible à vérifier
    realMin: 0.05,       // remise réelle minimale pour parler de vraie remise
    exaggeration: 0.10,  // écart affiché − réel au-delà duquel c'est exagéré
    silentMin: 0.10,     // baisse réelle sans prix barré, signalée au-delà de 10 %
  };
  const DISCOUNT_STATUS = {
    real: { label: 'Remise réelle', order: 3 },
    exaggerated: { label: 'Réelle mais exagérée', order: 1 },
    inflated: { label: 'Remise gonflée', order: 0 },
    unverifiable: { label: 'Impossible à vérifier', order: 2 },
    silent: { label: 'Baisse sans prix barré', order: 4 },
  };

  /* Classement commun : remise affichée (ou null) contre baisse réelle */
  function classifyDiscount(shown, real) {
    if (shown == null) return real >= DISCOUNT.silentMin ? 'silent' : 'none';
    if (real < DISCOUNT.realMin) return 'inflated';
    if (shown - real > DISCOUNT.exaggeration) return 'exaggerated';
    return 'real';
  }

  function discountCheck(offer) {
    const shownRaw = offer.strikePrice ? 1 - offer.price / offer.strikePrice : null;
    const shown = shownRaw != null && shownRaw > 0 ? shownRaw : null;
    const recent = offer.observations.filter((x) => NOW - x.t < DISCOUNT.window * DAY);
    const spanDays = recent.length ? Math.floor((NOW - recent[0].t) / DAY) + 1 : 0;
    const ageHours = (NOW - offer.collectedAt) / 3600000;
    const base = { shown, truth: offer.strikePrice ? strikeTruth(offer) : null };
    if (spanDays < DISCOUNT.minDays) {
      return Object.assign(base, { status: 'unverifiable', real: null, usual: null, reason: `seulement ${spanDays} jour${spanDays > 1 ? 's' : ''} de relevés chez ce marchand` });
    }
    if (ageHours > RULES.staleHours) {
      return Object.assign(base, { status: 'unverifiable', real: null, usual: null, reason: `dernier relevé ${fmtAgo(offer.collectedAt)}, le prix a pu changer` });
    }
    const usual = median(recent.map((x) => x.price));
    const real = 1 - offer.price / usual;
    return Object.assign(base, { status: classifyDiscount(shown, real), real, usual, reason: null });
  }

  function discountText(c, offer) {
    const pct = (v) => Math.round(Math.abs(v) * 100);
    const realTxt = c.real == null ? '' : c.real >= 0.005 ? `−${pct(c.real)} %` : c.real <= -0.005 ? `+${pct(c.real)} %` : '0 %';
    switch (c.status) {
      case 'real':
        return `Affiche −${pct(c.shown)} % ; la baisse réelle par rapport au prix habituel chez ${offer.merchant.name} (${fmtPrice(c.usual)}) est de ${realTxt}.`;
      case 'exaggerated':
        return `Affiche −${pct(c.shown)} %, mais par rapport au prix habituel chez ${offer.merchant.name} (${fmtPrice(c.usual)}), la baisse réelle n’est que de ${realTxt}.`;
      case 'inflated':
        return `Affiche −${pct(c.shown)} %, alors que le prix est ${c.real < -0.005 ? `au-dessus (${realTxt})` : 'au niveau'} du prix habituel chez ${offer.merchant.name} (${fmtPrice(c.usual)}).`;
      case 'silent':
        return `Aucun prix barré, mais ${realTxt} par rapport au prix habituel chez ${offer.merchant.name} (${fmtPrice(c.usual)}) : une vraie baisse que les comparateurs peuvent manquer.`;
      case 'unverifiable':
        return `${c.shown != null ? `Affiche −${pct(c.shown)} %, mais impossible` : 'Impossible'} à vérifier : ${c.reason}.`;
      default:
        return '';
    }
  }

  /* =======================================================================
     v1.0 — Vérifier un prix vu ailleurs (magasin, autre site)
     L'utilisateur saisit un prix (et éventuellement un prix barré, des
     frais de livraison, le marchand). On compare :
       - au prix habituel du marché (médiane sur 90 j du prix le plus bas
         observé chaque jour, hors livraison, tous marchands suivis) ;
       - au prix habituel chez ce marchand, s'il est suivi ;
       - au meilleur coût actuel chez les marchands suivis ;
       - au prix le plus bas observé sur 180 jours.
     ======================================================================= */
  function marketPriceSeries(product) {
    const byDay = new Map();
    product.offers.forEach((o) => o.observations.forEach((x) => {
      const d = Math.floor((NOW - x.t) / DAY);
      if (!byDay.has(d) || byDay.get(d) > x.price) byDay.set(d, x.price);
    }));
    return [...byDay.entries()].map(([d, v]) => ({ daysAgo: d, value: v }));
  }

  function checkSeenPrice(product, input) {
    const price = Number(input.price);
    if (!(price > 0)) return { ok: false, error: 'Indiquez le prix affiché.' };
    const strike = input.strike > price ? Number(input.strike) : null;
    const shipping = input.shipping != null && input.shipping >= 0 ? Number(input.shipping) : null;
    const notes = [];
    if (input.strike != null && input.strike > 0 && !strike) notes.push('Le prix barré saisi n’est pas supérieur au prix : il a été ignoré.');

    const series = marketPriceSeries(product);
    const recent = series.filter((p) => p.daysAgo < DISCOUNT.window);
    const span = recent.length ? Math.max(...recent.map((p) => p.daysAgo)) + 1 : 0;
    if (span < DISCOUNT.minDays) {
      return { ok: true, status: 'unverifiable', price, strike, shown: strike ? 1 - price / strike : null, notes,
        reason: `seulement ${span} jour${span > 1 ? 's' : ''} d’historique pour ce produit` };
    }
    const usual = median(recent.map((p) => p.value));
    const real = 1 - price / usual;
    const shown = strike ? 1 - price / strike : null;
    let status = classifyDiscount(shown, real);
    if (status === 'none') status = real <= -DISCOUNT.realMin ? 'above' : 'usual';

    // chez ce marchand, s'il est suivi
    let merchant = null;
    const offer = input.merchantId
      ? product.offers.find((o) => o.merchantId === input.merchantId || (o.merchant && o.merchant.id === input.merchantId))
      : null;
    if (offer) {
      const mc = discountCheck(Object.assign({}, offer, { price, strikePrice: strike, collectedAt: NOW }));
      merchant = { name: offer.merchant.name, usual: mc.usual, real: mc.real, status: mc.status === 'none' ? null : mc.status,
        truth: strike ? strikeTruth(Object.assign({}, offer, { strikePrice: strike })) : null };
    }

    // meilleur coût actuel chez les marchands suivis, à mode de réception égal
    const a = assess(product);
    const seenTotal = shipping != null ? price + shipping : price;
    const diff = seenTotal - a.bestCost;
    const low180 = Math.min(...series.filter((p) => p.daysAgo < 180).map((p) => p.value));

    const lines = [];
    const pct = (v) => Math.round(Math.abs(v) * 100);
    lines.push(real >= 0.005
      ? `Ce prix est ${pct(real)} % sous le prix habituel du marché (${fmtPrice(usual)}).`
      : real <= -0.005 ? `Ce prix est ${pct(real)} % au-dessus du prix habituel du marché (${fmtPrice(usual)}).`
        : `Ce prix est au niveau du prix habituel du marché (${fmtPrice(usual)}).`);
    if (shown != null) {
      lines.push(status === 'real'
        ? `La remise affichée (−${pct(shown)} %) correspond à une vraie baisse.`
        : status === 'exaggerated' ? `La remise affichée (−${pct(shown)} %) est exagérée : la baisse réelle est de −${pct(real)} %.`
          : `La remise affichée (−${pct(shown)} %) ne correspond à aucune baisse réelle.`);
    }
    if (merchant && merchant.usual) {
      lines.push(`Chez ${merchant.name}, le prix habituel est de ${fmtPrice(merchant.usual)}${merchant.truth ? (merchant.truth.seen ? ` ; le prix barré y a été pratiqué il y a ${merchant.truth.lastDaysAgo} jours` : ` ; le prix barré n’y a jamais été pratiqué en ${merchant.truth.windowDays} jours`) : ''}.`);
    }
    lines.push(diff > 0.5
      ? `Moins cher actuellement chez ${a.best.merchant.name} : ${fmtPrice(a.bestCost)} (${a.best.shipping == null ? 'hors livraison' : 'livraison comprise'}), soit ${fmtPrice(diff)} d’économie.`
      : diff < -0.5 ? `C’est ${fmtPrice(-diff)} de moins que la meilleure offre suivie (${fmtPrice(a.bestCost)} chez ${a.best.merchant.name}).`
        : `C’est le même prix que la meilleure offre suivie (${a.best.merchant.name}).`);
    if (shipping == null) notes.push('Sans frais de livraison saisis, la comparaison porte sur le prix seul.');
    if (price <= low180 * 1.01) lines.push(`C’est le prix le plus bas observé sur 180 jours (précédent minimum : ${fmtPrice(low180)}).`);

    return { ok: true, status, price, strike, shipping, shown, real, usual, merchant, best: a.best, bestCost: a.bestCost, diff, low180, lines, notes };
  }

  const SEEN_STATUS = Object.assign({}, {
    above: { label: 'Prix au-dessus de l’habitude' },
    usual: { label: 'Prix habituel' },
  });

  /* =======================================================================
     v0.11 — Coup d'œil : une réponse, une raison, des alertes, une action.
     Toujours dérivé du verdict et de la recommandation : jamais un avis
     différent de la fiche complète.
     ======================================================================= */
  function glance(a) {
    const pct = (v) => Math.round(Math.abs(v) * 100);
    const stance = stanceOf(a);
    const vsUsual = a.ratio == null ? null
      : a.ratio <= 0.995 ? `${pct(a.ratio - 1)} % sous le prix habituel`
        : a.ratio >= 1.005 ? `${pct(a.ratio - 1)} % au-dessus du prix habituel` : 'au niveau du prix habituel';
    let tone, answer, reason;
    if (a.verdict === VERDICTS.insufficient) {
      tone = 'insufficient';
      answer = 'Pas assez de données';
      reason = a.historyDays < RULES.minHistoryDays
        ? `Seulement ${a.historyDays} jours d’historique : impossible de dire si c’est une bonne affaire.`
        : `Dernière vérification ${fmtAgo(a.lastCollect)} : le prix a pu changer.`;
    } else if (stance === 'buy') {
      tone = 'great';
      answer = 'Bon moment pour acheter';
      reason = `${vsUsual[0].toUpperCase()}${vsUsual.slice(1)}, baisse confirmée par ${a.confirmations} relevés récents.`;
    } else if (stance === 'wait') {
      tone = a.verdict === VERDICTS.bad ? 'bad' : 'wait';
      answer = 'Mieux vaut attendre';
      const cal = a.calendar;
      if (a.verdict === VERDICTS.fair && eventSoon(cal, BACKTEST.horizon)) {
        reason = `${cal.upcoming.event.name} dans ${cal.upcoming.startsInDays} jour${cal.upcoming.startsInDays > 1 ? 's' : ''}.`;
      } else if (a.verdict === VERDICTS.fair && cycleSoon(a.cycle, BACKTEST.horizon)) {
        reason = `Une promotion revient environ tous les ${a.cycle.period} jours ; la prochaine est attendue ${a.cycle.nextInDays > 0 ? `d’ici ${a.cycle.nextInDays} jours` : 'bientôt'}.`;
      } else if (a.verdict === VERDICTS.bad) {
        reason = `Prix ${vsUsual}.`;
      } else {
        reason = `Prix ${vsUsual} ; il est déjà passé sous ${fmtPrice(a.greatThreshold)} ces derniers mois.`;
      }
    } else {
      tone = 'fair';
      answer = 'Prix correct';
      reason = a.cycle && !a.cycle.ongoing && a.cycle.nextInDays > 0
        ? `Prix ${vsUsual} ; la prochaine promotion habituelle n’est pas attendue avant ${a.cycle.nextInDays} jours.`
        : `Prix ${vsUsual}, sans baisse particulière en vue.`;
    }
    const warnings = [];
    if (a.best.shipping == null) warnings.push('Frais de livraison inconnus');
    if (a.best.merchant.signals.marketplace) warnings.push('Vendeur tiers de place de marché');
    if (a.ageHours > RULES.freshHours && a.verdict !== VERDICTS.insufficient) warnings.push(`Vérifié ${fmtAgo(a.lastCollect)}`);
    const fake = a.baseline ? a.offers.find((o) => o.strikePrice && o.price >= a.baseline * RULES.marketingTolerance) : null;
    if (fake) warnings.push(`Prix barré chez ${fake.merchant.name} sans baisse réelle`);
    return { tone, answer, reason, warnings, stance, verdict: a.verdict };
  }

  /* =======================================================================
     v0.13 — Retrouver un produit à partir d'un code scanné ou saisi
     EAN-13, EAN-8, UPC-A (12 chiffres, complété en EAN-13 par un 0) ;
     à défaut, la référence fabricant saisie à la main.
     Jamais de rapprochement sur le nom (§7).
     ======================================================================= */
  function normalizeCode(raw) {
    const digits = String(raw || '').replace(/[\s-]/g, '');
    if (/^\d{12}$/.test(digits)) return '0' + digits; // UPC-A → EAN-13
    return digits;
  }

  function lookupCode(products, raw) {
    const text = String(raw || '').trim();
    if (!text) return { status: 'empty' };
    const code = normalizeCode(text);
    const D = window.HunterDataset || (typeof HunterDataset !== 'undefined' ? HunterDataset : null);
    if (/^\d+$/.test(code)) {
      if (!/^\d{8}$|^\d{13}$/.test(code)) return { status: 'invalid', code, reason: `${code.length} chiffres : un EAN en compte 8 ou 13` };
      if (D && !D.eanValid(code)) return { status: 'invalid', code, reason: 'la clé de contrôle ne correspond pas (code mal lu ou mal saisi)' };
      const product = products.find((p) => p.ean && normalizeCode(p.ean) === code);
      return product ? { status: 'found', code, product, by: 'ean' } : { status: 'unknown', code };
    }
    // saisie d'une référence fabricant
    const ref = text.toUpperCase().replace(/\s+/g, '');
    const product = products.find((p) => p.mpn && p.mpn.toUpperCase().replace(/\s+/g, '') === ref);
    return product ? { status: 'found', code: text, product, by: 'mpn' } : { status: 'unknown', code: text };
  }

  /* =======================================================================
     v0.15 — Qualité des données (cadrage §12)
     Mesurable à partir des relevés : coût total connu, fraîcheur, régularité
     des relevés, comparabilité, profondeur d'historique. Les indicateurs qui
     demandent d'autres données (prix encore valide au clic, erreurs de
     correspondance signalées) sont listés comme non mesurés.
     ======================================================================= */
  const QUALITY = { window: 30, coverageLow: 0.5 };
  const QUALITY_TARGETS = { shipping: 0.9, fresh: 0.9, age: 24, coverage: 0.8, comparable: 0.8, history: 0.8 };

  function offerCoverage(o, windowDays = QUALITY.window) {
    const days = new Set();
    let first = Infinity;
    o.observations.forEach((x) => {
      first = Math.min(first, x.t);
      const d = Math.floor((NOW - x.t) / DAY);
      if (d < windowDays) days.add(d);
    });
    const span = Math.min(windowDays, Math.floor((NOW - first) / DAY) + 1);
    return span > 0 ? Math.min(1, days.size / span) : 0;
  }

  function dataQuality(products) {
    const rows = [];
    products.forEach((p) => p.offers.forEach((o) => {
      rows.push({ p, o, shippingKnown: o.shipping != null, ageHours: (NOW - o.collectedAt) / 3600000, coverage: offerCoverage(o) });
    }));
    const share = (arr, fn) => (arr.length ? arr.filter(fn).length / arr.length : null);
    const mean = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null);
    const histDays = new Map(products.map((p) => [p.id, dailyBest(p).length]));
    const audit = discountAudit(products);

    const ind = (key, label, value, display, ok, help) => ({ key, label, value, display, ok, help });
    const pct = (v) => (v == null ? '—' : Math.round(v * 100) + ' %');
    const shippingShare = share(rows, (x) => x.shippingKnown);
    const freshShare = share(rows, (x) => x.ageHours <= RULES.freshHours);
    const meanAge = mean(rows.map((x) => x.ageHours));
    const meanCoverage = mean(rows.map((x) => x.coverage));
    const comparable = share(products, (p) => p.offers.length >= 2);
    const deep = share(products, (p) => histDays.get(p.id) >= RULES.minHistoryDays);
    const T = QUALITY_TARGETS;
    const indicators = [
      ind('shipping', 'Offres au coût total connu', shippingShare, pct(shippingShare), shippingShare >= T.shipping, 'Livraison connue : sinon le verdict compare des prix incomplets.'),
      ind('fresh', 'Offres relevées depuis moins de 24 h', freshShare, pct(freshShare), freshShare >= T.fresh, 'Un prix ancien peut avoir changé chez le marchand.'),
      ind('age', 'Âge moyen du dernier relevé', meanAge, meanAge == null ? '—' : meanAge < 48 ? `${Math.round(meanAge)} h` : `${Math.round(meanAge / 24)} j`, meanAge != null && meanAge <= T.age, 'Objectif : un relevé par jour au moins.'),
      ind('coverage', `Régularité des relevés (${QUALITY.window} j)`, meanCoverage, pct(meanCoverage), meanCoverage >= T.coverage, 'Part des jours avec au moins un relevé : les trous faussent médianes et journal.'),
      ind('comparable', 'Produits comparables (2 marchands ou plus)', comparable, pct(comparable), comparable >= T.comparable, 'Avec un seul marchand, la comparaison est limitée.'),
      ind('history', `Produits avec ${RULES.minHistoryDays} jours d’historique`, deep, pct(deep), deep >= T.history, 'En dessous, le verdict est « Données insuffisantes ».'),
    ];
    const notMeasured = [
      'Part des offres dont le prix est encore valide au clic : demande une vérification au moment du clic sortant.',
      'Taux d’erreur de correspondance produit : demande de centraliser les signalements « Ce prix est faux ? ».',
    ];

    // par marchand
    const byMerchant = new Map();
    rows.forEach((x) => {
      const m = x.o.merchant;
      if (!byMerchant.has(m.id)) byMerchant.set(m.id, { id: m.id, name: m.name, offers: [], strikes: 0, doubtful: 0 });
      byMerchant.get(m.id).offers.push(x);
    });
    audit.forEach((a) => {
      const m = byMerchant.get(a.offer.merchant.id);
      if (!m || a.shown == null) return;
      m.strikes++;
      if (a.status === 'inflated' || a.status === 'exaggerated') m.doubtful++;
    });
    const merchants = [...byMerchant.values()].map((m) => ({
      id: m.id, name: m.name, offers: m.offers.length,
      shipping: share(m.offers, (x) => x.shippingKnown),
      lastAgeHours: Math.min(...m.offers.map((x) => x.ageHours)),
      coverage: mean(m.offers.map((x) => x.coverage)),
      strikes: m.strikes, doubtful: m.doubtful,
    })).sort((a, b) => a.name.localeCompare(b.name, 'fr'));

    // points à corriger
    const issues = [];
    rows.filter((x) => x.ageHours > RULES.staleHours).forEach((x) => issues.push({ level: 'warn', productId: x.p.id, text: `${x.p.name} chez ${x.o.merchant.name} : dernier relevé ${fmtAgo(x.o.collectedAt)}.` }));
    rows.filter((x) => x.coverage < QUALITY.coverageLow).forEach((x) => issues.push({ level: 'warn', productId: x.p.id, text: `${x.p.name} chez ${x.o.merchant.name} : relevé ${Math.round(x.coverage * 100)} % des jours seulement.` }));
    rows.filter((x) => !x.shippingKnown).forEach((x) => issues.push({ level: 'info', productId: x.p.id, text: `${x.p.name} chez ${x.o.merchant.name} : frais de livraison inconnus.` }));
    products.filter((p) => p.offers.length < 2).forEach((p) => issues.push({ level: 'info', productId: p.id, text: `${p.name} : un seul marchand suivi.` }));
    products.filter((p) => histDays.get(p.id) < RULES.minHistoryDays).forEach((p) => issues.push({ level: 'info', productId: p.id, text: `${p.name} : ${histDays.get(p.id)} jours d’historique (verdict impossible avant ${RULES.minHistoryDays}).` }));

    return {
      totals: { products: products.length, offers: rows.length, observations: rows.reduce((n, x) => n + x.o.observations.length, 0) },
      indicators, notMeasured, merchants, issues,
    };
  }

  /* Toutes les remises à vérifier sur un ensemble de produits */
  function discountAudit(products) {
    const rows = [];
    products.forEach((p) => p.offers.forEach((o) => {
      const c = discountCheck(o);
      if (c.status === 'none') return;
      rows.push(Object.assign({ product: p, offer: o, label: DISCOUNT_STATUS[c.status].label, text: discountText(c, o) }, c));
    }));
    return rows.sort((a, b) => DISCOUNT_STATUS[a.status].order - DISCOUNT_STATUS[b.status].order
      || ((b.shown || 0) - (b.real || 0)) - ((a.shown || 0) - (a.real || 0)));
  }

  /* Une promotion est-elle attendue dans les `withinDays` prochains jours ? */
  function cycleSoon(c, withinDays) {
    return !!c && !c.ongoing && c.nextInDays >= -CYCLE.soonMargin && c.nextInDays <= withinDays;
  }

  function cycleText(c) {
    if (!c) return null;
    const base = `Une promotion d’environ −${Math.round(c.avgDepth * 100)} % revient environ tous les ${c.period} jours (${c.count} fois observée, ${c.avgDays} jours en moyenne).`;
    if (c.ongoing) return base + ' Elle semble en cours.';
    if (c.nextInDays > 0) return base + ` La dernière a commencé il y a ${c.lastStartDaysAgo} jours : si le rythme se maintient, la prochaine viendrait dans environ ${c.nextInDays} jours.`;
    return base + ` La dernière a commencé il y a ${c.lastStartDaysAgo} jours : le rythme habituel est dépassé de ${-c.nextInDays} jours, à surveiller sans certitude.`;
  }

  /* « Faut-il attendre ? » + « Pourquoi pas plus haut ? » */
  function waitAdvice(a) {
    if (a.verdict === VERDICTS.insufficient || !a.greatThreshold) return null;
    const d = a.drops;
    const span = `${d.windowDays} derniers jours`;
    const freq = d.count === 0
      ? `Sur les ${span}, le prix n’était jamais descendu sous ce seuil${a.verdict === VERDICTS.great ? ' avant cette baisse' : ''}.`
      : `Sur les ${span}, le prix est passé sous ce seuil ${d.count === 1 ? 'une fois' : d.count + ' fois'}, pendant ${d.avgDays} jour${d.avgDays > 1 ? 's' : ''} en moyenne (dernière fois il y a ${d.lastDaysAgo} jours).`;
    if (a.verdict === VERDICTS.great) {
      return {
        kind: 'now',
        title: 'Faut-il attendre ?',
        lines: [
          `Le meilleur coût est sous le seuil de vraie affaire (${fmtPrice(a.greatThreshold)})${d.ongoing ? ` depuis ${d.ongoing.days} jour${d.ongoing.days > 1 ? 's' : ''}` : ''}.`,
          freq,
          cycleText(a.cycle),
          calendarText(a.calendar),
        ].filter(Boolean),
        cycle: a.cycle,
      };
    }
    return {
      kind: 'wait',
      title: 'Pourquoi pas plus haut ?',
      lines: [
        `En dessous de ${fmtPrice(a.greatThreshold)}, ce serait une vraie affaire (10 % sous le prix habituel). Il manque ${fmtPrice(a.bestCost - a.greatThreshold)}.`,
        freq,
        cycleText(a.cycle),
        calendarText(a.calendar),
      ].filter(Boolean),
      cycle: a.cycle,
    };
  }

  /* Statut d'une alerte de surveillance.
     onlyConfirmed : n'alerter que si la baisse est fiable (données fraîches,
     coût total connu, plusieurs observations récentes sous le seuil). */
  function alertStatus(a, target, prefs = {}) {
    if (a.bestCost > target) return { state: 'waiting', gap: Math.round((a.bestCost - target) * 100) / 100, issues: [] };
    const issues = [];
    if (a.verdict === VERDICTS.insufficient) issues.push('données insuffisantes');
    if (a.best.shipping == null) issues.push('livraison inconnue');
    if (a.ageHours > RULES.freshHours) issues.push('dernière collecte de plus de 24 h');
    let obs = 0;
    a.offers.forEach((o) => o.observations.forEach((x) => {
      if (NOW - x.t < RULES.confirmWindowDays * DAY && obsCost(o, x) <= target) obs++;
    }));
    if (obs < RULES.confirmMinObs) issues.push('une seule observation sous le seuil');
    if (prefs.onlyConfirmed && issues.length) return { state: 'unconfirmed', gap: 0, issues };
    return { state: 'reached', gap: 0, issues };
  }

  /* Résumé court et partageable du verdict */
  function shareText(a) {
    const p = a.product;
    const parts = [`${p.name} (${p.variant}) à ${fmtPrice(a.bestCost)}${a.best.shipping == null ? ' hors livraison' : ''}`];
    parts.push(`verdict The Hunter : ${a.verdict.label}`);
    if (a.ratio) parts.push(`${fmtPct(a.ratio - 1)} vs prix habituel 90 j`);
    parts.push(`${p.offers.length} marchand${p.offers.length > 1 ? 's' : ''} comparé${p.offers.length > 1 ? 's' : ''}`);
    parts.push(`vérifié ${fmtAgo(a.lastCollect)}`);
    return parts.join(' · ') + '.';
  }

  /* Vérité du prix barré : quand ce prix a-t-il été pratiqué pour la dernière
     fois par ce marchand ? (tolérance de 2 %) */
  function strikeTruth(offer, windowDays = 180) {
    if (!offer.strikePrice) return null;
    const inWindow = offer.observations.filter((x) => NOW - x.t < windowDays * DAY);
    const span = inWindow.length ? Math.floor((NOW - inWindow[0].t) / DAY) + 1 : 0;
    let last = null;
    inWindow.forEach((x) => { if (x.price >= offer.strikePrice * 0.98) last = x; });
    return {
      seen: !!last,
      lastDaysAgo: last ? Math.floor((NOW - last.t) / DAY) : null,
      windowDays: Math.min(windowDays, span),
    };
  }

  /* =======================================================================
     Labo §15 — que montrerait un simple tri par prix, et qu'ajoute Hunter ?
     Le « tri naïf » classe les offres par prix affiché (hors livraison),
     montre la remise annoncée et le dernier prix connu, sans date ni
     historique.
     ======================================================================= */
  const FINDINGS = {
    shipping: { label: 'Livraison', changesDecision: true },
    unknownCost: { label: 'Coût incomplet', changesDecision: false },
    seller: { label: 'Vendeur', changesDecision: true },
    fakePromo: { label: 'Fausse promo', changesDecision: true },
    above: { label: 'Prix au-dessus de l’habitude', changesDecision: true },
    realDeal: { label: 'Vraie baisse', changesDecision: false }, // confirme le choix, ne le change pas
    wait: { label: 'Attendre', changesDecision: true },
    cycle: { label: 'Promo récurrente', changesDecision: false },
    event: { label: 'Calendrier', changesDecision: false },
    caution: { label: 'Prudence', changesDecision: true },
  };

  function compareToNaive(a) {
    const naiveOffer = [...a.offers].sort((x, y) => x.price - y.price)[0];
    const shownDiscount = naiveOffer.strikePrice ? 1 - naiveOffer.price / naiveOffer.strikePrice : null;
    const findings = [];
    const add = (type, text) => findings.push({ type, label: FINDINGS[type].label, changesDecision: FINDINGS[type].changesDecision, text });

    if (naiveOffer.id !== a.best.id) {
      add('shipping', `Le prix le plus bas affiché (${fmtPrice(naiveOffer.price)} chez ${naiveOffer.merchant.name}) revient à ${naiveOffer.total == null ? 'un coût inconnu' : fmtPrice(naiveOffer.total)} avec la livraison. Le meilleur coût total est chez ${a.best.merchant.name} (${fmtPrice(a.bestCost)}).`);
    } else if (naiveOffer.shipping == null) {
      add('unknownCost', `Le prix le plus bas (${naiveOffer.merchant.name}) n’inclut pas la livraison, qui n’est pas connue : le vrai coût peut être plus élevé.`);
    }

    const s = naiveOffer.merchant.signals;
    if (s.marketplace || s.identified === false) {
      add('seller', `Le moins cher affiché est ${s.marketplace ? 'un vendeur tiers de place de marché' : 'un vendeur'}${s.identified === false ? ' dont l’identité n’est pas vérifiée' : ''} (${naiveOffer.merchant.name}).`);
    }

    if (a.verdict === VERDICTS.insufficient) {
      add('caution', a.historyDays < RULES.minHistoryDays
        ? `Historique de ${a.historyDays} jours : Hunter refuse de qualifier ce prix, alors qu’un tri l’afficherait comme n’importe quel autre.`
        : `Dernière collecte ${fmtAgo(a.lastCollect)} : un tri afficherait ce prix comme s’il était encore valable.`);
      return { naive: { offer: naiveOffer, price: naiveOffer.price, shownDiscount }, findings, addsValue: findings.length > 0, changesDecision: findings.some((f) => f.changesDecision) };
    }

    const fake = a.baseline
      ? a.offers.filter((o) => o.strikePrice && o.price >= a.baseline * RULES.marketingTolerance)
      : [];
    if (fake.length) {
      const o = fake[0];
      const t = strikeTruth(o);
      add('fakePromo', `${o.merchant.name} affiche −${Math.round((1 - o.price / o.strikePrice) * 100)} %, mais ${t && t.seen ? `ce prix barré n’a plus été pratiqué depuis ${t.lastDaysAgo} jours` : 'ce prix barré n’a jamais été pratiqué'} : le prix reste au niveau habituel.`);
    }

    if (a.verdict === VERDICTS.great) {
      add('realDeal', `Baisse réelle de ${Math.round((1 - a.ratio) * 100)} % sous le prix habituel, confirmée par ${a.confirmations} observations récentes : c’est un bon moment pour acheter, ce qu’un tri ne peut pas dire.`);
    } else {
      if (a.ratio > RULES.fairRatio) add('above', `Le meilleur coût est ${fmtPct(a.ratio - 1)} au-dessus du prix habituel, ce qu’un tri ne montre pas.`);
      const stance = stanceOf(a);
      const c = a.cycle;
      const cal = a.calendar;
      if (stance === 'wait' && eventSoon(cal, BACKTEST.horizon)) {
        add('wait', `${calendarText(cal)} Attendre est raisonnable.`);
      } else if (cal && cal.upcoming && (cal.upcoming.ongoing || cal.upcoming.startsInDays <= BACKTEST.horizon)) {
        add('event', calendarText(cal));
      }
      const soon = cycleSoon(c, BACKTEST.horizon);
      const byEvent = stance === 'wait' && eventSoon(cal, BACKTEST.horizon);
      if (byEvent) { /* déjà expliqué par le calendrier */ } else if (stance === 'wait' && soon) {
        add('wait', `Une promotion d’environ −${Math.round(c.avgDepth * 100)} % revient tous les ${c.period} jours environ, et la prochaine est attendue ${c.nextInDays > 0 ? `d’ici ${c.nextInDays} jours` : 'incessamment'} : attendre est raisonnable.`);
      } else if (stance === 'wait' && a.drops && a.drops.count > 0) {
        add('wait', `Le prix est passé ${a.drops.count === 1 ? 'une fois' : a.drops.count + ' fois'} sous ${fmtPrice(a.greatThreshold)} en ${a.drops.windowDays} jours : attendre est raisonnable.`);
      }
      if (c && !c.ongoing && !soon) {
        const when = c.nextInDays > 0
          ? `la prochaine n’est pas attendue avant ${c.nextInDays} jours`
          : `le rythme habituel est dépassé de ${-c.nextInDays} jours, sans promotion pour l’instant`;
        add('cycle', `Promotion récurrente repérée (tous les ${c.period} jours environ), mais ${when}${a.verdict === VERDICTS.fair ? ' : acheter maintenant reste raisonnable' : ''}.`);
      }
    }

    return {
      naive: { offer: naiveOffer, price: naiveOffer.price, shownDiscount },
      findings,
      addsValue: findings.length > 0,
      changesDecision: findings.some((f) => f.changesDecision),
    };
  }

  /* =======================================================================
     v0.6 — Journal des verdicts (rétro-test)
     On reconstitue le produit tel qu'il était il y a k jours (relevés
     antérieurs uniquement, décalés pour que cette date devienne
     « maintenant »), on rend le verdict avec le moteur actuel, puis on
     regarde ce qui s'est réellement passé pendant les `horizon` jours suivants.
     ======================================================================= */
  const BACKTEST = {
    step: 14,        // un verdict rejoué tous les 14 jours
    horizon: 21,     // on juge sur les 3 semaines suivantes
    maxBack: 105,    // jusqu'à ~3 mois et demi en arrière
    tolerance: 0.03, // baisse ou hausse considérée comme significative (3 %)
    fairMiss: 0.05,  // « Prix correct » faux si une baisse de plus de 5 % suit
  };

  function productAsOf(product, daysAgo) {
    const cut = NOW - daysAgo * DAY;
    const shift = daysAgo * DAY;
    const offers = product.offers.map((o) => {
      const past = o.observations.filter((x) => x.t <= cut);
      if (!past.length) return null;
      const observations = past.map((x) => Object.assign({}, x, { t: x.t + shift }));
      const last = observations[observations.length - 1];
      const shipping = last.shipping !== undefined && last.shipping !== null ? last.shipping : o.shipping;
      return Object.assign({}, o, {
        observations,
        price: last.price,
        shipping,
        total: shipping == null ? null : Math.round((last.price + shipping) * 100) / 100,
        strikePrice: last.strikePrice != null ? last.strikePrice : o.strikePrice,
        collectedAt: last.t,
      });
    }).filter(Boolean);
    return offers.length ? Object.assign({}, product, { offers, _asOfDays: (product._asOfDays || 0) + daysAgo }) : null;
  }

  /* Meilleur coût observé (tous marchands) entre « il y a fromDaysAgo » exclu
     et « il y a toDaysAgo » inclus */
  function futureBest(product, fromDaysAgo, toDaysAgo) {
    let best = null;
    product.offers.forEach((o) => o.observations.forEach((x) => {
      const ago = (NOW - x.t) / DAY;
      if (ago < fromDaysAgo && ago >= toDaysAgo) {
        const c = obsCost(o, x);
        if (!best || c < best.cost) best = { cost: c, daysAgo: Math.floor(ago), merchant: o.merchant.name };
      }
    }));
    return best;
  }

  /* Ce que The Hunter recommandait réellement à l'utilisateur à cette date */
  function stanceOf(a) {
    if (a.verdict === VERDICTS.great) return 'buy';
    if (a.verdict === VERDICTS.bad) return 'wait';
    if (a.verdict === VERDICTS.fair) {
      // v0.8 : un événement commercial proche (et qui a déjà joué, ou jamais observé)
      if (eventSoon(a.calendar, BACKTEST.horizon)) return 'wait';
      // v0.7 : avec un cycle régulier, on n'attend que si la promo est proche
      if (a.cycle && !a.cycle.ongoing) return cycleSoon(a.cycle, BACKTEST.horizon) ? 'wait' : 'ok';
      return a.drops && a.drops.count > 0 ? 'wait' : 'ok';
    }
    return null;
  }
  const STANCE_LABEL = { buy: 'Acheter', wait: 'Attendre', ok: 'Prix acceptable' };

  function judge(a, fut, k) {
    const stance = stanceOf(a);
    const after = (d) => `${k - d.daysAgo} jour${k - d.daysAgo > 1 ? 's' : ''} plus tard`;
    const drop = fut ? 1 - fut.cost / a.bestCost : 0;
    const pct = Math.round(Math.abs(drop) * 100);
    const H = BACKTEST.horizon;
    switch (stance) {
      case 'buy':
        return drop > BACKTEST.tolerance
          ? { stance, outcome: 'wrong', text: `Trop tôt : ${fmtPrice(fut.cost)} (−${pct} %) ${after(fut)}.` }
          : { stance, outcome: 'right', text: `Juste : pas de meilleur prix dans les ${H} jours suivants.` };
      case 'wait':
        return drop > BACKTEST.tolerance
          ? { stance, outcome: 'right', text: `Juste : ${fmtPrice(fut.cost)} (−${pct} %) ${after(fut)}.` }
          : { stance, outcome: 'wrong', text: `Attente inutile : pas de baisse dans les ${H} jours suivants.` };
      case 'ok':
        return drop > BACKTEST.fairMiss
          ? { stance, outcome: 'wrong', text: `Baisse non anticipée : ${fmtPrice(fut.cost)} (−${pct} %) ${after(fut)}.` }
          : { stance, outcome: 'right', text: `Juste : pas de baisse notable dans les ${H} jours suivants.` };
      default:
        return { stance, outcome: null, text: 'Non évalué : Hunter n’avait pas rendu de verdict.' };
    }
  }

  function backtest(product, opts = {}) {
    const cfg = Object.assign({}, BACKTEST, opts);
    const entries = [];
    for (let k = cfg.horizon; k <= cfg.maxBack; k += cfg.step) {
      const past = productAsOf(product, k);
      if (!past) continue;
      const a = assess(past);
      const fut = futureBest(product, k, k - cfg.horizon);
      const j = judge(a, fut, k);
      entries.push({
        daysAgo: k, verdict: a.verdict, bestCost: a.bestCost, merchant: a.best.merchant.name,
        ratio: a.ratio, future: fut, outcome: j.outcome, text: j.text,
        stance: j.stance, stanceLabel: j.stance ? STANCE_LABEL[j.stance] : null,
      });
    }
    const scored = entries.filter((e) => e.outcome);
    return {
      entries: entries.sort((x, y) => x.daysAgo - y.daysAgo),
      scored: scored.length,
      right: scored.filter((e) => e.outcome === 'right').length,
      config: cfg,
    };
  }

  const btCache = new Map();
  function backtestCached(product) {
    const key = product.id + '|' + costMode();
    if (!btCache.has(key)) btCache.set(key, backtest(product));
    return btCache.get(key);
  }

  /* ---------------- v0.5 : caractéristiques structurées ---------------- */
  const attrSchema = (category) => {
    const D = window.HunterDataset || (typeof HunterDataset !== 'undefined' ? HunterDataset : null);
    return (D && D.CATEGORY_ATTRS[category]) || { attrs: [] };
  };

  function fmtAttr(def, v) {
    if (v == null) return '—';
    if (def.type === 'bool') return v ? 'oui' : 'non';
    const n = v.toLocaleString('fr-FR', { maximumFractionDigits: 1 });
    if (!def.unit) return n;
    return def.unit === '″' ? n + '″' : n + ' ' + def.unit;
  }

  /* Prix par unité utile (€/To, €/pouce…) pour un coût donné */
  function unitPrice(product, cost) {
    const cfg = attrSchema(product.category).unitPrice;
    const v = cfg && product.attrs ? product.attrs[cfg.key] : null;
    if (!cfg || !v || !cost) return null;
    return { value: cost / (v / cfg.per), label: cfg.label, key: cfg.key };
  }

  /* Compare deux produits caractéristique par caractéristique.
     winner : 'a', 'b' ou null (égalité, goût, ou valeur manquante). */
  function compareAttrs(pa, pb) {
    if (pa.category !== pb.category) return [];
    const A = pa.attrs || {}, B = pb.attrs || {};
    return attrSchema(pa.category).attrs
      .filter((def) => A[def.key] != null || B[def.key] != null)
      .map((def) => {
        const a = A[def.key], b = B[def.key];
        let winner = null;
        if (a != null && b != null && a !== b && def.better) {
          const aBetter = def.type === 'bool' ? a === true : def.better === 'higher' ? a > b : a < b;
          winner = aBetter ? 'a' : 'b';
        }
        return { def, a, b, winner, aText: fmtAttr(def, a), bText: fmtAttr(def, b) };
      });
  }

  /* Synthèse factuelle : ce que le plus cher apporte, ce que le moins cher garde */
  function attrSummary(pa, pb, costA, costB) {
    const rows = compareAttrs(pa, pb).filter((r) => r.winner);
    if (!rows.length) return null;
    const aPricier = costA > costB;
    const pricier = aPricier ? pa : pb, cheaper = aPricier ? pb : pa;
    const side = (r, who) => (who === 'a' ? r.aText : r.bText);
    const list = (rs, me, other) => rs.map((r) => `${r.def.label.toLowerCase()} (${side(r, me)} contre ${side(r, other)})`).join(', ');
    const pk = aPricier ? 'a' : 'b', ck = aPricier ? 'b' : 'a';
    const plus = rows.filter((r) => r.winner === pk);
    const minus = rows.filter((r) => r.winner === ck);
    const diff = Math.abs(costA - costB);
    const parts = [];
    if (plus.length) parts.push(`Pour ${fmtPrice(diff)} de plus, le ${pricier.name} offre : ${list(plus, pk, ck)}.`);
    else parts.push(`Le ${pricier.name} coûte ${fmtPrice(diff)} de plus sans avantage mesurable sur les caractéristiques suivies.`);
    if (minus.length) parts.push(`Le ${cheaper.name} garde l’avantage sur : ${list(minus, ck, pk)}.`);
    return parts.join(' ');
  }

  const cache = new Map();
  function assessCached(product) {
    if (!cache.has(product.id)) cache.set(product.id, assess(product));
    return cache.get(product.id);
  }

  window.Hunter = {
    RULES, VERDICTS, assess: assessCached, assessFresh: assess, dailyBest, dropHistory, waitAdvice,
    alertStatus, shareText, strikeTruth, effectiveCost, obsCost,
    clearCache: () => { cache.clear(); btCache.clear(); }, compareToNaive, FINDINGS,
    backtest: backtestCached, backtestFresh: backtest, productAsOf, BACKTEST,
    detectCycle, promoEpisodes, cycleSoon, cycleText, CYCLE, stanceOf,
    calendarInfo, eventEffects, eventSoon, calendarText, CAL,
    discountCheck, discountText, discountAudit, DISCOUNT, DISCOUNT_STATUS,
    classifyDiscount, checkSeenPrice, marketPriceSeries, SEEN_STATUS, glance,
    normalizeCode, lookupCode, dataQuality, offerCoverage, QUALITY, QUALITY_TARGETS,
    costMode, offerView, unitPrice, compareAttrs, attrSummary, fmtAttr, attrSchema, fmtPrice, fmtPct, fmtAgo, fmtDate, median,
  };
})();
