/* =========================================================================
   The Hunter — application (routeur + vues)
   Routes : #/  #/recherche?q=&cat=&tri=  #/produit/:id  #/surveillance
            #/compte  #/methodologie  #/legal
   ========================================================================= */
(function () {
  const DS = window.HunterDataset;
  const DS_KEY = 'thehunter.dataset';
  // Rempli au démarrage (boot) selon le jeu choisi : démo ou échantillon réel
  let products = [], categories = [], sponsored = null;
  const H = window.Hunter;
  const S = window.Store;
  const $app = document.getElementById('app');

  /* ---------------- helpers ---------------- */
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const byId = (id) => products.find((p) => p.id === id);
  const catName = (id) => (categories.find((c) => c.id === id) || {}).name || '';
  const VERDICT_ORDER = { great: 0, fair: 1, insufficient: 2, bad: 3 };

  const ICONS = {
    laptop: '<path d="M10 14h44v28H10z" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linejoin="round"/><path d="M4 46h56l-4 5H8z" fill="currentColor" opacity=".85"/>',
    phone: '<rect x="20" y="6" width="24" height="52" rx="5" fill="none" stroke="currentColor" stroke-width="2.5"/><path d="M28 51h8" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/>',
    audio: '<path d="M12 40v-6a20 20 0 0 1 40 0v6" fill="none" stroke="currentColor" stroke-width="2.5"/><rect x="8" y="36" width="10" height="16" rx="3" fill="currentColor"/><rect x="46" y="36" width="10" height="16" rx="3" fill="currentColor"/>',
    screen: '<rect x="6" y="10" width="52" height="34" rx="3" fill="none" stroke="currentColor" stroke-width="2.5"/><path d="M26 52h12M32 44v8" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/>',
    storage: '<rect x="6" y="22" width="52" height="20" rx="3" fill="none" stroke="currentColor" stroke-width="2.5"/><path d="M14 32h20" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/><circle cx="48" cy="32" r="3" fill="currentColor"/>',
  };
  const productArt = (p, size = 'md') =>
    `<div class="art art-${size} art-${p.category}" aria-hidden="true"><svg viewBox="0 0 64 64">${ICONS[p.icon]}</svg></div>`;

  const verdictBadge = (v, size = '') =>
    `<span class="verdict verdict-${v.key} ${size}"><span class="dot"></span>${esc(v.label)}</span>`;

  function toast(msg) {
    const t = document.createElement('div');
    t.className = 'toast';
    t.textContent = msg;
    document.body.appendChild(t);
    requestAnimationFrame(() => t.classList.add('show'));
    setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, 2600);
  }

  function parseRoute() {
    const hash = location.hash.replace(/^#/, '') || '/';
    const [path, qs] = hash.split('?');
    const params = new URLSearchParams(qs || '');
    const parts = path.split('/').filter(Boolean);
    return { parts, params };
  }

  function searchBox(value = '', big = false) {
    return `
      <form class="search ${big ? 'search-big' : ''}" data-search role="search">
        <label class="sr-only" for="q${big ? 'b' : 's'}">Rechercher un produit</label>
        <svg class="search-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" stroke-width="2"/><path d="m20 20-4-4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
        <input id="q${big ? 'b' : 's'}" name="q" type="search" autocomplete="off" value="${esc(value)}"
          placeholder="Nom du produit, référence fabricant ou code EAN" />
        <button type="submit" class="btn btn-primary">Analyser</button>
      </form>`;
  }

  /* ---------------- v0.5 : livraison, prix unitaire, mode de réception ---------------- */
  function shipLabel(o, cap = false) {
    const t = o.pickupApplied ? 'retrait en magasin'
      : o.shipping == null ? 'hors livraison'
        : o.shipping === 0 ? 'livraison offerte' : 'livraison incluse';
    return cap ? t.charAt(0).toUpperCase() + t.slice(1) : t;
  }
  function unitHTML(p, cost, cls = 'muted xsmall') {
    const u = H.unitPrice(p, cost);
    return u ? `<span class="unit-price ${cls}">${H.fmtPrice(u.value)} ${esc(u.label.replace('€ ', ''))}</span>` : '';
  }
  function costModeToggle() {
    const m = H.costMode();
    return `<span class="seg seg-sm cost-mode" role="group" aria-label="Mode de réception">
      <button type="button" data-cost-mode="domicile" class="${m === 'domicile' ? 'on' : ''}" aria-pressed="${m === 'domicile'}">Livraison</button>
      <button type="button" data-cost-mode="retrait" class="${m === 'retrait' ? 'on' : ''}" aria-pressed="${m === 'retrait'}">Retrait magasin</button>
    </span>`;
  }

  /* ---------------- cartes ---------------- */
  function productCard(p, opts = {}) {
    const a = H.assess(p);
    return `
      <a class="card product-card ${opts.sponsored ? 'is-sponsored' : ''}" href="#/produit/${p.id}">
        ${opts.sponsored ? `<span class="sponsor-tag">Sponsorisé · ${esc(sponsored.by)}</span>` : ''}
        ${productArt(p)}
        <div class="pc-body">
          <div class="pc-cat">${esc(catName(p.category))}</div>
          <h3 class="pc-title">${esc(p.name)}</h3>
          <div class="pc-variant">${esc(p.variant)}</div>
          ${verdictBadge(a.verdict, 'sm')}
        </div>
        <div class="pc-price">
          <div class="price">${H.fmtPrice(a.bestCost)}</div>
          <div class="muted small">${shipLabel(a.best)} · ${esc(a.best.merchant.name)}</div>
          ${unitHTML(p, a.bestCost)}
          <div class="small fresh-line ${a.ageHours > H.RULES.staleHours ? 'stale' : ''}"><span class="fdot"></span>${p.offers.length} offre${p.offers.length > 1 ? 's' : ''} · vérifié ${H.fmtAgo(a.lastCollect)}</div>
        </div>
      </a>`;
  }

  /* ---------------- vues ---------------- */
  function viewHome() {
    const featured = [...products]
      .map((p) => ({ p, a: H.assess(p) }))
      .sort((x, y) => VERDICT_ORDER[x.a.verdict.key] - VERDICT_ORDER[y.a.verdict.key] || x.a.ratio - y.a.ratio)
      .slice(0, 4);

    return `
      ${(() => {
        const C = window.HunterCalendar;
        if (!C || window.HunterData.useCalendar === false) return '';
        const u = C.nextEvent(window.HunterData.NOW, 14);
        if (!u) return '';
        const end = C.fmtDay(new Date(u.event.end.getTime() - 1));
        return `<div class="event-banner"><div class="wrap"><strong>${esc(u.event.name)} ${u.ongoing ? `en cours, jusqu’au ${end}` : `dans ${u.startsInDays} jour${u.startsInDays > 1 ? 's' : ''}`}.</strong> <span>Les remises affichées ne sont pas toutes réelles : The Hunter compare chaque prix à son historique.</span> <a href="#/verificateur">Vérifier les remises →</a></div></div>`;
      })()}
      <section class="hero">
        <div class="wrap">
          <p class="eyebrow">Assistant de chasse aux bonnes affaires</p>
          <h1>Trouvez les achats qui valent <em>vraiment</em> le coup — et sachez pourquoi.</h1>
          <p class="lead">The Hunter compare l’historique, le coût total et les offres des marchands pour vous dire si une promo est une vraie baisse, un prix habituel ou une remise marketing.</p>
          ${searchBox('', true)}
          <p class="small hero-hint"><a href="#/scan">Scanner un code-barres</a> · <a href="#/verifier">Un prix vu en magasin ? Vérifiez la remise →</a></p>
          ${products.length ? `<p class="muted small hero-hint">Essayez : ${products.slice(0, 2).map((p) => `<a href="#/recherche?q=${encodeURIComponent(p.name)}">${esc(p.name)}</a>`).join(' · ')}${products.find((p) => p.ean) ? ` · <a href="#/recherche?q=${products.find((p) => p.ean).ean}">${products.find((p) => p.ean).ean}</a>` : ''}</p>` : ''}
        </div>
      </section>

      <section class="wrap section">
        <div class="section-head">
          <h2>Offres analysées aujourd’hui</h2>
          <a href="#/recherche" class="link">Tout voir →</a>
        </div>
        <div class="grid-cards">${featured.map(({ p }) => productCard(p)).join('')}</div>
      </section>

      <section class="wrap section">
        <h2>Les cinq questions posées à chaque offre</h2>
        <ol class="questions">
          <li><strong>Historique</strong><span>Est-ce un bon prix par rapport aux 30, 90 et 180 derniers jours ?</span></li>
          <li><strong>Comparaison</strong><span>Est-ce vraiment moins cher que chez les autres marchands suivis ?</span></li>
          <li><strong>Coût total</strong><span>Combien ça coûte, livraison et frais obligatoires compris ?</span></li>
          <li><strong>Confiance</strong><span>Le vendeur et l’offre présentent-ils des signaux suffisants ?</span></li>
          <li><strong>Votre besoin</strong><span>Le prix atteint-il le seuil que vous vous êtes fixé ?</span></li>
        </ol>
      </section>

      <section class="wrap section">
        <h2>Catégories de test</h2>
        <div class="cats">
          ${categories.map((c) => `
            <a class="cat" href="#/recherche?cat=${c.id}">
              <svg viewBox="0 0 64 64" aria-hidden="true">${ICONS[c.icon]}</svg>
              <span>${esc(c.name)}</span>
              <span class="muted small">${products.filter((p) => p.category === c.id).length} produits</span>
            </a>`).join('')}
        </div>
      </section>

      <section class="wrap section">
        <div class="trust-band">
          <div>
            <h2>Transparent par conception</h2>
            <p>Chaque verdict affiche ses critères, son niveau de confiance et la date de dernière collecte. Les liens commerciaux sont signalés, et la rémunération ne modifie jamais le verdict ni l’ordre des offres.</p>
          </div>
          <a class="btn btn-ghost" href="#/methodologie">Lire la méthode</a>
        </div>
      </section>`;
  }

  function viewSearch(params) {
    const q = (params.get('q') || '').trim();
    const cat = params.get('cat') || '';
    const sort = params.get('tri') || 'verdict';

    if (/^https?:\/\//i.test(q)) {
      return `
        <section class="wrap section">
          ${searchBox(q)}
          <div class="notice">
            <h2>Analyse d’URL : bientôt</h2>
            <p>Coller le lien d’une offre n’est pas encore pris en charge dans ce prototype. Recherchez le produit par son nom, sa référence fabricant ou son code EAN.</p>
          </div>
        </section>`;
    }

    const norm = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    const terms = norm(q).split(/\s+/).filter(Boolean);
    let list = products.filter((p) => {
      if (cat && p.category !== cat) return false;
      if (!terms.length) return true;
      const hay = norm([p.name, p.brand, p.variant, p.mpn, p.ean, catName(p.category)].join(' '));
      return terms.every((t) => hay.includes(t));
    });

    const withA = list.map((p) => ({ p, a: H.assess(p) }));
    const sorters = {
      verdict: (x, y) => VERDICT_ORDER[x.a.verdict.key] - VERDICT_ORDER[y.a.verdict.key] || (x.a.ratio || 9) - (y.a.ratio || 9),
      prix: (x, y) => x.a.bestCost - y.a.bestCost,
      maj: (x, y) => y.a.lastCollect - x.a.lastCollect,
    };
    withA.sort(sorters[sort] || sorters.verdict);

    const sp = sponsored ? byId(sponsored.productId) : null;
    // Emplacement sponsorisé : seulement en navigation (pas sur une recherche précise)
    const showSponsored = !!sp && !q && (!cat || cat === sp.category);

    const qp = (k, v) => {
      const p = new URLSearchParams(params);
      if (v) p.set(k, v); else p.delete(k);
      return '#/recherche?' + p.toString();
    };

    return `
      <section class="wrap section">
        ${searchBox(q)}
        <div class="filters">
          <div class="chips" role="group" aria-label="Catégorie">
            <a class="chip ${!cat ? 'on' : ''}" href="${qp('cat', '')}">Toutes</a>
            ${categories.map((c) => `<a class="chip ${cat === c.id ? 'on' : ''}" href="${qp('cat', c.id)}">${esc(c.name)}</a>`).join('')}
          </div>
          ${costModeToggle()}
          <label class="sort">Trier par
            <select data-sort>
              <option value="verdict" ${sort === 'verdict' ? 'selected' : ''}>Meilleur verdict</option>
              <option value="prix" ${sort === 'prix' ? 'selected' : ''}>Coût le plus bas</option>
              <option value="maj" ${sort === 'maj' ? 'selected' : ''}>Mise à jour récente</option>
            </select>
          </label>
        </div>
        <p class="muted small results-count">${withA.length} résultat${withA.length > 1 ? 's' : ''}${q ? ` pour « ${esc(q)} »` : ''}</p>

        ${showSponsored ? `
          <div class="sponsored-slot">
            ${productCard(sp, { sponsored: true })}
            <p class="muted xsmall">Emplacement payé par un marchand. Il n’influence ni le verdict ni le classement des résultats ci-dessous.</p>
          </div>` : ''}

        ${withA.length ? `<div class="list">${withA.map(({ p }) => productCard(p)).join('')}</div>` : `
          <div class="empty">
            <h2>Aucun produit trouvé</h2>
            <p>Ce prototype couvre une petite sélection de produits (${products.length}). Essayez une marque, une référence ou un code EAN.</p>
          </div>`}
      </section>`;
  }

  /* Prix barré + depuis quand il n'a plus été pratiqué (idée « vérité de la promo ») */
  function strikeHTML(o) {
    if (!o.strikePrice) return '';
    const t = H.strikeTruth(o);
    const truth = t.seen
      ? (t.lastDaysAgo <= 1 ? 'pratiqué récemment' : `pratiqué il y a ${t.lastDaysAgo} j`)
      : `jamais pratiqué en ${t.windowDays} j`;
    return `<span class="strike"><s class="muted xsmall">${H.fmtPrice(o.strikePrice)}</s><span class="strike-truth ${t.seen ? '' : 'never'} xsmall" title="Dernière fois que ce marchand a vendu à ce prix (tolérance 2 %)">${truth}</span></span>`;
  }

  /* ---------------- graphique d'historique ---------------- */
  function chartSVG(a, days, target) {
    const pts = a.series.filter((p) => p.daysAgo < days).sort((x, y) => y.daysAgo - x.daysAgo);
    if (pts.length < 2) return '<p class="muted">Pas assez de points pour tracer un historique.</p>';
    const W = 640, Hh = 220, L = 52, R = 14, T = 14, B = 28;
    const vals = pts.map((p) => p.value);
    const med = H.median(vals);
    let lo = Math.min(...vals, target || Infinity, med), hi = Math.max(...vals, target || -Infinity, med);
    const pad = (hi - lo) * 0.12 || hi * 0.05;
    lo -= pad; hi += pad;
    const maxAgo = pts[0].daysAgo;
    const x = (ago) => L + (W - L - R) * (1 - ago / Math.max(1, maxAgo));
    const y = (v) => T + (Hh - T - B) * (1 - (v - lo) / (hi - lo));
    const path = pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.daysAgo).toFixed(1)},${y(p.value).toFixed(1)}`).join('');
    const area = `${path}L${x(0).toFixed(1)},${Hh - B}L${x(maxAgo).toFixed(1)},${Hh - B}Z`;
    const ticks = 4;
    const yt = Array.from({ length: ticks }, (_, i) => lo + ((hi - lo) * (i + 0.5)) / ticks);
    const xt = [maxAgo, Math.round(maxAgo / 2), 0];
    const last = pts[pts.length - 1];
    const dateOf = (ago) => new Date(window.HunterData.NOW - ago * window.HunterData.DAY).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });

    return `
      <svg class="chart" viewBox="0 0 ${W} ${Hh}" role="img" aria-label="Historique du meilleur coût sur ${days} jours" data-chart='${JSON.stringify({ L, R, W, maxAgo })}'>
        ${yt.map((v) => `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" class="grid"/><text x="${L - 8}" y="${y(v) + 4}" class="axis" text-anchor="end">${Math.round(v)} €</text>`).join('')}
        ${xt.map((ago) => `<text x="${x(ago)}" y="${Hh - 8}" class="axis" text-anchor="${ago === 0 ? 'end' : ago === maxAgo ? 'start' : 'middle'}">${ago === 0 ? 'Aujourd’hui' : dateOf(ago)}</text>`).join('')}
        ${a.cycle ? H.promoEpisodes(a.series).episodes.filter((e) => e.end < days).map((e) => {
          const x1 = x(Math.min(e.start, maxAgo)), x2 = x(e.end);
          return `<rect x="${Math.min(x1, x2).toFixed(1)}" y="${T}" width="${Math.max(3, Math.abs(x2 - x1)).toFixed(1)}" height="${Hh - T - B}" class="promo-band"><title>Promotion</title></rect>`;
        }).join('') : ''}
        ${(window.HunterData.useCalendar === false || !window.HunterCalendar) ? '' : window.HunterCalendar.eventsBetween(window.HunterData.NOW - maxAgo * window.HunterData.DAY, window.HunterData.NOW).map((e) => {
          const a0 = Math.min(maxAgo, (window.HunterData.NOW - e.start.getTime()) / window.HunterData.DAY);
          const a1 = Math.max(0, (window.HunterData.NOW - e.end.getTime()) / window.HunterData.DAY);
          const x1 = x(a0), x2 = x(a1);
          return `<rect x="${x1.toFixed(1)}" y="${T}" width="${Math.max(2, x2 - x1).toFixed(1)}" height="${Hh - T - B}" class="event-band"><title>${esc(e.name)}</title></rect><text x="${(x1 + 4).toFixed(1)}" y="${T + 11}" class="event-label">${esc(e.id === 'black-friday' ? 'Black Friday' : e.name)}</text>`;
        }).join('')}
        <path d="${area}" class="area"/>
        <line x1="${L}" x2="${W - R}" y1="${y(med)}" y2="${y(med)}" class="median"/>
        <text x="${W - R}" y="${y(med) - 6}" class="label" text-anchor="end">Médiane ${H.fmtPrice(med)}</text>
        ${target ? `<line x1="${L}" x2="${W - R}" y1="${y(target)}" y2="${y(target)}" class="target"/><text x="${L + 6}" y="${y(target) - 6}" class="label label-target">Votre seuil ${H.fmtPrice(target)}</text>` : ''}
        <path d="${path}" class="line"/>
        <circle cx="${x(last.daysAgo)}" cy="${y(last.value)}" r="5" class="now"/>
        <g class="hover" style="display:none"><line class="hover-line" y1="${T}" y2="${Hh - B}"/><circle r="4" class="hover-dot"/></g>
        <rect x="${L}" y="${T}" width="${W - L - R}" height="${Hh - T - B}" fill="transparent" class="hit"/>
      </svg>
      <div class="chart-tip" hidden></div>
      <script type="application/json" class="chart-data">${JSON.stringify(pts.map((p) => [p.daysAgo, p.value, x(p.daysAgo), y(p.value)]))}</script>`;
  }

  function bindChart(root) {
    root.querySelectorAll('.chart').forEach((svg) => {
      const holder = svg.parentElement;
      const data = JSON.parse(holder.querySelector('.chart-data').textContent);
      const tip = holder.querySelector('.chart-tip');
      const g = svg.querySelector('.hover');
      const hit = svg.querySelector('.hit');
      const move = (ev) => {
        const r = svg.getBoundingClientRect();
        const cx = ((ev.touches ? ev.touches[0].clientX : ev.clientX) - r.left) * (640 / r.width);
        let best = data[0];
        data.forEach((d) => { if (Math.abs(d[2] - cx) < Math.abs(best[2] - cx)) best = d; });
        g.style.display = '';
        g.querySelector('.hover-line').setAttribute('x1', best[2]);
        g.querySelector('.hover-line').setAttribute('x2', best[2]);
        g.querySelector('.hover-dot').setAttribute('cx', best[2]);
        g.querySelector('.hover-dot').setAttribute('cy', best[3]);
        const d = new Date(window.HunterData.NOW - best[0] * window.HunterData.DAY);
        tip.hidden = false;
        tip.innerHTML = `<strong>${H.fmtPrice(best[1])}</strong><span>${d.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' })}</span>`;
        const px = (best[2] / 640) * r.width;
        tip.style.left = Math.min(Math.max(px, 50), r.width - 50) + 'px';
      };
      hit.addEventListener('mousemove', move);
      hit.addEventListener('touchmove', move, { passive: true });
      hit.addEventListener('mouseleave', () => { g.style.display = 'none'; tip.hidden = true; });
    });
  }

  function viewProduct(id, params) {
    const p = byId(id);
    if (!p) return viewNotFound();
    const a = H.assess(p);
    const days = [30, 90, 180].includes(+params.get('p')) ? +params.get('p') : 90;
    const w = S.getWatch(p.id);
    const suggestedTarget = a.greatThreshold || Math.floor(a.bestCost * 0.9);
    const advice = H.waitAdvice(a);

    const reasonIcon = { plus: '＋', minus: '−', neutral: '•', info: 'i' };

    return `
      <nav class="wrap crumbs" aria-label="Fil d’Ariane">
        <a href="#/">Accueil</a> / <a href="#/recherche?cat=${p.category}">${esc(catName(p.category))}</a> / <span>${esc(p.name)}</span>
      </nav>

      <section class="wrap product-head">
        ${productArt(p, 'lg')}
        <div>
          <p class="eyebrow">${esc(p.brand)}</p>
          <h1>${esc(p.name)}</h1>
          <p class="lead">${esc(p.variant)}</p>
          <p class="ids muted small">Réf. fabricant <code>${esc(p.mpn)}</code> · EAN <code>${esc(p.ean)}</code></p>
        </div>
        <div class="head-price">
          <div class="muted small">Meilleur coût connu</div>
          <div class="price price-xl">${H.fmtPrice(a.bestCost)}</div>
          <div class="muted small">${a.best.shipping == null ? 'Livraison inconnue' : shipLabel(a.best, true)} · ${esc(a.best.merchant.name)}</div>
          ${unitHTML(p, a.bestCost, 'small')}
          <a class="btn btn-ghost btn-sm glance-link" href="#/oeil/${p.id}">Coup d’œil</a>
          <div class="freshness ${a.ageHours > H.RULES.staleHours ? 'stale' : ''}">
            <span class="pulse"></span> Vérifié ${H.fmtAgo(a.lastCollect)} <span class="muted">(${H.fmtDate(a.lastCollect)})</span>
          </div>
        </div>
      </section>

      <section class="wrap analysis verdict-panel-${a.verdict.key}">
        <div class="analysis-main">
          <p class="eyebrow">Analyse The Hunter</p>
          <div class="verdict-row">
            ${verdictBadge(a.verdict, 'lg')}
            <span class="confidence conf-${a.confidencePoints}" title="Calculé sur l’historique, le nombre de marchands, la fraîcheur et le coût total">
              Confiance <strong>${a.confidence}</strong>
              <span class="bars">${[1, 2, 3, 4].map((i) => `<i class="${i <= a.confidencePoints ? 'on' : ''}"></i>`).join('')}</span>
            </span>
          </div>
          <h2 class="sr-only">Pourquoi ce verdict</h2>
          <ul class="reasons">
            ${a.reasons.map((r) => `<li class="r-${r.kind}"><span class="ri" aria-hidden="true">${reasonIcon[r.kind]}</span><span>${esc(r.text)}</span></li>`).join('')}
          </ul>
          ${advice ? `
          <div class="advice advice-${advice.kind}">
            <h3>${esc(advice.title)}</h3>
            ${advice.lines.map((l) => `<p>${esc(l)}</p>`).join('')}
            ${advice.kind === 'wait' ? `<button class="btn btn-ghost btn-sm" type="button" data-use-target="${a.greatThreshold}">Utiliser ${H.fmtPrice(a.greatThreshold)} comme prix cible</button>` : ''}
            <p class="muted xsmall">Ce sont des faits observés, pas une prévision.</p>
          </div>` : ''}
          <div class="share-row">
            <button class="btn btn-ghost btn-sm" type="button" data-share="${p.id}">
              <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M12 3v12M7 8l5-5 5 5M5 14v5h14v-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
              Partager ce verdict
            </button>
            <span class="muted xsmall">Résumé court avec la date de vérification.</span>
          </div>
          <details class="limits">
            <summary>Limites de cette analyse (${a.limits.length})</summary>
            <ul>${a.limits.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>
          </details>
        </div>

        <aside class="watch-box">
          <h3>${w ? 'Produit surveillé' : 'Attendre le bon prix'}</h3>
          <p class="muted small">${w ? 'Vous serez alerté quand le coût total passera sous votre seuil.' : 'Fixez un prix cible : on vous prévient quand une offre l’atteint.'}</p>
          <form data-watch="${p.id}">
            <label for="target">Prix cible</label>
            <div class="input-euro">
              <input id="target" name="targetPrice" type="number" min="1" step="1" inputmode="numeric" value="${w ? w.target : suggestedTarget}" required />
              <span>€</span>
            </div>
            <p class="muted xsmall">${a.greatThreshold ? `Suggestion : seuil de vraie affaire, 10 % sous le prix habituel (${H.fmtPrice(a.baseline)}).` : 'Historique insuffisant pour suggérer un seuil.'}</p>
            <button class="btn btn-primary btn-block" type="submit">${w ? 'Mettre à jour le seuil' : 'Surveiller ce produit'}</button>
            ${w ? `<button class="btn btn-ghost btn-block" type="button" data-unwatch="${p.id}">Ne plus surveiller</button>` : ''}
          </form>
        </aside>
      </section>

      <section class="wrap section">
        <div class="section-head">
          <h2>Historique du meilleur coût</h2>
          <div class="seg" role="group" aria-label="Période">
            ${[30, 90, 180].map((d) => `<a class="${d === days ? 'on' : ''}" href="#/produit/${p.id}?p=${d}">${d} j</a>`).join('')}
          </div>
        </div>
        ${a.historyDays < H.RULES.minHistoryDays ? `<p class="notice small">Historique de ${a.historyDays} jours seulement : le graphique est indicatif.</p>` : ''}
        <div class="chart-wrap">${chartSVG(a, days, w ? w.target : null)}</div>
        ${a.cycle ? `<p class="cycle-note small"><span class="promo-swatch" aria-hidden="true"></span>${esc(H.cycleText(a.cycle))}</p>` : ''}
        ${H.calendarText(a.calendar) ? `<p class="cycle-note small"><span class="event-swatch" aria-hidden="true"></span>${esc(H.calendarText(a.calendar))}</p>` : ''}
        ${a.stats.w30 ? `
        <div class="stats">
          ${[['30 jours', a.stats.w30], ['90 jours', a.stats.w90], ['180 jours', a.stats.w180]].filter(([, s]) => s).map(([l, s]) => `
            <div><span class="muted small">${l}</span><strong>${H.fmtPrice(s.median)}</strong><span class="muted xsmall">médiane · min ${H.fmtPrice(s.min)}</span></div>`).join('')}
        </div>` : ''}
      </section>

      ${journalSection(p)}

      <section class="wrap section">
        <div class="section-head">
          <h2>Offres des marchands suivis</h2>
          <a class="link small" href="#/verifier?p=${p.id}">Vérifier un prix vu ailleurs →</a>
          <div class="offers-tools">${costModeToggle()}<span class="muted small">Triées par coût total, jamais par commission</span></div>
        </div>
        <div class="offers">
          <div class="offer offer-head" aria-hidden="true">
            <span>Marchand</span><span>Prix</span><span>Livraison</span><span>Coût total</span><span>Disponibilité</span><span></span>
          </div>
          ${a.offers.map((o, i) => `
            <div class="offer ${i === 0 ? 'is-best' : ''}">
              <div class="o-merchant">
                <strong>${esc(o.merchant.name)}</strong>${i === 0 ? '<span class="best-tag">Meilleur coût</span>' : ''}
                <span class="muted xsmall">${esc(o.merchant.kind)}</span>
                <span class="signals">
                  ${o.merchant.signals.identified === true ? '<span class="sig ok">Société identifiée</span>' : o.merchant.signals.identified === false ? '<span class="sig warn">Identité non vérifiée</span>' : '<span class="sig">Identité non renseignée</span>'}
                  ${o.merchant.signals.marketplace ? '<span class="sig warn">Place de marché</span>' : ''}
                  ${o.merchant.signals.returns ? `<span class="sig">Retour ${esc(o.merchant.signals.returns)}</span>` : ''}
                  ${o.merchant.signals.since ? `<span class="sig">Depuis ${esc(o.merchant.signals.since)}</span>` : ''}
                </span>
              </div>
              <div class="o-price" data-label="Prix">${H.fmtPrice(o.price)}${strikeHTML(o)}</div>
              <div data-label="Livraison">${o.pickupApplied ? '<span class="pickup-ok">Retrait gratuit</span>' : o.shipping == null ? '<span class="warn-text">Inconnue</span>' : o.shipping === 0 ? 'Offerte' : H.fmtPrice(o.shipping)}${o.pickup && !o.pickupApplied ? '<span class="muted xsmall">Retrait gratuit possible</span>' : ''}</div>
              <div class="o-total" data-label="Coût total"><strong>${o.total == null ? `${H.fmtPrice(o.price)} <span class="warn-text xsmall">+ livraison ?</span>` : H.fmtPrice(o.total)}</strong></div>
              <div data-label="Disponibilité">${esc(o.stock)}<span class="muted xsmall">${esc(o.delay)} · vu ${H.fmtAgo(o.collectedAt)}</span></div>
              <div class="o-cta">
                <button class="btn ${i === 0 ? 'btn-primary' : 'btn-ghost'} btn-sm" data-out="${o.id}">Voir l’offre</button>
                <span class="muted xsmall">${o.affiliate ? 'Lien partenaire' : 'Lien direct'}</span>
                ${S.isReported(o.id)
                  ? '<span class="reported xsmall">Signalé, merci</span>'
                  : `<button class="link-btn xsmall" type="button" data-report="${o.id}">Ce prix est faux ?</button>`}
              </div>
            </div>`).join('')}
        </div>
        <p class="muted xsmall">Source et méthode : ${[...new Set(a.offers.map((o) => o.source))].join(', ')}. Les prix et stocks peuvent changer à tout moment chez le marchand.</p>
      </section>

      ${similarSection(p, a)}

      <section class="wrap section two-col">
        <div>
          <h2>Caractéristiques</h2>
          ${(() => {
            const rows = H.attrSchema(p.category).attrs.filter((d) => p.attrs && p.attrs[d.key] != null);
            return rows.length ? `<dl class="kv attrs">${rows.map((d) => `<dt>${esc(d.label)}</dt><dd>${esc(H.fmtAttr(d, p.attrs[d.key]))}</dd>`).join('')}</dl>` : '';
          })()}
          ${p.specs.length ? `<ul class="specs">${p.specs.map((s) => `<li>${esc(s)}</li>`).join('')}</ul>` : ''}
        </div>
        <div>
          <h2>Identification du produit</h2>
          <p class="small">Les offres ne sont regroupées que lorsque la référence fabricant ou le code EAN correspondent. Deux produits ne sont jamais fusionnés sur la seule ressemblance de leur nom.</p>
          <dl class="kv"><dt>Marque</dt><dd>${esc(p.brand)}</dd><dt>Référence</dt><dd><code>${esc(p.mpn)}</code></dd><dt>EAN</dt><dd><code>${esc(p.ean)}</code></dd><dt>Catégorie</dt><dd>${esc(catName(p.category))}</dd></dl>
        </div>
      </section>`;
  }

  /* ---------------- v0.6 : journal des verdicts ---------------- */
  function journalSection(p) {
    const b = H.backtest(p);
    if (!b.entries.length) return '';
    const D = window.HunterData;
    const dateOf = (k) => new Date(D.NOW - k * D.DAY).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
    const rate = b.scored ? Math.round((b.right / b.scored) * 100) : null;
    const icon = { right: '✓', wrong: '✗' };
    return `
      <section class="wrap section">
        <div class="section-head">
          <h2>Journal des verdicts</h2>
          <span class="muted small">${b.scored ? `<strong class="journal-rate">${b.right} juste${b.right > 1 ? 's' : ''} sur ${b.scored}</strong> (${rate} %)` : 'Pas encore de verdict évaluable'}</span>
        </div>
        <p class="small muted">Tous les ${b.config.step} jours, nous rejouons le verdict avec les seules données disponibles à cette date, puis nous regardons ce qui s’est passé dans les ${b.config.horizon} jours suivants. Nos erreurs restent visibles.</p>
        <ol class="journal">
          ${b.entries.map((e) => `
            <li class="j-${e.outcome || 'none'}">
              <span class="j-date">${dateOf(e.daysAgo)}</span>
              <span class="j-verdict">${verdictBadge(e.verdict, 'sm')}${e.stanceLabel ? `<span class="j-stance">${esc(e.stanceLabel)}</span>` : ''}</span>
              <span class="j-cost mono">${H.fmtPrice(e.bestCost)}</span>
              <span class="j-out"><span class="j-icon" aria-hidden="true">${icon[e.outcome] || '–'}</span>${esc(e.text)}</span>
            </li>`).join('')}
        </ol>
        <p class="muted xsmall">Verdicts recalculés avec les règles actuelles, pas les verdicts affichés à l’époque. Une erreur est comptée si la recommandation (acheter, attendre, prix acceptable) a été démentie par un écart de plus de ${Math.round(b.config.tolerance * 100)} % (${Math.round(b.config.fairMiss * 100)} % pour « prix acceptable »).</p>
      </section>`;
  }

  /* ---------------- produits comparables (fiche produit) ---------------- */
  function similarSection(p, a) {
    const similar = products.filter((x) => x.category === p.category && x.id !== p.id);
    if (!similar.length) return '';
    const items = similar.map((x) => {
      const ax = H.assess(x);
      const diff = ax.bestCost - a.bestCost;
      return `
        <div class="similar-item">
          ${productArt(x, 'sm')}
          <div>
            <a href="#/produit/${x.id}"><strong>${esc(x.name)}</strong></a>
            <div class="muted xsmall">${esc(x.variant)}</div>
            ${verdictBadge(ax.verdict, 'sm')}
          </div>
          <div class="similar-price">
            <strong class="price">${H.fmtPrice(ax.bestCost)}</strong>
            <span class="xsmall ${diff < 0 ? 'cheaper' : 'pricier'}">${diff < 0 ? H.fmtPrice(-diff) + ' de moins' : H.fmtPrice(diff) + ' de plus'}</span>
          </div>
          <a class="btn btn-ghost btn-sm" href="#/comparer/${p.id}/${x.id}">Comparer</a>
        </div>`;
    }).join('');
    return `
      <section class="wrap section">
        <div class="section-head">
          <h2>Produits comparables</h2>
          <span class="muted small">Même catégorie · prix, verdict et caractéristiques</span>
        </div>
        <div class="similar">${items}</div>
      </section>`;
  }

  /* ---------------- comparateur de produits proches ---------------- */
  function viewCompare(aId, bId) {
    const pa = byId(aId);
    if (!pa) return viewNotFound();
    const candidates = products.filter((x) => x.category === pa.category && x.id !== pa.id);
    const pb = byId(bId) && bId !== aId ? byId(bId) : candidates[0];
    if (!pb) {
      return `<section class="wrap section narrow"><div class="empty"><h1>Rien à comparer</h1><p>Aucun autre produit suivi dans la catégorie « ${esc(catName(pa.category))} ».</p><a class="btn btn-primary" href="#/produit/${pa.id}">Retour à la fiche</a></div></section>`;
    }
    const A = H.assess(pa), B = H.assess(pb);
    const diff = A.bestCost - B.bestCost;
    const cheaper = diff <= 0 ? pa : pb, other = diff <= 0 ? pb : pa;
    const pct = Math.abs(diff) / Math.max(A.bestCost, B.bestCost);
    const vOrder = { great: 0, fair: 1, bad: 2, insufficient: 3 };

    let timing;
    if (A.verdict.key === 'insufficient' || B.verdict.key === 'insufficient') {
      timing = 'Pour l’un des deux produits, les données ne suffisent pas à juger le moment d’achat.';
    } else if (vOrder[A.verdict.key] === vOrder[B.verdict.key]) {
      timing = `Les deux produits ont le même verdict (« ${A.verdict.label} ») : le moment d’achat ne les départage pas.`;
    } else {
      const better = vOrder[A.verdict.key] < vOrder[B.verdict.key] ? [pa, A] : [pb, B];
      timing = `Côté moment d’achat, le ${better[0].name} est mieux placé (« ${better[1].verdict.label} »).`;
    }

    const col = (p, a) => ({
      head: `<a href="#/produit/${p.id}" class="cmp-head">${productArt(p, 'md')}<span><strong>${esc(p.name)}</strong><span class="muted xsmall">${esc(p.variant)}</span></span></a>`,
      verdict: verdictBadge(a.verdict, 'sm'),
      cost: `<strong class="price">${H.fmtPrice(a.bestCost)}</strong><span class="muted xsmall">${shipLabel(a.best)} · ${esc(a.best.merchant.name)}</span>`,
      unit: H.unitPrice(p, a.bestCost) ? `<span>${H.fmtPrice(H.unitPrice(p, a.bestCost).value)}</span>` : '<span class="muted">—</span>',
      usual: a.ratio ? `<span>${H.fmtPct(a.ratio - 1)}</span><span class="muted xsmall">vs ${H.fmtPrice(a.baseline)}</span>` : '<span class="muted">—</span>',
      threshold: a.greatThreshold ? H.fmtPrice(a.greatThreshold) : '<span class="muted">—</span>',
      confidence: a.confidence,
      merchants: String(p.offers.length),
      fresh: H.fmtAgo(a.lastCollect),
      specs: `<ul class="cmp-specs">${p.specs.map((x) => `<li>${esc(x)}</li>`).join('') || '<li class="muted">Non renseignées</li>'}</ul>`,
    });
    const ca = col(pa, A), cb = col(pb, B);
    const rows = [
      ['Verdict', 'verdict'], ['Meilleur coût', 'cost'], ['Écart au prix habituel', 'usual'],
      ['Seuil de vraie affaire', 'threshold'], ['Confiance', 'confidence'], ['Marchands suivis', 'merchants'],
      ['Vérifié', 'fresh'],
    ];
    const unitCfg = H.attrSchema(pa.category).unitPrice;
    if (unitCfg) rows.splice(2, 0, ['Prix ' + unitCfg.label, 'unit']);
    const attrRows = H.compareAttrs(pa, pb);
    const summary = H.attrSummary(pa, pb, A.bestCost, B.bestCost);
    const priceLine = Math.abs(diff) < 0.5
      ? 'Les deux produits coûtent le même prix aujourd’hui.'
      : `Le <strong>${esc(cheaper.name)}</strong> coûte <strong>${H.fmtPrice(Math.abs(diff))}</strong> de moins (−${Math.round(pct * 100)} %) que le ${esc(other.name)}.`;
    const picker = candidates.length > 1 ? `
        <label class="sort cmp-pick">Comparer ${esc(pa.name)} avec
          <select data-compare-select="${pa.id}">
            ${candidates.map((x) => `<option value="${x.id}" ${x.id === pb.id ? 'selected' : ''}>${esc(x.name)} — ${esc(x.variant)}</option>`).join('')}
          </select>
        </label>` : '';

    return `
      <nav class="wrap crumbs" aria-label="Fil d’Ariane">
        <a href="#/">Accueil</a> / <a href="#/produit/${pa.id}">${esc(pa.name)}</a> / <span>Comparer</span>
      </nav>
      <section class="wrap section">
        <p class="eyebrow">Comparateur</p>
        <h1>${esc(pa.name)} ou ${esc(pb.name)}&nbsp;?</h1>
        <div class="cmp-summary">
          <p>${priceLine}</p>
          ${summary ? `<p>${esc(summary)}</p>` : ''}
          <p>${esc(timing)}</p>
          <p class="muted small">Comparez les caractéristiques ci-dessous pour juger si l’écart de prix se justifie pour votre usage.</p>
        </div>
        <div class="cmp-tools">${picker}${costModeToggle()}</div>
        <div class="cmp">
          <div class="cmp-row cmp-top"><div></div><div>${ca.head}</div><div>${cb.head}</div></div>
          ${rows.map(([label, k]) => `<div class="cmp-row"><div class="cmp-label">${label}</div><div>${ca[k]}</div><div>${cb[k]}</div></div>`).join('')}
          ${attrRows.length ? `<div class="cmp-row cmp-section"><div class="cmp-label">Caractéristiques comparées</div></div>
          ${attrRows.map((x) => `<div class="cmp-row"><div class="cmp-label">${esc(x.def.label)}</div><div><span class="${x.winner === 'a' ? 'cmp-win' : ''}">${esc(x.aText)}</span></div><div><span class="${x.winner === 'b' ? 'cmp-win' : ''}">${esc(x.bText)}</span></div></div>`).join('')}` : ''}
          ${pa.specs.length || pb.specs.length ? `<div class="cmp-row"><div class="cmp-label">Autres informations</div><div>${ca.specs}</div><div>${cb.specs}</div></div>` : ''}
        </div>
        <p class="muted xsmall">Chaque produit est comparé sur sa meilleure offre connue, livraison comprise quand elle est connue.</p>
      </section>`;
  }

  /* ---------------- v0.15 : qualité des données ---------------- */
  function viewQuality() {
    const q = H.dataQuality(products);
    const meta = window.HunterData.meta || {};
    const pct = (v) => (v == null ? '—' : Math.round(v * 100) + ' %');
    const age = (h) => (h < 48 ? `${Math.round(h)} h` : `${Math.round(h / 24)} j`);
    const T = H.QUALITY_TARGETS;
    const target = { shipping: `objectif ${pct(T.shipping)}`, fresh: `objectif ${pct(T.fresh)}`, age: `objectif ≤ ${T.age} h`, coverage: `objectif ${pct(T.coverage)}`, comparable: `objectif ${pct(T.comparable)}`, history: `objectif ${pct(T.history)}` };
    const warn = q.issues.filter((i) => i.level === 'warn');
    const info = q.issues.filter((i) => i.level === 'info');
    const issue = (i) => `<li class="q-${i.level}"><a href="#/produit/${i.productId}">${esc(i.text)}</a></li>`;
    return `
      <section class="wrap section">
        <p class="eyebrow">Interne · cadrage §12</p>
        <h1>Qualité des données</h1>
        <p class="lead">Un verdict ne vaut que ce que valent les relevés. Cette page montre si les prix sont complets, récents et réguliers, source par source.</p>
        ${meta.kind === 'demo' ? '<p class="notice small"><strong>Démonstration :</strong> relevés générés, donc presque parfaits. Les vrais flux feront apparaître des trous, des livraisons inconnues et des retards.</p>' : `<p class="muted small">Jeu analysé : « ${esc(meta.name || '')} ».</p>`}

        <div class="lab-tiles q-tiles">
          ${q.indicators.map((i) => `
            <div class="lab-tile q-tile ${i.ok ? 'q-ok' : 'q-ko'}" title="${esc(i.help)}">
              <strong>${esc(i.display)}</strong>
              <span>${esc(i.label)}</span>
              <span class="muted xsmall">${i.ok ? '✓' : '✗'} ${esc(target[i.key])}</span>
            </div>`).join('')}
        </div>
        <p class="muted xsmall">${q.totals.products} produits · ${q.totals.offers} offres · ${q.totals.observations.toLocaleString('fr-FR')} relevés. Non mesurés pour l’instant : ${q.notMeasured.map(esc).join(' ')}</p>

        <h2 class="q-h2">Par marchand</h2>
        <div class="q-table" role="table" aria-label="Qualité par marchand">
          <div class="q-row q-head" role="row"><span role="columnheader">Marchand</span><span role="columnheader">Offres</span><span role="columnheader">Coût total connu</span><span role="columnheader">Dernier relevé</span><span role="columnheader">Régularité</span><span role="columnheader">Prix barrés douteux</span></div>
          ${q.merchants.map((m) => `
            <div class="q-row" role="row">
              <strong role="cell">${esc(m.name)}</strong>
              <span role="cell" data-l="Offres">${m.offers}</span>
              <span role="cell" data-l="Coût total connu" class="${m.shipping < T.shipping ? 'q-bad' : ''}">${pct(m.shipping)}</span>
              <span role="cell" data-l="Dernier relevé" class="${m.lastAgeHours > H.RULES.staleHours ? 'q-bad' : ''}">il y a ${age(m.lastAgeHours)}</span>
              <span role="cell" data-l="Régularité" class="${m.coverage < T.coverage ? 'q-bad' : ''}">${pct(m.coverage)}</span>
              <span role="cell" data-l="Prix barrés douteux" class="${m.doubtful ? 'q-bad' : ''}">${m.strikes ? `${m.doubtful} sur ${m.strikes}` : 'aucun prix barré'}</span>
            </div>`).join('')}
        </div>

        <h2 class="q-h2">Points à corriger (${q.issues.length})</h2>
        ${q.issues.length ? `<ul class="q-issues">${warn.map(issue).join('')}${info.map(issue).join('')}</ul>` : '<p class="muted">Aucun point à corriger.</p>'}

        <h2 class="q-h2">Dernière collecte</h2>
        <div id="collecte-box"><p class="muted small">Chargement…</p></div>
      </section>`;
  }

  async function loadCollecte() {
    const box = document.getElementById('collecte-box');
    if (!box) return;
    let c = null;
    try {
      const res = await fetch('data/collecte.json', { cache: 'no-store' });
      if (res.ok) c = await res.json();
    } catch (e) { /* hors ligne ou absent */ }
    if (!document.body.contains(box)) return;
    if (!c) {
      box.innerHTML = '<p class="muted small">Aucune collecte enregistrée. Déclarez vos sources dans <code>data/sources.json</code>, puis lancez <code>npm run collecte</code> (voir <code>data/GUIDE_FLUX.md</code>).</p>';
      return;
    }
    const when = new Date(c.at).toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' });
    box.innerHTML = `
      <p class="small">Le ${esc(when)} · ${c.sources.length} source${c.sources.length > 1 ? 's' : ''}${c.errors ? ` · <strong class="warn-text">${c.errors} erreur${c.errors > 1 ? 's' : ''}</strong>` : ''}</p>
      ${c.alerts && c.alerts.length ? `<ul class="q-issues">${c.alerts.map((a) => `<li class="q-warn">${esc(a)}</li>`).join('')}</ul>` : '<p class="small">Aucune alerte.</p>'}
      <div class="q-table">
        <div class="q-row q-head q-row5"><span>Source</span><span>Fichiers importés</span><span>Lignes retenues</span><span>Rejets</span><span>Dernier import</span></div>
        ${c.sources.map((s) => `
          <div class="q-row q-row5">
            <strong>${esc(s.name)}</strong>
            <span data-l="Fichiers importés">${s.imported}${s.duplicates ? ` (+${s.duplicates} déjà connus)` : ''}</span>
            <span data-l="Lignes retenues">${s.kept} / ${s.rows}</span>
            <span data-l="Rejets" class="${s.rows && s.rejected / s.rows > 0.2 ? 'q-bad' : ''}">${s.rows ? Math.round((s.rejected / s.rows) * 100) + ' %' : '—'}</span>
            <span data-l="Dernier import">${s.lastImport ? H.fmtAgo(Date.parse(s.lastImport)) : 'jamais'}</span>
          </div>`).join('')}
      </div>`;
  }

  /* ---------------- v0.13 : scanner un code-barres ---------------- */
  let scanStream = null;
  let scanTimer = null;
  let scanLast = '';
  const scanSupported = () => 'BarcodeDetector' in window && !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia) && window.isSecureContext;

  function stopScan() {
    if (scanTimer) { clearInterval(scanTimer); scanTimer = null; }
    if (scanStream) { scanStream.getTracks().forEach((t) => t.stop()); scanStream = null; }
    scanLast = '';
  }

  function scanTarget(then, p) {
    return then === 'verifier' ? `#/verifier?p=${p.id}` : `#/oeil/${p.id}`;
  }

  function showScanResult(html) {
    const box = document.getElementById('scan-result');
    if (box) box.innerHTML = html;
  }

  /* Traite un code lu par la caméra ou saisi ; renvoie true si un produit est trouvé */
  function handleCode(raw, then, source) {
    const r = H.lookupCode(products, raw);
    if (r.status === 'found') {
      stopScan();
      toast(`${source === 'camera' ? 'Code lu' : 'Code'} ${r.code} : ${r.product.name}`);
      location.hash = scanTarget(then, r.product);
      return true;
    }
    if (source === 'camera' && r.code === scanLast) return false; // évite de répéter le même message
    scanLast = r.code || '';
    if (r.status === 'invalid') {
      showScanResult(`<div class="notice small"><strong>Code ${esc(r.code)} illisible</strong> : ${esc(r.reason)}. ${source === 'camera' ? 'Rapprochez le code ou améliorez l’éclairage.' : 'Vérifiez les chiffres sous le code-barres.'}</div>`);
    } else if (r.status === 'unknown') {
      showScanResult(`<div class="notice small"><strong>Produit non suivi</strong> (code ${esc(r.code)}). The Hunter ne suit que ${products.length} produits pour l’instant. <a href="#/recherche">Chercher par nom →</a></div>`);
    } else if (r.status === 'empty') {
      showScanResult('<div class="notice small">Saisissez les chiffres sous le code-barres (8 ou 13 chiffres), ou la référence fabricant.</div>');
    }
    return false;
  }

  async function startScan(then) {
    const video = document.getElementById('scan-video');
    const status = document.getElementById('scan-status');
    if (!video) return;
    try {
      const wanted = ['ean_13', 'ean_8', 'upc_a', 'upc_e'];
      const supported = window.BarcodeDetector.getSupportedFormats ? await window.BarcodeDetector.getSupportedFormats() : wanted;
      const formats = wanted.filter((f) => supported.includes(f));
      if (!formats.length) throw new Error('formats');
      const detector = new window.BarcodeDetector({ formats });
      scanStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
      video.srcObject = scanStream;
      // ne pas attendre play() : il peut rester en attente (onglet masqué,
      // lecture automatique restreinte) alors que la détection fonctionne
      video.play().catch(() => {});
      document.querySelector('.scan-box').classList.add('on');
      status.textContent = 'Visez le code-barres, il est lu automatiquement.';
      let busy = false;
      scanTimer = setInterval(async () => {
        if (busy || !scanStream) return;
        busy = true;
        try {
          const codes = await detector.detect(video);
          if (codes.length) handleCode(codes[0].rawValue, then, 'camera');
        } catch (e) { /* image pas encore prête */ }
        busy = false;
      }, 300);
    } catch (err) {
      stopScan();
      status.textContent = err && err.name === 'NotAllowedError'
        ? 'Accès à la caméra refusé. Vous pouvez saisir le code à la main ci-dessous.'
        : 'Caméra indisponible sur cet appareil. Saisissez le code à la main ci-dessous.';
    }
  }

  function viewScan(params) {
    const then = params.get('puis') === 'verifier' ? 'verifier' : 'oeil';
    const ok = scanSupported();
    return `
      <section class="wrap section narrow scan-page">
        <p class="eyebrow">En magasin</p>
        <h1>Scanner un code-barres</h1>
        <p class="lead">${then === 'verifier' ? 'Scannez le produit, puis saisissez le prix que vous voyez.' : 'Scannez le produit pour voir tout de suite si c’est une bonne affaire.'}</p>
        <div class="seg seg-block" role="group" aria-label="Après le scan">
          <a href="#/scan" class="${then === 'oeil' ? 'on' : ''}">Voir le verdict</a>
          <a href="#/scan?puis=verifier" class="${then === 'verifier' ? 'on' : ''}">Vérifier un prix</a>
        </div>
        ${ok ? `
        <div class="scan-box">
          <video id="scan-video" playsinline muted aria-label="Image de la caméra"></video>
          <div class="scan-frame" aria-hidden="true"></div>
          <button class="btn btn-primary scan-start" type="button" data-scan-start="${then}">Activer la caméra</button>
        </div>
        <p id="scan-status" class="small muted" role="status">L’image est analysée sur votre appareil : rien n’est envoyé ni enregistré.</p>`
        : `<div class="notice small" id="scan-status">Ce navigateur ne sait pas lire les codes-barres avec la caméra (c’est le cas de Safari). Saisissez simplement les chiffres inscrits sous le code-barres.</div>`}
        <form class="form card pad scan-manual" data-scan-manual="${then}">
          <label>Chiffres sous le code-barres, ou référence fabricant
            <input name="code" inputmode="numeric" autocomplete="off" placeholder="2000000002200" />
          </label>
          <button class="btn ${ok ? 'btn-ghost' : 'btn-primary'}" type="submit">Rechercher ce code</button>
        </form>
        <div id="scan-result" aria-live="polite"></div>
      </section>`;
  }

  /* ---------------- v0.11 : coup d’œil ---------------- */
  const GLANCE_ICON = { great: '✓', fair: '≈', wait: '⏳', bad: '✕', insufficient: '?' };

  function viewGlance(id) {
    const p = byId(id);
    if (!p) return viewNotFound();
    const a = H.assess(p);
    const g = H.glance(a);
    const w = S.getWatch(p.id);
    const target = a.greatThreshold || Math.floor(a.bestCost * 0.9);
    const idx = products.findIndex((x) => x.id === p.id);
    const next = products[(idx + 1) % products.length];
    return `
      <section class="glance glance-${g.tone}">
        <div class="wrap glance-wrap">
          <div class="g-top">
            <span class="g-links"><a href="#/produit/${p.id}" class="g-back">← Analyse complète</a><a href="#/scan" class="g-back">Scanner</a></span>
            <label class="sr-only" for="g-pick">Changer de produit</label>
            <select id="g-pick" data-glance-select>
              ${products.map((x) => `<option value="${x.id}" ${x.id === p.id ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}
            </select>
          </div>
          <p class="g-product">${esc(p.name)} <span>${esc(p.variant)}</span></p>
          <div class="g-answer">
            <span class="g-icon" aria-hidden="true">${GLANCE_ICON[g.tone]}</span>
            <h1>${esc(g.answer)}</h1>
          </div>
          <p class="g-reason">${esc(g.reason)}</p>
          <div class="g-price">
            <strong>${H.fmtPrice(a.bestCost)}</strong>
            <span>${shipLabel(a.best)} · ${esc(a.best.merchant.name)}</span>
            <span class="g-fresh ${a.ageHours > H.RULES.staleHours ? 'stale' : ''}">Vérifié ${H.fmtAgo(a.lastCollect)}</span>
          </div>
          ${g.warnings.length ? `<ul class="g-warn">${g.warnings.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
          <div class="g-actions">
            <button class="btn btn-primary" type="button" data-out="${a.best.id}">Voir l’offre</button>
            ${w ? `<a class="btn btn-ghost" href="#/surveillance">Surveillé sous ${H.fmtPrice(w.target)} ✓</a>`
              : `<button class="btn btn-ghost" type="button" data-quick-watch="${p.id}" data-target="${target}">Surveiller sous ${H.fmtPrice(target)}</button>`}
            <a class="btn btn-ghost" href="#/verifier?p=${p.id}">J’ai un autre prix sous les yeux</a>
          </div>
          <a class="g-next" href="#/oeil/${next.id}">Produit suivant : ${esc(next.name)} →</a>
        </div>
      </section>`;
  }

  /* ---------------- v1.0 : vérifier un prix vu ailleurs ---------------- */
  const parseNum = (v) => {
    if (v == null || String(v).trim() === '') return null;
    const n = Number(String(v).replace(/[€\s  ]/g, '').replace(',', '.'));
    return isFinite(n) ? n : NaN;
  };
  const SEEN_LABELS = () => Object.assign({}, Object.fromEntries(Object.entries(H.DISCOUNT_STATUS).map(([k, v]) => [k, v.label])),
    Object.fromEntries(Object.entries(H.SEEN_STATUS).map(([k, v]) => [k, v.label])), { silent: 'Vraie baisse' });
  const SEEN_CLASS = { real: 'real', silent: 'real', exaggerated: 'exaggerated', inflated: 'inflated', above: 'inflated', usual: 'none', unverifiable: 'none' };

  function viewSeenCheck(params) {
    const pid = params.get('p') || '';
    const p = byId(pid);
    const price = parseNum(params.get('prix'));
    const strike = parseNum(params.get('barre'));
    const ship = parseNum(params.get('liv'));
    const mid = params.get('m') || '';
    const submitted = params.has('prix');
    const merchants = p ? p.offers.map((o) => o.merchant) : [];
    const cats = categories.filter((c) => products.some((x) => x.category === c.id));

    let result = '';
    if (submitted && !p) {
      result = '<div class="notice">Choisissez un produit dans la liste.</div>';
    } else if (submitted) {
      const bad = [price, strike, ship].some((v) => Number.isNaN(v));
      const r = bad ? { ok: false, error: 'Un des montants est illisible. Exemple : 249,99' } : H.checkSeenPrice(p, { price, strike, shipping: ship, merchantId: mid || null });
      if (!r.ok) {
        result = `<div class="notice">${esc(r.error)}</div>`;
      } else {
        const label = SEEN_LABELS()[r.status];
        const share = location.href;
        result = `
          <section class="seen-result dc-${SEEN_CLASS[r.status]}" aria-live="polite">
            <p class="eyebrow">Résultat pour ${esc(p.name)} · ${esc(p.variant)}</p>
            <div class="seen-head">
              <span class="dc-status seen-status">${esc(label)}</span>
              <strong class="price">${H.fmtPrice(r.price)}</strong>${r.strike ? `<s class="muted">${H.fmtPrice(r.strike)}</s>` : ''}
            </div>
            ${r.status === 'unverifiable'
              ? `<p>Impossible de conclure : ${esc(r.reason)}. Nous préférons ne rien affirmer.</p>`
              : `<ul class="seen-lines">${r.lines.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>`}
            ${r.notes && r.notes.length ? `<p class="muted xsmall">${r.notes.map(esc).join(' ')}</p>` : ''}
            <div class="row">
              <a class="btn btn-primary btn-sm" href="#/produit/${p.id}">Voir l’analyse complète</a>
              <a class="btn btn-ghost btn-sm" href="#/oeil/${p.id}">Coup d’œil</a>
              <button class="btn btn-ghost btn-sm" type="button" data-copy-link="${esc(share)}">Copier le lien du résultat</button>
            </div>
            <p class="muted xsmall">Comparaison avec les ${p.offers.length} marchands suivis par The Hunter, pas avec tout le marché.</p>
          </section>`;
      }
    }

    return `
      <section class="wrap section narrow">
        <p class="eyebrow">En magasin ou sur un autre site</p>
        <h1>Vérifier une remise vue ailleurs</h1>
        <p class="lead">Saisissez le prix que vous voyez, et le prix barré s’il y en a un. The Hunter le compare à l’historique des prix de ce produit.</p>
        <p><a class="btn btn-ghost btn-sm" href="#/scan?puis=verifier">Scanner le code-barres du produit</a></p>
        <form class="form card pad seen-form" data-seen>
          <label>Produit
            <select name="produit" required data-seen-product>
              <option value="">Choisir un produit suivi…</option>
              ${cats.map((c) => `<optgroup label="${esc(c.name)}">${products.filter((x) => x.category === c.id).map((x) => `<option value="${x.id}" ${x.id === pid ? 'selected' : ''}>${esc(x.name)} — ${esc(x.variant)}</option>`).join('')}</optgroup>`).join('')}
            </select>
          </label>
          <div class="seen-grid">
            <label>Prix affiché
              <span class="input-euro"><input name="prix" inputmode="decimal" required placeholder="249,99" value="${price && !Number.isNaN(price) ? String(price).replace('.', ',') : ''}" /><span>€</span></span>
            </label>
            <label>Prix barré <span class="muted xsmall">facultatif</span>
              <span class="input-euro"><input name="barre" inputmode="decimal" placeholder="349,99" value="${strike && !Number.isNaN(strike) ? String(strike).replace('.', ',') : ''}" /><span>€</span></span>
            </label>
            <label>Livraison <span class="muted xsmall">facultatif</span>
              <span class="input-euro"><input name="liv" inputmode="decimal" placeholder="0" value="${ship != null && !Number.isNaN(ship) ? String(ship).replace('.', ',') : ''}" /><span>€</span></span>
            </label>
            <label>Où ?
              <select name="marchand">
                <option value="">Ailleurs / en magasin</option>
                ${merchants.map((m) => `<option value="${m.id}" ${m.id === mid ? 'selected' : ''}>${esc(m.name)}</option>`).join('')}
              </select>
            </label>
          </div>
          <button class="btn btn-primary" type="submit">Vérifier ce prix</button>
          <p class="muted xsmall">Rien n’est envoyé : le calcul se fait dans votre navigateur. Produit absent ? The Hunter ne suit que ${products.length} produits pour l’instant.</p>
        </form>
        ${result}
      </section>`;
  }

  /* ---------------- v0.9 : vérificateur de remises ---------------- */
  function checkerTitle() {
    const C = window.HunterCalendar;
    const u = C && window.HunterData.useCalendar !== false ? C.nextEvent(window.HunterData.NOW, 0.01) : null;
    if (u && u.ongoing && u.event.id === 'black-friday') return { title: 'Vérificateur Black Friday', event: u };
    if (u && u.ongoing) return { title: 'Vérificateur des soldes', event: u };
    return { title: 'Vérificateur de remises', event: null };
  }

  function viewChecker(params) {
    const filter = params.get('f') || '';
    const rows = H.discountAudit(products);
    const shownRows = rows.filter((x) => x.shown != null);
    const verif = shownRows.filter((x) => x.status !== 'unverifiable');
    const count = (k) => rows.filter((x) => x.status === k).length;
    const gap = verif.length ? verif.reduce((n, x) => n + (x.shown - x.real), 0) / verif.length : null;
    const { title, event } = checkerTitle();
    const pct = (v) => Math.round(Math.abs(v) * 100);
    const bar = (v, cls) => `<span class="dc-bar ${cls}"><i style="width:${Math.max(0, Math.min(v || 0, 0.5)) / 0.5 * 100}%"></i></span>`;
    const list = rows.filter((x) => !filter || x.status === filter);
    const qp = (v) => '#/verificateur' + (v ? '?f=' + v : '');
    const tile = (value, label, sub = '') => `<div class="lab-tile"><strong>${value}</strong><span>${label}</span>${sub ? `<span class="muted xsmall">${sub}</span>` : ''}</div>`;
    const plural = (n, one, many) => (n > 1 ? many : one);
    const meta = window.HunterData.meta || {};

    const row = (x) => {
      const t = x.truth;
      const truthTxt = !t ? '' : t.seen
        ? (t.lastDaysAgo <= 1 ? 'Prix barré pratiqué récemment' : `Prix barré pratiqué il y a ${t.lastDaysAgo} jours`)
        : `Prix barré jamais pratiqué en ${t.windowDays} jours`;
      const realLabel = x.real == null ? '—' : x.real >= 0.005 ? `−${pct(x.real)} %` : x.real <= -0.005 ? `+${pct(x.real)} %` : '0 %';
      return `
        <article class="dc-row dc-${x.status}">
          <header class="dc-head">
            <a href="#/produit/${x.product.id}" class="lab-prod">${productArt(x.product, 'sm')}<span><strong>${esc(x.product.name)}</strong><span class="muted xsmall">${esc(x.offer.merchant.name)}${x.product.variant ? ` · ${esc(x.product.variant)}` : ''}</span></span></a>
            <span class="dc-status">${esc(x.label)}</span>
          </header>
          <div class="dc-body">
            <div class="dc-price"><strong class="price">${H.fmtPrice(x.offer.price)}</strong>${x.offer.strikePrice && x.shown != null ? `<s class="muted small">${H.fmtPrice(x.offer.strikePrice)}</s>` : ''}</div>
            <div class="dc-bars">
              <div><span class="dc-k">Affichée</span>${bar(x.shown, 'shown')}<span class="dc-v">${x.shown != null ? '−' + pct(x.shown) + ' %' : 'aucune'}</span></div>
              <div><span class="dc-k">Réelle</span>${bar(x.real, 'real')}<span class="dc-v">${realLabel}</span></div>
            </div>
          </div>
          <p class="small dc-text">${esc(x.text)}</p>
          ${truthTxt ? `<p class="muted xsmall dc-truth">${esc(truthTxt)} · relevé ${H.fmtAgo(x.offer.collectedAt)}</p>` : `<p class="muted xsmall dc-truth">Relevé ${H.fmtAgo(x.offer.collectedAt)}</p>`}
        </article>`;
    };

    return `
      <section class="wrap section">
        <p class="eyebrow">${event ? `${esc(event.event.name)} · jusqu’au ${esc(window.HunterCalendar.fmtDay(new Date(event.event.end.getTime() - 1)))}` : 'Toute l’année'}</p>
        <h1>${title}</h1>
        <p class="lead">Chaque prix barré des produits suivis, comparé au prix habituellement pratiqué <strong>par le même marchand</strong> (médiane de ses relevés sur ${H.DISCOUNT.window} jours). Une remise affichée n’est pas une preuve.</p>
        <p><a class="link" href="#/verifier">Vous voyez une remise en magasin ou ailleurs ? Vérifiez-la →</a></p>
        ${meta.kind === 'demo' ? '<p class="notice small"><strong>Démonstration :</strong> marchands et prix fictifs. Le classement montre la méthode, pas l’état réel du marché.</p>' : ''}

        <div class="lab-tiles">
          ${tile(shownRows.length, plural(shownRows.length, 'remise affichée', 'remises affichées'))}
          ${tile(count('real'), plural(count('real'), 'réelle', 'réelles'), 'affichage fidèle à la baisse')}
          ${tile(count('exaggerated'), plural(count('exaggerated'), 'exagérée', 'exagérées'), 'vraie baisse, mais plus petite')}
          ${tile(count('inflated'), plural(count('inflated'), 'gonflée', 'gonflées'), 'aucune baisse réelle')}
          ${tile(gap != null ? `+${Math.round(gap * 100)} <small>pts</small>` : '—', 'd’exagération moyenne', 'remise affichée − remise réelle')}
          ${tile(count('silent'), plural(count('silent'), 'baisse discrète', 'baisses discrètes'), 'vraies baisses sans prix barré')}
        </div>

        <div class="filters">
          <div class="chips" role="group" aria-label="Filtrer par résultat">
            <a class="chip ${!filter ? 'on' : ''}" href="${qp('')}">Tout (${rows.length})</a>
            ${Object.entries(H.DISCOUNT_STATUS).sort((a, b) => a[1].order - b[1].order).filter(([k]) => count(k)).map(([k, v]) => `<a class="chip ${filter === k ? 'on' : ''}" href="${qp(k)}">${esc(v.label)} (${count(k)})</a>`).join('')}
          </div>
        </div>
        <div class="dc-list">${list.map(row).join('') || '<p class="muted">Aucune remise pour ce filtre.</p>'}</div>

        <details class="limits">
          <summary>Comment nous classons les remises</summary>
          <ul>
            <li><strong>Remise réelle</strong> : le prix est au moins ${Math.round(H.DISCOUNT.realMin * 100)} % sous le prix habituel du marchand, et la remise affichée ne dépasse pas la baisse réelle de plus de ${Math.round(H.DISCOUNT.exaggeration * 100)} points.</li>
            <li><strong>Réelle mais exagérée</strong> : vraie baisse, mais la remise affichée la dépasse de plus de ${Math.round(H.DISCOUNT.exaggeration * 100)} points.</li>
            <li><strong>Remise gonflée</strong> : prix barré affiché alors que le prix est au niveau habituel, voire au-dessus.</li>
            <li><strong>Impossible à vérifier</strong> : moins de ${H.DISCOUNT.minDays} jours de relevés chez ce marchand, ou dernier relevé de plus de ${H.RULES.staleHours} h.</li>
            <li><strong>Baisse sans prix barré</strong> : au moins ${Math.round(H.DISCOUNT.silentMin * 100)} % sous le prix habituel, sans aucune remise affichée.</li>
          </ul>
          <p class="small">Nous ne qualifions jamais une remise de trompeuse au sens juridique : nous comparons des prix observés. La loi encadre les annonces de réduction (prix de référence), mais seule l’autorité compétente peut constater une infraction.</p>
        </details>
      </section>`;
  }

  /* ---------------- Labo §15 : verdict Hunter vs tri par prix ---------------- */
  const RATINGS = [
    ['utile', 'Utile'],
    ['neutre', 'Pas d’apport'],
    ['faux', 'Faux'],
  ];
  const datasetKind = () => ((window.HunterData.meta || {}).kind || 'demo');
  const evalKey = (id) => datasetKind() + ':' + id;

  function labRows() {
    return products.map((p) => {
      const a = H.assess(p);
      return { p, a, c: H.compareToNaive(a), ev: S.getEval(evalKey(p.id)) };
    });
  }

  function viewLab(params) {
    const filter = params.get('f') || '';
    const all = labRows();
    const total = all.length;
    const adds = all.filter((x) => x.c.addsValue).length;
    const changes = all.filter((x) => x.c.changesDecision).length;
    const none = total - adds;
    const rated = all.filter((x) => x.ev && x.ev.rating);
    const bt = all.map((x) => H.backtest(x.p));
    const btScored = bt.reduce((n, b) => n + b.scored, 0);
    const btRight = bt.reduce((n, b) => n + b.right, 0);
    const byStance = {};
    bt.forEach((b) => b.entries.forEach((e) => {
      if (!e.stance) return;
      byStance[e.stance] = byStance[e.stance] || { n: 0, ok: 0, label: e.stanceLabel };
      byStance[e.stance].n++;
      if (e.outcome === 'right') byStance[e.stance].ok++;
    }));
    const pct = (n) => (total ? Math.round((n / total) * 100) : 0);
    const countBy = {};
    all.forEach((x) => x.c.findings.forEach((f) => { countBy[f.type] = (countBy[f.type] || 0) + 1; }));
    const rows = all.filter((x) => !filter || (filter === 'aucun' ? !x.c.addsValue : x.c.findings.some((f) => f.type === filter)));
    const meta = window.HunterData.meta || {};
    const qp = (v) => '#/labo' + (v ? '?f=' + v : '');

    const tile = (value, label, sub = '') => `<div class="lab-tile"><strong>${value}</strong><span>${label}</span>${sub ? `<span class="muted xsmall">${sub}</span>` : ''}</div>`;

    const row = ({ p, a, c, ev }) => {
      const status = c.changesDecision ? ['change', 'Change la décision'] : c.addsValue ? ['info', 'Information en plus'] : ['none', 'Aucun apport'];
      const n = c.naive;
      return `
        <article class="lab-row">
          <header class="lab-head">
            <a href="#/produit/${p.id}" class="lab-prod">${productArt(p, 'sm')}<span><strong>${esc(p.name)}</strong><span class="muted xsmall">${esc(p.variant)}</span></span></a>
            <span class="lab-badges">${(() => { const b = H.backtest(p); return b.scored ? `<span class="lab-journal" title="Verdicts passés rejoués et vérifiés">Journal ${b.right}/${b.scored}</span>` : ''; })()}<span class="lab-status lab-${status[0]}">${status[1]}</span></span>
          </header>
          <div class="lab-cols">
            <div class="lab-col lab-naive">
              <h3>Tri par prix</h3>
              <strong class="price">${H.fmtPrice(n.price)}</strong>
              <span class="small">chez ${esc(n.offer.merchant.name)}${n.shownDiscount ? ` · <span class="lab-discount">−${Math.round(n.shownDiscount * 100)} % affiché</span>` : ''}</span>
              <span class="muted xsmall">Prix affiché, hors livraison, sans date ni historique</span>
            </div>
            <div class="lab-col lab-hunter">
              <h3>The Hunter</h3>
              ${verdictBadge(a.verdict, 'sm')}
              <span class="small"><strong class="mono">${H.fmtPrice(a.bestCost)}</strong> chez ${esc(a.best.merchant.name)}${a.best.shipping == null ? ' (hors livraison)' : ''}</span>
              <span class="muted xsmall">Confiance ${a.confidence.toLowerCase()} · vérifié ${H.fmtAgo(a.lastCollect)}</span>
            </div>
          </div>
          ${c.findings.length ? `<ul class="lab-findings">${c.findings.map((f) => `<li><span class="lab-chip ${f.changesDecision ? 'strong' : ''}">${esc(f.label)}</span><span>${esc(f.text)}</span></li>`).join('')}</ul>`
            : '<p class="muted small lab-nofind">Hunter et le tri par prix mènent à la même conclusion.</p>'}
          <div class="lab-eval">
            <span class="small">Ce verdict est-il juste et utile ?</span>
            <div class="lab-rate" role="group" aria-label="Évaluation de ${esc(p.name)}">
              ${RATINGS.map(([k, l]) => `<button type="button" class="${ev && ev.rating === k ? 'on rate-' + k : ''}" data-eval="${p.id}" data-rating="${k}" aria-pressed="${ev && ev.rating === k ? 'true' : 'false'}">${l}</button>`).join('')}
            </div>
            <input class="lab-note" type="text" data-eval-note="${p.id}" value="${esc(ev ? ev.note : '')}" placeholder="Note (facultatif) : pourquoi ?" aria-label="Note sur ${esc(p.name)}" />
          </div>
        </article>`;
    };

    return `
      <section class="wrap section">
        <p class="eyebrow">Labo interne · critère §15</p>
        <h1>Verdict Hunter ou simple tri par prix&nbsp;?</h1>
        <p class="lead">Pour chaque produit : ce qu’un tri par prix aurait montré, ce que dit The Hunter, et si le verdict change la décision d’achat. Notez chaque verdict pour décider s’il faut lancer le développement complet.</p>
        ${meta.kind === 'demo' ? `<div class="notice small"><strong>Jeu de démonstration :</strong> il a été construit pour couvrir chaque cas, donc ses taux ne prouvent rien. Seul un échantillon réel compte (voir <code>data/GUIDE_RELEVE.md</code>).</div>`
          : `<p class="muted small">Jeu analysé : « ${esc(meta.name || '')} » · ${total} produit${total > 1 ? 's' : ''}.</p>`}

        <div class="lab-tiles">
          ${tile(total, 'produits analysés')}
          ${tile(`${changes} <small>(${pct(changes)} %)</small>`, 'décision changée', 'livraison, vendeur, fausse promo, attendre, prudence')}
          ${tile(`${adds} <small>(${pct(adds)} %)</small>`, 'information en plus', 'dont vraies baisses confirmées')}
          ${tile(none, 'sans apport', 'même conclusion qu’un tri')}
          ${tile(btScored ? `${btRight}/${btScored} <small>(${Math.round((btRight / btScored) * 100)} %)</small>` : '—', 'verdicts passés justes', Object.values(byStance).map((x) => `${x.label} : ${x.ok}/${x.n}`).join(' · ') || 'journal vide')}
          ${tile(`${rated.length}/${total}`, 'verdicts notés', rated.length ? (() => { const u = rated.filter((x) => x.ev.rating === 'utile').length; const f = rated.filter((x) => x.ev.rating === 'faux').length; return `${u} utile${u > 1 ? 's' : ''} · ${f} faux`; })() : 'aucun pour l’instant')}
        </div>

        <div class="filters">
          <div class="chips" role="group" aria-label="Filtrer par apport">
            <a class="chip ${!filter ? 'on' : ''}" href="${qp('')}">Tous (${total})</a>
            ${Object.entries(H.FINDINGS).filter(([k]) => countBy[k]).map(([k, f]) => `<a class="chip ${filter === k ? 'on' : ''}" href="${qp(k)}">${esc(f.label)} (${countBy[k]})</a>`).join('')}
            ${none ? `<a class="chip ${filter === 'aucun' ? 'on' : ''}" href="${qp('aucun')}">Sans apport (${none})</a>` : ''}
          </div>
          <button class="btn btn-ghost btn-sm" type="button" data-lab-export>Exporter en CSV</button>
        </div>

        <div class="lab-list">${rows.map(row).join('') || '<p class="muted">Aucun produit pour ce filtre.</p>'}</div>
        <p class="muted xsmall">Les évaluations sont enregistrées dans ce navigateur, séparément pour la démo et pour l’échantillon. Exportez-les pour les partager.</p>
      </section>`;
  }

  function exportLab() {
    const cell = (v) => {
      const t = String(v ?? '');
      return /[;"\n]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t;
    };
    const num = (v) => (v == null ? '' : String(v).replace('.', ','));
    const head = ['jeu', 'produit_id', 'produit', 'variante', 'ean', 'verdict', 'confiance', 'tri_marchand', 'tri_prix_affiche', 'tri_remise_affichee', 'hunter_marchand', 'hunter_cout_total', 'livraison_connue', 'change_decision', 'apports', 'detail_apports', 'journal_justes', 'journal_evalues', 'evaluation', 'note', 'date_evaluation'];
    const lines = labRows().map(({ p, a, c, ev }) => [
      datasetKind(), p.id, p.name, p.variant, p.ean, a.verdict.label, a.confidence,
      c.naive.offer.merchant.name, num(c.naive.price), c.naive.shownDiscount ? Math.round(c.naive.shownDiscount * 100) + ' %' : '',
      a.best.merchant.name, num(a.bestCost), a.best.shipping == null ? 'non' : 'oui',
      c.changesDecision ? 'oui' : 'non', c.findings.map((f) => f.label).join(' | '), c.findings.map((f) => f.text).join(' | '),
      H.backtest(p).right, H.backtest(p).scored,
      ev && ev.rating ? (RATINGS.find((x) => x[0] === ev.rating) || [])[1] : '', ev ? ev.note : '',
      ev && ev.at ? new Date(ev.at).toISOString() : '',
    ].map(cell).join(';'));
    const csvText = '﻿' + [head.join(';'), ...lines].join('\r\n');
    const blob = new Blob([csvText], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `labo-hunter-${datasetKind()}-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 0);
    toast('Export CSV prêt');
  }

  function viewWatchlist() {
    const st = S.get();
    const items = st.watchlist.map((w) => ({ w, p: byId(w.productId) })).filter((x) => x.p);
    if (!items.length) {
      return `
        <section class="wrap section narrow">
          <h1>Liste de surveillance</h1>
          <div class="empty">
            <h2>Aucun produit surveillé</h2>
            <p>Ouvrez une fiche produit et fixez un prix cible : The Hunter vérifiera les offres pour vous.</p>
            <a class="btn btn-primary" href="#/recherche">Chercher un produit</a>
          </div>
        </section>`;
    }
    const rows = items.map(({ w, p }) => {
      const a = H.assess(p);
      const s = H.alertStatus(a, w.target, st.prefs);
      return `
        <div class="watch-item ${s.state}">
          <a href="#/produit/${p.id}" class="wi-main">
            ${productArt(p, 'sm')}
            <div>
              <strong>${esc(p.name)}</strong>
              <div class="muted small">${esc(p.variant)}</div>
              ${verdictBadge(a.verdict, 'sm')}
            </div>
          </a>
          <div class="wi-nums">
            <div><span class="muted xsmall">Actuel</span><strong>${H.fmtPrice(a.bestCost)}</strong></div>
            <div><span class="muted xsmall">Votre seuil</span><strong>${H.fmtPrice(w.target)}</strong></div>
          </div>
          <div class="wi-status">
            ${s.state === 'reached'
              ? `<span class="alert-on">Seuil atteint</span><span class="muted xsmall">chez ${esc(a.best.merchant.name)} · ${H.fmtAgo(a.lastCollect)}</span>`
              : s.state === 'unconfirmed'
                ? `<span class="alert-pending">Atteint, à confirmer</span><span class="muted xsmall">${esc(s.issues.join(' · '))}</span>`
                : `<span class="muted small">Encore ${H.fmtPrice(s.gap)}</span><span class="muted xsmall">vérifié ${H.fmtAgo(a.lastCollect)}</span>`}
          </div>
          <button class="icon-btn" data-unwatch="${p.id}" aria-label="Retirer ${esc(p.name)}">×</button>
        </div>`;
    }).join('');
    const reachedCount = items.filter(({ w, p }) => H.alertStatus(H.assess(p), w.target, st.prefs).state === 'reached').length;

    return `
      <section class="wrap section narrow">
        <h1>Liste de surveillance</h1>
        <p class="lead">${items.length} produit${items.length > 1 ? 's' : ''} suivi${items.length > 1 ? 's' : ''}${reachedCount ? ` · <strong>${reachedCount} seuil${reachedCount > 1 ? 's' : ''} atteint${reachedCount > 1 ? 's' : ''}</strong>` : ''}</p>
        ${!st.user ? `<div class="notice small">Votre liste est enregistrée dans ce navigateur uniquement. <a href="#/compte">Créez un compte</a> pour recevoir les alertes par e-mail.</div>` : `<p class="muted small">Alertes ${st.prefs.emailAlerts ? `par e-mail à ${esc(st.user.email)} (${st.prefs.frequency === 'immediate' ? 'immédiates' : 'résumé quotidien'})` : 'désactivées'} · <a href="#/compte">modifier</a></p>`}
        <p class="muted small">${st.prefs.onlyConfirmed ? 'Mode « vraie affaire uniquement » : une alerte n’est envoyée que si la baisse est confirmée, récente et que le coût total est connu.' : 'Toutes les baisses sous votre seuil déclenchent une alerte, même non confirmées.'} <a href="#/compte">Changer</a></p>
        <div class="watch-list">${rows}</div>
        <p class="muted xsmall">Prototype : les alertes sont simulées. Dans la version connectée, The Hunter revérifie les sources autorisées avant chaque envoi.</p>
      </section>`;
  }

  function installSection() {
    const standalone = window.matchMedia && window.matchMedia('(display-mode: standalone)').matches;
    const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
    return `
      <div class="card pad install-card">
        <h2>Application</h2>
        ${standalone
          ? '<p class="small">The Hunter est installée sur cet appareil. ✓</p>'
          : `<p class="small">Installez The Hunter pour l’ouvrir depuis l’écran d’accueil et la consulter hors ligne (avec les dernières données chargées).</p>
             ${deferredInstall ? '<button class="btn btn-primary btn-sm" type="button" data-install>Installer l’application</button>' : ''}
             <ul class="small install-steps">
               ${ios ? '<li><strong>iPhone / iPad (Safari)</strong> : bouton Partager, puis « Sur l’écran d’accueil ».</li>' : ''}
               <li><strong>Android (Chrome)</strong> : menu ⋮, puis « Installer l’application ».</li>
               <li><strong>Ordinateur (Chrome, Edge)</strong> : icône d’installation dans la barre d’adresse.</li>
               ${ios ? '' : '<li><strong>iPhone / iPad (Safari)</strong> : bouton Partager, puis « Sur l’écran d’accueil ».</li>'}
             </ul>`}
      </div>`;
  }

  function viewAccount(params) {
    const st = S.get();
    if (!st.user) {
      const mode = params.get('m') === 'connexion' ? 'connexion' : 'inscription';
      return `
        <section class="wrap section narrow auth">
          <h1>${mode === 'inscription' ? 'Créer un compte' : 'Se connecter'}</h1>
          <p class="lead">Un compte léger pour retrouver vos produits suivis et recevoir les alertes.</p>
          <div class="seg seg-block">
            <a href="#/compte?m=inscription" class="${mode === 'inscription' ? 'on' : ''}">Inscription</a>
            <a href="#/compte?m=connexion" class="${mode === 'connexion' ? 'on' : ''}">Connexion</a>
          </div>
          <form data-auth class="form">
            ${mode === 'inscription' ? '<label>Prénom <input name="name" autocomplete="given-name" /></label>' : ''}
            <label>E-mail <input name="email" type="email" required autocomplete="email" /></label>
            <label>Mot de passe <input name="password" type="password" required minlength="8" autocomplete="${mode === 'inscription' ? 'new-password' : 'current-password'}" /></label>
            <button class="btn btn-primary btn-block" type="submit">${mode === 'inscription' ? 'Créer mon compte' : 'Se connecter'}</button>
            <p class="muted xsmall">Prototype : rien n’est envoyé. Le mot de passe n’est ni stocké ni transmis ; seuls le prénom et l’e-mail restent dans ce navigateur.</p>
          </form>
          ${installSection()}
        </section>`;
    }
    const pr = st.prefs;
    return `
      <section class="wrap section narrow">
        <h1>Bonjour ${esc(st.user.name)}</h1>
        <p class="muted">${esc(st.user.email)} · ${st.watchlist.length} produit${st.watchlist.length > 1 ? 's' : ''} suivi${st.watchlist.length > 1 ? 's' : ''}</p>
        <form data-prefs class="form card pad">
          <h2>Préférences d’alertes</h2>
          <label class="check"><input type="checkbox" name="emailAlerts" ${pr.emailAlerts ? 'checked' : ''}/> Recevoir les alertes par e-mail</label>
          <label>Fréquence
            <select name="frequency">
              <option value="immediate" ${pr.frequency === 'immediate' ? 'selected' : ''}>Dès qu’un seuil est atteint</option>
              <option value="daily" ${pr.frequency === 'daily' ? 'selected' : ''}>Un résumé par jour</option>
            </select>
          </label>
          <label class="check"><input type="checkbox" name="onlyConfirmed" ${pr.onlyConfirmed ? 'checked' : ''}/> Seulement si le prix est confirmé par plusieurs observations</label>
          <button class="btn btn-primary" type="submit">Enregistrer</button>
        </form>
        ${installSection()}
        <div class="card pad danger-zone">
          <h2>Mes données</h2>
          <p class="small">The Hunter ne collecte que ce qui est nécessaire aux alertes : e-mail, produits suivis, seuils.</p>
          <div class="row">
            <button class="btn btn-ghost" data-signout>Se déconnecter</button>
            <button class="btn btn-danger" data-reset>Supprimer mes données</button>
          </div>
        </div>
      </section>`;
  }

  function viewMethod() {
    const R = H.RULES;
    return `
      <section class="wrap section prose">
        <p class="eyebrow">Méthodologie & transparence</p>
        <h1>Comment The Hunter rend son verdict</h1>
        <p class="lead">Pas de note mystérieuse sur 100. Un verdict parmi quatre, les critères qui le justifient, et un niveau de confiance.</p>

        <h2>Les quatre verdicts</h2>
        <div class="verdict-grid">
          <div>${verdictBadge(H.VERDICTS.great)}<p>Le meilleur coût est au moins ${Math.round((1 - R.greatRatio) * 100)} % sous la médiane des 90 derniers jours, et au moins ${R.confirmMinObs} observations des ${R.confirmWindowDays} derniers jours le confirment.</p></div>
          <div>${verdictBadge(H.VERDICTS.fair)}<p>Le prix est compétitif mais proche du niveau habituel (jusqu’à ${Math.round((R.fairRatio - 1) * 100)} % au-dessus de la médiane 90 jours).</p></div>
          <div>${verdictBadge(H.VERDICTS.bad)}<p>Le prix est au-dessus de l’habitude, même si une remise est affichée.</p></div>
          <div>${verdictBadge(H.VERDICTS.insufficient)}<p>Moins de ${R.minHistoryDays} jours d’historique, ou dernière collecte de plus de ${R.staleHours} heures. Nous préférons ne pas conclure.</p></div>
        </div>

        <h2>Les signaux utilisés</h2>
        <ul>
          <li><strong>Écart à l’historique</strong> : prix comparé aux médianes 30, 90 et 180 jours. La médiane résiste mieux qu’une moyenne aux promotions éclair.</li>
          <li><strong>Prix barré</strong> : il n’est jamais utilisé comme référence. Une remise affichée sur un prix jamais observé est signalée comme « remise marketing ». Pour chaque prix barré, nous indiquons la dernière fois où ce marchand a réellement vendu à ce prix.</li>
          <li><strong>Comparaison marchands</strong> : écart avec les autres offres du même produit (même référence ou même EAN).</li>
          <li><strong>Coût total</strong> : prix + livraison + frais obligatoires connus. Si la livraison est inconnue, nous le disons.</li>
          <li><strong>Disponibilité et fraîcheur</strong> : stock et délai annoncés, horodatés.</li>
          <li><strong>Signaux vendeur</strong> : identité, ancienneté, conditions de retour. Nous ne qualifions jamais un vendeur d’arnaque sur un seul signal automatique.</li>
        </ul>

        <h2>Seuil de vraie affaire et « Faut-il attendre ? »</h2>
        <p>Le seuil de vraie affaire vaut ${Math.round(R.greatRatio * 100)} % de la médiane des 90 derniers jours. C’est le prix cible que nous suggérons. Sous le verdict, nous indiquons combien de fois le prix est passé sous ce seuil sur 180 jours, et pendant combien de temps en moyenne. Ce sont des faits observés, pas une prévision.</p>

        <h2>Alertes « vraie affaire uniquement »</h2>
        <p>Dans ce mode, activé par défaut, une alerte n’est envoyée que si le coût total est connu, que la collecte date de moins de ${R.freshHours} h, que les données suffisent à rendre un verdict et qu’au moins ${R.confirmMinObs} observations des ${R.confirmWindowDays} derniers jours sont sous votre seuil. Sinon, le produit est marqué « atteint, à confirmer ».</p>

        <h2>Coup d’œil</h2>
        <p>Le mode coup d’œil résume une fiche en une réponse (bon moment pour acheter, prix correct, mieux vaut attendre, pas assez de données), une raison et les alertes utiles. Il dit toujours la même chose que la fiche complète : c’est la même analyse, en plus court.</p>

        <h2>Vérifier un prix vu ailleurs</h2>
        <p>Le prix saisi est comparé au prix habituel du marché (médiane sur ${H.DISCOUNT.window} jours du prix le plus bas observé chaque jour, hors livraison), au prix habituel du marchand s’il est suivi, à la meilleure offre suivie et au plus bas observé sur 180 jours. Les mêmes seuils que le vérificateur de remises s’appliquent. Le calcul se fait dans votre navigateur.</p>

        <h2>Vérificateur de remises</h2>
        <p>Chaque prix barré est comparé au prix habituellement pratiqué par le même marchand (médiane de ses relevés sur ${H.DISCOUNT.window} jours). Nous distinguons les remises réelles, exagérées (vraie baisse plus petite qu’annoncé) et gonflées (aucune baisse), et nous signalons les vraies baisses sans prix barré. Sans ${H.DISCOUNT.minDays} jours de relevés chez ce marchand, nous ne concluons pas.</p>

        <h2>Calendrier commercial</h2>
        <p>The Hunter connaît les dates des soldes d’hiver et d’été, fixées par la loi et identiques en ligne : quatre semaines à partir du deuxième mercredi de janvier et du dernier mercredi de juin, avec des ajustements prévus par l’arrêté du 27 mai 2019. Il connaît aussi la semaine du Black Friday, qui est un usage commercial et non une période légale. Certains départements ont d’autres dates de soldes : nous utilisons les dates nationales.</p>
        <p>Pour chaque produit, nous mesurons la baisse réellement observée lors des précédentes éditions, en comparant le prix le plus bas pendant l’événement à la médiane des ${H.CAL.before} jours précédents. Quand un événement commence dans les ${H.BACKTEST.horizon} prochains jours, « Prix correct » conseille d’attendre, sauf si ce produit n’a pas baissé d’au moins ${Math.round(H.CAL.minEffect * 100)} % la dernière fois. Pendant l’événement, nous ne conseillons pas d’attendre : c’est le moment de vérifier les remises.</p>

        <h2>Promotions récurrentes</h2>
        <p>Une promotion, c’est au moins ${H.CYCLE.minLength} jours consécutifs où le meilleur coût est au moins ${Math.round(H.CYCLE.depth * 100)} % sous la médiane de l’historique. Nous ne parlons de rythme que si au moins ${H.CYCLE.minEpisodes} promotions ont commencé à intervalles réguliers (écart de ${Math.round(H.CYCLE.maxSpread * 100)} % au plus), tous les ${H.CYCLE.minPeriod} à ${H.CYCLE.maxPeriod} jours. Avec un rythme repéré, « Prix correct » conseille d’attendre seulement si la prochaine promotion est attendue dans les ${H.BACKTEST.horizon} jours. Sinon, acheter maintenant reste raisonnable. Ce n’est jamais une promesse : un marchand peut changer de calendrier.</p>

        <h2>Journal des verdicts</h2>
        <p>Sur chaque fiche, nous rejouons notre verdict tous les ${H.BACKTEST.step} jours sur les ${H.BACKTEST.maxBack} derniers jours, avec les seules données disponibles à chaque date. Puis nous comparons la recommandation (acheter, attendre, prix acceptable) à ce qui s’est réellement passé dans les ${H.BACKTEST.horizon} jours suivants. Les erreurs restent affichées : c’est ainsi que nous améliorons les règles.</p>

        <h2>Le niveau de confiance</h2>
        <p>Un point pour chaque condition remplie : au moins 90 jours d’historique, au moins deux marchands, une collecte de moins de ${R.freshHours} h, un coût total connu. 4 points : confiance élevée ; 2–3 : moyenne ; 0–1 : faible.</p>

        <h2>Comment nous gagnons de l’argent</h2>
        <p>Certains liens sont des liens partenaires : si vous achetez après avoir cliqué, le marchand peut nous verser une commission. Ces liens sont marqués « Lien partenaire ». La commission ne change <strong>jamais</strong> le verdict, ni l’ordre des offres, qui sont toujours triées par coût total. Les emplacements payés portent la mention « Sponsorisé ».</p>

        <h2>Ce que nous ne promettons pas</h2>
        <p>The Hunter ne garantit pas qu’un prix est le meilleur du marché : il compare les marchands qu’il suit. Il ne garantit pas non plus qu’un vendeur est fiable. Vérifiez toujours l’offre chez le marchand avant de payer.</p>
      </section>`;
  }

  function viewLegal() {
    return `
      <section class="wrap section prose">
        <h1>Mentions légales, confidentialité et cookies</h1>
        <p class="notice small">Prototype de démonstration non commercial : produits, marchands et prix sont fictifs.</p>
        <h2>Éditeur</h2>
        <p><strong>The Hunter — projet de TimotheeNourris</strong> — Projet étudiant non commercial, prototype de démonstration.<br>Contact : https://github.com/TimotheeNourris<br>Hébergeur : GitHub, Inc., 88 Colin P. Kelly Jr. Street, San Francisco, CA 94107, États-Unis (https://github.com)</p>
        <h2>Données personnelles</h2>
        <p>Dans ce prototype, aucune donnée n’est transmise à un serveur. Le prénom, l’e-mail, les produits suivis et les préférences sont enregistrés dans le stockage local de votre navigateur et peuvent être supprimés depuis la page Compte. En production : base légale, durée de conservation, droits d’accès, de rectification et d’effacement, contact du responsable de traitement.</p>
        <h2>Cookies et traceurs</h2>
        <p>Ce prototype n’utilise aucun cookie publicitaire ni outil de mesure d’audience. Seul le stockage local nécessaire au fonctionnement (liste de surveillance, compte) est utilisé.</p>
        <h2>Données produits</h2>
        <p>Les produits, marques, marchands, prix et visuels affichés sont fictifs et générés pour la démonstration.</p>
      </section>`;
  }

  function viewNotFound() {
    return `<section class="wrap section narrow"><div class="empty"><h1>Page introuvable</h1><p>Ce lien ne mène nulle part.</p><a class="btn btn-primary" href="#/">Retour à l’accueil</a></div></section>`;
  }

  /* ---------------- modale sortie marchand ---------------- */
  function outbound(offerId) {
    let offer, product;
    products.forEach((p) => p.offers.forEach((o) => { if (o.id === offerId) { offer = o; product = p; } }));
    if (!offer) return;
    const dlg = document.getElementById('out-dialog');
    dlg.querySelector('.out-body').innerHTML = `
      <h2>Vers ${esc(offer.merchant.name)}</h2>
      ${(() => { const v = H.offerView(offer); return `<p>${esc(product.name)} — <strong>${H.fmtPrice(v.total ?? v.price)}</strong> (${shipLabel(v)}), observé ${H.fmtAgo(offer.collectedAt)}.</p>`; })()}
      <p class="small">${offer.affiliate ? 'Lien partenaire : The Hunter peut percevoir une commission si vous achetez. Cela ne change pas le verdict.' : 'Lien direct : The Hunter ne perçoit aucune commission sur cette offre.'}</p>
      <p class="small muted">Vérifiez le prix, les frais et le stock chez le marchand avant de payer.</p>
      ${/^https?:\/\//.test(offer.url)
        ? `<p><a class="btn btn-primary" href="${esc(offer.url)}" target="_blank" rel="noopener noreferrer${offer.affiliate ? ' sponsored' : ''}">Ouvrir chez ${esc(offer.merchant.name)} ↗</a></p>`
        : '<p class="notice xsmall">Prototype : ce marchand est fictif, aucune redirection n’a lieu.</p>'}`;
    dlg.showModal();
  }

  /* ---------------- partage du verdict ---------------- */
  async function shareVerdict(id) {
    const p = byId(id);
    if (!p) return;
    const text = H.shareText(H.assess(p));
    const url = location.origin + location.pathname + '#/produit/' + p.id;
    try {
      if (navigator.share) { await navigator.share({ title: p.name + ' · The Hunter', text, url }); return; }
    } catch (e) { if (e && e.name === 'AbortError') return; }
    try {
      await navigator.clipboard.writeText(text + ' ' + url);
      toast('Résumé copié dans le presse-papiers');
    } catch (e) {
      window.prompt('Copiez ce résumé :', text + ' ' + url);
    }
  }

  /* ---------------- relevé quotidien (interne) ---------------- */
  const RV_KEY = 'thehunter.releve';
  const RV_URLS = 'thehunter.releve.urls';
  const lsGet = (k, d) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } };
  let RV = null;        // { name, header, rows, savedAt }
  let rvApi = false;    // vrai si le serveur local (npm start) sait lire et enregistrer les feuilles

  function viewReleve() {
    RV = lsGet(RV_KEY, null);
    return `
      <section class="wrap section releve">
        <p class="eyebrow">Interne · relevé quotidien</p>
        <h1>Saisie du relevé</h1>
        <p class="lead">Ouvrez chaque page marchand et notez ce que vous voyez. Les saisies sont gardées dans ce navigateur au fil de l’eau ; rien n’est envoyé ailleurs.</p>
        <p class="muted small">Navigation privée, sans être connecté. Sur une place de marché, le vendeur affiché par défaut. Produit introuvable : laissez le prix vide.</p>
        <div id="rv-box">${RV ? releveBody() : releveEmpty()}</div>
      </section>`;
  }

  function releveEmpty(msg) {
    return `
      <div class="card rv-empty">
        ${msg ? `<p class="notice small">${esc(msg)}</p>` : ''}
        <p>Aucune feuille ouverte.</p>
        <p class="muted small">Créez la feuille du jour avec <code>npm run kit -- feuille</code>. Avec <code>npm start</code>, elle s’ouvre ici toute seule ; sinon, choisissez le fichier :</p>
        <label class="btn btn-ghost">Ouvrir une feuille (.csv)<input type="file" accept=".csv,text/csv" data-rv-file hidden></label>
      </div>`;
  }

  const rvPct = (p) => (p.total ? Math.round(((p.saisis + p.rupture) / p.total) * 100) : 0);

  function releveBody() {
    const R = window.HunterReleve;
    const p = R.progress(RV.rows);
    const hour = (String((RV.rows[0] && RV.rows[0].date_collecte) || '').match(/\d{1,2}:\d{2}/) || ['10:00'])[0];
    const groups = R.group(RV.rows);
    return `
      <div class="card rv-bar">
        <div class="rv-bar-top">
          <div><strong>${esc(RV.name)}</strong> <span class="muted small">· ${p.total} lignes · ${groups.length} produits</span></div>
          <label class="small">Heure du relevé <input type="time" value="${esc(hour.padStart(5, '0'))}" data-rv-hour></label>
        </div>
        <div class="rv-progress" aria-hidden="true"><span style="width:${rvPct(p)}%"></span></div>
        <p class="small" data-rv-count>${releveCount(p)}</p>
        <div class="rv-actions">
          <select data-rv-filter aria-label="Lignes affichées"><option value="">Toutes les lignes</option><option value="todo">À faire</option><option value="pb">Erreurs et avertissements</option></select>
          <button class="btn btn-primary btn-sm" data-rv-save>${rvApi ? 'Enregistrer dans le projet' : 'Télécharger la feuille remplie'}</button>
          <button class="btn btn-ghost btn-sm" data-rv-download ${rvApi ? '' : 'hidden'}>Télécharger</button>
          <button class="btn btn-ghost btn-sm" data-rv-close>Fermer la feuille</button>
        </div>
        <p class="small" data-rv-msg role="status"></p>
      </div>
      ${groups.map((g) => `
        <div class="card rv-product">
          <h2 class="rv-title">${esc(g.marque)} ${esc(g.produit)}${g.variante ? ` <span class="muted">· ${esc(g.variante)}</span>` : ''}</h2>
          <p class="muted xsmall">EAN <code>${esc(g.ean)}</code>${g.mpn ? ` · réf. <code>${esc(g.mpn)}</code>` : ''}</p>
          <div class="rv-lines">${g.lines.map((i) => releveLine(i)).join('')}</div>
        </div>`).join('')}`;
  }

  function releveCount(p) {
    return `<strong>${p.saisis}</strong> prix saisis${p.rupture ? `, ${p.rupture} en rupture` : ''} · <strong>${p.restants}</strong> à faire${p.erreur ? ` · <strong class="warn-text">${p.erreur} erreur${p.erreur > 1 ? 's' : ''}</strong>` : ''}${p.attention ? ` · ${p.attention} à vérifier` : ''}`;
  }

  function releveLine(i) {
    const R = window.HunterReleve;
    const r = RV.rows[i];
    const st = R.checkRow(r);
    const f = (k, label, ph, cls = '') => `<label class="rv-f ${cls}"><span>${label}</span><input ${k === 'url' || k === 'delai' ? '' : 'inputmode="decimal"'} value="${esc(r[k] || '')}" placeholder="${esc(ph)}" data-rv-i="${i}" data-rv-k="${k}"></label>`;
    const link = (href, text) => `<a href="${esc(href)}" target="_blank" rel="noopener noreferrer">${text}</a>`;
    return `
      <div class="rv-line rv-${st.level}" data-rv-line="${i}">
        <div class="rv-merchant">
          <strong>${esc(r.marchand)}</strong>
          <span class="xsmall">${r.url ? link(r.url, 'Ouvrir la page') + ' · ' : ''}${link(R.searchUrl(r.marchand, r.ean), 'Chercher l’EAN')}${r.mpn ? ' · ' + link(R.searchUrl(r.marchand, r.mpn), 'la réf.') : ''}</span>
        </div>
        ${f('prix', 'Prix €', '89,99')}
        ${f('livraison', 'Livraison €', '0 si offerte')}
        ${f('prix_barre', 'Prix barré €', 'si affiché')}
        <label class="rv-f"><span>Disponibilité</span><select data-rv-i="${i}" data-rv-k="disponibilite"><option value=""></option>${R.STOCK.map((s) => `<option${s === r.disponibilite ? ' selected' : ''}>${esc(s)}</option>`).join('')}${r.disponibilite && !R.STOCK.includes(r.disponibilite) ? `<option selected>${esc(r.disponibilite)}</option>` : ''}</select></label>
        ${f('delai', 'Délai', '2-3 jours')}
        ${f('url', 'Adresse de la page', 'https://…', 'rv-url')}
        <p class="rv-status xsmall" data-rv-status="${i}">${releveStatus(st)}</p>
      </div>`;
  }

  function releveStatus(st) {
    if (st.level === 'ok') return '✓ complet';
    if (st.level === 'vide') return st.messages[0] ? esc(st.messages[0]) : '';
    return (st.level === 'erreur' ? '✗ ' : '⚠ ') + st.messages.map(esc).join(' · ');
  }

  function releveMsg(text, warn) {
    const el = document.querySelector('[data-rv-msg]');
    if (el) { el.textContent = text; el.classList.toggle('warn-text', !!warn); }
  }

  function releveSave() {
    RV.savedAt = new Date().toISOString();
    if (!lsSet(RV_KEY, RV)) releveMsg('Ce navigateur refuse l’enregistrement local : téléchargez la feuille avant de fermer la page.', true);
    lsSet(RV_URLS, window.HunterReleve.rememberUrls(RV.rows, lsGet(RV_URLS, {})));
  }

  function releveOpen(name, text) {
    const R = window.HunterReleve;
    const res = R.parse(text);
    const box = document.getElementById('rv-box');
    if (res.error) { if (box) box.innerHTML = releveEmpty(res.error); return; }
    RV = { name, header: res.header, rows: R.applyUrls(res.rows, lsGet(RV_URLS, {})) };
    releveSave();
    if (box) box.innerHTML = releveBody();
  }

  function releveRefresh() {
    const p = window.HunterReleve.progress(RV.rows);
    const c = document.querySelector('[data-rv-count]');
    if (c) c.innerHTML = releveCount(p);
    const bar = document.querySelector('.rv-progress span');
    if (bar) bar.style.width = rvPct(p) + '%';
  }

  function releveFilter(mode) {
    const R = window.HunterReleve;
    document.querySelectorAll('[data-rv-line]').forEach((el) => {
      const r = RV.rows[+el.dataset.rvLine];
      const lvl = R.checkRow(r).level;
      el.hidden = mode === 'todo' ? !(lvl === 'vide' && !/rupture/i.test(r.disponibilite || ''))
        : mode === 'pb' ? !['erreur', 'attention'].includes(lvl) : false;
    });
    document.querySelectorAll('.rv-product').forEach((card) => { card.hidden = ![...card.querySelectorAll('[data-rv-line]')].some((l) => !l.hidden); });
  }

  async function loadReleve() {
    const box = document.getElementById('rv-box');
    if (!box) return;
    let res = null;
    try { res = await fetch('api/releve', { cache: 'no-store' }); } catch (e) { /* hors ligne ou site publié */ }
    if (!document.body.contains(box)) return;
    const name = res && res.ok ? res.headers.get('X-Releve-Nom') : null;
    rvApi = !!name;
    if (!name) return;
    const text = await res.text();
    if (!RV) return releveOpen(name, text);
    const save = box.querySelector('[data-rv-save]');
    if (save) save.textContent = 'Enregistrer dans le projet';
    const dl = box.querySelector('[data-rv-download]');
    if (dl) dl.hidden = false;
    // feuille plus récente : on y passe directement si l'ancienne n'a aucune saisie
    if (RV.name !== name && name > RV.name && !window.HunterReleve.progress(RV.rows).saisis) return releveOpen(name, text);
    if (RV.name !== name && name > RV.name) releveMsg(`Une feuille plus récente existe : ${name}. Enregistrez celle-ci, puis fermez-la pour ouvrir la nouvelle.`, true);
  }

  function releveDownload() {
    const blob = new Blob([window.HunterReleve.serialize(RV.header, RV.rows)], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = RV.name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    releveMsg(`Fichier ${RV.name} téléchargé : placez-le dans data/demarrage/releves/ (il remplace la feuille vide).`);
  }

  async function releveStore() {
    const p = window.HunterReleve.progress(RV.rows);
    if (p.erreur && !confirm(`${p.erreur} ligne(s) en erreur seront ignorées à la conversion. Enregistrer quand même ?`)) return;
    if (!rvApi) return releveDownload();
    try {
      const res = await fetch('api/releve/' + encodeURIComponent(RV.name), { method: 'PUT', headers: { 'X-Hunter': 'releve', 'Content-Type': 'text/csv; charset=utf-8' }, body: window.HunterReleve.serialize(RV.header, RV.rows) });
      if (!res.ok) throw new Error(await res.text());
      const j = await res.json();
      releveMsg(`✓ Enregistré dans ${j.fichier} à ${new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}.`);
    } catch (err) {
      releveMsg(`Enregistrement impossible (${err.message}). Téléchargez la feuille à la place.`, true);
    }
  }

  document.addEventListener('input', (e) => {
    const el = e.target.closest && e.target.closest('[data-rv-i]');
    if (!el || !RV) return;
    const i = +el.dataset.rvI;
    RV.rows[i][el.dataset.rvK] = el.value.trim();
    releveSave();
    const st = window.HunterReleve.checkRow(RV.rows[i]);
    const line = document.querySelector(`[data-rv-line="${i}"]`);
    if (line) line.className = `rv-line rv-${st.level}`;
    const s = document.querySelector(`[data-rv-status="${i}"]`);
    if (s) s.innerHTML = releveStatus(st);
    releveRefresh();
  });

  document.addEventListener('change', (e) => {
    if (e.target.matches('[data-rv-file]')) {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => releveOpen(file.name, String(reader.result));
      reader.readAsText(file, 'utf-8');
    } else if (e.target.matches('[data-rv-hour]') && RV) {
      RV.rows = window.HunterReleve.setHour(RV.rows, e.target.value);
      releveSave();
      releveMsg(`Heure du relevé : ${e.target.value}.`);
    } else if (e.target.matches('[data-rv-filter]') && RV) releveFilter(e.target.value);
  });

  document.addEventListener('click', (e) => {
    if (!RV) return;
    if (e.target.closest('[data-rv-download]')) releveDownload();
    else if (e.target.closest('[data-rv-save]')) releveStore();
    else if (e.target.closest('[data-rv-close]')) {
      if (!confirm('Fermer cette feuille ? Les saisies non enregistrées dans le projet ni téléchargées seront perdues.')) return;
      try { localStorage.removeItem(RV_KEY); } catch (err) { /* stockage indisponible */ }
      RV = null;
      render();
    }
  });

  /* ---------------- rendu & événements ---------------- */
  function updateNav() {
    const n = S.get().watchlist.length;
    document.querySelectorAll('[data-watch-count]').forEach((el) => { el.textContent = n; el.hidden = !n; });
    const u = S.get().user;
    document.querySelectorAll('[data-account-label]').forEach((el) => { el.textContent = u ? u.name : 'Compte'; });
    const { parts } = parseRoute();
    document.querySelectorAll('.nav a[data-route]').forEach((a) => a.classList.toggle('on', a.dataset.route === (parts[0] || '')));
  }

  function render() {
    const { parts, params } = parseRoute();
    let html;
    switch (parts[0]) {
      case undefined: html = viewHome(); break;
      case 'recherche': html = viewSearch(params); break;
      case 'produit': html = viewProduct(parts[1], params); break;
      case 'surveillance': html = viewWatchlist(); break;
      case 'compte': html = viewAccount(params); break;
      case 'methodologie': html = viewMethod(); break;
      case 'legal': html = viewLegal(); break;
      case 'comparer': html = viewCompare(parts[1], parts[2]); break;
      case 'labo': html = viewLab(params); break;
      case 'verificateur': html = viewChecker(params); break;
      case 'verifier': html = viewSeenCheck(params); break;
      case 'oeil': html = viewGlance(parts[1]); break;
      case 'scan': html = viewScan(params); break;
      case 'qualite': html = viewQuality(); break;
      case 'releve': html = viewReleve(); break;
      default: html = viewNotFound();
    }
    $app.innerHTML = html;
    if (parts[0] === 'qualite') loadCollecte();
    if (parts[0] === 'releve') loadReleve();
    bindChart($app);
    updateNav();
    const titles = { recherche: 'Recherche', produit: (byId(parts[1]) || {}).name, surveillance: 'Surveillance', compte: 'Compte', methodologie: 'Méthodologie', legal: 'Mentions légales', comparer: 'Comparer', labo: 'Labo', verificateur: checkerTitle().title, verifier: 'Vérifier une remise', scan: 'Scanner', qualite: 'Qualité des données', releve: 'Saisie du relevé', oeil: 'Coup d’œil' + ((byId(parts[1]) || {}).name ? ' · ' + byId(parts[1]).name : '') };
    document.title = (titles[parts[0]] ? titles[parts[0]] + ' · ' : '') + 'The Hunter';
  }

  let lastPath = '';
  window.addEventListener('hashchange', () => {
    stopScan();
    const path = location.hash.split('?')[0];
    render();
    if (path !== lastPath) window.scrollTo({ top: 0 });
    lastPath = path;
  });

  document.addEventListener('submit', (e) => {
    const f = e.target;
    if (f.matches('[data-scan-manual]')) {
      e.preventDefault();
      handleCode(f.elements.code.value, f.dataset.scanManual, 'manual');
      return;
    }
    if (f.matches('[data-seen]')) {
      e.preventDefault();
      const q = new URLSearchParams();
      q.set('p', f.elements.produit.value);
      q.set('prix', f.elements.prix.value.trim());
      if (f.elements.barre.value.trim()) q.set('barre', f.elements.barre.value.trim());
      if (f.elements.liv.value.trim()) q.set('liv', f.elements.liv.value.trim());
      if (f.elements.marchand.value) q.set('m', f.elements.marchand.value);
      location.hash = '#/verifier?' + q.toString();
      return;
    }
    if (f.matches('[data-search]')) {
      e.preventDefault();
      const q = f.q.value.trim();
      location.hash = '#/recherche' + (q ? '?q=' + encodeURIComponent(q) : '');
    } else if (f.matches('[data-watch]')) {
      e.preventDefault();
      const v = Math.round(+f.elements.targetPrice.value);
      if (!(v > 0)) return;
      const was = S.isWatched(f.dataset.watch);
      S.watch(f.dataset.watch, v);
      render();
      toast(was ? 'Seuil mis à jour' : 'Ajouté à votre liste de surveillance');
    } else if (f.matches('[data-auth]')) {
      e.preventDefault();
      const nm = f.elements.namedItem("name"); S.signIn(nm ? nm.value.trim() : "", f.elements.email.value.trim());
      location.hash = '#/surveillance';
      toast('Bienvenue sur The Hunter');
    } else if (f.matches('[data-prefs]')) {
      e.preventDefault();
      S.setPrefs({ emailAlerts: f.emailAlerts.checked, frequency: f.frequency.value, onlyConfirmed: f.onlyConfirmed.checked });
      toast('Préférences enregistrées');
    }
  });

  document.addEventListener('click', (e) => {
    const t = e.target.closest('[data-unwatch],[data-out],[data-signout],[data-reset],[data-close],[data-use-target],[data-share],[data-report],[data-eval],[data-lab-export],[data-copy-link],[data-quick-watch]');
    if (!t) return;
    if (t.dataset.quickWatch) {
      S.watch(t.dataset.quickWatch, Number(t.dataset.target));
      render();
      toast(`Alerte créée sous ${H.fmtPrice(Number(t.dataset.target))}`);
      return;
    }
    if (t.dataset.copyLink) {
      (navigator.clipboard ? navigator.clipboard.writeText(t.dataset.copyLink) : Promise.reject())
        .then(() => toast('Lien copié'))
        .catch(() => window.prompt('Copiez ce lien :', t.dataset.copyLink));
      return;
    }
    if (t.dataset.eval) {
      const key = evalKey(t.dataset.eval);
      const cur = S.getEval(key);
      S.setEval(key, { rating: cur && cur.rating === t.dataset.rating ? null : t.dataset.rating });
      const y = window.scrollY;
      render();
      window.scrollTo(0, y);
      return;
    }
    if (t.hasAttribute('data-lab-export')) { exportLab(); return; }
    if (t.dataset.unwatch) { S.unwatch(t.dataset.unwatch); render(); toast('Retiré de la surveillance'); }
    else if (t.dataset.useTarget) {
      const input = document.getElementById('target');
      input.value = t.dataset.useTarget;
      input.focus();
      input.scrollIntoView({ behavior: 'smooth', block: 'center' });
      toast('Seuil reporté dans le prix cible');
    } else if (t.dataset.share) shareVerdict(t.dataset.share);
    else if (t.dataset.report) {
      S.report(t.dataset.report);
      render();
      toast('Merci : ce prix sera revérifié en priorité');
    }
    else if (t.dataset.out) outbound(t.dataset.out);
    else if (t.hasAttribute('data-signout')) { S.signOut(); render(); }
    else if (t.hasAttribute('data-reset')) {
      if (confirm('Supprimer le compte, la liste de surveillance et les préférences de ce navigateur ?')) { S.reset(); location.hash = '#/'; toast('Données supprimées'); }
    } else if (t.hasAttribute('data-close')) t.closest('dialog').close();
  });

  document.addEventListener('change', (e) => {
    if (e.target.matches('[data-glance-select]')) {
      location.hash = '#/oeil/' + e.target.value;
      return;
    }
    if (e.target.matches('[data-seen-product]')) {
      const q = new URLSearchParams();
      if (e.target.value) q.set('p', e.target.value);
      history.replaceState(null, '', '#/verifier' + (q.toString() ? '?' + q : ''));
      render();
      return;
    }
    if (e.target.matches('[data-eval-note]')) {
      S.setEval(evalKey(e.target.dataset.evalNote), { note: e.target.value.trim() });
      toast('Note enregistrée');
      return;
    }
    if (e.target.matches('[data-compare-select]')) {
      location.hash = `#/comparer/${e.target.dataset.compareSelect}/${e.target.value}`;
      return;
    }
    if (e.target.matches('[data-sort]')) {
      const { params } = parseRoute();
      params.set('tri', e.target.value);
      location.hash = '#/recherche?' + params.toString();
    }
  });

  /* ---------------- démarrage : choix du jeu de données ---------------- */
  function renderDataBar(meta, sampleState) {
    const bar = document.getElementById('data-bar');
    const fmtD = (t) => new Date(t).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
    const label = meta.kind === 'demo'
      ? 'produits, marchands et prix <strong>fictifs</strong> de démonstration'
      : `<strong>échantillon réel</strong> « ${esc(meta.name)} » · ${meta.productCount} produit${meta.productCount > 1 ? 's' : ''} · relevés du ${fmtD(meta.from)} au ${fmtD(meta.to)}`;
    let toggle = '';
    if (sampleState === 'ok') {
      toggle = `<span class="ds-toggle" role="group" aria-label="Jeu de données">
        <button type="button" data-dataset="demo" class="${meta.kind === 'demo' ? 'on' : ''}">Démo</button>
        <button type="button" data-dataset="sample" class="${meta.kind !== 'demo' ? 'on' : ''}">Échantillon</button></span>`;
    } else if (sampleState === 'invalid') {
      toggle = '<span class="ds-warn">Échantillon présent mais invalide : lancez tools/validate-dataset.js</span>';
    }
    bar.innerHTML = `<span>Prototype v0.20 — ${label}</span>${toggle}`;
    bar.classList.toggle('is-sample', meta.kind !== 'demo');
  }

  async function boot() {
    let sample = null, sampleState = 'none';
    try {
      const res = await fetch('data/echantillon.json', { cache: 'no-store' });
      if (res.ok) {
        sample = await res.json();
        const report = DS.validate(sample);
        sampleState = report.ok ? 'ok' : 'invalid';
        if (!report.ok) console.warn('Échantillon invalide :', report.errors);
      }
    } catch (e) { /* pas d'échantillon (ou ouverture en file://) : démo */ }
    let choice = null;
    try { choice = localStorage.getItem(DS_KEY); } catch (e) { /* ignoré */ }
    const useSample = sampleState === 'ok' && choice !== 'demo';
    const n = DS.normalize(useSample ? sample : window.HunterDemoDataset);
    Object.assign(window.HunterData, n, { costMode: S.get().prefs.costMode || 'domicile' });
    ({ products, categories, sponsored } = n);
    H.clearCache();
    renderDataBar(n.meta, sampleState);
    render();
  }

  document.addEventListener('click', (e) => {
    const sb = e.target.closest('[data-scan-start]');
    if (sb) { sb.hidden = true; startScan(sb.dataset.scanStart); }
  });

  document.addEventListener('click', (e) => {
    const m = e.target.closest('[data-cost-mode]');
    if (!m || m.dataset.costMode === H.costMode()) return;
    S.setPrefs({ costMode: m.dataset.costMode });
    window.HunterData.costMode = m.dataset.costMode;
    H.clearCache();
    const y = window.scrollY;
    render();
    window.scrollTo(0, y);
    toast(m.dataset.costMode === 'retrait' ? 'Coûts recalculés avec le retrait en magasin' : 'Coûts recalculés avec la livraison');
  });

  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-dataset]');
    if (!b) return;
    try { localStorage.setItem(DS_KEY, b.dataset.dataset); } catch (err) { /* ignoré */ }
    // Les produits diffèrent d'un jeu à l'autre : on repart de l'accueil
    if (location.hash && location.hash !== '#/') history.replaceState(null, '', '#/');
    boot().then(() => toast(b.dataset.dataset === 'demo' ? 'Données de démonstration' : 'Échantillon réel chargé'));
  });

  /* ---------------- v0.12 : application installable ---------------- */
  let deferredInstall = null;
  const INSTALL_KEY = 'thehunter.install-dismissed';
  const installBar = document.getElementById('install-bar');
  const offlineBar = document.getElementById('offline-bar');

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();               // on propose l'installation nous-mêmes, au bon endroit
    deferredInstall = e;
    let dismissed = false;
    try { dismissed = !!localStorage.getItem(INSTALL_KEY); } catch (err) { /* ignoré */ }
    if (!dismissed) installBar.hidden = false;
    if (parseRoute().parts[0] === 'compte') render();
  });
  window.addEventListener('appinstalled', () => {
    deferredInstall = null;
    installBar.hidden = true;
    toast('The Hunter est installée');
  });
  document.addEventListener('click', async (e) => {
    if (e.target.closest('[data-install-dismiss]')) {
      installBar.hidden = true;
      try { localStorage.setItem(INSTALL_KEY, String(Date.now())); } catch (err) { /* ignoré */ }
      return;
    }
    if (!e.target.closest('[data-install]') || !deferredInstall) return;
    deferredInstall.prompt();
    const choice = await deferredInstall.userChoice;
    deferredInstall = null;
    installBar.hidden = true;
    if (choice && choice.outcome !== 'accepted') toast('Installation annulée');
  });

  const syncOnline = () => { offlineBar.hidden = navigator.onLine; };
  window.addEventListener('online', () => { syncOnline(); toast('Connexion rétablie'); });
  window.addEventListener('offline', syncOnline);
  syncOnline();

  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch((err) => console.warn('Service worker non enregistré :', err));
    });
  }

  S.on(updateNav);
  lastPath = location.hash.split('?')[0];
  boot();
})();
