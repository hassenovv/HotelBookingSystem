/* ==========================================================
   bookings.js  -  "My bookings": find by email, show status, cancel
   ========================================================== */
(function () {
  'use strict';
  const UI = window.UI, API = window.HotelApi;
  const form = UI.$('#lookup-form'), emailEl = UI.$('#email'), errEl = UI.$('#email-error');
  const list = UI.$('#list'), btn = UI.$('#lookup-btn');

  form.addEventListener('submit', function (e) { e.preventDefault(); load(); });

  async function load() {
    errEl.textContent = '';
    btn.disabled = true;
    list.innerHTML = '<p class="muted"><span class="spinner spinner--dark"></span> Looking for your bookings…</p>';
    try {
      const res = await API.getBookingsByEmail(emailEl.value);
      render(res);
    } catch (err) {
      list.innerHTML = '';
      errEl.textContent = err.message;
    } finally { btn.disabled = false; }
  }

  function render(res) {
    if (!res.user) { list.innerHTML = '<div class="alert alert--info">No bookings found for this email.</div>'; return; }
    if (!res.bookings.length) { list.innerHTML = '<div class="alert alert--info">You have no bookings yet. <a href="booking.html">Book a room</a></div>'; return; }
    list.innerHTML = '<h2 style="font-size:1.3rem">Hello, ' + UI.esc(res.user.first_name) + '</h2>' +
      '<div class="grid">' + res.bookings.map(function (b) {
        const cancellable = b.status !== 'CANCELLED';
        return '<article class="card booking-item">' +
          '<div><h3>#' + b.booking_id + ' · ' + UI.esc(b.room_type) + ' (room ' + UI.esc(b.room_number) + ')</h3>' +
          '<div class="muted">' + UI.fmtDate(b.check_in_date) + ' → ' + UI.fmtDate(b.check_out_date) + ' · ' + b.nights + (b.nights === 1 ? ' night' : ' nights') +
          ' · <strong>' + UI.money(b.total_price) + '</strong></div></div>' +
          '<div class="actions">' + UI.chip(b.status) +
          (cancellable ? '<button class="btn btn--sm btn--danger" data-cancel="' + b.booking_id + '">Cancel</button>' : '') + '</div></article>';
      }).join('') + '</div>';
  }

  // One listener on the list (event delegation) handles every Cancel button, also the ones drawn later.
  list.addEventListener('click', async function (e) {
    const b = e.target.closest('[data-cancel]');
    if (!b) return;
    if (!window.confirm('Cancel this booking? The room will be released.')) return;
    b.disabled = true;
    try {
      await API.cancelBooking(Number(b.getAttribute('data-cancel')));
      UI.toast('Booking cancelled.');
      load();
    } catch (err) { UI.toast(err.message, 'bad'); b.disabled = false; }
  });

  // Pre-fill from ?email=... (link from the confirmation page) or from this browser session.
  const fromUrl = new URLSearchParams(location.search).get('email');
  let last = '';
  try { last = sessionStorage.getItem('hotel_last_email') || ''; } catch (e) { /* ignore */ }
  emailEl.value = fromUrl || last;
  if (emailEl.value) load();
})();
