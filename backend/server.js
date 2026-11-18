/* ==========================================================
   server.js  -  BACKEND of the hotel booking system
   Run:  node backend/server.js      then open  http://localhost:3000

   No npm packages needed: only Node.js built-ins
     node:http    web server
     node:sqlite  database (file backend/hotel.db)

   What it does (same rules as in the reports):
   - serves the website files (HTML/CSS/JS)
   - JSON API under /api/...  (the frontend calls it with fetch)
   - calculates the price on the SERVER (never trusts the browser)
   - saves bookings in SQLite inside a transaction
   - refuses double bookings (check + database trigger)
   - payment and email are SIMULATED (no real money, no real mail)
   ========================================================== */
'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

let DatabaseSync;
try { ({ DatabaseSync } = require('node:sqlite')); }
catch (e) {
  console.error('This server needs Node.js 22.5 or newer (built-in SQLite). Your version: ' + process.version);
  console.error('Download the LTS version from https://nodejs.org');
  process.exit(1);
}

require('../frontend/js/data.js');                       // seed data (room types + 40 rooms), shared with the frontend
const HotelData = globalThis.HotelData;

const PORT = Number(process.env.PORT) || 3000;
const SITE_ROOT = path.join(__dirname, '..', 'frontend');   // the website files
const DB_FILE = process.env.DB_FILE || path.join(__dirname, 'hotel.db');
const STARTED = Date.now();

/* ---------------------------------------------------------- database */
const db = new DatabaseSync(DB_FILE);
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
db.exec(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));

function seedIfEmpty() {
  if (db.prepare('SELECT COUNT(*) AS n FROM room_types').get().n > 0) return;
  const insType = db.prepare('INSERT INTO room_types (room_type_id, type_name, price_per_night) VALUES (?, ?, ?)');
  HotelData.ROOM_TYPES.forEach(function (t) { insType.run(t.room_type_id, t.type_name, t.price_per_night); });
  const insRoom = db.prepare('INSERT INTO rooms (room_id, room_number, room_type_id, room_notes) VALUES (?, ?, ?, ?)');
  HotelData.buildRooms().forEach(function (r) { insRoom.run(r.room_id, r.room_number, r.room_type_id, r.room_notes); });
  resetCounters();
}
function resetCounters() {            // first ids match the JSON example in the Data task
  db.exec("DELETE FROM sqlite_sequence WHERE name IN ('bookings','users','email_outbox')");
  db.prepare('INSERT INTO sqlite_sequence (name, seq) VALUES (?, ?)').run('users', HotelData.FIRST_USER_ID - 1);
  db.prepare('INSERT INTO sqlite_sequence (name, seq) VALUES (?, ?)').run('bookings', HotelData.FIRST_BOOKING_ID - 1);
}
seedIfEmpty();

/* ---------------------------------------------------------- helpers */
class ApiError extends Error {
  constructor(code, message, status, fields) { super(message); this.code = code; this.status = status || 400; this.fields = fields || null; }
}
const sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
const nowISO = function () { return new Date().toISOString(); };

function toUTC(iso) { return Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)); }
function isISO(s) { return /^\d{4}-\d{2}-\d{2}$/.test(s || '') && new Date(toUTC(s)).toISOString().slice(0, 10) === s; }
function nightsBetween(a, b) { return Math.round((toUTC(b) - toUTC(a)) / 86400000); }
function todayISO() { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); }
function addDays(iso, n) { const d = new Date(toUTC(iso)); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
function priceFor(pricePerNight, nights) { return Math.round(nights * pricePerNight * 100) / 100; }   // cents, no float drift
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function validateDates(cin, cout, f) {
  if (!isISO(cin)) f.check_in_date = 'Choose a check-in date.';
  else if (cin < todayISO()) f.check_in_date = 'Check-in cannot be in the past.';
  if (!isISO(cout)) f.check_out_date = 'Choose a check-out date.';
  else if (isISO(cin) && nightsBetween(cin, cout) < 1) f.check_out_date = 'Check-out must be after check-in.';
  else if (isISO(cin) && nightsBetween(cin, cout) > 30) f.check_out_date = 'The maximum stay is 30 nights.';
  return f;
}

/* ---------------------------------------------------------- queries (all use ? placeholders: no SQL injection) */
const BOOKING_SELECT =
  'SELECT b.*, r.room_number, t.type_name AS room_type FROM bookings b ' +
  'JOIN rooms r ON r.room_id = b.room_id JOIN room_types t ON t.room_type_id = r.room_type_id ';

function shape(row) {
  return {
    booking_id: row.booking_id, user_id: row.user_id, room_id: row.room_id,
    room_number: row.room_number, room_type: row.room_type,
    check_in_date: row.check_in_date, check_out_date: row.check_out_date,
    nights: nightsBetween(row.check_in_date, row.check_out_date),
    total_price: row.total_price, status: row.status, created_at: row.created_at
  };
}
function getBookingRow(id) { return db.prepare(BOOKING_SELECT + 'WHERE b.booking_id = ?').get(id); }

function freeRooms(typeId, cin, cout) {
  return db.prepare(
    'SELECT r.* FROM rooms r WHERE (? IS NULL OR r.room_type_id = ?) AND r.room_id NOT IN (' +
    "SELECT room_id FROM bookings WHERE status <> 'CANCELLED' AND check_in_date < ? AND ? < check_out_date) " +
    'ORDER BY r.room_id').all(typeId || null, typeId || null, cout, cin);
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

/* ---------------------------------------------------------- payment + email (SIMULATED) */
async function chargeCard(token) {
  await sleep(700);                                     // pretend to call the payment provider
  const last4 = String(token).split('_')[1];
  if (last4 === '0002') return { status: 'declined' };
  if (last4 === '9995') return { status: 'timeout' };
  return { status: 'paid', charge_id: 'ch_' + Math.random().toString(36).slice(2, 10) };
}
function sendConfirmationEmail(bookingId) {
  const row = db.prepare('SELECT b.booking_id, u.email FROM bookings b JOIN users u ON u.user_id = b.user_id WHERE b.booking_id = ?').get(bookingId);
  const subject = 'Booking #' + row.booking_id + ' confirmed';
  db.prepare('INSERT INTO email_outbox (booking_id, to_email, subject, sent_at) VALUES (?, ?, ?, ?)').run(row.booking_id, row.email, subject, nowISO());
  return { to: row.email, subject: subject };
}

/* ---------------------------------------------------------- create booking */
function validateCreate(body) {
  const f = {};
  const g = (body && body.guest) || {};
  if (!g.first_name || String(g.first_name).trim().length < 2) f.first_name = 'Enter your first name.';
  if (!g.last_name || String(g.last_name).trim().length < 2) f.last_name = 'Enter your last name.';
  if (!EMAIL_RE.test(g.email || '')) f.email = 'Enter a valid email address.';
  if (String(g.phone_number || '').replace(/\D/g, '').length < 7) f.phone_number = 'Enter a valid phone number.';
  validateDates(body.check_in_date, body.check_out_date, f);
  if (!body.room_type_id && !body.room_id) f.room_type_id = 'Choose a room type.';
  if (!/^tok_/.test(body.payment_token || '')) f.payment = 'Payment token is missing.';
  if (!body.idempotency_key) f.idempotency_key = 'Idempotency key is missing.';
  if (Object.keys(f).length) throw new ApiError('VALIDATION', 'Please check the highlighted fields.', 422, f);
}

// STEP A: check that a room is free AND save the booking as PENDING, in ONE transaction.
// node:sqlite is synchronous, so no other request can run between the check and the insert.
function reserve(body) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const cin = body.check_in_date, cout = body.check_out_date;
    let room;
    if (body.room_id) {
      room = db.prepare('SELECT * FROM rooms WHERE room_id = ?').get(Number(body.room_id));
      if (!room) throw new ApiError('NOT_FOUND', 'Room not found.', 404);
      if (!freeRooms(room.room_type_id, cin, cout).some(function (r) { return r.room_id === room.room_id; })) {
        throw new ApiError('ROOM_TAKEN', 'Sorry, this room was just booked by another guest.', 409);
      }
    } else {
      const free = freeRooms(Number(body.room_type_id), cin, cout);
      if (!free.length) throw new ApiError('NO_AVAILABILITY', 'Sorry, no rooms of this type are free for these dates.', 409);
      room = chooseRoom(free, body.special_requests);
    }
    const type = db.prepare('SELECT * FROM room_types WHERE room_type_id = ?').get(room.room_type_id);
    const total = priceFor(type.price_per_night, nightsBetween(cin, cout));       // price comes from the DATABASE, not from the browser

    const g = body.guest;
    let user = db.prepare('SELECT * FROM users WHERE email = ?').get(g.email.trim());          // email is UNIQUE
    if (!user) {
      const r = db.prepare('INSERT INTO users (first_name, last_name, email, phone_number) VALUES (?, ?, ?, ?)')
        .run(g.first_name.trim(), g.last_name.trim(), g.email.trim(), g.phone_number.trim());
      user = { user_id: Number(r.lastInsertRowid) };
    } else {
      db.prepare('UPDATE users SET first_name = ?, last_name = ?, phone_number = ? WHERE user_id = ?')
        .run(g.first_name.trim(), g.last_name.trim(), g.phone_number.trim(), user.user_id);
    }
    const ins = db.prepare('INSERT INTO bookings (user_id, room_id, check_in_date, check_out_date, total_price, status, special_requests, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(user.user_id, room.room_id, cin, cout, total, 'PENDING', String(body.special_requests || '').slice(0, 300), nowISO());
    db.exec('COMMIT');
    return Number(ins.lastInsertRowid);
  } catch (e) {
    db.exec('ROLLBACK');
    if (String(e.message).indexOf('UNIQUE_VIOLATION') >= 0) throw new ApiError('UNIQUE_VIOLATION', 'This room is already booked for these dates.', 409);
    throw e;
  }
}

const inflight = new Map();
async function createBooking(body) {
  validateCreate(body);
  const key = body.idempotency_key;
  if (inflight.has(key)) return inflight.get(key);                                       // double click while the first is still running
  const saved = db.prepare('SELECT response FROM idempotency_keys WHERE idem_key = ?').get(key);
  if (saved) return Object.assign(JSON.parse(saved.response), { replayed: true });
  const p = runCreate(body);
  inflight.set(key, p);
  const clear = function () { inflight.delete(key); };
  p.then(clear, clear);
  return p;
}
async function runCreate(body) {
  const bookingId = reserve(body);                                                       // room is now held (PENDING)
  const pay = await chargeCard(body.payment_token);                                      // outside the transaction
  if (pay.status === 'declined') {                                                       // ROLLBACK: the room becomes free again
    db.prepare('DELETE FROM bookings WHERE booking_id = ?').run(bookingId);
    throw new ApiError('PAYMENT_DECLINED', 'Your card was declined. No money was taken and the room was released.', 402);
  }
  let response;
  if (pay.status === 'timeout') {                                                        // stays PENDING, never charge twice
    response = Object.assign(shape(getBookingRow(bookingId)), {
      message: 'The payment service is slow. Your room is held and the booking is PENDING. You will not be charged twice.', http_status: 202 });
  } else {
    db.prepare("UPDATE bookings SET status = 'CONFIRMED' WHERE booking_id = ?").run(bookingId);
    const email = sendConfirmationEmail(bookingId);
    response = Object.assign(shape(getBookingRow(bookingId)), { message: 'Booking confirmed. A confirmation email was sent.', email: email, http_status: 201 });
  }
  db.prepare('INSERT OR REPLACE INTO idempotency_keys (idem_key, response, created_at) VALUES (?, ?, ?)').run(body.idempotency_key, JSON.stringify(response), nowISO());
  return response;
}

/* ---------------------------------------------------------- other endpoints */
function getRoomTypes() {
  return db.prepare('SELECT t.room_type_id, t.type_name, t.price_per_night, (SELECT COUNT(*) FROM rooms r WHERE r.room_type_id = t.room_type_id) AS total_rooms FROM room_types t ORDER BY t.room_type_id').all();
}
function getAvailability(cin, cout) {
  const f = validateDates(cin, cout, {});
  if (Object.keys(f).length) throw new ApiError('VALIDATION', 'Please check the dates.', 422, f);
  const nights = nightsBetween(cin, cout);
  return {
    check_in_date: cin, check_out_date: cout, nights: nights,
    types: getRoomTypes().map(function (t) {
      return { room_type_id: t.room_type_id, type_name: t.type_name, price_per_night: t.price_per_night, total_rooms: t.total_rooms,
               available: freeRooms(t.room_type_id, cin, cout).length, total_price: priceFor(t.price_per_night, nights) };
    })
  };
}
function getBookingsByEmail(email) {
  if (!EMAIL_RE.test(email || '')) throw new ApiError('VALIDATION', 'Enter a valid email address.', 422, { email: 'Enter a valid email address.' });
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email.trim());
  if (!user) return { user: null, bookings: [] };
  return {
    user: { first_name: user.first_name, last_name: user.last_name, email: user.email },
    bookings: db.prepare(BOOKING_SELECT + 'WHERE b.user_id = ? ORDER BY b.booking_id DESC').all(user.user_id).map(shape)
  };
}
function cancelBooking(id) {
  const row = getBookingRow(id);
  if (!row) throw new ApiError('NOT_FOUND', 'Booking not found.', 404);
  if (row.status === 'CANCELLED') throw new ApiError('CONFLICT', 'This booking is already cancelled.', 409);
  db.prepare("UPDATE bookings SET status = 'CANCELLED' WHERE booking_id = ?").run(id);
  return shape(getBookingRow(id));
}
function confirmAtDesk(id) {
  const row = getBookingRow(id);
  if (!row) throw new ApiError('NOT_FOUND', 'Booking not found.', 404);
  if (row.status !== 'PENDING') throw new ApiError('CONFLICT', 'Only PENDING bookings can be confirmed.', 409);
  db.prepare("UPDATE bookings SET status = 'CONFIRMED' WHERE booking_id = ?").run(id);
  sendConfirmationEmail(id);
  return shape(getBookingRow(id));
}
function listBookings() {
  return db.prepare(BOOKING_SELECT.replace('SELECT b.*,', "SELECT b.*, u.first_name || ' ' || u.last_name AS guest_name, u.email, u.phone_number,")
      .replace('JOIN rooms r', 'JOIN users u ON u.user_id = b.user_id JOIN rooms r') + 'ORDER BY b.booking_id DESC').all()
    .map(function (row) { return Object.assign(shape(row), { guest_name: row.guest_name, email: row.email, phone_number: row.phone_number, special_requests: row.special_requests || '' }); });
}
function listRoomsForDate(date) {
  if (!isISO(date)) throw new ApiError('VALIDATION', 'Invalid date.', 422);
  return db.prepare(
    'SELECT r.room_id, r.room_number, t.type_name AS room_type, r.room_notes, ' +
    "COALESCE((SELECT b.status FROM bookings b WHERE b.room_id = r.room_id AND b.status <> 'CANCELLED' AND b.check_in_date <= ?1 AND ?1 < b.check_out_date LIMIT 1), 'FREE') AS state, " +
    "(SELECT b.booking_id FROM bookings b WHERE b.room_id = r.room_id AND b.status <> 'CANCELLED' AND b.check_in_date <= ?1 AND ?1 < b.check_out_date LIMIT 1) AS booking_id " +
    'FROM rooms r JOIN room_types t ON t.room_type_id = r.room_type_id ORDER BY r.room_id').all(date);
}
function resetData() {
  db.exec('DELETE FROM bookings; DELETE FROM users; DELETE FROM email_outbox; DELETE FROM idempotency_keys;');
  resetCounters();
  return true;
}
function seedDemo() {
  const today = todayISO();
  const people = [['Aigerim', 'Nurlanova', 'aigerim@example.com', '+7 701 111 2233'], ['Daniyar', 'Sadykov', 'daniyar@example.com', '+7 702 222 3344'],
                  ['Madina', 'Kenzhebek', 'madina@example.com', '+7 705 333 4455'], ['John', 'Carter', 'john.carter@example.com', '+44 7700 900123']];
  const stays = [[0, 1, 0, 3, 'CONFIRMED'], [1, 2, -1, 2, 'CONFIRMED'], [2, 3, 0, 4, 'CONFIRMED'], [0, 2, 1, 3, 'PENDING'],
                 [3, 1, 2, 2, 'CONFIRMED'], [1, 3, 3, 5, 'CONFIRMED'], [2, 1, 4, 2, 'CANCELLED'], [3, 2, 1, 2, 'CONFIRMED']];
  stays.forEach(function (s, i) {
    const p = people[s[0]];
    let user = db.prepare('SELECT * FROM users WHERE email = ?').get(p[2]);
    if (!user) user = { user_id: Number(db.prepare('INSERT INTO users (first_name, last_name, email, phone_number) VALUES (?, ?, ?, ?)').run(p[0], p[1], p[2], p[3]).lastInsertRowid) };
    const cin = addDays(today, s[2]), cout = addDays(cin, s[3]);
    const free = freeRooms(s[1], cin, cout);
    if (!free.length) return;
    const type = db.prepare('SELECT * FROM room_types WHERE room_type_id = ?').get(s[1]);
    db.prepare('INSERT INTO bookings (user_id, room_id, check_in_date, check_out_date, total_price, status, special_requests, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(user.user_id, chooseRoom(free, '').room_id, cin, cout, priceFor(type.price_per_night, s[3]), s[4], i === 0 ? 'Quiet room, high floor' : '', nowISO());
  });
  return true;
}

const TABLES = ['room_types', 'rooms', 'users', 'bookings', 'email_outbox', 'idempotency_keys'];
function health() {
  const counts = {};
  TABLES.forEach(function (t) { counts[t] = db.prepare('SELECT COUNT(*) AS n FROM ' + t).get().n; });   // table names come from the fixed list above
  return {
    status: 'ok', service: 'grandstay-backend', node: process.version, time: nowISO(),
    uptime_seconds: Math.round((Date.now() - STARTED) / 1000),
    database: { engine: 'SQLite', file: path.basename(DB_FILE), tables: counts }
  };
}
function tableRows(name) {
  if (TABLES.indexOf(name) < 0) throw new ApiError('NOT_FOUND', 'Unknown table.', 404);
  const order = { bookings: 'booking_id DESC', users: 'user_id DESC', email_outbox: 'email_id DESC' }[name];
  return db.prepare('SELECT * FROM ' + name + (order ? ' ORDER BY ' + order : '') + ' LIMIT 200').all();
}

/* ---------------------------------------------------------- request log (shown on connection.html and in this terminal) */
const LOG = [];
function logRequest(entry) {
  LOG.push(entry);
  if (LOG.length > 100) LOG.shift();
  if (entry.url.indexOf('/api/') === 0 && entry.url.indexOf('/api/logs') !== 0) {
    console.log(entry.time.slice(11, 19) + '  ' + entry.method.padEnd(5) + entry.url.padEnd(48) + String(entry.status).padEnd(5) + entry.ms + ' ms');
  }
}

/* ---------------------------------------------------------- router */
function sendJson(res, status, data) {
  const text = JSON.stringify(data);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(text);
}
function readBody(req) {
  return new Promise(function (resolve, reject) {
    let size = 0; const chunks = [];
    req.on('data', function (c) { size += c.length; if (size > 100000) { reject(new ApiError('TOO_LARGE', 'Request too large.', 413)); req.destroy(); } else chunks.push(c); });
    req.on('end', function () {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch (e) { reject(new ApiError('BAD_JSON', 'Request body is not valid JSON.', 400)); }
    });
    req.on('error', reject);
  });
}

async function handleApi(req, res, url) {
  const m = req.method, p = url.pathname, q = url.searchParams;
  let match;
  if (m === 'GET' && p === '/api/health') return sendJson(res, 200, health());
  if (m === 'GET' && p === '/api/logs') return sendJson(res, 200, LOG.slice().reverse());
  if (m === 'GET' && p === '/api/room-types') return sendJson(res, 200, getRoomTypes());
  if (m === 'GET' && p === '/api/availability') return sendJson(res, 200, getAvailability(q.get('in'), q.get('out')));
  if (m === 'POST' && p === '/api/bookings') {
    const result = await createBooking(await readBody(req));
    return sendJson(res, result.http_status || 201, result);
  }
  if (m === 'GET' && p === '/api/bookings') return sendJson(res, 200, getBookingsByEmail(q.get('email')));
  if (m === 'POST' && (match = /^\/api\/bookings\/(\d+)\/cancel$/.exec(p))) return sendJson(res, 200, cancelBooking(Number(match[1])));
  if (m === 'POST' && (match = /^\/api\/bookings\/(\d+)\/confirm$/.exec(p))) return sendJson(res, 200, confirmAtDesk(Number(match[1])));
  if (m === 'GET' && p === '/api/staff/bookings') return sendJson(res, 200, listBookings());
  if (m === 'GET' && p === '/api/staff/rooms') return sendJson(res, 200, listRoomsForDate(q.get('date')));
  if (m === 'POST' && p === '/api/staff/reset') return sendJson(res, 200, { ok: resetData() });
  if (m === 'POST' && p === '/api/staff/seed') return sendJson(res, 200, { ok: seedDemo() });
  if (m === 'GET' && (match = /^\/api\/tables\/([a-z_]+)$/.exec(p))) return sendJson(res, 200, tableRows(match[1]));
  throw new ApiError('NOT_FOUND', 'Unknown API endpoint: ' + m + ' ' + p, 404);
}

const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json',
               '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.md': 'text/plain; charset=utf-8' };
function serveStatic(req, res, url) {
  let rel = decodeURIComponent(url.pathname);
  if (rel === '/') rel = '/index.html';
  const file = path.normalize(path.join(SITE_ROOT, rel));
  const inside = file.indexOf(SITE_ROOT + path.sep) === 0;
  const hidden = rel.indexOf('/.') >= 0;       // only files inside frontend/ are served, never hidden files
  if (!inside || hidden || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('Not found');
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  fs.createReadStream(file).pipe(res);
}

const server = http.createServer(async function (req, res) {
  const t0 = Date.now();
  const url = new URL(req.url, 'http://localhost');
  res.on('finish', function () {
    logRequest({ time: nowISO(), method: req.method, url: url.pathname + url.search, status: res.statusCode, ms: Date.now() - t0 });
  });
  // CORS: lets the pages work even if index.html is opened from the disk (file://) while this server runs
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
  try {
    if (url.pathname.indexOf('/api/') === 0) await handleApi(req, res, url);
    else serveStatic(req, res, url);
  } catch (err) {
    if (err instanceof ApiError) return sendJson(res, err.status, { code: err.code, message: err.message, fields: err.fields });
    console.error(err);
    sendJson(res, 500, { code: 'SERVER_ERROR', message: 'Something went wrong on the server.' });
  }
});

server.listen(PORT, function () {
  console.log('');
  console.log('  GrandStay backend is running');
  console.log('  Website + API :  http://localhost:' + PORT);
  console.log('  Health check  :  http://localhost:' + PORT + '/api/health');
  console.log('  Database file :  ' + DB_FILE);
  console.log('  Press Ctrl+C to stop. Every API request is printed below.');
  console.log('');
});
