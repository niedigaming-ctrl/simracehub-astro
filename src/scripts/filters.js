// filters.js — SimRaceHub Filter-/Popup-/Vergleichs-Logik
// Wird im BaseLayout oder in index.astro geladen.

function fmtPrice(p) { return p.toLocaleString('de-DE') + ' €'; }

// Read products from JSON script tag
function getProducts() {
  const el = document.getElementById('srh-products-data');
  if (!el) return [];
  try { return JSON.parse(el.textContent); } catch(e) { return []; }
}

// ---- ACCENT COLOR ----
window.setAccent = function(c) {
  document.documentElement.style.setProperty('--accent', c);
  try { localStorage.setItem('srh_accent', c); } catch(e) {}
  const t = document.getElementById('twk-trigger');
  if (t) t.style.background = c;
};

(function() {
  try {
    const s = localStorage.getItem('srh_accent');
    if (s) window.setAccent(s);
  } catch(e) {}
})();

// ---- FILTER LOGIC ----
function initFilters(products) {
  const cards = document.querySelectorAll('.card[data-cat]');
  const searchInput = document.querySelector('.header-search input, input[placeholder*="Direct Drive"]');
  let activeCat = 'all', activeBudget = 'all', activePlatform = 'all', searchQuery = '';

  function setActive(selector, val, key) {
    document.querySelectorAll(selector).forEach(p => p.classList.toggle('active', p.dataset[key] === val));
  }

  function filter() {
    let visible = 0;
    cards.forEach(card => {
      const cat = card.dataset.cat;
      const price = parseFloat(card.dataset.price);
      const platforms = card.dataset.platform.toLowerCase().split(',');
      const name = card.dataset.name;

      const catMatch = activeCat === 'all' || cat === activeCat;
      let budgetMatch = activeBudget === 'all';
      if (!budgetMatch) {
        if (activeBudget === 'under200') budgetMatch = price < 200;
        else if (activeBudget === '200-500') budgetMatch = price >= 200 && price <= 500;
        else if (activeBudget === '500-1000') budgetMatch = price > 500 && price <= 1000;
        else if (activeBudget === '1000plus') budgetMatch = price > 1000;
      }
      const platMatch = activePlatform === 'all' || platforms.includes(activePlatform);
      const searchMatch = !searchQuery || name.includes(searchQuery.toLowerCase());

      const show = catMatch && budgetMatch && platMatch && searchMatch;
      card.style.display = show ? '' : 'none';
      if (show) visible++;
    });
    const h2 = document.querySelector('h2.headline');
    if (h2) h2.textContent = visible + ' Produkte. Handverlesen.';
  }

  document.addEventListener('click', e => {
    const pill = e.target.closest('.pill[data-cat], .pill[data-budget], .pill[data-platform]');
    if (!pill) return;
    if (pill.dataset.cat) { activeCat = pill.dataset.cat; setActive('.pill[data-cat]', activeCat, 'cat'); }
    if (pill.dataset.budget) { activeBudget = pill.dataset.budget; setActive('.pill[data-budget]', activeBudget, 'budget'); }
    if (pill.dataset.platform) { activePlatform = pill.dataset.platform; setActive('.pill[data-platform]', activePlatform, 'platform'); }
    filter();
  }, true);

  if (searchInput) {
    searchInput.addEventListener('input', e => { searchQuery = e.target.value; filter(); });
  }

  // ---- SHOP POPUP ----
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.7);z-index:999;display:none;justify-content:center;align-items:center;backdrop-filter:blur(4px);';
  overlay.addEventListener('click', e => { if (e.target === overlay) closePopup(); });
  document.body.appendChild(overlay);

  const popup = document.createElement('div');
  popup.style.cssText = 'background:#111;border:1px solid rgba(255,255,255,0.12);width:90%;max-width:520px;max-height:80vh;overflow-y:auto;position:relative;';
  overlay.appendChild(popup);

  window.closePopup = function() { overlay.style.display = 'none'; document.body.style.overflow = ''; };
  function closePopup() { window.closePopup(); }

  window.openPopup = function(product) {
    popup.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;padding:18px 20px;border-bottom:1px solid rgba(255,255,255,0.07);">
        <div><div class="mono" style="font-size:10px;color:var(--text-3);">PREISVERGLEICH</div>
        <div class="headline" style="font-size:22px;">${product.name}</div></div>
        <span style="cursor:pointer;font-size:22px;color:var(--text-3);" onclick="window.closePopup()">&times;</span>
      </div>
      <div style="padding:10px 0;">
        ${product.shops.sort((a,b)=>a.price-b.price).map(s => `
          <a href="${s.url}" target="_blank" rel="noopener sponsored" class="shop-row" style="display:flex;justify-content:space-between;align-items:center;padding:12px 20px;border-bottom:1px solid rgba(255,255,255,0.04);text-decoration:none;color:var(--text);">
            <div>
              <div style="font-weight:600;font-size:14px;">${s.name}</div>
              <div style="font-size:11px;color:${s.inStock ? 'var(--text-2)' : '#ff4444'};margin-top:2px;">${s.inStock ? 'Auf Lager' : 'Ausverkauft'} ${s.delivery ? '· ' + s.delivery : ''}</div>
            </div>
            <div style="text-align:right;">
              <div class="headline" style="font-size:20px;color:var(--accent);">${fmtPrice(s.price)}</div>
              ${s.oldPrice ? `<div class="mono" style="font-size:10px;color:var(--text-3);text-decoration:line-through;">${fmtPrice(s.oldPrice)}</div>` : ''}
            </div>
          </a>
        `).join('')}
      </div>
      <div style="padding:12px 20px;border-top:1px solid rgba(255,255,255,0.07);display:flex;justify-content:space-between;align-items:center;">
        <span class="mono" style="font-size:9px;color:var(--text-3);">* Affiliate-Links</span>
        <a href="/simracehub-astro/produkte/${product.slug}/" class="btn" style="font-size:10px;height:32px;padding:0 12px;">Details</a>
      </div>
    `;
    overlay.style.display = 'flex';
    document.body.style.overflow = 'hidden';
    popup.scrollTop = 0;
  };

  // Attach popup to "Preise" buttons
  document.querySelectorAll('.shop-count-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.preventDefault();
      e.stopPropagation();
      const slug = btn.dataset.slug;
      const p = products.find(x => x.slug === slug);
      if (p) openPopup(p);
    });
  });

  // ---- LIVE PRICE FETCH ----
  fetch('/simracehub-astro/products-live.json')
    .then(r => r.ok ? r.json() : null)
    .then(data => {
      if (!data || !data.products) return;
      const map = {};
      for (const k in data.products) {
        const entry = data.products[k];
        if (entry.price) map[entry.shopKey] = entry;
      }
      products.forEach(p => {
        p.shops.forEach(s => {
          const live = map[s.shopKey];
          if (live && live.price) {
            s.price = live.price;
            s.currency = live.currency || s.currency;
            s.inStock = live.availability === 'InStock';
            if (live.oldPrice && live.oldPrice > live.price) s.oldPrice = live.oldPrice;
          }
        });
      });
      // Re-sort cards after price update
      const grid = document.querySelector('.prod-grid');
      if (grid) {
        const sorted = Array.from(cards).sort((a, b) => {
          const pa = parseFloat(a.dataset.price), pb = parseFloat(b.dataset.price);
          return pa - pb;
        });
        sorted.forEach(c => grid.appendChild(c));
      }
    })
    .catch(() => { /* silent fail */ });

  // ---- COMPARE / FAVORITES ----
  let compareList = JSON.parse(localStorage.getItem('srh_compare') || '[]');
  let favList = JSON.parse(localStorage.getItem('srh_favs') || '[]');

  function updateCompareBtns() {
    document.querySelectorAll('.compare-btn').forEach(btn => {
      const id = parseInt(btn.dataset.id);
      btn.style.background = compareList.includes(id) ? 'var(--accent)' : 'rgba(0,0,0,0.6)';
      btn.style.color = compareList.includes(id) ? '#fff' : 'var(--text-2)';
    });
  }

  function updateFavBtns() {
    document.querySelectorAll('.fav-btn').forEach(btn => {
      const id = parseInt(btn.dataset.id);
      btn.style.background = favList.includes(id) ? 'var(--accent)' : 'rgba(0,0,0,0.6)';
      btn.style.color = favList.includes(id) ? '#fff' : 'var(--text-2)';
    });
  }

  function toggleCompare(id) {
    const idx = compareList.indexOf(id);
    if (idx >= 0) compareList.splice(idx, 1);
    else {
      if (compareList.length >= 4) { alert('Max 4 Produkte im Vergleich'); return; }
      compareList.push(id);
    }
    localStorage.setItem('srh_compare', JSON.stringify(compareList));
    updateCompareBtns();
    if (compareList.length >= 2) openCompareOverlay(products);
  }

  function toggleFav(id) {
    const idx = favList.indexOf(id);
    if (idx >= 0) favList.splice(idx, 1);
    else favList.push(id);
    localStorage.setItem('srh_favs', JSON.stringify(favList));
    updateFavBtns();
  }

  window.openCompareOverlay = function(prodsArg) {
    const prods = (prodsArg || products).filter(p => compareList.includes(p.id));
    const overlay = document.createElement('div');
    overlay.id = 'srh-compare-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.85);backdrop-filter:blur(8px);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px;';
    let html = '<div style="background:var(--bg);border:1px solid var(--line);border-radius:8px;max-width:1100px;width:100%;max-height:90vh;overflow:auto;">';
    html += '<div style="display:flex;justify-content:space-between;align-items:center;padding:16px 20px;border-bottom:1px solid var(--line);position:sticky;top:0;background:var(--bg);z-index:1;">';
    html += '<div class="headline" style="font-size:20px;">Vergleich (' + prods.length + ')</div>';
    html += '<button id="srh-close-cmp" style="background:none;border:none;color:var(--text-2);cursor:pointer;font-size:20px;">✕</button>';
    html += '</div><div style="display:flex;"><div style="width:180px;padding:16px;background:var(--panel-2);border-right:1px solid var(--line);flex-shrink:0;"></div>';
    prods.forEach(p => {
      html += '<div style="min-width:220px;padding:16px;border-left:1px solid var(--line);">';
      html += '<div class="mono" style="font-size:9px;color:var(--text-3);">' + p.brand + '</div>';
      html += '<div class="headline" style="font-size:15px;margin-bottom:8px;">' + p.name + '</div>';
      html += '<div class="headline" style="font-size:18px;color:var(--accent);margin-bottom:4px;">' + fmtPrice(Math.min(...p.shops.filter(s=>s.inStock).map(s=>s.price))) + '</div>';
      html += '<div style="font-size:10px;color:var(--text-3);margin-bottom:12px;">ab · ' + p.shops.length + ' Shops</div>';
      html += '<a href="/simracehub-astro/produkte/' + p.slug + '/" class="btn btn-primary" style="font-size:10px;height:28px;">Zum Produkt →</a>';
      html += '</div>';
    });
    html += '</div>';
    ['Drehmoment','Plattform','Best für','Rating'].forEach(spec => {
      html += '<div style="display:flex;">';
      html += '<div style="width:180px;padding:12px 16px;background:var(--panel-2);border-top:1px solid var(--line);border-right:1px solid var(--line);font-size:11px;color:var(--text-3);flex-shrink:0;">' + spec + '</div>';
      prods.forEach(p => {
        let val = '-';
        if (spec === 'Drehmoment') val = (p.specs.find(s=>s[0]==='Drehmoment')||['-'])[1];
        else if (spec === 'Plattform') val = p.platforms.join(', ');
        else if (spec === 'Best für') val = p.bestFor;
        else if (spec === 'Rating') val = p.rating.toFixed(1) + ' (' + p.reviews + ')';
        html += '<div style="min-width:220px;padding:12px 16px;border-left:1px solid var(--line);border-top:1px solid var(--line);font-size:11px;">' + val + '</div>';
      });
      html += '</div>';
    });
    html += '</div>';
    overlay.innerHTML = html;
    document.body.appendChild(overlay);
    document.getElementById('srh-close-cmp').addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
  };

  // ---- QUIZ OVERLAY ----
  function openQuizOverlay() {
    const overlay = document.createElement('div');
    overlay.id = 'srh-quiz-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.85);backdrop-filter:blur(8px);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px;';
    overlay.innerHTML = '<div style="background:var(--bg);border:1px solid var(--line);border-radius:8px;max-width:500px;width:100%;padding:32px;">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:24px;">' +
      '<div class="headline" style="font-size:20px;">Kaufberater</div>' +
      '<button id="srh-close-quiz" style="background:none;border:none;color:var(--text-2);cursor:pointer;font-size:20px;">✕</button>' +
      '</div>' +
      '<div id="srh-quiz-content"></div>' +
      '</div>';
    document.body.appendChild(overlay);
    document.getElementById('srh-close-quiz').addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
    quizStep1(products);
  }

  function quizStep1(products) {
    const el = document.getElementById('srh-quiz-content');
    if (!el) return;
    el.innerHTML = '<div class="mono" style="font-size:9px;color:var(--text-3);margin-bottom:12px;">FRAGE 1/3</div>' +
      '<div class="headline" style="font-size:18px;margin-bottom:20px;">Was ist dein Budget?</div>' +
      '<div style="display:flex;flex-direction:column;gap:8px;">' +
      '<button class="btn quiz-btn" data-budget="entry" style="height:44px;justify-content:flex-start;padding:0 16px;">Bis 500€ (Einstieg)</button>' +
      '<button class="btn quiz-btn" data-budget="mid" style="height:44px;justify-content:flex-start;padding:0 16px;">500€ - 1.000€ (Mittel)</button>' +
      '<button class="btn quiz-btn" data-budget="high" style="height:44px;justify-content:flex-start;padding:0 16px;">Über 1.000€ (Premium)</button>' +
      '</div>';
    el.querySelectorAll('.quiz-btn').forEach(btn => btn.addEventListener('click', () => quizStep2(products, btn.dataset.budget)));
  }

  function quizStep2(products, budget) {
    const el = document.getElementById('srh-quiz-content');
    if (!el) return;
    el.innerHTML = '<div class="mono" style="font-size:9px;color:var(--text-3);margin-bottom:12px;">FRAGE 2/3</div>' +
      '<div class="headline" style="font-size:18px;margin-bottom:20px;">Welche Plattform?</div>' +
      '<div style="display:flex;flex-direction:column;gap:8px;">' +
      '<button class="btn quiz-btn" data-platform="pc" style="height:44px;justify-content:flex-start;padding:0 16px;">PC</button>' +
      '<button class="btn quiz-btn" data-platform="ps5" style="height:44px;justify-content:flex-start;padding:0 16px;">PlayStation 5</button>' +
      '<button class="btn quiz-btn" data-platform="xbox" style="height:44px;justify-content:flex-start;padding:0 16px;">Xbox</button>' +
      '</div>';
    el.querySelectorAll('.quiz-btn').forEach(btn => btn.addEventListener('click', () => quizStep3(products, budget, btn.dataset.platform)));
  }

  function quizStep3(products, budget, platform) {
    const el = document.getElementById('srh-quiz-content');
    if (!el) return;
    el.innerHTML = '<div class="mono" style="font-size:9px;color:var(--text-3);margin-bottom:12px;">FRAGE 3/3</div>' +
      '<div class="headline" style="font-size:18px;margin-bottom:20px;">Was suchst du?</div>' +
      '<div style="display:flex;flex-direction:column;gap:8px;">' +
      '<button class="btn quiz-btn" data-cat="wheelbase" style="height:44px;justify-content:flex-start;padding:0 16px;">Wheelbase</button>' +
      '<button class="btn quiz-btn" data-cat="pedals" style="height:44px;justify-content:flex-start;padding:0 16px;">Pedale</button>' +
      '<button class="btn quiz-btn" data-cat="wheel" style="height:44px;justify-content:flex-start;padding:0 16px;">Lenkrad</button>' +
      '<button class="btn quiz-btn" data-cat="cockpit" style="height:44px;justify-content:flex-start;padding:0 16px;">Cockpit</button>' +
      '</div>';
    el.querySelectorAll('.quiz-btn').forEach(btn => btn.addEventListener('click', () => quizResult(products, budget, platform, btn.dataset.cat)));
  }

  function quizResult(products, budget, platform, cat) {
    let candidates = products.filter(p => p.category === cat);
    if (budget === 'entry') candidates = candidates.filter(p => Math.min(...p.shops.map(s=>s.price)) <= 500);
    if (budget === 'mid') candidates = candidates.filter(p => { const m = Math.min(...p.shops.map(s=>s.price)); return m > 500 && m <= 1000; });
    if (budget === 'high') candidates = candidates.filter(p => Math.min(...p.shops.map(s=>s.price)) > 1000);
    if (platform !== 'pc') candidates = candidates.filter(p => p.platforms.includes(platform === 'ps5' ? 'PS5' : 'Xbox'));
    candidates.sort((a,b) => b.rating - a.rating);
    const rec = candidates[0] || products.filter(p => p.category === cat).sort((a,b) => b.rating - a.rating)[0];
    const el = document.getElementById('srh-quiz-content');
    if (rec && el) {
      el.innerHTML = '<div style="text-align:center;padding:20px 0;">' +
        '<div class="mono" style="font-size:9px;color:var(--text-3);margin-bottom:8px;">' + rec.brand + '</div>' +
        '<div class="headline" style="font-size:24px;margin-bottom:12px;">' + rec.name + '</div>' +
        '<div style="margin-bottom:16px;"><span class="stars">★★★★★</span> <span class="mono" style="font-size:12px;color:var(--text-2);">' + rec.rating.toFixed(1) + ' (' + rec.reviews + ')</span></div>' +
        '<div class="headline" style="color:var(--accent);font-size:28px;margin-bottom:20px;">' + fmtPrice(Math.min(...rec.shops.filter(s=>s.inStock).map(s=>s.price))) + '</div>' +
        '<a href="/simracehub-astro/produkte/' + rec.slug + '/" class="btn btn-primary" style="height:44px;padding:0 32px;font-size:13px;">Zum Bestpreis →</a>' +
        '</div>';
    }
  }

  // ---- BEST OF OVERLAY ----
  function openBestOfOverlay() {
    const bestCats = ['wheelbase','pedals','wheel','cockpit'];
    const best = bestCats.map(c => {
      const prods = products.filter(p => p.category === c);
      return prods.sort((a,b) => b.rating - a.rating)[0];
    }).filter(Boolean);
    const overlay = document.createElement('div');
    overlay.id = 'srh-bestof-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.85);backdrop-filter:blur(8px);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px;';
    let html = '<div style="background:var(--bg);border:1px solid var(--line);border-radius:8px;max-width:900px;width:100%;max-height:90vh;overflow:auto;">';
    html += '<div style="display:flex;justify-content:space-between;align-items:center;padding:16px 20px;border-bottom:1px solid var(--line);">';
    html += '<div class="headline" style="font-size:20px;">Best of 2026</div>';
    html += '<button id="srh-close-bo" style="background:none;border:none;color:var(--text-2);cursor:pointer;font-size:20px;">✕</button>';
    html += '</div>';
    html += '<div style="padding:20px;display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:16px;">';
    best.forEach(p => {
      html += '<div style="background:var(--panel);border:1px solid var(--line);border-radius:6px;padding:16px;">';
      html += '<div class="mono" style="font-size:9px;color:var(--accent);margin-bottom:8px;">' + p.categoryLabel + '</div>';
      html += '<div class="headline" style="font-size:16px;margin-bottom:8px;">' + p.name + '</div>';
      html += '<div style="margin-bottom:12px;"><span class="stars">★★★★★</span> <span class="mono" style="font-size:10px;color:var(--text-2);">' + p.rating.toFixed(1) + '</span></div>';
      html += '<div class="headline" style="color:var(--accent);font-size:18px;margin-bottom:12px;">' + fmtPrice(Math.min(...p.shops.filter(s=>s.inStock).map(s=>s.price))) + '</div>';
      html += '<a href="/simracehub-astro/produkte/' + p.slug + '/" class="btn btn-primary" style="height:32px;font-size:11px;">Ansehen →</a>';
      html += '</div>';
    });
    html += '</div></div>';
    overlay.innerHTML = html;
    document.body.appendChild(overlay);
    document.getElementById('srh-close-bo').addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
  }

  // ---- EVENT DELEGATION FOR COMPARE/FAV/NAV ----
  document.addEventListener('click', e => {
    const compareBtn = e.target.closest('.compare-btn');
    if (compareBtn) { e.preventDefault(); toggleCompare(parseInt(compareBtn.dataset.id)); return; }
    const favBtn = e.target.closest('.fav-btn');
    if (favBtn) { e.preventDefault(); toggleFav(parseInt(favBtn.dataset.id)); return; }
    const actionLink = e.target.closest('[data-action]');
    if (actionLink) {
      e.preventDefault();
      const a = actionLink.dataset.action;
      if (a === 'quiz') openQuizOverlay();
      else if (a === 'compare' || a === 'compare-all') { if (compareList.length >= 2) openCompareOverlay(products); else alert('Wähle mind. 2 Produkte zum Vergleichen (⚖ Button auf Karten)'); }
      else if (a === 'bestof') openBestOfOverlay();
      return;
    }
  });

  // ---- FEATURE SECTION LINKS ----
  document.querySelectorAll('#features a.btn').forEach(link => {
    link.addEventListener('click', e => {
      e.preventDefault();
      const txt = link.textContent.toLowerCase();
      if (txt.includes('quiz') || txt.includes('kaufberater')) openQuizOverlay();
      else if (txt.includes('vergleich')) { if (compareList.length >= 2) openCompareOverlay(products); else alert('Wähle mind. 2 Produkte zum Vergleichen (⚖ Button auf Produktkarten)'); }
      else if (txt.includes('best') || txt.includes('top')) openBestOfOverlay();
    });
  });

  // ---- INIT ----
  updateCompareBtns();
  updateFavBtns();

  // ---- CLOSE ON ESCAPE ----
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      closePopup();
      document.getElementById('srh-compare-overlay')?.remove();
      document.getElementById('srh-quiz-overlay')?.remove();
      document.getElementById('srh-bestof-overlay')?.remove();
    }
  });

  // Expose for feature section links
  window.openQuizOverlay = openQuizOverlay;
  window.openBestOfOverlay = openBestOfOverlay;
}

// ---- INIT ON DOM READY ----
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    const products = getProducts();
    if (products.length) initFilters(products);
  });
} else {
  const products = getProducts();
  if (products.length) initFilters(products);
}
