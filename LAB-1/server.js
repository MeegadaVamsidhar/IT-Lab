const express = require('express');
const path = require('path');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const session = require('express-session');

const dbPath = path.join(__dirname, 'mydb.db');
const db = new Database(dbPath);

const userColumns = db.prepare("PRAGMA table_info(users)").all().map((column) => column.name);
if (userColumns.length > 0 && (!userColumns.includes('username') || !userColumns.includes('password'))) {
    db.prepare('DROP TABLE users').run();
}

db.prepare(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY,
    username TEXT UNIQUE,
    password TEXT
)`).run();

console.log(`Using SQLite database at ${dbPath}`);

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(session({
    secret: 'change_this_secret_at_deploy',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 24 * 60 * 60 * 1000, httpOnly: true }
}));

app.use(express.static(path.join(__dirname, 'public')));

// Register
app.post('/api/register', async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'username and password required' });
    if (password.length < 6) return res.status(400).json({ error: 'password must be >= 6 characters' });
    const hash = await bcrypt.hash(password, 10);
    try {
        const stmt = db.prepare('INSERT INTO users (username, password) VALUES (?, ?)');
        const info = stmt.run(username, hash);
        req.session.user = { id: info.lastInsertRowid, username };
        return res.json({ ok: true });
    } catch (e) {
    if (e.code === 'SQLITE_CONSTRAINT_UNIQUE') return res.status(400).json({ error: 'username already exists' });
    console.error(e);
    return res.status(500).json({ error: 'internal server error' });
}
});

// Login
app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'username and password required' });
    const row = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
    if (!row) return res.status(400).json({ error: 'invalid credentials' });
    const ok = await bcrypt.compare(password, row.password);
    if (!ok) return res.status(400).json({ error: 'invalid credentials' });
    req.session.user = { id: row.id, username: row.username };
    return res.json({ ok: true });
});

// Current user
app.get('/api/me', (req, res) => {
    if (req.session && req.session.user) return res.json({ username: req.session.user.username });
    return res.status(401).json({ error: 'unauthenticated' });
});

// Logout
app.post('/api/logout', (req, res) => {
    req.session.destroy(err => {
        if (err) return res.status(500).json({ error: 'failed to logout' });
        res.clearCookie('connect.sid');
        return res.json({ ok: true });
    });
});

// Fallback to index.html for SPA
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
