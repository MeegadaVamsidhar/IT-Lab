/**
 * models/userModel.js - all SQL for the users table.
 */
const db = require('../database/db');

function findByEmail(email) {
  return db.prepare('SELECT * FROM users WHERE email = ?').get(email);
}

function findById(id) {
  return db.prepare('SELECT id, name, email, role, approved, created_at FROM users WHERE id = ?').get(id);
}

function create({ name, email, password, role, approved }) {
  const info = db.prepare(
    'INSERT INTO users (name, email, password, role, approved) VALUES (?,?,?,?,?)'
  ).run(name, email, password, role, approved ? 1 : 0);
  return findById(info.lastInsertRowid);
}

function updateProfile(id, { name, email }) {
  db.prepare('UPDATE users SET name = ?, email = ? WHERE id = ?').run(name, email, id);
  return findById(id);
}

function updatePassword(id, hash) {
  db.prepare('UPDATE users SET password = ? WHERE id = ?').run(hash, id);
}

function setApproved(id, approved) {
  db.prepare('UPDATE users SET approved = ? WHERE id = ?').run(approved ? 1 : 0, id);
}

function remove(id) {
  db.prepare('DELETE FROM users WHERE id = ?').run(id);
}

function all() {
  return db.prepare('SELECT id, name, email, role, approved, created_at FROM users ORDER BY created_at DESC').all();
}

function countByRole(role) {
  return db.prepare('SELECT COUNT(*) AS c FROM users WHERE role = ?').get(role).c;
}

module.exports = {
  findByEmail, findById, create, updateProfile, updatePassword,
  setApproved, remove, all, countByRole
};
