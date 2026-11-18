/* ==========================================================
   connection.js  -  "Backend connection" page
   Shows live proof that the frontend talks to the backend:
   status, API tester, request log and database tables.
   ========================================================== */
(function () {
  'use strict';
  const UI = window.UI, API = window.HotelApi, U = API.util;
  const el = function (id) { return document.getElementById(id); };
  let seenLog = null;     // ids already shown, to highlight new rows

  /* ---------- 1. status ---------- */
  API.onStatus(function (st) {
    const live = st.mode === 'backend';
    el('c-status').innerHTML = live ? '<span class="status-ok">● CONNECTED</span>'
      : st.mode === 'offline' ? '<span class="status-bad">● SERVER NOT RESPONDING</span>'
      : st.mode === 'mock' ? '<span class="muted">○ No server found (demo mode)</span>' : 'checking…';
    el('c-base').textContent = st.base;
    el('c-ms').textContent = st.lastMs == null ? '–' : st.lastMs + ' ms';
    el('c-calls').textContent = st.requests;
    ['n-front'].forEach(function (id) { el(id).classList.remove('is-down'); });
    el('n-back').classList.toggle('is-down', !live);
    el('n-db').classList.toggle('is-down', !live);
    if (st.info) {
      el('c-up').textContent = st.info.uptime_seconds + ' s (Node ' + st.info.node + ')';
      const t = st.info.database.tables;
      el('c-db').textContent = st.info.database.engine + ' · file ' + st.info.database.file + ' · ' +
        Object.keys(t).map(function (k) { return k + ': ' + t[k]; }).join(', ');
    }
    el('offline-note').innerHTML = live ? '' :
      '<div class="alert alert--warn"><strong>The backend is not running.</strong> Start it in a terminal: <code>node server/server.js</code>, then open <a href="http://localhost:3000/connection.html">http://localhost:3000/connection.html</a>.</div>';
  });
  el('ping-btn').addEventListener('click', async function () {
    const st = await API.ping();
    if (st) { hit('n-back'); loadHealth(); } else UI.toast('Server not responding', 'bad');
  });
  function loadHealth() { return API.ping(); }       // GET /api/health, updates the status table

  /* little animation: the node lights up when a request goes through */
  function hit(id) { const n = el(id); n.classList.add('is-hot'); setTimeout(function () { n.classList.remove('is-hot'); }, 500); }

  /* ---------- 2. API tester ---------- */
  el('tester').addEventListener('click', async function (e) {
    const b = e.target.closest('[data-req]');
    if (!b) return;
    const parts = b.getAttribute('data-req').split(' ');
    let path = parts[1];
    if (path === '/api/availability') path += '?in=' + U.addDays(U.todayISO(), 1) + '&out=' + U.addDays(U.todayISO(), 4);
    el('curl-line').textContent = 'curl ' + (API.status().base || 'http://localhost:3000') + path;
    el('tester-meta').textContent = 'Sending…';
    const t0 = performance.now();
    hit('n-front');
    try {
      const data = await API.call(parts[0], path);
      hit('n-back'); hit('n-db');
      el('tester-meta').innerHTML = '<span class="status-ok">200 OK</span> · ' + Math.round(performance.now() - t0) + ' ms · ' + UI.esc(parts[0] + ' ' + path);
      el('tester-out').textContent = JSON.stringify(data, null, 2).slice(0, 3000);
    } catch (err) {
      el('tester-meta').innerHTML = '<span class="status-bad">' + UI.esc(err.status || 'ERROR') + '</span> · ' + UI.esc(err.message);
      el('tester-out').textContent = '// the request failed: is the backend running?';
    }
  });

  /* ---------- 3. request log ---------- */
  async function refreshLog() {
    if (API.mode() !== 'backend') return;
    try {
      const rows = await fetch((API.status().base || '') + '/api/logs', { cache: 'no-store' }).then(function (r) { return r.json(); });
      const visible = rows.filter(function (r) { return r.url.indexOf('/api/') === 0 && r.url.indexOf('/api/logs') !== 0; }).slice(0, 15);
      const keys = visible.map(function (r) { return r.time + r.method + r.url; });
      el('log-table').querySelector('tbody').innerHTML = visible.length ? visible.map(function (r, i) {
        const isNew = seenLog && seenLog.indexOf(keys[i]) < 0;
        return '<tr class="' + (isNew ? 'is-new' : '') + '"><td class="small">' + UI.esc(r.time.slice(11, 19)) + '</td>' +
          '<td><span class="method method--' + UI.esc(r.method) + '">' + UI.esc(r.method) + '</span></td><td><code>' + UI.esc(r.url) + '</code></td>' +
          '<td class="' + (r.status < 400 ? 'status-ok' : 'status-bad') + '">' + r.status + '</td><td class="num">' + r.ms + '</td></tr>';
      }).join('') : '<tr><td colspan="5" class="muted">Waiting for requests…</td></tr>';
      seenLog = keys;
    } catch (e) { /* the badge shows the problem */ }
  }
  setInterval(refreshLog, 1500);

  /* ---------- 4. database tables ---------- */
  async function loadTable() {
    if (API.mode() !== 'backend') return;
    const name = el('table-select').value;
    try {
      const rows = await API.call('GET', '/api/tables/' + name);
      const cols = rows.length ? Object.keys(rows[0]) : [];
      el('db-table').querySelector('thead').innerHTML = cols.length ? '<tr>' + cols.map(function (c) { return '<th>' + UI.esc(c) + '</th>'; }).join('') + '</tr>' : '';
      el('db-table').querySelector('tbody').innerHTML = rows.length
        ? rows.map(function (r) { return '<tr>' + cols.map(function (c) { return '<td>' + UI.esc(r[c]) + '</td>'; }).join('') + '</tr>'; }).join('')
        : '<tr><td class="muted">This table is empty. Make a booking first.</td></tr>';
      el('table-count').textContent = rows.length + ' rows';
      hit('n-db');
    } catch (e) { el('table-count').textContent = 'Could not load the table.'; }
  }
  el('table-refresh').addEventListener('click', loadTable);
  el('table-select').addEventListener('change', loadTable);

  API.ready.then(function () { loadHealth(); loadTable(); refreshLog(); });
})();
