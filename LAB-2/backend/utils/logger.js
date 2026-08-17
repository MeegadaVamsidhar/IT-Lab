/**
 * utils/logger.js - activity log / audit trail writer.
 */
const db = require('../database/db');

function log(userId, action, detail = '') {
  db.prepare(
    'INSERT INTO activity_logs (user_id, action, detail) VALUES (?,?,?)'
  ).run(userId || null, action, String(detail).slice(0, 500));
}

function recent(limit = 50) {
  return db.prepare(`
    SELECT l.*, u.name AS user_name, u.email AS user_email
    FROM activity_logs l LEFT JOIN users u ON u.id = l.user_id
    ORDER BY l.id DESC LIMIT ?
  `).all(limit);
}

module.exports = { log, recent };
