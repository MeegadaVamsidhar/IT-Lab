const { DatabaseSync } = require('node:sqlite');
const path = require('path');

const dbPath = path.join(__dirname, 'mydb.db');
const db = new DatabaseSync(dbPath);

const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all();
console.log('Database:', dbPath);
console.log('Tables:', tables.map((table) => table.name).join(', ') || '(none)');

if (tables.some((table) => table.name === 'users')) {
	const users = db.prepare('SELECT * FROM users ORDER BY id').all();
	console.table(users);
} else {
	console.log('No users table found yet.');
}

db.close();
