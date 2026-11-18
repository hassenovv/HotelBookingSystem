/* ==========================================================
   api-client.js  -  THE CONNECTION between frontend and backend

   Loaded after api.js (the mock). It replaces window.HotelApi with
   a version that talks to the real server with fetch():

        browser (this file)  --fetch JSON-->  backend/server.js  --SQL-->  hotel.db

   The pages did NOT change: they still call HotelApi.createBooking(...)
   etc. Only what is behind these methods changed.

   Mode (shown in the badge in the header):
     backend  the server answered GET /api/health -> every call goes to it
     mock     no server found -> falls back to the old in-browser demo (api.js)
     offline  the server was there, then stopped answering

   Force a mode:  add ?mode=mock  or  ?mode=backend  to any page URL.
   Other server address:  set window.HOTEL_API_BASE before this file.
   ========================================================== */
(function (g) {
  'use strict';
  const mock = g.HotelApi;                                  // the old in-browser backend (fallback)
  const ApiError = mock.ApiError;

  // Same origin when the page comes from the server. If index.html is opened from the disk (file://), use localhost:3000.
  const BASE = (typeof g.HOTEL_API_BASE === 'string') ? g.HOTEL_API_BASE
    : (location.protocol === 'file:' ? 'http://localhost:3000' : '');
  const forced = new URLSearchParams(location.search).get('mode');   // 'mock' | 'backend' | null

  const state = { mode: 'checking', base: BASE || location.origin, requests: 0, lastMs: null, info: null };
  const listeners = [];
  function notify() { listeners.forEach(function (fn) { try { fn(state); } catch (e) { /* ignore */ } }); }

  /* ---------- low level: one fetch call ---------- */
  async function call(method, path, body) {
    const t0 = performance.now();
    let res;
    try {
      res = await fetch(BASE + path, {
        method: method,
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
        cache: 'no-store'
      });
    } catch (e) {
      state.mode = 'offline'; notify();
      throw new ApiError('NETWORK', 'Cannot reach the server. Please check your connection and try again.', 0);
    }
    state.requests++;
    state.lastMs = Math.round(performance.now() - t0);
    if (state.mode === 'offline') state.mode = 'backend';
    notify();
    let data = null;
    try { data = await res.json(); } catch (e) { /* empty body */ }
    if (!res.ok) throw new ApiError((data && data.code) || 'ERROR', (data && data.message) || res.statusText, res.status, data && data.fields);
    return data;
  }

  /* ---------- the same methods as in api.js, but over HTTP ---------- */
  const real = {
    getRoomTypes: function () { return call('GET', '/api/room-types'); },
    getAvailability: function (cin, cout) { return call('GET', '/api/availability?in=' + encodeURIComponent(cin) + '&out=' + encodeURIComponent(cout)); },
    createBooking: function (request) { return call('POST', '/api/bookings', request); },
    getBookingsByEmail: function (email) { return call('GET', '/api/bookings?email=' + encodeURIComponent(email)); },
    cancelBooking: function (id) { return call('POST', '/api/bookings/' + id + '/cancel'); },
    confirmAtDesk: function (id) { return call('POST', '/api/bookings/' + id + '/confirm'); },
    listBookings: function () { return call('GET', '/api/staff/bookings'); },
    listRoomsForDate: function (d) { return call('GET', '/api/staff/rooms?date=' + encodeURIComponent(d)); },
    resetDemo: function () { return call('POST', '/api/staff/reset'); },
    seedDemo: function () { return call('POST', '/api/staff/seed'); }
  };

  /* ---------- connection check ---------- */
  function ping() {
    const t0 = performance.now();
    return fetch(BASE + '/api/health', { cache: 'no-store' })
      .then(function (r) { if (!r.ok) throw new Error('bad status'); return r.json(); })
      .then(function (info) { state.info = info; state.lastMs = Math.round(performance.now() - t0); return true; })
      .catch(function () { return false; });
  }
  const ready = (forced === 'mock') ? Promise.resolve(false) : ping();
  ready.then(function (ok) {
    state.mode = ok ? 'backend' : (forced === 'backend' ? 'offline' : 'mock');
    notify();
  });

  /* ---------- the public object: each method waits for the check, then picks backend or mock ---------- */
  const api = Object.assign({}, mock);                       // keeps util, ApiError and the browser-only tests
  Object.keys(real).forEach(function (name) {
    api[name] = async function () {
      const live = await ready;
      return live || state.mode === 'offline' ? real[name].apply(null, arguments) : mock[name].apply(null, arguments);
    };
  });

  api.mode = function () { return state.mode; };
  api.status = function () { return state; };
  api.onStatus = function (fn) { listeners.push(fn); fn(state); };
  api.ping = async function () { const ok = await ping(); state.mode = ok ? 'backend' : 'offline'; notify(); return ok ? state : null; };
  api.call = call;                                           // used by the connection page (API tester)
  api.ready = ready;

  // Acceptance test against the REAL server: 50 real HTTP requests at the same time for ONE room.
  api.runLiveRaceTest = async function (n) {
    n = n || 50;
    const U = mock.util, cin = U.addDays(U.todayISO(), 40), cout = U.addDays(cin, 2), t0 = performance.now();
    const jobs = [];
    for (let i = 0; i < n; i++) {
      jobs.push(call('POST', '/api/bookings', {
        guest: { first_name: 'Race' + i, last_name: 'Test', email: 'race' + i + '@test.com', phone_number: '+7 700 000 00 00' },
        room_id: 40, check_in_date: cin, check_out_date: cout, payment_token: 'tok_4242_test', idempotency_key: 'live-race-' + Date.now() + '-' + i
      }).then(function (r) { return { ok: true, r: r }; }, function (e) { return { ok: false, code: e.code }; }));
    }
    const results = await Promise.all(jobs);
    const saved = results.filter(function (x) { return x.ok; });
    const rejected = {};
    results.filter(function (x) { return !x.ok; }).forEach(function (x) { rejected[x.code] = (rejected[x.code] || 0) + 1; });
    for (const s of saved) { try { await call('POST', '/api/bookings/' + s.r.booking_id + '/cancel'); } catch (e) { /* ignore */ } }   // clean up the test booking
    return { requests: n, saved_in_database: saved.length, rejected: rejected, ms: Math.round(performance.now() - t0) };
  };

  g.HotelApi = api;
})(window);
