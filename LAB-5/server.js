const path = require('path');
const fs = require('fs');
const http = require('http');
const crypto = require('crypto');
const express = require('express');
const helmet = require('helmet');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const Database = require('better-sqlite3');
const { Server } = require('socket.io');

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const JWT_SECRET = process.env.JWT_SECRET || 'change-this-secret-in-production';
const root = __dirname;
const dataDir = path.join(root, 'data');
fs.mkdirSync(dataDir, { recursive: true });
const db = new Database(path.join(dataDir, 'tictactoe.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.exec(fs.readFileSync(path.join(root, 'database', 'schema.sql'), 'utf8'));

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: true, credentials: true } });
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: '20kb' }));
app.use(express.static(path.join(root, 'public')));
app.get('/robots.txt', (req, res) => {
  res.type('text/plain').send('User-agent: *\nAllow: /\n');
});

const activeRooms = new Map();
const clients = new Map();
const now = () => new Date().toISOString();
const clean = (value, max = 80) => String(value || '').trim().slice(0, max);
const publicUser = (user) => ({ id: user.id, name: user.name, username: user.username, credits: user.credits, wins: user.wins, losses: user.losses, draws: user.draws });
const tokenFor = (user) => jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '7d' });
function auth(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    req.user = jwt.verify(header.startsWith('Bearer ') ? header.slice(7) : '', JWT_SECRET);
    next();
  } catch { res.status(401).json({ error: 'Authentication required' }); }
}
function socketUser(socket) { return socket.user; }
function notify(userId, message, type = 'info') {
  db.prepare('INSERT INTO notifications (user_id, message, type) VALUES (?, ?, ?)').run(userId, message, type);
  const socketId = clients.get(userId);
  if (socketId) io.to(socketId).emit('notification', { message, type, created_at: now() });
}
function userById(id) { return db.prepare('SELECT * FROM users WHERE id = ?').get(id); }
function roomSnapshot(roomId) {
  const room = activeRooms.get(roomId);
  if (!room) return null;
  return { roomId, roomName: room.roomName, status: room.status, board: room.board, turn: room.turn, players: room.players.map((p) => ({ id: p.id, name: p.name, symbol: p.symbol })), spectators: room.spectators.length, startedAt: room.startedAt };
}
function broadcastRoom(roomId) { io.to(roomId).emit('room:update', roomSnapshot(roomId)); }
function winningLine(board) {
  const lines = [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];
  return lines.find(([a,b,c]) => board[a] && board[a] === board[b] && board[a] === board[c]) || null;
}
function finishRoom(roomId, result, winnerId) {
  const room = activeRooms.get(roomId); if (!room) return;
  room.status = 'finished';
  const x = room.players.find((p) => p.symbol === 'X'); const o = room.players.find((p) => p.symbol === 'O');
  db.prepare('INSERT INTO matches (room_id, player_x, player_o, winner_id, result) VALUES (?, ?, ?, ?, ?)').run(roomId, x.id, o ? o.id : x.id, winnerId || null, result);
  const participants = [x, o].filter(Boolean);
  const update = db.transaction(() => {
    participants.forEach((player) => {
      const points = result === 'draw' ? 5 : (player.id === winnerId ? 10 : 2);
      const field = result === 'draw' ? 'draws' : (player.id === winnerId ? 'wins' : 'losses');
      db.prepare(`UPDATE users SET credits = credits + ?, ${field} = ${field} + 1 WHERE id = ?`).run(points, player.id);
      db.prepare('INSERT INTO credits (user_id, points, transaction_type) VALUES (?, ?, ?)').run(player.id, points, result === 'draw' ? 'draw' : (player.id === winnerId ? 'win' : 'participation'));
      notify(player.id, result === 'draw' ? 'Match drawn. +5 credits.' : (player.id === winnerId ? 'You won the match. +10 credits!' : 'Match complete. +2 participation credits.'), result === 'draw' ? 'info' : (player.id === winnerId ? 'success' : 'info'));
    });
  });
  update();
  io.to(roomId).emit('game:finished', { result, winnerId, line: winningLine(room.board) });
  broadcastRoom(roomId);
}

app.post('/api/register', (req, res) => {
  const name = clean(req.body.name, 80), username = clean(req.body.username, 30), email = clean(req.body.email, 120).toLowerCase(), password = String(req.body.password || '');
  if (name.length < 2 || username.length < 3 || !/^\S+@\S+\.\S+$/.test(email) || password.length < 6) return res.status(400).json({ error: 'Enter a valid name, username, email and password of 6+ characters.' });
  try {
    const result = db.prepare('INSERT INTO users (name, username, email, password_hash) VALUES (?, ?, ?, ?)').run(name, username, email, bcrypt.hashSync(password, 12));
    const user = userById(result.lastInsertRowid); res.status(201).json({ token: tokenFor(user), user: publicUser(user) });
  } catch (error) { res.status(409).json({ error: error.code === 'SQLITE_CONSTRAINT_UNIQUE' ? 'Username or email is already registered.' : 'Could not create account.' }); }
});
app.post('/api/login', (req, res) => {
  const identity = clean(req.body.identity, 120), user = db.prepare('SELECT * FROM users WHERE username = ? COLLATE NOCASE OR email = ? COLLATE NOCASE').get(identity, identity);
  if (!user || !bcrypt.compareSync(String(req.body.password || ''), user.password_hash)) return res.status(401).json({ error: 'Invalid credentials.' });
  res.json({ token: tokenFor(user), user: publicUser(user) });
});
app.get('/api/profile', auth, (req, res) => res.json({ user: publicUser(userById(req.user.id)), notifications: db.prepare('SELECT * FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT 8').all(req.user.id) }));
app.post('/api/room/create', auth, (req, res) => {
  const roomId = crypto.randomBytes(3).toString('hex').toUpperCase(); const roomName = clean(req.body.roomName, 50) || `${userById(req.user.id).name}'s room`;
  db.prepare('INSERT INTO rooms (room_id, room_name, host_id) VALUES (?, ?, ?)').run(roomId, roomName, req.user.id);
  res.status(201).json({ roomId, roomName });
});
app.post('/api/room/join', auth, (req, res) => {
  const roomId = clean(req.body.roomId, 12).toUpperCase(), room = db.prepare('SELECT * FROM rooms WHERE room_id = ?').get(roomId);
  if (!room) return res.status(404).json({ error: 'Room not found.' });
  if (room.status === 'finished') return res.status(400).json({ error: 'That room has finished.' });
  res.json({ roomId, roomName: room.room_name });
});
app.get('/api/rooms', auth, (req, res) => res.json({ rooms: db.prepare("SELECT r.room_id as roomId, r.room_name as roomName, r.status, r.created_at as createdAt, u.name as hostName FROM rooms r JOIN users u ON u.id = r.host_id WHERE r.status != 'finished' ORDER BY r.created_at DESC").all() }));
app.get('/api/matches', auth, (req, res) => res.json({ matches: db.prepare('SELECT m.*, x.name AS playerXName, o.name AS playerOName, w.name AS winnerName FROM matches m JOIN users x ON x.id = m.player_x LEFT JOIN users o ON o.id = m.player_o LEFT JOIN users w ON w.id = m.winner_id WHERE m.player_x = ? OR m.player_o = ? ORDER BY m.played_at DESC LIMIT 30').all(req.user.id, req.user.id) }));
app.get('/api/leaderboard', auth, (req, res) => {
  const sort = ['wins', 'credits', 'win_rate'].includes(req.query.sort) ? req.query.sort : 'credits';
  const order = sort === 'win_rate' ? '((wins * 100.0) / NULLIF(wins + losses + draws, 0))' : sort;
  res.json({ players: db.prepare(`SELECT id, name, username, credits, wins, losses, draws, ROUND(CASE WHEN wins + losses + draws = 0 THEN 0 ELSE wins * 100.0 / (wins + losses + draws) END, 1) AS win_rate FROM users ORDER BY ${order} DESC, wins DESC LIMIT 20`).all() });
});
app.get('/api/analytics', auth, (req, res) => {
  const stats = db.prepare('SELECT wins, losses, draws, credits FROM users WHERE id = ?').get(req.user.id);
  const platform = { totalUsers: db.prepare('SELECT COUNT(*) AS n FROM users').get().n, activeRooms: [...activeRooms.values()].filter((r) => r.status !== 'finished').length, totalMatches: db.prepare('SELECT COUNT(*) AS n FROM matches').get().n };
  const daily = db.prepare("SELECT substr(played_at, 1, 10) AS day, COUNT(*) AS matches FROM matches WHERE played_at >= datetime('now', '-14 days') GROUP BY day ORDER BY day").all();
  res.json({ stats, platform, daily });
});

io.use((socket, next) => { try { socket.user = jwt.verify(socket.handshake.auth?.token || '', JWT_SECRET); next(); } catch { next(new Error('Unauthorized')); } });
io.on('connection', (socket) => {
  const user = socketUser(socket); clients.set(user.id, socket.id); socket.emit('presence', { online: clients.size });
  socket.on('room:create', ({ roomId, roomName }, callback) => {
    const name = clean(roomName, 50) || 'Neon match';
    activeRooms.set(roomId, { roomName: name, status: 'waiting', board: Array(9).fill(null), turn: 'X', players: [{ id: user.id, name: userById(user.id).name, symbol: 'X' }], spectators: [], startedAt: null });
    socket.join(roomId); callback({ ok: true, room: roomSnapshot(roomId) });
  });
  socket.on('room:join', ({ roomId }, callback) => {
    const room = activeRooms.get(roomId); if (!room) return callback({ ok: false, error: 'Room is not active yet. Ask the host to create it first.' });
    const existing = room.players.find((p) => p.id === user.id); if (!existing && room.players.length >= 2) room.spectators.push(user.id); else if (!existing) room.players.push({ id: user.id, name: userById(user.id).name, symbol: 'O' });
    socket.join(roomId); if (room.players.length === 2 && room.status === 'waiting') { room.status = 'playing'; room.startedAt = Date.now(); room.turn = 'X'; room.players.forEach((p) => notify(p.id, 'Match started. You are Player ' + p.symbol + '.', 'success')); io.to(roomId).emit('game:started'); }
    broadcastRoom(roomId); callback({ ok: true, room: roomSnapshot(roomId) });
  });
  socket.on('game:move', ({ roomId, index }, callback) => {
    const room = activeRooms.get(roomId), player = room?.players.find((p) => p.id === user.id);
    if (!room || !player || room.status !== 'playing' || player.symbol !== room.turn || !Number.isInteger(index) || index < 0 || index > 8 || room.board[index]) return callback({ ok: false, error: 'That move is not available.' });
    room.board[index] = player.symbol; const line = winningLine(room.board);
    if (line) finishRoom(roomId, player.symbol === 'X' ? 'x_wins' : 'o_wins', player.id); else if (room.board.every(Boolean)) finishRoom(roomId, 'draw', null); else { room.turn = room.turn === 'X' ? 'O' : 'X'; broadcastRoom(roomId); }
    callback({ ok: true });
  });
  socket.on('game:restart', ({ roomId }) => { const room = activeRooms.get(roomId); if (!room || room.players[0]?.id !== user.id) return; room.board = Array(9).fill(null); room.turn = 'X'; room.status = room.players.length === 2 ? 'playing' : 'waiting'; room.startedAt = Date.now(); broadcastRoom(roomId); });
  socket.on('room:leave', ({ roomId }) => { const room = activeRooms.get(roomId); if (!room) return; room.players = room.players.filter((p) => p.id !== user.id); room.spectators = room.spectators.filter((id) => id !== user.id); socket.leave(roomId); if (!room.players.length) { activeRooms.delete(roomId); db.prepare("UPDATE rooms SET status = 'finished' WHERE room_id = ?").run(roomId); } else { room.status = 'waiting'; broadcastRoom(roomId); } });
  socket.on('disconnect', () => { if (clients.get(user.id) === socket.id) clients.delete(user.id); });
});

app.get('*', (req, res) => res.sendFile(path.join(root, 'public', 'index.html')));
function startServer(port) {
  server.once('error', (error) => {
    if (error.code === 'EADDRINUSE') {
      console.warn(`Port ${port} is in use; trying port ${port + 1}.`);
      startServer(port + 1);
      return;
    }
    throw error;
  });
  server.listen(port, HOST, () => console.log(`Let's Play running at http://localhost:${port} (network: http://<your-ip>:${port})`));
}

startServer(PORT);
