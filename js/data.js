/* ==========================================================
   data.js  -  seed data that follows the ER diagram
   Tables: room_types, rooms, users, bookings
   (room_notes and preferences come from the "knowledge in an
    experienced employee's head" part of the Data task)
   ========================================================== */
(function (g) {
  'use strict';

  // ER: ROOM_TYPES (room_type_id PK, type_name UK, price_per_night)
  const ROOM_TYPES = [
    { room_type_id: 1, type_name: 'Standard', price_per_night: 90 },
    { room_type_id: 2, type_name: 'Deluxe',   price_per_night: 150 },
    { room_type_id: 3, type_name: 'Suite',    price_per_night: 260 }
  ];

  // Display-only text. It is NOT part of the database (the ER diagram has no such columns).
  const ROOM_TYPE_INFO = {
    1: { tagline: 'Compact and bright',   beds: 'Queen bed',          guests: 2, size: '22 m²', perks: ['Free Wi-Fi', 'Desk', 'City view'] },
    2: { tagline: 'More space to relax',  beds: 'King bed + sofa',    guests: 3, size: '34 m²', perks: ['Free Wi-Fi', 'Balcony', 'Mini-bar'] },
    3: { tagline: 'Top floors, quiet',    beds: 'King bed + lounge',  guests: 4, size: '52 m²', perks: ['Free Wi-Fi', 'Lounge area', 'Breakfast'] }
  };

  // ER: ROOMS (room_id PK, room_number UK, room_type_id FK) + room_notes
  // The hotel has 40 rooms (Task 07). Rooms are numbered by floor.
  function buildRooms() {
    const plan = [
      // [numbers, room_type_id]
      [range(101, 110).concat(range(201, 204)), 1],   // 14 Standard
      [range(205, 210).concat(range(301, 308)), 2],   // 14 Deluxe
      [[309, 310].concat(range(401, 410)), 3]         // 12 Suites
    ];
    const notes = {
      204: 'Noisy at night, next to the elevator',
      101: 'Next to the lobby',
      401: 'Quiet, high floor', 402: 'Quiet, high floor', 403: 'Quiet, high floor',
      404: 'Quiet, high floor', 405: 'Quiet, high floor', 406: 'Quiet, high floor'
    };
    const rooms = [];
    let id = 1;
    plan.forEach(function (p) {
      p[0].forEach(function (n) {
        rooms.push({ room_id: id++, room_number: String(n), room_type_id: p[1], room_notes: notes[n] || '' });
      });
    });
    return rooms;
  }
  function range(a, b) { const r = []; for (let i = a; i <= b; i++) r.push(i); return r; }

  g.HotelData = {
    ROOM_TYPES: ROOM_TYPES,
    ROOM_TYPE_INFO: ROOM_TYPE_INFO,
    buildRooms: buildRooms,
    // first ids match the JSON example in the Data task (user_id 102, booking_id 5041)
    FIRST_USER_ID: 102,
    FIRST_BOOKING_ID: 5041
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
