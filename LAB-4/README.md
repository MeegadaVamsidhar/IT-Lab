# PulsePass Ticketing Platform

A browser-based event ticketing prototype with a local SQLite backend.

## Run in VS Code

1. Open the `LAB-4` folder in VS Code.
2. Open the integrated terminal.
3. Run:

```powershell
npm start
```

4. Open http://localhost:3000

The first run creates `data/pulsepass.db`, seeds three events, and creates the demo accounts below.

On launch, choose a dashboard and verify an account before continuing. Customer accounts can also be created from the access dialog.

## Seed accounts

Use these accounts in the login dialog:

| Role | Email | Password |
| --- | --- | --- |
| Customer | `customer@pulsepass.local` | `customer123` |
| Organizer | `organizer@pulsepass.local` | `organize123` |

Passwords are masked while they are entered in the login form.

## SQLite API

- `GET /api/health` checks the server and database.
- `GET /api/events` returns event inventory and calculated ticket prices.
- `GET /api/orders` returns recent orders.
- `POST /api/auth/register` creates an attendee account.
- `POST /api/auth/login` authenticates an attendee.
- `POST /api/orders` creates an order and atomically updates inventory.

Node.js 22.5 or newer is required because the app uses the built-in `node:sqlite` module. The UI can still be opened directly as `index.html` for a visual-only demo, but SQLite persistence requires `npm start`.
