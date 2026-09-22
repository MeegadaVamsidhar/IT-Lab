# Let's Play

A network-ready multiplayer Tic-Tac-Toe platform built with Express, Socket.IO, SQLite, JWT and Chart.js.

## Run

```bash
npm install
npm start
```

Open `http://localhost:3000/`. To play from another machine on the same network, open `http://<server-ip>:3000/`; the server listens on `0.0.0.0`.

Set `JWT_SECRET` in production. The SQLite database is created at `data/tictactoe.db` on first start.

## API

All endpoints below except registration and login require `Authorization: Bearer <token>`.

| Method | Endpoint | Purpose |
| --- | --- | --- |
| POST | `/api/register` | Create a user with name, username, email, password |
| POST | `/api/login` | Authenticate with username/email and password |
| GET | `/api/profile` | Current stats and notifications |
| POST | `/api/room/create` | Create a room with `roomName` |
| POST | `/api/room/join` | Validate a room with `roomId` |
| GET | `/api/rooms` | Active lobby rooms |
| GET | `/api/matches` | Current user's completed matches |
| GET | `/api/leaderboard?sort=credits` | Rankings by credits, wins or win rate |
| GET | `/api/analytics` | Personal and platform analytics |

Socket.IO uses the JWT in `handshake.auth.token` and exposes `room:create`, `room:join`, `game:move`, `game:restart`, and `room:leave`. Server events include `room:update`, `game:started`, `game:finished`, `notification`, and `presence`.

## Scoring
A win awards 10 credits, a draw awards 5 credits to each participant, and a losing participant receives 2 participation credits. Every completed match and credit transaction is persisted in SQLite.
