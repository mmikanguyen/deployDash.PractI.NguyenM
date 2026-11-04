(() => {
  'use strict';

  const $ = (s) => document.querySelector(s);
  const TEXT_KEYS = new Set(['name', 'city', 'state', 'restaurant']);
  const COLORS = { food: '#2f6f5e', alcohol: '#b5446e', tips: '#e0a030', steel: '#5b7c99', grid: '#e3eae8', ink: '#1c2b2a' };
  const SERIES = ['#2f6f5e', '#b5446e', '#e0a030', '#5b7c99', '#7a5c99', '#c8693a', '#3e9aa8', '#8a9a3b'];
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  // MySQL DAYOFWEEK: 1 = Sunday. Display Monday first.
  const DAYS = [[2, 'Mon'], [3, 'Tue'], [4, 'Wed'], [5, 'Thu'], [6, 'Fri'], [7, 'Sat'], [1, 'Sun']];

  const money = (n) => '$' + Math.round(Number(n) || 0).toLocaleString();
  const money2 = (n) => '$' + (Number(n) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const int = (n) => (Number(n) || 0).toLocaleString();
  const dec1 = (n) => (n == null ? '–' : Number(n).toFixed(1));
  const pct = (n) => (n == null || !isFinite(n) ? '–' : n.toFixed(1) + '%');
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const charts = {};
  let filtersReady = false;

  /* ---------- data helpers ---------- */
  function numify(v, key) {
    if (Array.isArray(v)) return v.map((x) => numify(x));
    if (v && typeof v === 'object') {
      return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, numify(x, k)]));
    }
    if (typeof v === 'string' && !TEXT_KEYS.has(key) && /^-?\d+(\.\d+)?$/.test(v)) return Number(v);
    return v;
  }

  function monthLabel(ym) {
    const [y, m] = ym.split('-').map(Number);
    return MONTHS[m - 1] + " '" + String(y).slice(2);
  }

  /* ---------- chart helpers ---------- */
  function setupChartDefaults() {
    Chart.defaults.font.family = "'Public Sans', 'Segoe UI', system-ui, sans-serif";
    Chart.defaults.font.size = 12;
    Chart.defaults.color = '#55696a';
    Chart.defaults.maintainAspectRatio = false;
    Chart.defaults.plugins.legend.labels.boxWidth = 12;
    Chart.defaults.plugins.legend.labels.boxHeight = 12;
    Chart.defaults.plugins.tooltip.padding = 10;
  }

  function draw(id, config) {
    if (charts[id]) charts[id].destroy();
    charts[id] = new Chart(document.getElementById(id), config);
  }

  const moneyAxis = { ticks: { callback: (v) => '$' + Number(v).toLocaleString() }, grid: { color: COLORS.grid } };
  const countAxis = { beginAtZero: true, ticks: { precision: 0 }, grid: { color: COLORS.grid } };
  const noGrid = { grid: { display: false } };

  function hbar(id, labels, datasets, opts = {}) {
    draw(id, {
      type: 'bar',
      data: { labels, datasets },
      options: {
        indexAxis: 'y',
        plugins: { legend: { display: datasets.length > 1 }, tooltip: { callbacks: opts.tooltip || {} } },
        scales: {
          x: { ...(opts.money ? moneyAxis : countAxis), stacked: !!opts.stacked, beginAtZero: true },
          y: { ...noGrid, stacked: !!opts.stacked },
        },
      },
    });
  }

  /* ---------- sections ---------- */
  function renderReceipt(k, scope) {
    const sales = k.food + k.alcohol;
    const total = sales + k.tips;
    const tipRate = sales ? (k.tips / sales) * 100 : null;
    const avgCheck = k.visits ? sales / k.visits : null;
    const line = (label, value, cls = '') =>
      `<div class="line ${cls}"><span class="swatch"></span><span>${label}</span><span class="dots"></span><strong>${value}</strong></div>`;
    $('#receipt').innerHTML = `
      <h2>Grand total</h2>
      <p class="scope">${esc(scope)}</p>
      ${line('Food', money2(k.food), 'food')}
      ${line('Alcohol', money2(k.alcohol), 'alcohol')}
      <hr class="rule">
      ${line('Sales', money2(sales))}
      ${line('Tips', money2(k.tips), 'tips')}
      ${line('Total', money2(total), 'big')}
      <hr class="rule">
      ${line('Visits', int(k.visits))}
      ${line('Guests seated', int(k.guests))}
      ${line('Unique customers', int(k.customers))}
      ${line('Seen at 2+ restaurants', int(k.multi_restaurant_customers))}
      ${line('Average check', avgCheck == null ? '–' : money2(avgCheck))}
      ${line('Average tip', pct(tipRate))}
      ${line('Average wait (min)', dec1(k.avg_wait))}
      ${k.avg_discount != null ? line('Average food discount', dec1(k.avg_discount) + '%') : ''}
      <hr class="rule">
      <p class="thanks">Customers are counted once per restaurant, and once overall.</p>`;
  }

  function renderMonthly(rows) {
    draw('c-monthly', {
      type: 'bar',
      data: {
        labels: rows.map((r) => monthLabel(r.month)),
        datasets: [
          { label: 'Food', data: rows.map((r) => r.food), backgroundColor: COLORS.food, stack: 's', yAxisID: 'y', order: 2 },
          { label: 'Alcohol', data: rows.map((r) => r.alcohol), backgroundColor: COLORS.alcohol, stack: 's', yAxisID: 'y', order: 2 },
          { type: 'line', label: 'Visits', data: rows.map((r) => r.visits), borderColor: COLORS.tips, backgroundColor: COLORS.tips, borderWidth: 2.5, pointRadius: 3, tension: 0.25, yAxisID: 'y1', order: 1 },
        ],
      },
      options: {
        interaction: { mode: 'index', intersect: false },
        plugins: { tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${c.dataset.label === 'Visits' ? int(c.raw) : money(c.raw)}` } } },
        scales: {
          x: { ...noGrid, stacked: true },
          y: { ...moneyAxis, stacked: true, beginAtZero: true },
          y1: { position: 'right', beginAtZero: true, grid: { display: false }, ticks: { precision: 0 } },
        },
      },
    });
  }

  function renderMix(k) {
    const sales = k.food + k.alcohol;
    draw('c-mix', {
      type: 'doughnut',
      data: { labels: ['Food', 'Alcohol'], datasets: [{ data: [k.food, k.alcohol], backgroundColor: [COLORS.food, COLORS.alcohol], borderWidth: 2, borderColor: '#fff' }] },
      options: {
        cutout: '58%',
        plugins: { legend: { position: 'bottom' }, tooltip: { callbacks: { label: (c) => `${c.label}: ${money(c.raw)}` } } },
      },
    });
    $('#mix-note').textContent = sales
      ? `Alcohol is ${((k.alcohol / sales) * 100).toFixed(1)}% of sales: ${money(k.alcohol)} against ${money(k.food)} for food.`
      : 'No sales in this selection.';
  }

  function renderRestaurants(rows, kpis) {
    const names = rows.map((r) => r.name);
    hbar('c-rev', names, [
      { label: 'Food', data: rows.map((r) => r.food), backgroundColor: COLORS.food },
      { label: 'Alcohol', data: rows.map((r) => r.alcohol), backgroundColor: COLORS.alcohol },
    ], { money: true, stacked: true, tooltip: { label: (c) => `${c.dataset.label}: ${money(c.raw)}` } });

    hbar('c-visits', names, [{ label: 'Visits', data: rows.map((r) => r.visits), backgroundColor: COLORS.steel }]);

    hbar('c-cust', names, [{ label: 'Unique customers', data: rows.map((r) => r.customers), backgroundColor: COLORS.tips }]);
    $('#cust-note').textContent = `${int(kpis.customers)} unique customers across all restaurants in this selection. A customer who visits several restaurants counts once in that total.`;

    const cols = [
      { key: 'name', label: 'Restaurant' },
      { key: 'location', label: 'Location' },
      { key: 'visits', label: 'Visits', num: true, fmt: int },
      { key: 'customers', label: 'Customers', num: true, fmt: int },
      { key: 'food', label: 'Food', num: true, fmt: money },
      { key: 'alcohol', label: 'Alcohol', num: true, fmt: money },
      { key: 'tips', label: 'Tips', num: true, fmt: money },
      { key: 'avg_check', label: 'Avg check', num: true, fmt: money2 },
      { key: 'tip_rate', label: 'Tip rate', num: true, fmt: pct },
      { key: 'avg_wait', label: 'Avg wait (min)', num: true, fmt: dec1 },
    ];
    const data = rows.map((r) => {
      const sales = r.food + r.alcohol;
      return {
        ...r,
        location: [r.city, r.state].filter(Boolean).join(', '),
        avg_check: r.visits ? sales / r.visits : 0,
        tip_rate: sales ? (r.tips / sales) * 100 : null,
      };
    });
    sortableTable('#t-rest', cols, data, 'visits');
  }

  function renderYoY(rows) {
    const years = [...new Set(rows.map((r) => r.year))].sort();
    draw('c-yoy', {
      type: 'line',
      data: {
        labels: MONTHS,
        datasets: years.map((y, i) => ({
          label: String(y),
          data: MONTHS.map((_, m) => rows.find((r) => r.year === y && r.month === m + 1)?.revenue ?? null),
          borderColor: SERIES[i % SERIES.length],
          backgroundColor: SERIES[i % SERIES.length],
          borderWidth: 2.5, pointRadius: 3, tension: 0.25, spanGaps: true,
        })),
      },
      options: {
        interaction: { mode: 'index', intersect: false },
        plugins: { tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${money(c.raw)}` } } },
        scales: { x: noGrid, y: { ...moneyAxis, beginAtZero: true } },
      },
    });
  }

  function renderWeekday(rows) {
    const by = Object.fromEntries(rows.map((r) => [r.dow, r.visits]));
    draw('c-dow', {
      type: 'bar',
      data: { labels: DAYS.map((d) => d[1]), datasets: [{ label: 'Visits', data: DAYS.map((d) => by[d[0]] || 0), backgroundColor: COLORS.steel }] },
      options: { plugins: { legend: { display: false } }, scales: { x: noGrid, y: countAxis } },
    });
  }

  function renderHeat(rows) {
    const el = $('#heat');
    const cells = rows.filter((r) => r.hr != null);
    if (!cells.length) { el.innerHTML = '<p class="empty">No visit times in this selection.</p>'; return; }
    const hrs = cells.map((r) => r.hr);
    const lo = Math.min(...hrs), hi = Math.max(...hrs);
    const max = Math.max(...cells.map((r) => r.visits));
    const lookup = new Map(cells.map((r) => [`${r.dow}-${r.hr}`, r.visits]));
    const hourName = (h) => (h === 0 ? '12a' : h < 12 ? h + 'a' : h === 12 ? '12p' : h - 12 + 'p');
    const n = hi - lo + 1;
    let html = `<div class="heat-grid" style="grid-template-columns:44px repeat(${n}, minmax(0,1fr))"><span></span>`;
    for (let h = lo; h <= hi; h++) html += `<span class="heat-label col">${hourName(h)}</span>`;
    for (const [dow, name] of DAYS) {
      html += `<span class="heat-label">${name}</span>`;
      for (let h = lo; h <= hi; h++) {
        const v = lookup.get(`${dow}-${h}`) || 0;
        const a = v ? 0.12 + 0.88 * (v / max) : 0;
        html += `<span class="heat-cell" style="${v ? `background:rgba(47,111,94,${a.toFixed(2)})` : ''}" title="${name} ${hourName(h)}: ${v} visits">${v && n <= 16 ? v : ''}</span>`;
      }
    }
    el.innerHTML = html + '</div>';
  }

  function renderMix2(meals, payments, party) {
    draw('c-meal', {
      type: 'doughnut',
      data: { labels: meals.map((m) => m.name), datasets: [{ data: meals.map((m) => m.visits), backgroundColor: SERIES, borderWidth: 2, borderColor: '#fff' }] },
      options: { cutout: '55%', plugins: { legend: { position: 'bottom' }, tooltip: { callbacks: { label: (c) => `${c.label}: ${int(c.raw)} visits` } } } },
    });
    draw('c-pay', {
      type: 'bar',
      data: { labels: payments.map((p) => p.name), datasets: [{ label: 'Sales', data: payments.map((p) => p.revenue), backgroundColor: COLORS.steel }] },
      options: {
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => `${money(c.raw)} across ${int(payments[c.dataIndex].bills)} bills` } } },
        scales: { x: noGrid, y: { ...moneyAxis, beginAtZero: true } },
      },
    });
    draw('c-party', {
      type: 'bar',
      data: { labels: party.map((p) => p.size), datasets: [{ label: 'Visits', data: party.map((p) => p.visits), backgroundColor: COLORS.food }] },
      options: {
        plugins: { legend: { display: false }, tooltip: { callbacks: { title: (i) => `Party of ${i[0].label}` } } },
        scales: { x: { ...noGrid, title: { display: true, text: 'Guests in party' } }, y: countAxis },
      },
    });
  }

  function renderPeople(loyalty, servers, customers) {
    const lc = [
      { key: 'name', label: 'Group' },
      { key: 'customers', label: 'Customers', num: true, fmt: int },
      { key: 'visits', label: 'Visits', num: true, fmt: int },
      { key: 'revenue', label: 'Sales', num: true, fmt: money },
      { key: 'per_visit', label: 'Sales per visit', num: true, fmt: money2 },
      { key: 'visits_per', label: 'Visits per customer', num: true, fmt: dec1 },
      { key: 'tip_rate', label: 'Tip rate', num: true, fmt: pct },
    ];
    sortableTable('#t-loyal', lc, loyalty.map((r) => ({
      ...r,
      per_visit: r.visits ? r.revenue / r.visits : 0,
      visits_per: r.customers ? r.visits / r.customers : 0,
      tip_rate: r.revenue ? (r.tips / r.revenue) * 100 : null,
    })), 'revenue');

    sortableTable('#t-servers', [
      { key: 'name', label: 'Server' },
      { key: 'restaurant', label: 'Restaurant' },
      { key: 'visits', label: 'Visits', num: true, fmt: int },
      { key: 'tips', label: 'Tips', num: true, fmt: money },
      { key: 'tip_rate', label: 'Tip rate', num: true, fmt: pct },
    ], servers.map((s) => ({ ...s, tip_rate: s.revenue ? (s.tips / s.revenue) * 100 : null })), 'tips');

    sortableTable('#t-customers', [
      { key: 'name', label: 'Customer' },
      { key: 'visits', label: 'Visits', num: true, fmt: int },
      { key: 'restaurants', label: 'Restaurants', num: true, fmt: int },
      { key: 'spend', label: 'Spent', num: true, fmt: money },
    ], customers, 'spend');
  }

  /* ---------- sortable table ---------- */
  function sortableTable(sel, cols, rows, sortKey) {
    const el = $(sel);
    if (!rows.length) { el.innerHTML = '<p class="empty">Nothing to show for this selection.</p>'; return; }
    const state = { key: sortKey, dir: -1 };
    const paint = () => {
      const sorted = [...rows].sort((a, b) => {
        const x = a[state.key], y = b[state.key];
        if (x == null) return 1;
        if (y == null) return -1;
        return (typeof x === 'string' ? x.localeCompare(y) : x - y) * state.dir;
      });
      el.innerHTML = `<table><thead><tr>${cols.map((c) =>
        `<th class="${c.num ? 'num' : ''}" aria-sort="${state.key === c.key ? (state.dir < 0 ? 'descending' : 'ascending') : 'none'}"><button type="button" data-k="${c.key}">${c.label}</button></th>`
      ).join('')}</tr></thead><tbody>${sorted.map((r) =>
        `<tr>${cols.map((c) => `<td class="${c.num ? 'num' : ''}">${c.fmt ? c.fmt(r[c.key]) : esc(r[c.key])}</td>`).join('')}</tr>`
      ).join('')}</tbody></table>`;
      el.querySelectorAll('button[data-k]').forEach((b) => b.addEventListener('click', () => {
        const k = b.dataset.k;
        state.dir = state.key === k ? -state.dir : (typeof rows[0][k] === 'string' ? 1 : -1);
        state.key = k;
        paint();
      }));
    };
    paint();
  }

  /* ---------- loading ---------- */
  function fillFilters(f) {
    const add = (sel, items, val, label) => {
      const s = $(sel);
      items.forEach((i) => s.insertAdjacentHTML('beforeend', `<option value="${esc(val(i))}">${esc(label(i))}</option>`));
    };
    add('#f-year', f.years, (y) => y, (y) => y);
    add('#f-restaurant', f.restaurants, (r) => r.id, (r) => r.name);
    add('#f-meal', f.meals, (m) => m.id, (m) => m.name);
    filtersReady = true;
  }

  function scopeText() {
    const pick = (sel, all) => { const s = $(sel); return s.value ? s.options[s.selectedIndex].text : all; };
    return `${pick('#f-restaurant', 'All restaurants')}, ${pick('#f-year', 'all years')}, ${pick('#f-meal', 'all meals').toLowerCase()}`;
  }

  function showError(msg) {
    const b = $('#banner');
    b.textContent = msg;
    b.hidden = false;
  }

  async function load() {
    const qs = new URLSearchParams();
    ['year', 'restaurant', 'meal'].forEach((k) => { const v = $('#f-' + k).value; if (v) qs.set(k, v); });
    $('#main').setAttribute('aria-busy', 'true');
    $('#banner').hidden = true;
    try {
      const res = await fetch('api.php?' + qs.toString(), { headers: { Accept: 'application/json' } });
      const raw = await res.json().catch(() => ({ error: 'The server sent an unreadable response.' }));
      if (!res.ok || raw.error) throw new Error(raw.error || res.statusText);
      const d = numify(raw);
      if (!filtersReady) fillFilters(d.filters);
      renderReceipt(d.kpis, scopeText());
      renderMonthly(d.monthly);
      renderMix(d.kpis);
      renderRestaurants(d.restaurants, d.kpis);
      renderYoY(d.yoy);
      renderWeekday(d.weekday);
      renderHeat(d.heat);
      renderMix2(d.meals, d.payments, d.party);
      renderPeople(d.loyalty, d.servers, d.customers);
      $('#updated').textContent = 'Updated ' + new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    } catch (e) {
      showError(e.message);
    } finally {
      $('#main').setAttribute('aria-busy', 'false');
    }
  }

  window.addEventListener('DOMContentLoaded', () => {
    setupChartDefaults();
    ['year', 'restaurant', 'meal'].forEach((k) => $('#f-' + k).addEventListener('change', load));
    $('#reset').addEventListener('click', () => {
      ['year', 'restaurant', 'meal'].forEach((k) => ($('#f-' + k).value = ''));
      load();
    });
    load();
  });
})();
