import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { createHash, randomUUID } from 'node:crypto';

const root = resolve(fileURLToPath(new URL('.', import.meta.url)));
const dataDirectory = join(root, 'data');
const databasePath = join(dataDirectory, 'pulsepass.db');
await mkdir(dataDirectory, { recursive: true });
const database = new DatabaseSync(databasePath);

database.exec(`
  PRAGMA foreign_keys = ON;
  CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    category TEXT NOT NULL,
    date TEXT NOT NULL,
    venue TEXT NOT NULL,
    capacity INTEGER NOT NULL,
    sold INTEGER NOT NULL DEFAULT 0,
    base_price INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'on-sale'
  );
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'attendee',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_code TEXT NOT NULL UNIQUE,
    user_id INTEGER,
    event_id INTEGER NOT NULL,
    quantity INTEGER NOT NULL,
    amount INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'paid',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (event_id) REFERENCES events(id)
  );
`);

const eventCount = database.prepare('SELECT COUNT(*) AS count FROM events').get().count;
if (eventCount === 0) {
  const seed = database.prepare(`INSERT INTO events (name, category, date, venue, capacity, sold, base_price, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
  seed.run('Neon Fields Festival', 'Music festival', '2026-09-18T18:00:00', 'Lumen Park', 1600, 1024, 59, 'on-sale');
  seed.run('Riverside Theatre: Macbeth', 'Theatre', '2026-09-24T19:30:00', 'Riverside Hall', 400, 324, 38, 'on-sale');
  seed.run('City Hawks vs. Northstars', 'Sport', '2026-10-02T20:00:00', 'Hawks Arena', 12000, 0, 24, 'draft');
}

const hashPassword = password => createHash('sha256').update(password).digest('hex');
database.prepare('INSERT OR IGNORE INTO users (email, password_hash, role) VALUES (?, ?, ?)').run('organizer@pulsepass.local', hashPassword('organize123'), 'organizer');
database.prepare('INSERT OR IGNORE INTO users (email, password_hash, role) VALUES (?, ?, ?)').run('customer@pulsepass.local', hashPassword('customer123'), 'attendee');
const json = (response, status, payload) => {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
  response.end(JSON.stringify(payload));
};
const body = async request => {
  let raw = '';
  for await (const chunk of request) raw += chunk;
  return raw ? JSON.parse(raw) : {};
};
const currentPrice = event => {
  const capacity = event.sold / event.capacity * 100;
  if (capacity >= 75) return Math.round(event.base_price * 1.12);
  if (capacity <= 15) return Math.round(event.base_price * 0.85);
  return event.base_price;
};

function events() {
  return database.prepare('SELECT * FROM events ORDER BY date').all().map(event => ({
    ...event,
    soldPercent: Math.round(event.sold / event.capacity * 100),
    currentPrice: currentPrice(event)
  }));
}

async function handleApi(request, response, pathname) {
  if (request.method === 'GET' && pathname === '/api/health') return json(response, 200, { status: 'ok', database: 'sqlite', timestamp: new Date().toISOString() });
  if (request.method === 'GET' && pathname === '/api/events') return json(response, 200, { events: events() });
  if (request.method === 'GET' && pathname === '/api/orders') {
    const rows = database.prepare(`SELECT orders.order_code AS orderCode, users.email, events.name AS event, orders.quantity, orders.amount, orders.status, orders.created_at AS createdAt FROM orders LEFT JOIN users ON users.id = orders.user_id JOIN events ON events.id = orders.event_id ORDER BY orders.id DESC`).all();
    return json(response, 200, { orders: rows });
  }
  if (request.method === 'POST' && pathname === '/api/auth/register') {
    const input = await body(request);
    if (!input.email || !input.password) return json(response, 400, { error: 'Email and password are required.' });
    if (input.role === 'organizer') return json(response, 403, { error: 'Organizer accounts are created by the PulsePass administrator.' });
    try {
      const result = database.prepare('INSERT INTO users (email, password_hash) VALUES (?, ?)').run(input.email.toLowerCase(), hashPassword(input.password));
      return json(response, 201, { user: { id: Number(result.lastInsertRowid), email: input.email.toLowerCase(), role: 'attendee' } });
    } catch (error) {
      return json(response, 409, { error: error.message.includes('UNIQUE') ? 'An account with this email already exists.' : 'Could not create account.' });
    }
  }
  if (request.method === 'POST' && pathname === '/api/auth/login') {
    const input = await body(request);
    const user = database.prepare('SELECT id, email, role FROM users WHERE email = ? AND password_hash = ?').get(input.email?.toLowerCase(), hashPassword(input.password || ''));
    const requestedRole = input.role === 'organizer' ? 'organizer' : 'attendee';
    if (!user || user.role !== requestedRole) return json(response, 401, { error: `These credentials do not have ${input.role === 'organizer' ? 'organizer' : 'customer'} access.` });
    return json(response, 200, { user: { ...user, role: input.role === 'organizer' ? 'organizer' : 'customer' }, token: randomUUID() });
  }
  if (request.method === 'POST' && pathname === '/api/orders') {
    const input = await body(request);
    const customer = input.userId && database.prepare('SELECT id FROM users WHERE id = ? AND role = \'attendee\'').get(input.userId);
    if (!customer) return json(response, 401, { error: 'Sign in with a customer account before booking.' });
    const event = database.prepare('SELECT * FROM events WHERE id = ? AND status = \'on-sale\'').get(input.eventId);
    const quantity = Number(input.quantity || 1);
    if (!event || quantity < 1 || event.sold + quantity > event.capacity) return json(response, 400, { error: 'Tickets are unavailable for this event.' });
    const amount = currentPrice(event) * quantity;
    const orderCode = `PP-${Math.floor(10000 + Math.random() * 89999)}`;
    database.exec('BEGIN IMMEDIATE');
    try {
      database.prepare('UPDATE events SET sold = sold + ? WHERE id = ?').run(quantity, event.id);
      database.prepare('INSERT INTO orders (order_code, user_id, event_id, quantity, amount) VALUES (?, ?, ?, ?, ?)').run(orderCode, input.userId || null, event.id, quantity, amount);
      database.exec('COMMIT');
    } catch (error) {
      database.exec('ROLLBACK');
      throw error;
    }
    return json(response, 201, { order: { orderCode, event: event.name, quantity, amount, status: 'paid' } });
  }
  return json(response, 404, { error: 'API route not found.' });
}

const mimeTypes = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8' };
async function serveStatic(response, pathname) {
  const requested = pathname === '/' ? '/index.html' : pathname;
  const filePath = normalize(join(root, requested));
  if (!filePath.startsWith(root)) return json(response, 403, { error: 'Forbidden' });
  try {
    const content = await readFile(filePath);
    response.writeHead(200, { 'Content-Type': mimeTypes[extname(filePath)] || 'application/octet-stream' });
    response.end(content);
  } catch {
    json(response, 404, { error: 'File not found.' });
  }
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url, 'http://localhost');
  try {
    if (url.pathname.startsWith('/api/')) await handleApi(request, response, url.pathname);
    else await serveStatic(response, url.pathname);
  } catch (error) {
    json(response, 500, { error: 'Server error.', detail: error.message });
  }
});

const port = Number(process.env.PORT || 3000);
server.listen(port, () => console.log(`PulsePass running at http://localhost:${port}`));
