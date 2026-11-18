# GrandStay Hotel – Hotel Booking System (frontend + backend)

## Run (needs Node.js 22.5 or newer: https://nodejs.org, LTS)
- Windows: double-click `start-server.bat`
- Mac/Linux: `./start-server.sh` or `node server/server.js`
- Open http://localhost:3000  (the server also serves the website)
- Proof of the connection: http://localhost:3000/connection.html

No `npm install` is needed. The database file `server/hotel.db` is created on the first start.
If the server is not running, the site falls back to a browser-only demo (badge: "Demo mode").

## Files
- `index.html`, `booking.html`, `bookings.html`: guest website
- `staff.html`: staff panel and acceptance tests
- `connection.html`: live proof of frontend ⇄ backend ⇄ database
- `docs.html`: project documentation (Task 06, Data task, Task 07)
- `js/api-client.js`: the frontend → backend connection (fetch)
- `js/api.js`: browser-only fallback backend
- `server/server.js`: backend (HTTP API). `server/schema.sql`: database tables
