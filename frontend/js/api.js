/* ==========================================================
   api.js  -  MOCK BACKEND (runs in the browser)

   Why it exists: the real server + PostgreSQL are the backend
   teammate's job. This file behaves like that server, so the
   frontend can be built and demonstrated now.
   The rest of the site only calls window.HotelApi.* , so later
   each method can be replaced by a fetch('/api/...') call that
   returns the same JSON.

   What it demonstrates from the reports:
   - Price is calculated HERE (server side), never trusted from the page
   - One room + one guest + one date: lock + overlap rule (unique constraint)
   - Reserve (PENDING) -> pay -> CONFIRMED, or roll back when payment fails
   - Idempotency key: pressing "Pay" twice never charges twice
   - Payment timeout -> booking stays PENDING (no second charge)
   - Statuses: PENDING, CONFIRMED, CANCELLED
   ========================================================== */
(function (g) {
  'use strict';

  const STORAGE_KEY = 'hotel_booking_db_v1';
  const sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
  const clone = function (o) { return JSON.parse(JSON.stringify(o)); };

  /* ---------- errors ---------- */
  class ApiError extends Error {
    constructor(code, message, status, fields) {
      super(message);
      this.name = 'ApiError';
      this.code = code;
      this.status = status || 400;
      this.fields = fields || null;
    }
  }

  /* ---------- date helpers (ISO strings "YYYY-MM-DD") ---------- */
  function toUTC(iso) { return Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)); }
  function isISO(s) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s || '')) return false;
    return new Date(toUTC(s)).toISOString().slice(0, 10) === s;
  }
  function nightsBetween(a, b) { return Math.round((toUTC(b) - toUTC(a)) / 86400000); }
  function todayISO() {
    const d = new Date();
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().slice(0, 10);
  }
  function addDays(iso, n) {
    const d = new Date(toUTC(iso));
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  }
  // A stay occupies the nights [check_in, check_out). Two stays clash if the ranges overlap.
  function overlaps(inA, outA, inB, outB) { return inA < outB && inB < outA; }

  /* ---------- storage ("the database") ---------- */
  function freshDb() {
    return {
      room_types: clone(g.HotelData.ROOM_TYPES),
      rooms: g.HotelData.buildRooms(),
      users: [],
      bookings: [],
      emails: [],
      idem: {},                                   // idempotency key -> saved response
      seq: { user_id: g.HotelData.FIRST_USER_ID, booking_id: g.HotelData.FIRST_BOOKING_ID }
    };
  }
  function browserStore() {
    let memory = null;
    return {
      load: function () {
        try {
          const raw = g.localStorage && g.localStorage.getItem(STORAGE_KEY);
          if (raw) return JSON.parse(raw);
        } catch (e) { /* storage blocked: use memory */ }
        if (!memory) memory = freshDb();
        return clone(memory);
      },
      save: function (db) {
        memory = clone(db);
        try { if (g.localStorage) g.localStorage.setItem(STORAGE_KEY, JSON.stringify(db)); } catch (e) { /* ignore */ }
      }
    };
  }
  function memoryStore() {                         // used by the concurrency test (does not touch real data)
    let db = freshDb();
    return { load: function () { return clone(db); }, save: function (d) { db = clone(d); } };
  }

  /* ---------- the engine ---------- */
  function createEngine(store, cfg) {
    cfg = cfg || {};
    const latency = cfg.latency == null ? 350 : cfg.latency;           // network + server time
    const paymentLatency = cfg.paymentLatency == null ? 700 : cfg.paymentLatency;
    const raceWindow = cfg.raceWindow == null ? 30 : cfg.raceWindow;   // time between "read" and "write"

    // The lock: requests run one after another inside it. (Real database: SELECT ... FOR UPDATE.)
    let lockTail = Promise.resolve();
    function withLock(fn) {
      const run = lockTail.then(fn);
      lockTail = run.then(function () {}, function () {});
      return run;
    }
    const inflight = new Map();

    if (!store.load().seq) store.save(freshDb());

    /* ----- payment provider (fake) ----- */
    const Payment = {
      // The token looks like tok_<last4>_<random>. The real card number never reaches the server.
      charge: async function (token) {
        await sleep(paymentLatency);
        const last4 = String(token).split('_')[1];
        if (last4 === '0002') return { status: 'declined' };
        if (last4 === '9995') return { status: 'timeout' };
        return { status: 'paid', charge_id: 'ch_' + Math.random().toString(36).slice(2, 10) };
      }
    };

    /* ----- helpers ----- */
    function freeRooms(db, typeId, cin, cout) {
      const busy = new Set(db.bookings
        .filter(function (b) { return b.status !== 'CANCELLED' && overlaps(b.check_in_date, b.check_out_date, cin, cout); })
        .map(function (b) { return b.room_id; }));
      return db.rooms.filter(function (r) { return (!typeId || r.room_type_id === typeId) && !busy.has(r.room_id); });
    }
    // Use what an experienced receptionist knows (room_notes): noisy rooms last, quiet/high floor on request.
    function chooseRoom(list, special) {
      const wantsQuiet = /quiet|high floor/i.test(special || '');
      function score(r) {
        const n = (r.room_notes || '').toLowerCase();
        let s = n.indexOf('noisy') >= 0 ? 10 : 0;
        if (wantsQuiet) s -= (n.indexOf('quiet') >= 0 ? 5 : 0) + parseInt(r.room_number.charAt(0), 10);
        return s;
      }
      return list.slice().sort(function (a, b) { return score(a) - score(b) || a.room_id - b.room_id; })[0];
    }
    function priceFor(type, nights) { return Math.round(nights * type.price_per_night * 100) / 100; }  // cents, no float drift

    // "UNIQUE constraint": the database refuses a second active booking for the same room and date.
    function insertBooking(db, b, enforce) {
      if (enforce) {
        const clash = db.bookings.some(function (x) {
          return x.room_id === b.room_id && x.status !== 'CANCELLED' &&
                 overlaps(x.check_in_date, x.check_out_date, b.check_in_date, b.check_out_date);
        });
        if (clash) throw new ApiError('UNIQUE_VIOLATION', 'This room is already booked for these dates.', 409);
      }
      db.bookings.push(b);
    }

    function validate(req) {
      const f = {};
      const gst = req.guest || {};
      if (!gst.first_name || gst.first_name.trim().length < 2) f.first_name = 'Enter your first name.';
      if (!gst.last_name || gst.last_name.trim().length < 2) f.last_name = 'Enter your last name.';
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(gst.email || '')) f.email = 'Enter a valid email address.';
      if (String(gst.phone_number || '').replace(/\D/g, '').length < 7) f.phone_number = 'Enter a valid phone number.';
      validateDates(req.check_in_date, req.check_out_date, f);
      if (!req.room_type_id && !req.room_id) f.room_type_id = 'Choose a room type.';
      if (!/^tok_/.test(req.payment_token || '')) f.payment = 'Payment token is missing.';
      if (!req.idempotency_key) f.idempotency_key = 'Idempotency key is missing.';
      if (Object.keys(f).length) throw new ApiError('VALIDATION', 'Please check the highlighted fields.', 422, f);
    }
    function validateDates(cin, cout, f) {
      f = f || {};
      if (!isISO(cin)) f.check_in_date = 'Choose a check-in date.';
      else if (cin < todayISO()) f.check_in_date = 'Check-in cannot be in the past.';
      if (!isISO(cout)) f.check_out_date = 'Choose a check-out date.';
      else if (isISO(cin) && nightsBetween(cin, cout) < 1) f.check_out_date = 'Check-out must be after check-in.';
      else if (isISO(cin) && nightsBetween(cin, cout) > 30) f.check_out_date = 'The maximum stay is 30 nights.';
      return f;
    }
    function throwIfBad(f) {
      if (Object.keys(f).length) throw new ApiError('VALIDATION', 'Please check the dates.', 422, f);
    }

    function shape(b, db) {
      const room = db.rooms.find(function (r) { return r.room_id === b.room_id; });
      const type = db.room_types.find(function (t) { return t.room_type_id === room.room_type_id; });
      return {
        booking_id: b.booking_id, user_id: b.user_id, room_id: b.room_id,
        room_number: room.room_number, room_type: type.type_name,
        check_in_date: b.check_in_date, check_out_date: b.check_out_date,
        nights: nightsBetween(b.check_in_date, b.check_out_date),
        total_price: b.total_price, status: b.status, created_at: b.created_at
      };
    }

    /* ----- step A: reserve (check + insert PENDING in one locked block) ----- */
    async function reserve(req, safe) {
      const db = store.load();
      let room;
      if (req.room_id) {
        room = db.rooms.find(function (r) { return r.room_id === req.room_id; });
        if (!room) throw new ApiError('NOT_FOUND', 'Room not found.', 404);
        const free = freeRooms(db, room.room_type_id, req.check_in_date, req.check_out_date);
        if (!free.some(function (r) { return r.room_id === room.room_id; })) {
          throw new ApiError('ROOM_TAKEN', 'Sorry, this room was just booked by another guest.', 409);
        }
      } else {
        const free = freeRooms(db, +req.room_type_id, req.check_in_date, req.check_out_date);
        if (!free.length) throw new ApiError('NO_AVAILABILITY', 'Sorry, no rooms of this type are free for these dates.', 409);
        room = chooseRoom(free, req.special_requests);
      }
      const type = db.room_types.find(function (t) { return t.room_type_id === room.room_type_id; });
      const nights = nightsBetween(req.check_in_date, req.check_out_date);
      const total = priceFor(type, nights);             // price comes from the server, never from the browser

      // UNSAFE mode only: a gap between "I saw it is free" and "I save it". This is the bug the lock removes.
      if (!safe) await sleep(raceWindow);

      const db2 = safe ? db : store.load();
      const gst = req.guest;
      let user = db2.users.find(function (u) { return u.email.toLowerCase() === gst.email.toLowerCase(); });   // email is UNIQUE
      if (!user) {
        user = { user_id: db2.seq.user_id++, first_name: gst.first_name.trim(), last_name: gst.last_name.trim(),
                 email: gst.email.trim(), phone_number: gst.phone_number.trim() };
        db2.users.push(user);
      } else {
        user.first_name = gst.first_name.trim(); user.last_name = gst.last_name.trim(); user.phone_number = gst.phone_number.trim();
      }
      const booking = {
        booking_id: db2.seq.booking_id++, user_id: user.user_id, room_id: room.room_id,
        check_in_date: req.check_in_date, check_out_date: req.check_out_date,
        total_price: total, status: 'PENDING',
        special_requests: (req.special_requests || '').slice(0, 300),
        created_at: new Date().toISOString()
      };
      insertBooking(db2, booking, safe);
      store.save(db2);
      return booking;
    }

    function sendEmail(db, booking) {
      const user = db.users.find(function (u) { return u.user_id === booking.user_id; });
      db.emails.push({ to: user.email, subject: 'Booking #' + booking.booking_id + ' confirmed', booking_id: booking.booking_id, sent_at: new Date().toISOString() });
      return { to: user.email, subject: 'Booking #' + booking.booking_id + ' confirmed' };
    }

    /* ----- the whole create-booking operation ----- */
    async function runCreate(req, safe) {
      await sleep(latency);
      const booking = await (safe ? withLock(function () { return reserve(req, true); }) : reserve(req, false));

      const pay = await Payment.charge(req.payment_token);          // outside the lock: the PENDING row already holds the room
      let response;

      if (pay.status === 'declined') {
        await withLock(async function () {                           // ROLLBACK: the room becomes free again
          const db = store.load();
          db.bookings = db.bookings.filter(function (b) { return b.booking_id !== booking.booking_id; });
          store.save(db);
        });
        throw new ApiError('PAYMENT_DECLINED', 'Your card was declined. No money was taken and the room was released.', 402);
      }

      const db = store.load();
      const row = db.bookings.find(function (b) { return b.booking_id === booking.booking_id; });
      if (pay.status === 'timeout') {                                // stays PENDING, never charge twice
        response = Object.assign(shape(row, db), { message: 'The payment service is slow. Your room is held and the booking is PENDING. You will not be charged twice.', http_status: 202 });
      } else {
        row.status = 'CONFIRMED';
        const email = sendEmail(db, row);
        response = Object.assign(shape(row, db), { message: 'Booking confirmed. A confirmation email was sent.', email: email, http_status: 201 });
      }
      db.idem[req.idempotency_key] = response;                       // same key later = same answer
      store.save(db);
      return clone(response);
    }

    async function createBooking(req, opts) {
      const safe = !(opts && opts.safe === false);
      validate(req);
      const key = req.idempotency_key;
      if (inflight.has(key)) return inflight.get(key);               // double click while the first is still running
      const saved = store.load().idem[key];
      if (saved) return Object.assign(clone(saved), { replayed: true });
      const p = runCreate(req, safe);
      inflight.set(key, p);
      const clear = function () { inflight.delete(key); };
      p.then(clear, clear);
      return p;
    }

    /* ----- read / manage operations ----- */
    async function getRoomTypes() {
      await sleep(80);
      const db = store.load();
      return db.room_types.map(function (t) { return Object.assign({}, t, { total_rooms: db.rooms.filter(function (r) { return r.room_type_id === t.room_type_id; }).length }); });
    }

    async function getAvailability(cin, cout) {
      await sleep(Math.min(latency, 150));
      throwIfBad(validateDates(cin, cout, {}));
      const db = store.load();
      const nights = nightsBetween(cin, cout);
      return {
        check_in_date: cin, check_out_date: cout, nights: nights,
        types: db.room_types.map(function (t) {
          const total = db.rooms.filter(function (r) { return r.room_type_id === t.room_type_id; }).length;
          const free = freeRooms(db, t.room_type_id, cin, cout).length;
          return { room_type_id: t.room_type_id, type_name: t.type_name, price_per_night: t.price_per_night,
                   total_rooms: total, available: free, total_price: priceFor(t, nights) };
        })
      };
    }

    async function getBookingsByEmail(email) {
      await sleep(200);
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email || '')) throw new ApiError('VALIDATION', 'Enter a valid email address.', 422, { email: 'Enter a valid email address.' });
      const db = store.load();
      const user = db.users.find(function (u) { return u.email.toLowerCase() === email.trim().toLowerCase(); });
      if (!user) return { user: null, bookings: [] };
      return {
        user: { first_name: user.first_name, last_name: user.last_name, email: user.email },
        bookings: db.bookings.filter(function (b) { return b.user_id === user.user_id; })
          .sort(function (a, b) { return b.booking_id - a.booking_id; })
          .map(function (b) { return shape(b, db); })
      };
    }

    async function cancelBooking(id) {
      await sleep(200);
      return withLock(async function () {
        const db = store.load();
        const b = db.bookings.find(function (x) { return x.booking_id === id; });
        if (!b) throw new ApiError('NOT_FOUND', 'Booking not found.', 404);
        if (b.status === 'CANCELLED') throw new ApiError('CONFLICT', 'This booking is already cancelled.', 409);
        b.status = 'CANCELLED';
        store.save(db);
        return shape(b, db);
      });
    }

    // Staff: guest paid at the hotel desk (backup when the payment service is down)
    async function confirmAtDesk(id) {
      await sleep(200);
      return withLock(async function () {
        const db = store.load();
        const b = db.bookings.find(function (x) { return x.booking_id === id; });
        if (!b) throw new ApiError('NOT_FOUND', 'Booking not found.', 404);
        if (b.status !== 'PENDING') throw new ApiError('CONFLICT', 'Only PENDING bookings can be confirmed.', 409);
        b.status = 'CONFIRMED';
        sendEmail(db, b);
        store.save(db);
        return shape(b, db);
      });
    }

    async function listBookings() {
      await sleep(120);
      const db = store.load();
      return db.bookings.slice().sort(function (a, b) { return b.booking_id - a.booking_id; }).map(function (b) {
        const user = db.users.find(function (u) { return u.user_id === b.user_id; });
        return Object.assign(shape(b, db), { guest_name: user.first_name + ' ' + user.last_name, email: user.email, phone_number: user.phone_number, special_requests: b.special_requests || '' });
      });
    }

    async function listRoomsForDate(dateISO) {
      await sleep(100);
      const db = store.load();
      return db.rooms.map(function (r) {
        const type = db.room_types.find(function (t) { return t.room_type_id === r.room_type_id; });
        const hit = db.bookings.find(function (b) { return b.room_id === r.room_id && b.status !== 'CANCELLED' && b.check_in_date <= dateISO && dateISO < b.check_out_date; });
        return { room_id: r.room_id, room_number: r.room_number, room_type: type.type_name, room_notes: r.room_notes,
                 state: hit ? hit.status : 'FREE', booking_id: hit ? hit.booking_id : null };
      });
    }

    async function resetDemo() { store.save(freshDb()); return true; }

    // A few ready-made bookings so the staff panel is not empty in a demo.
    async function seedDemo() {
      const db = store.load();
      const today = todayISO();
      const people = [
        ['Aigerim', 'Nurlanova', 'aigerim@example.com', '+7 701 111 2233'],
        ['Daniyar', 'Sadykov', 'daniyar@example.com', '+7 702 222 3344'],
        ['Madina', 'Kenzhebek', 'madina@example.com', '+7 705 333 4455'],
        ['John', 'Carter', 'john.carter@example.com', '+44 7700 900123']
      ];
      const stays = [[0, 1, 0, 3, 'CONFIRMED'], [1, 2, -1, 2, 'CONFIRMED'], [2, 3, 0, 4, 'CONFIRMED'], [0, 2, 1, 3, 'PENDING'],
                     [3, 1, 2, 2, 'CONFIRMED'], [1, 3, 3, 5, 'CONFIRMED'], [2, 1, 4, 2, 'CANCELLED'], [3, 2, 1, 2, 'CONFIRMED']];
      stays.forEach(function (s, i) {
        const p = people[s[0]];
        let user = db.users.find(function (u) { return u.email === p[2]; });
        if (!user) { user = { user_id: db.seq.user_id++, first_name: p[0], last_name: p[1], email: p[2], phone_number: p[3] }; db.users.push(user); }
        const cin = addDays(today, s[2]), cout = addDays(cin, s[3]);
        const free = freeRooms(db, s[1], cin, cout);
        if (!free.length) return;
        const room = chooseRoom(free, '');
        const type = db.room_types.find(function (t) { return t.room_type_id === s[1]; });
        db.bookings.push({ booking_id: db.seq.booking_id++, user_id: user.user_id, room_id: room.room_id, check_in_date: cin, check_out_date: cout,
                           total_price: priceFor(type, s[3]), status: s[4], special_requests: i === 0 ? 'Quiet room, high floor' : '', created_at: new Date().toISOString() });
      });
      store.save(db);
      return true;
    }

    return {
      createBooking: createBooking, getRoomTypes: getRoomTypes, getAvailability: getAvailability,
      getBookingsByEmail: getBookingsByEmail, cancelBooking: cancelBooking, confirmAtDesk: confirmAtDesk,
      listBookings: listBookings, listRoomsForDate: listRoomsForDate, resetDemo: resetDemo, seedDemo: seedDemo,
      _store: store
    };
  }

  /* ---------- acceptance tests from Task 07 (run on a throw-away database) ---------- */
  // "50 requests at the same time for one room -> only one booking is saved"
  async function runConcurrencyTest(opts) {
    opts = opts || {};
    const n = opts.requests || 50;
    const safe = opts.safe !== false;
    const engine = createEngine(memoryStore(), { latency: 5, paymentLatency: 5, raceWindow: 30 });
    const cin = addDays(todayISO(), 1), cout = addDays(cin, 2);
    const t0 = Date.now();
    const jobs = [];
    for (let i = 0; i < n; i++) {
      jobs.push(engine.createBooking({
        guest: { first_name: 'Test' + i, last_name: 'Guest', email: 'guest' + i + '@test.com', phone_number: '+7 700 000 00' + (10 + (i % 90)) },
        room_id: 1, check_in_date: cin, check_out_date: cout,
        payment_token: 'tok_4242_test', idempotency_key: 'race-' + i
      }, { safe: safe }).then(function () { return 'saved'; }, function (e) { return e.code || 'ERROR'; }));
    }
    const results = await Promise.all(jobs);
    const rejected = {};
    results.forEach(function (r) { if (r !== 'saved') rejected[r] = (rejected[r] || 0) + 1; });
    const db = engine._store.load();
    const active = db.bookings.filter(function (b) { return b.room_id === 1 && b.status !== 'CANCELLED'; }).length;
    return { requests: n, safe: safe, saved_in_database: active, rejected: rejected, double_booking: active > 1, ms: Date.now() - t0 };
  }

  // "no booking is lost in 100 test bookings"
  async function runLoadTest(opts) {
    opts = opts || {};
    const n = opts.bookings || 100;
    const engine = createEngine(memoryStore(), { latency: 5, paymentLatency: 5 });
    const base = addDays(todayISO(), 1);
    const jobs = [];
    for (let i = 0; i < n; i++) {
      const cin = addDays(base, i % 10 * 2);               // 10 different stays, 10 guests each (14 Standard rooms free)
      jobs.push(engine.createBooking({
        guest: { first_name: 'Load' + i, last_name: 'Test', email: 'load' + i + '@test.com', phone_number: '+7 700 111 22 33' },
        room_type_id: 1, check_in_date: cin, check_out_date: addDays(cin, 1),
        payment_token: 'tok_4242_test', idempotency_key: 'load-' + i
      }).then(function () { return true; }, function () { return false; }));
    }
    const ok = (await Promise.all(jobs)).filter(Boolean).length;
    const db = engine._store.load();
    const saved = db.bookings.filter(function (b) { return b.status === 'CONFIRMED'; }).length;
    return { bookings_sent: n, accepted: ok, saved_in_database: saved, lost: ok - saved };
  }

  /* ---------- public API (what the pages use) ---------- */
  const engine = createEngine(browserStore());
  g.HotelApi = Object.assign({}, engine, {
    ApiError: ApiError,
    runConcurrencyTest: runConcurrencyTest,
    runLoadTest: runLoadTest,
    util: { nightsBetween: nightsBetween, todayISO: todayISO, addDays: addDays, isISO: isISO },
    _createEngine: createEngine, _memoryStore: memoryStore
  });
})(typeof globalThis !== 'undefined' ? globalThis : window);
