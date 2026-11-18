/* ==========================================================
   search.js  -  home page: date search + room type cards
   Flow: read dates -> validate -> HotelApi.getAvailability()
         -> draw one card per room type -> "Book" link carries
         the choice to booking.html in the URL.
   ========================================================== */
(function () {
  'use strict';
  const UI = window.UI, API = window.HotelApi, U = API.util;
  const form = UI.$('#search-form');
  const inEl = UI.$('#check-in'), outEl = UI.$('#check-out');
  const errEl = UI.$('#search-error');
  const list = UI.$('#room-list'), summary = UI.$('#results-summary');

  // 1. Default dates: tomorrow for 3 nights. min= stops the picker from choosing the past.
  const today = U.todayISO();
  inEl.min = U.addDays(today, 0);
  inEl.value = U.addDays(today, 1);
  outEl.value = U.addDays(today, 4);
  outEl.min = U.addDays(inEl.value, 1);

  // 2. When check-in changes, check-out must be at least one day later.
  inEl.addEventListener('change', function () {
    if (!inEl.value) return;
    outEl.min = U.addDays(inEl.value, 1);
    if (!outEl.value || outEl.value <= inEl.value) outEl.value = U.addDays(inEl.value, 1);
  });

  // 3. Submit: client-side check first (fast feedback). The server checks again (never trust the browser).
  form.addEventListener('submit', function (e) {
    e.preventDefault();
    errEl.textContent = '';
    if (!inEl.value || !outEl.value) { errEl.textContent = 'Please choose both dates.'; return; }
    if (inEl.value < today) { errEl.textContent = 'Check-in cannot be in the past.'; return; }
    if (outEl.value <= inEl.value) { errEl.textContent = 'Check-out must be after check-in.'; return; }
    search(true);
  });

  async function search(scroll) {
    list.innerHTML = '<p class="muted"><span class="spinner spinner--dark"></span> Checking availability…</p>';
    try {
      const res = await API.getAvailability(inEl.value, outEl.value);
      render(res);
      if (scroll) UI.$('#rooms').scrollIntoView({ behavior: 'smooth' });
    } catch (err) {
      list.innerHTML = '';
      errEl.textContent = (err.fields && (err.fields.check_in_date || err.fields.check_out_date)) || err.message;
    }
  }

  // 4. Draw the cards. Text shown to the user is escaped with UI.esc().
  function render(res) {
    const info = window.HotelData.ROOM_TYPE_INFO;
    const n = res.nights;
    summary.textContent = UI.fmtDate(res.check_in_date) + ' → ' + UI.fmtDate(res.check_out_date) + ' · ' + n + (n === 1 ? ' night' : ' nights');
    list.innerHTML = res.types.map(function (t) {
      const d = info[t.room_type_id];
      const soldOut = t.available === 0;
      const low = t.available > 0 && t.available <= 3;
      const availClass = soldOut ? 'avail--none' : (low ? 'avail--low' : '');
      const availText = soldOut ? 'Sold out for these dates' : (low ? 'Only ' + t.available + ' left' : t.available + ' of ' + t.total_rooms + ' rooms free');
      const href = 'booking.html?type=' + t.room_type_id + '&in=' + res.check_in_date + '&out=' + res.check_out_date;
      return '<article class="card room-card">' +
        '<div class="room-card__img room-card__img--' + t.room_type_id + '">' + UI.esc(t.type_name) + '</div>' +
        '<div class="room-card__body">' +
          '<div><strong>' + UI.esc(d.tagline) + '</strong><br><span class="muted small">' + UI.esc(d.beds) + ' · up to ' + d.guests + ' guests · ' + UI.esc(d.size) + '</span></div>' +
          '<ul>' + d.perks.map(function (p) { return '<li>' + UI.esc(p) + '</li>'; }).join('') + '</ul>' +
          '<div class="price">' + UI.money(t.price_per_night) + ' <small>/ night</small></div>' +
          '<div class="muted small">' + n + (n === 1 ? ' night' : ' nights') + ' = <strong>' + UI.money(t.total_price) + '</strong> (estimate)</div>' +
          '<div class="room-card__foot">' +
            '<span class="avail ' + availClass + '">' + availText + '</span>' +
            (soldOut ? '<button class="btn btn--sm" disabled>Unavailable</button>' : '<a class="btn btn--sm" href="' + href + '">Book now</a>') +
          '</div>' +
        '</div></article>';
    }).join('');
  }

  search();   // show availability for the default dates when the page opens
})();
