# GrandStay Hotel – Hotel Booking System

Course project (Introduction to Information Systems, KBTU): a hotel booking website with a backend and a database.

**Team guide (Russian): [docs/TEAM_GUIDE_RU.md](docs/TEAM_GUIDE_RU.md)**

## Repository structure

```
HotelBookingSystem/
├── frontend/              the website (HTML, CSS, JavaScript)
│   ├── index.html         home: search + room types
│   ├── booking.html       3-step booking form + payment
│   ├── bookings.html      "My bookings"
│   ├── staff.html         staff panel + acceptance tests
│   ├── connection.html    live proof: frontend ⇄ backend ⇄ database
│   ├── docs.html          project documentation (reports)
│   ├── css/styles.css     all styles
│   ├── js/                page scripts + api-client.js (connection to the backend)
│   └── assets/            ER diagram, system map, JSON screenshot
├── backend/               the server and the database
│   ├── server.js          HTTP API (Node.js, no packages needed)
│   ├── schema.sql         tables from the ER diagram + anti-double-booking trigger
│   ├── seed.sql           starting data (3 room types, 40 rooms)
│   └── hotel.db           ready SQLite database
├── docs/                  guides for the team
├── start-server.bat       Windows: start everything
└── start-server.sh        Mac/Linux: start everything
```

## Run

Needs **Node.js 22.5 or newer** (https://nodejs.org, LTS). No `npm install`.

- Windows: double-click `start-server.bat`
- Mac/Linux: `./start-server.sh` (or `node backend/server.js`)
- Open http://localhost:3000. Proof of the connection: http://localhost:3000/connection.html

If the server is not running, the website falls back to a browser-only demo (badge: "Demo mode").

## Database

- `backend/hotel.db` is used directly by the server.
- Rebuild a clean database: `cat backend/schema.sql backend/seed.sql | sqlite3 backend/hotel.db`
- Reset data: Staff panel → *Reset all data*, or `git checkout backend/hotel.db`.

## What is real and what is simulated

Real: web server, HTTP API, SQLite database, price calculation on the server, protection against double booking.
Simulated: card payment (no real money) and confirmation email (written to the `email_outbox` table).
