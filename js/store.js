/* =========================================================================
   The Hunter — stockage local du prototype
   Aucune donnée n'est envoyée à un serveur : tout reste dans le navigateur.
   Aucun mot de passe n'est conservé.
   ========================================================================= */
(function () {
  const KEY = 'thehunter.v1';
  const defaults = () => ({
    user: null, // { name, email, createdAt }
    prefs: { emailAlerts: true, frequency: 'immediate', onlyConfirmed: true, costMode: 'domicile' },
    watchlist: [], // { productId, target, addedAt }
    reports: [],   // { offerId, at } — signalements « ce prix est faux »
    evals: {},     // Labo §15 : { "<jeu>:<produit>": { rating, note, at } }
  });

  let state = defaults();
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) state = Object.assign(defaults(), JSON.parse(raw));
  } catch (e) { /* stockage indisponible : on reste en mémoire */ }

  const listeners = new Set();
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* ignoré */ }
    listeners.forEach((fn) => fn(state));
  }

  window.Store = {
    get: () => state,
    on: (fn) => listeners.add(fn),
    signIn(name, email) {
      state.user = { name: name || email.split('@')[0], email, createdAt: Date.now() };
      save();
    },
    signOut() { state.user = null; save(); },
    setPrefs(p) { state.prefs = Object.assign({}, state.prefs, p); save(); },
    isWatched: (id) => state.watchlist.some((w) => w.productId === id),
    getWatch: (id) => state.watchlist.find((w) => w.productId === id) || null,
    watch(productId, target) {
      const existing = state.watchlist.find((w) => w.productId === productId);
      if (existing) existing.target = target;
      else state.watchlist.push({ productId, target, addedAt: Date.now() });
      save();
    },
    unwatch(productId) {
      state.watchlist = state.watchlist.filter((w) => w.productId !== productId);
      save();
    },
    isReported: (offerId) => state.reports.some((r) => r.offerId === offerId),
    report(offerId) {
      if (!state.reports.some((r) => r.offerId === offerId)) state.reports.push({ offerId, at: Date.now() });
      save();
    },
    getEval: (key) => state.evals[key] || null,
    setEval(key, patch) {
      state.evals[key] = Object.assign({ rating: null, note: '' }, state.evals[key], patch, { at: Date.now() });
      save();
    },
    reset() { state = defaults(); save(); },
  };
})();
