/* ==========================================================
   staff.js  -  reception view: bookings table, room board, tests
   ========================================================== */
(function () {
  'use strict';
  const UI = window.UI, API = window.HotelApi, U = API.util;
  const tbody = UI.$('#bookings-table tbody');
  const filter = UI.$('#status-filter');
  const boardDate = UI.$('#board-date');
  let all = [];

  /* ----- bookings table + stats ----- */
  async function refresh() {
    all = await API.listBookings();
    drawStats();
    drawTable();
    drawBoard();
  }

  function drawStats() {
    const today = U.todayISO();
    const active = all.filter(function (b) { return b.status !== 'CANCELLED'; });
    const arrivals = active.filter(function (b) { return b.check_in_date === today; }).length;
    const inHouse = active.filter(function (b) { return b.check_in_date <= today && today < b.check_out_date; }).length;
    const pending = all.filter(function (b) { return b.status === 'PENDING'; }).length;
    const revenue = all.filter(function (b) { return b.status === 'CONFIRMED'; }).reduce(function (s, b) { return s + b.total_price; }, 0);
    UI.$('#stats').innerHTML =
      stat(inHouse + ' / 40', 'Rooms occupied today') + stat(arrivals, 'Arrivals today') +
      stat(pending, 'Pending payment') + stat(UI.money(revenue), 'Confirmed revenue');
  }
  function stat(v, label) { return '<div class="stat"><b>' + UI.esc(v) + '</b><span class="muted small">' + UI.esc(label) + '</span></div>'; }

  function drawTable() {
    const rows = all.filter(function (b) { return !filter.value || b.status === filter.value; });
    if (!rows.length) { tbody.innerHTML = '<tr><td colspan="8" class="muted" style="padding:1.5rem">No bookings yet. Make one on the “Book a room” page or press “Load sample bookings”.</td></tr>'; return; }
    tbody.innerHTML = rows.map(function (b) {
      let actions = '';
      if (b.status === 'PENDING') actions += '<button class="btn btn--sm btn--teal" data-confirm="' + b.booking_id + '" title="Guest paid at the hotel desk">Paid at desk</button> ';
      if (b.status !== 'CANCELLED') actions += '<button class="btn btn--sm btn--danger" data-cancel="' + b.booking_id + '">Cancel</button>';
      return '<tr>' +
        '<td>#' + b.booking_id + '</td>' +
        '<td><strong>' + UI.esc(b.guest_name) + '</strong>' + (b.special_requests ? '<br><span class="muted small">“' + UI.esc(b.special_requests) + '”</span>' : '') + '</td>' +
        '<td class="small">' + UI.esc(b.email) + '<br>' + UI.esc(b.phone_number) + '</td>' +
        '<td>' + UI.esc(b.room_type) + '<br><span class="muted small">No. ' + UI.esc(b.room_number) + '</span></td>' +
        '<td class="small">' + UI.fmtDate(b.check_in_date) + '<br>→ ' + UI.fmtDate(b.check_out_date) + '</td>' +
        '<td class="num">' + UI.money(b.total_price) + '</td>' +
        '<td>' + UI.chip(b.status) + '</td>' +
        '<td>' + actions + '</td></tr>';
    }).join('');
  }
  filter.addEventListener('change', drawTable);

  tbody.addEventListener('click', async function (e) {
    const c = e.target.closest('[data-confirm]'), x = e.target.closest('[data-cancel]');
    try {
      if (c) { await API.confirmAtDesk(Number(c.getAttribute('data-confirm'))); UI.toast('Booking confirmed. Email sent to the guest.'); }
      else if (x) { if (!confirm('Cancel this booking?')) return; await API.cancelBooking(Number(x.getAttribute('data-cancel'))); UI.toast('Booking cancelled.'); }
      else return;
      refresh();
    } catch (err) { UI.toast(err.message, 'bad'); }
  });

  UI.$('#seed-btn').addEventListener('click', async function () { await API.seedDemo(); UI.toast('Sample bookings added.'); refresh(); });
  UI.$('#reset-btn').addEventListener('click', async function () {
    if (!confirm('Delete ALL bookings and guests in this browser?')) return;
    await API.resetDemo(); UI.toast('Data reset.'); refresh();
  });

  /* ----- room board ----- */
  async function drawBoard() {
    const rooms = await API.listRoomsForDate(boardDate.value);
    UI.$('#room-grid').innerHTML = rooms.map(function (r) {
      const tip = (r.room_type + (r.room_notes ? ' – ' + r.room_notes : '')) + (r.booking_id ? ' (booking #' + r.booking_id + ')' : '');
      return '<div class="room-tile is-' + r.state + '" title="' + UI.esc(tip) + '"><b>' + UI.esc(r.room_number) + '</b>' + UI.esc(r.room_type) + '</div>';
    }).join('');
  }
  boardDate.value = U.todayISO();
  boardDate.addEventListener('change', drawBoard);

  /* ----- acceptance tests ----- */
  const out = UI.$('#test-out');
  UI.$('#race-btn').addEventListener('click', async function (e) {
    const btn = e.currentTarget; btn.disabled = true;
    const live = API.mode() === 'backend';
    out.innerHTML = '<p class="muted"><span class="spinner spinner--dark"></span> Sending 50 requests at the same time' + (live ? ' to the real server' : '') + '…</p>';
    const unsafe = await API.runConcurrencyTest({ requests: 50, safe: false });          // simulation in the browser: what happens WITHOUT protection
    const safe = live ? await API.runLiveRaceTest(50) : await API.runConcurrencyTest({ requests: 50, safe: true });
    out.innerHTML =
      '<div class="test-box test-box--bad"><strong>Without lock and without unique rule (simulation)</strong>' +
        '<b class="big">' + unsafe.saved_in_database + ' bookings saved for ONE room</b>' +
        '<p class="small" style="margin:0">All 50 requests read “room is free” before any of them saved. This is the double booking from Task 06 (breaks Isolation and Consistency).</p></div>' +
      '<div class="test-box test-box--ok"><strong>' + (live ? 'Our REAL backend: 50 real HTTP requests' : 'With lock + unique rule (our design)') + '</strong>' +
        '<b class="big">' + safe.saved_in_database + ' booking saved</b>' +
        '<p class="small" style="margin:0">' + Object.keys(safe.rejected).map(function (k) { return safe.rejected[k] + ' requests rejected with ' + UI.esc(k); }).join(', ') + '. ' +
        (safe.saved_in_database === 1 ? '<strong>Acceptance criterion passed.</strong>' : '<strong>Failed.</strong>') +
        (live ? ' The test booking was cancelled afterwards.' : '') + '</p></div>';
    btn.disabled = false;
    refresh();
  });
  UI.$('#load-btn').addEventListener('click', async function (e) {
    const btn = e.currentTarget; btn.disabled = true;
    out.innerHTML = '<p class="muted"><span class="spinner spinner--dark"></span> Creating 100 bookings…</p>';
    const r = await API.runLoadTest({ bookings: 100 });
    const pass = r.lost === 0 && r.saved_in_database === 100;
    out.innerHTML = '<div class="test-box ' + (pass ? 'test-box--ok' : 'test-box--bad') + '"><strong>100 test bookings</strong>' +
      '<b class="big">' + r.saved_in_database + ' saved, ' + r.lost + ' lost</b>' +
      '<p class="small" style="margin:0">' + r.accepted + ' accepted by the server, ' + r.saved_in_database + ' found in the database. ' + (pass ? '<strong>Acceptance criterion passed.</strong>' : '<strong>Failed.</strong>') + '</p></div>';
    btn.disabled = false;
  });

  refresh();
})();
