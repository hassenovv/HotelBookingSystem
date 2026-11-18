-- seed.sql: starting data of the hotel (3 room types, 40 rooms, no bookings)
-- Rebuild an empty database:  cat schema.sql seed.sql | sqlite3 hotel.db

INSERT INTO room_types (room_type_id, type_name, price_per_night) VALUES (1, 'Standard', 90);
INSERT INTO room_types (room_type_id, type_name, price_per_night) VALUES (2, 'Deluxe', 150);
INSERT INTO room_types (room_type_id, type_name, price_per_night) VALUES (3, 'Suite', 260);

INSERT INTO rooms (room_id, room_number, room_type_id, room_notes) VALUES (1, '101', 1, 'Next to the lobby');
INSERT INTO rooms (room_id, room_number, room_type_id, room_notes) VALUES (2, '102', 1, '');
INSERT INTO rooms (room_id, room_number, room_type_id, room_notes) VALUES (3, '103', 1, '');
INSERT INTO rooms (room_id, room_number, room_type_id, room_notes) VALUES (4, '104', 1, '');
INSERT INTO rooms (room_id, room_number, room_type_id, room_notes) VALUES (5, '105', 1, '');
INSERT INTO rooms (room_id, room_number, room_type_id, room_notes) VALUES (6, '106', 1, '');
INSERT INTO rooms (room_id, room_number, room_type_id, room_notes) VALUES (7, '107', 1, '');
INSERT INTO rooms (room_id, room_number, room_type_id, room_notes) VALUES (8, '108', 1, '');
INSERT INTO rooms (room_id, room_number, room_type_id, room_notes) VALUES (9, '109', 1, '');
INSERT INTO rooms (room_id, room_number, room_type_id, room_notes) VALUES (10, '110', 1, '');
INSERT INTO rooms (room_id, room_number, room_type_id, room_notes) VALUES (11, '201', 1, '');
INSERT INTO rooms (room_id, room_number, room_type_id, room_notes) VALUES (12, '202', 1, '');
INSERT INTO rooms (room_id, room_number, room_type_id, room_notes) VALUES (13, '203', 1, '');
INSERT INTO rooms (room_id, room_number, room_type_id, room_notes) VALUES (14, '204', 1, 'Noisy at night, next to the elevator');
INSERT INTO rooms (room_id, room_number, room_type_id, room_notes) VALUES (15, '205', 2, '');
INSERT INTO rooms (room_id, room_number, room_type_id, room_notes) VALUES (16, '206', 2, '');
INSERT INTO rooms (room_id, room_number, room_type_id, room_notes) VALUES (17, '207', 2, '');
INSERT INTO rooms (room_id, room_number, room_type_id, room_notes) VALUES (18, '208', 2, '');
INSERT INTO rooms (room_id, room_number, room_type_id, room_notes) VALUES (19, '209', 2, '');
INSERT INTO rooms (room_id, room_number, room_type_id, room_notes) VALUES (20, '210', 2, '');
INSERT INTO rooms (room_id, room_number, room_type_id, room_notes) VALUES (21, '301', 2, '');
INSERT INTO rooms (room_id, room_number, room_type_id, room_notes) VALUES (22, '302', 2, '');
INSERT INTO rooms (room_id, room_number, room_type_id, room_notes) VALUES (23, '303', 2, '');
INSERT INTO rooms (room_id, room_number, room_type_id, room_notes) VALUES (24, '304', 2, '');
INSERT INTO rooms (room_id, room_number, room_type_id, room_notes) VALUES (25, '305', 2, '');
INSERT INTO rooms (room_id, room_number, room_type_id, room_notes) VALUES (26, '306', 2, '');
INSERT INTO rooms (room_id, room_number, room_type_id, room_notes) VALUES (27, '307', 2, '');
INSERT INTO rooms (room_id, room_number, room_type_id, room_notes) VALUES (28, '308', 2, '');
INSERT INTO rooms (room_id, room_number, room_type_id, room_notes) VALUES (29, '309', 3, '');
INSERT INTO rooms (room_id, room_number, room_type_id, room_notes) VALUES (30, '310', 3, '');
INSERT INTO rooms (room_id, room_number, room_type_id, room_notes) VALUES (31, '401', 3, 'Quiet, high floor');
INSERT INTO rooms (room_id, room_number, room_type_id, room_notes) VALUES (32, '402', 3, 'Quiet, high floor');
INSERT INTO rooms (room_id, room_number, room_type_id, room_notes) VALUES (33, '403', 3, 'Quiet, high floor');
INSERT INTO rooms (room_id, room_number, room_type_id, room_notes) VALUES (34, '404', 3, 'Quiet, high floor');
INSERT INTO rooms (room_id, room_number, room_type_id, room_notes) VALUES (35, '405', 3, 'Quiet, high floor');
INSERT INTO rooms (room_id, room_number, room_type_id, room_notes) VALUES (36, '406', 3, 'Quiet, high floor');
INSERT INTO rooms (room_id, room_number, room_type_id, room_notes) VALUES (37, '407', 3, '');
INSERT INTO rooms (room_id, room_number, room_type_id, room_notes) VALUES (38, '408', 3, '');
INSERT INTO rooms (room_id, room_number, room_type_id, room_notes) VALUES (39, '409', 3, '');
INSERT INTO rooms (room_id, room_number, room_type_id, room_notes) VALUES (40, '410', 3, '');

-- first ids match the JSON example in the Data task (user_id 102, booking_id 5041)
INSERT INTO sqlite_sequence (name, seq) VALUES ('users', 101);
INSERT INTO sqlite_sequence (name, seq) VALUES ('bookings', 5040);
