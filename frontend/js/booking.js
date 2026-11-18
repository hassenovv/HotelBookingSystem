/* ==========================================================
   booking.js  -  3-step booking form + payment  (WBS 1.2 and 3.1)

   Order of work:
   1. fill the form from the URL (?type=2&in=...&out=...)
   2. step 1: dates + room type  -> ask the server what is free
   3. step 2: guest details      -> validate in the browser
   4. step 3: card               -> Luhn check -> TOKEN (card number is erased)
   5. send ONE request (JSON) with an idempotency key; no price inside
   6. show CONFIRMED / PENDING / error from the server answer
   ========================================================== */
(function () {
  'use strict';
  const UI = window.UI, API = window.HotelApi, U = API.util;

  const form = UI.$('#booking-form');
  const panels = UI.$$('.step-panel');
  const stepperItems = UI.$$('#stepper li');
  const alertBox = UI.$('#form-alert');
  const payBtn = UI.$('#pay-btn');
  const el = {
    cin: UI.$('#check-in'), cout: UI.$('#check-out'), type: UI.$('#room-type'), note: UI.$('#avail-note'),
    first: UI.$('#first-name'), last: UI.$('#last-name'), email: UI.$('#email'), phone: UI.$('#phone'), special: UI.$('#special'),
    cname: UI.$('#card-name'), cnum: UI.$('#card-number'), cexp: UI.$('#card-exp'), ccvc: UI.$('#card-cvc')
  };

  let step = 1;
  let types = [];          // room types from the server
  let avail = null;        // availability answer for the chosen dates
  let submitting = false;  // blocks double clicks
  let idemKey = newKey();  // identifies this booking attempt

  function newKey() {
    return (window.crypto && window.crypto.randomUUID) ? window.crypto.randomUUID()
      : 'k-' + Date.now() + '-' + Math.random().toString(36).slice(2);
  }

  /* ---------- small helpers ---------- */
  function setErrors(map) {
    UI.$$('.field[data-field]', form).forEach(function (f) {
      const msg = map && map[f.getAttribute('data-field')];
      f.classList.toggle('invalid', !!msg);
      const p = UI.$('.error', f);
      if (p) p.textContent = msg || '';
    });
  }
  function showAlert(kind, text) {
    alertBox.innerHTML = text ? '<div class="alert alert--' + kind + '">' + UI.esc(text) + '</div>' : '';
  }
  function goTo(n) {
    step = n;
    panels.forEach(function (p) { p.hidden = Number(p.getAttribute('data-step')) !== n; });
    stepperItems.forEach(function (li, i) {
      li.classList.toggle('is-active', i + 1 === n);
      li.classList.toggle('is-done', i + 1 < n);
      if (i + 1 === n) li.setAttribute('aria-current', 'step'); else li.removeAttribute('aria-current');
    });
    const focusTarget = UI.$('.step-panel[data-step="' + n + '"] input, .step-panel[data-step="' + n + '"] select');
    if (focusTarget) focusTarget.focus();
    updateSummary();
  }
  function currentType() { return types.find(function (t) { return String(t.room_type_id) === el.type.value; }); }
  function nights() {
    return (U.isISO(el.cin.value) && U.isISO(el.cout.value)) ? U.nightsBetween(el.cin.value, el.cout.value) : 0;
  }
  // Estimate only. Money is counted in cents to avoid floating point errors (e.g. 0.1 + 0.2).
  function estimate() {
    const t = currentType(), n = nights();
    return (t && n > 0) ? Math.round(n * t.price_per_night * 100) / 100 : null;
  }
  function updateSummary() {
    const t = currentType(), n = nights(), est = estimate();
    UI.$('#s-type').textContent = t ? t.type_name : '–';
    UI.$('#s-in').textContent = U.isISO(el.cin.value) ? UI.fmtDate(el.cin.value) : '–';
    UI.$('#s-out').textContent = U.isISO(el.cout.value) ? UI.fmtDate(el.cout.value) : '–';
    UI.$('#s-nights').textContent = n > 0 ? n : '–';
    UI.$('#s-rate').textContent = t ? UI.money(t.price_per_night) + ' / night' : '–';
    UI.$('#s-total').textContent = est == null ? '–' : UI.money(est);
    payBtn.textContent = est == null ? 'Pay' : 'Pay ' + UI.money(est);
  }

  /* ---------- availability ---------- */
  let availTimer = null;
  function refreshAvailability() {
    clearTimeout(availTimer);
    availTimer = setTimeout(async function () {
      el.note.textContent = '';
      avail = null;
      if (!U.isISO(el.cin.value) || !U.isISO(el.cout.value) || nights() < 1) { updateSummary(); return; }
      try {
        avail = await API.getAvailability(el.cin.value, el.cout.value);
        const a = avail.types.find(function (t) { return String(t.room_type_id) === el.type.value; });
        if (a) {
          el.note.textContent = a.available === 0 ? 'Sold out for these dates. Please choose another type or other dates.'
            : a.available + ' of ' + a.total_rooms + ' rooms free for these dates.';
        }
      } catch (e) { /* the date errors are shown when the user presses Continue */ }
      updateSummary();
    }, 150);
  }

  /* ---------- validation per step ---------- */
  async function validateStep1() {
    const errs = {};
    if (!U.isISO(el.cin.value)) errs.check_in_date = 'Choose a check-in date.';
    else if (el.cin.value < U.todayISO()) errs.check_in_date = 'Check-in cannot be in the past.';
    if (!U.isISO(el.cout.value)) errs.check_out_date = 'Choose a check-out date.';
    else if (U.isISO(el.cin.value) && nights() < 1) errs.check_out_date = 'Check-out must be after check-in.';
    else if (nights() > 30) errs.check_out_date = 'The maximum stay is 30 nights.';
    if (!el.type.value) errs.room_type_id = 'Choose a room type.';
    setErrors(errs);
    if (Object.keys(errs).length) return false;

    try {                                           // ask the server: is it really free right now?
      avail = await API.getAvailability(el.cin.value, el.cout.value);
    } catch (e) { setErrors(e.fields || {}); showAlert('bad', e.message); return false; }
    const a = avail.types.find(function (t) { return String(t.room_type_id) === el.type.value; });
    if (!a || a.available === 0) {
      setErrors({ room_type_id: 'Sold out for these dates. Please choose another type or other dates.' });
      return false;
    }
    return true;
  }
  function validateStep2() {
    const errs = {};
    if (el.first.value.trim().length < 2) errs.first_name = 'Enter your first name.';
    if (el.last.value.trim().length < 2) errs.last_name = 'Enter your last name.';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(el.email.value.trim())) errs.email = 'Enter a valid email address.';
    if (el.phone.value.replace(/\D/g, '').length < 7) errs.phone_number = 'Enter a valid phone number.';
    setErrors(errs);
    return !Object.keys(errs).length;
  }
  // Luhn algorithm: catches typing mistakes in the card number before anything is sent.
  function luhnOk(digits) {
    let sum = 0, dbl = false;
    for (let i = digits.length - 1; i >= 0; i--) {
      let d = digits.charCodeAt(i) - 48;
      if (dbl) { d *= 2; if (d > 9) d -= 9; }
      sum += d; dbl = !dbl;
    }
    return digits.length >= 13 && sum % 10 === 0;
  }
  function validateStep3() {
    const errs = {};
    const digits = el.cnum.value.replace(/\D/g, '');
    if (el.cname.value.trim().length < 3) errs.card_name = 'Enter the name on the card.';
    if (!luhnOk(digits)) errs.card_number = 'This card number is not valid.';
    const m = /^(\d{2})\/(\d{2})$/.exec(el.cexp.value);
    if (!m || +m[1] < 1 || +m[1] > 12) errs.card_exp = 'Use the format MM/YY.';
    else {
      const now = new Date();
      const endOfMonth = new Date(2000 + (+m[2]), +m[1], 0, 23, 59, 59);
      if (endOfMonth < now) errs.card_exp = 'This card has expired.';
    }
    if (!/^\d{3,4}$/.test(el.ccvc.value)) errs.card_cvc = 'Enter the 3 or 4 digit code.';
    setErrors(errs);
    return !Object.keys(errs).length;
  }

  /* ---------- card input helpers ---------- */
  el.cnum.addEventListener('input', function () {
    const d = el.cnum.value.replace(/\D/g, '').slice(0, 19);
    el.cnum.value = d.replace(/(.{4})/g, '$1 ').trim();
  });
  el.cexp.addEventListener('input', function () {
    let d = el.cexp.value.replace(/\D/g, '').slice(0, 4);
    if (d.length >= 3) d = d.slice(0, 2) + '/' + d.slice(2);
    el.cexp.value = d;
  });
  el.ccvc.addEventListener('input', function () { el.ccvc.value = el.ccvc.value.replace(/\D/g, '').slice(0, 4); });
  UI.$$('[data-card]').forEach(function (b) {
    b.addEventListener('click', function () {
      el.cnum.value = b.getAttribute('data-card');
      if (!el.cname.value) el.cname.value = ((el.first.value + ' ' + el.last.value).trim() || 'Test Guest').toUpperCase();
      if (!el.cexp.value) { const y = (new Date().getFullYear() + 3) % 100; el.cexp.value = '12/' + String(y).padStart(2, '0'); }
      if (!el.ccvc.value) el.ccvc.value = '123';
    });
  });

  // TOKENISATION: in a real system the payment provider's script does this. We keep only a token.
  function tokenize(number) {
    const digits = number.replace(/\D/g, '');
    return 'tok_' + digits.slice(-4) + '_' + Math.random().toString(36).slice(2, 12);
  }

  /* ---------- navigation buttons ---------- */
  form.addEventListener('click', async function (e) {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    showAlert('', '');
    if (btn.getAttribute('data-action') === 'back') { goTo(step - 1); return; }
    let ok = false;
    if (step === 1) { btn.disabled = true; ok = await validateStep1(); btn.disabled = false; }
    else if (step === 2) ok = validateStep2();
    if (ok) goTo(step + 1);
  });

  [el.cin, el.cout, el.type].forEach(function (x) { x.addEventListener('change', function () { setErrors({}); updateSummary(); refreshAvailability(); }); });
  el.cin.addEventListener('change', function () {
    if (!el.cin.value) return;
    el.cout.min = U.addDays(el.cin.value, 1);
    if (!el.cout.value || el.cout.value <= el.cin.value) el.cout.value = U.addDays(el.cin.value, 1);
    updateSummary();
  });

  /* ---------- SUBMIT: pay ---------- */
  form.addEventListener('submit', async function (e) {
    e.preventDefault();
    if (submitting) return;                          // a second click while waiting does nothing
    showAlert('', '');
    if (!validateStep3()) return;

    submitting = true;
    payBtn.disabled = true;
    payBtn.innerHTML = '<span class="spinner"></span> Processing… please wait';

    const token = tokenize(el.cnum.value);
    // The request holds NO card number and NO price. The server decides the price.
    const request = {
      guest: { first_name: el.first.value.trim(), last_name: el.last.value.trim(), email: el.email.value.trim(), phone_number: el.phone.value.trim() },
      room_type_id: Number(el.type.value),
      check_in_date: el.cin.value,
      check_out_date: el.cout.value,
      special_requests: el.special.value.trim(),
      payment_token: token,
      idempotency_key: idemKey
    };
    el.cnum.value = ''; el.ccvc.value = ''; el.cexp.value = '';   // erase the card from the page

    try {
      const response = await API.createBooking(request);
      showResult(request, response);
    } catch (err) {
      handleError(err);
    } finally {
      submitting = false;
      payBtn.disabled = false;
      updateSummary();
    }
  });

  function handleError(err) {
    const code = err.code;
    if (code === 'VALIDATION' && err.fields) {
      const f = err.fields;
      setErrors(f);
      goTo((f.check_in_date || f.check_out_date || f.room_type_id) ? 1 : (f.first_name || f.last_name || f.email || f.phone_number) ? 2 : 3);
      showAlert('bad', err.message);
      idemKey = newKey();
    } else if (code === 'NO_AVAILABILITY' || code === 'ROOM_TAKEN' || code === 'UNIQUE_VIOLATION') {
      goTo(1);
      showAlert('bad', err.message + ' You were not charged.');
      refreshAvailability();
      idemKey = newKey();
    } else if (code === 'PAYMENT_DECLINED') {
      goTo(3);
      showAlert('bad', err.message + ' Please try another card.');
      idemKey = newKey();
    } else {
      goTo(3);
      // keep the SAME idempotency key: pressing Pay again cannot create a second booking or charge
      showAlert('warn', 'We could not reach the server. Please enter your card again and press Pay. You will not be charged twice.');
    }
  }

  /* ---------- result screen ---------- */
  function showResult(request, res) {
    const confirmed = res.status === 'CONFIRMED';
    const box = UI.$('#result');
    const safeReq = JSON.parse(JSON.stringify(request));
    const body =
      '<div class="confirm-icon ' + (confirmed ? 'confirm-icon--ok' : 'confirm-icon--warn') + '" aria-hidden="true">' + (confirmed ? '✓' : '⏳') + '</div>' +
      '<h2>' + (confirmed ? 'Booking confirmed' : 'Booking pending') + '</h2>' +
      '<p>' + UI.esc(res.message) + '</p>' +
      '<div class="table-wrap" style="margin:1rem 0"><table class="data"><tbody>' +
        row('Booking number', '#' + res.booking_id) +
        row('Status', UI.chip(res.status), true) +
        row('Room', UI.esc(res.room_type) + ' · No. ' + UI.esc(res.room_number), true) +
        row('Check-in', UI.fmtDate(res.check_in_date)) +
        row('Check-out', UI.fmtDate(res.check_out_date)) +
        row('Nights', res.nights) +
        row('Total price (set by server)', '<strong>' + UI.money(res.total_price) + '</strong>', true) +
      '</tbody></table></div>' +
      (confirmed && res.email
        ? '<div class="email-preview"><div class="meta">To: ' + UI.esc(res.email.to) + '<br>Subject: ' + UI.esc(res.email.subject) + '</div>' +
          'Dear ' + UI.esc(request.guest.first_name) + ',<br>your stay is confirmed: ' + UI.esc(res.room_type) + ', ' + UI.fmtDate(res.check_in_date) +
          ' to ' + UI.fmtDate(res.check_out_date) + '. Booking number #' + res.booking_id + '. We look forward to welcoming you.</div>'
        : '<div class="alert alert--warn">Reception can also take the payment at the hotel if the payment service stays unavailable.</div>') +
      '<details class="json"><summary>Show the JSON request and response (API contract)</summary>' +
        '<p class="muted small">Note: the request has a payment token and an idempotency key, but no card number and no price.</p>' +
        '<pre><code>' + UI.esc('// POST /api/bookings\n' + JSON.stringify(safeReq, null, 2) + '\n\n// Response ' + (res.http_status || 201) + '\n' + JSON.stringify(res, null, 2)) + '</code></pre></details>' +
      '<div style="display:flex;gap:.6rem;flex-wrap:wrap;margin-top:1.2rem">' +
        '<a class="btn" href="bookings.html?email=' + encodeURIComponent(request.guest.email) + '">View my bookings</a>' +
        '<a class="btn btn--ghost" href="booking.html">Book another room</a></div>';
    box.innerHTML = body;
    box.hidden = false;
    form.hidden = true;
    UI.$('#stepper').hidden = true;
    UI.$('#page-title').textContent = confirmed ? 'Thank you!' : 'Almost done';
    box.scrollIntoView({ behavior: 'smooth', block: 'start' });
    try { sessionStorage.setItem('hotel_last_email', request.guest.email); } catch (e) { /* ignore */ }
  }
  function row(label, value, raw) { return '<tr><th scope="row">' + label + '</th><td>' + (raw ? value : UI.esc(value)) + '</td></tr>'; }
  // row() receives already-escaped HTML for rows that need markup (raw = true) and plain text for the others.

  /* ---------- start ---------- */
  (async function init() {
    const today = U.todayISO();
    const params = new URLSearchParams(location.search);
    el.cin.min = today;
    el.cin.value = U.isISO(params.get('in')) ? params.get('in') : U.addDays(today, 1);
    el.cout.min = U.addDays(el.cin.value, 1);
    el.cout.value = U.isISO(params.get('out')) ? params.get('out') : U.addDays(el.cin.value, 3);
    try {
      types = await API.getRoomTypes();
      el.type.innerHTML = '<option value="">Choose a room type…</option>' + types.map(function (t) {
        return '<option value="' + t.room_type_id + '">' + UI.esc(t.type_name) + ' — ' + UI.money(t.price_per_night) + ' / night</option>';
      }).join('');
      if (params.get('type')) el.type.value = params.get('type');
      try { const last = sessionStorage.getItem('hotel_last_email'); if (last) el.email.value = last; } catch (e) { /* ignore */ }
    } catch (e) { showAlert('bad', 'Could not load room types. Please refresh the page.'); }
    updateSummary();
    refreshAvailability();
  })();
})();
