-- ==========================================================
-- schema.sql  -  database of the hotel (from the ER diagram)
-- Engine: SQLite (one file: server/hotel.db). The same SQL idea
-- works in PostgreSQL (see docs/FRIEND_ROLE.md).
-- ==========================================================

CREATE TABLE IF NOT EXISTS room_types (
  room_type_id    INTEGER PRIMARY KEY AUTOINCREMENT,
  type_name       TEXT NOT NULL UNIQUE,
  price_per_night NUMERIC NOT NULL CHECK (price_per_night > 0)
);

CREATE TABLE IF NOT EXISTS rooms (
  room_id      INTEGER PRIMARY KEY AUTOINCREMENT,
  room_number  TEXT NOT NULL UNIQUE,
  room_type_id INTEGER NOT NULL REFERENCES room_types(room_type_id),
  room_notes   TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS users (
  user_id      INTEGER PRIMARY KEY AUTOINCREMENT,
  first_name   TEXT NOT NULL,
  last_name    TEXT NOT NULL,
  email        TEXT NOT NULL UNIQUE COLLATE NOCASE,
  phone_number TEXT
);

CREATE TABLE IF NOT EXISTS bookings (
  booking_id       INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id          INTEGER NOT NULL REFERENCES users(user_id),
  room_id          INTEGER NOT NULL REFERENCES rooms(room_id),
  check_in_date    TEXT NOT NULL,
  check_out_date   TEXT NOT NULL,
  total_price      NUMERIC NOT NULL,
  status           TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','CONFIRMED','CANCELLED')),
  special_requests TEXT NOT NULL DEFAULT '',
  created_at       TEXT NOT NULL,
  CHECK (check_out_date > check_in_date)
);
CREATE INDEX IF NOT EXISTS idx_bookings_room_dates ON bookings(room_id, check_in_date, check_out_date);

-- SECOND SAFETY LAYER (Task 06): the database itself refuses a second active booking
-- for the same room and overlapping dates, even if the server code has a bug.
CREATE TRIGGER IF NOT EXISTS bookings_no_overlap
BEFORE INSERT ON bookings
WHEN NEW.status <> 'CANCELLED' AND EXISTS (
  SELECT 1 FROM bookings b
  WHERE b.room_id = NEW.room_id AND b.status <> 'CANCELLED'
    AND b.check_in_date < NEW.check_out_date AND NEW.check_in_date < b.check_out_date)
BEGIN
  SELECT RAISE(ABORT, 'UNIQUE_VIOLATION');
END;

-- Same request twice (double click, retry) = same answer, no second booking or charge.
CREATE TABLE IF NOT EXISTS idempotency_keys (
  idem_key   TEXT PRIMARY KEY,
  response   TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- Every confirmation email the server "sent" (the sending itself is simulated).
CREATE TABLE IF NOT EXISTS email_outbox (
  email_id   INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_id INTEGER NOT NULL,
  to_email   TEXT NOT NULL,
  subject    TEXT NOT NULL,
  sent_at    TEXT NOT NULL
);
