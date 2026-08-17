/**
 * models/questionModel.js - all SQL for the questions table.
 */
const db = require('../database/db');

function create({ examId, question, options, correct, category }) {
  const info = db.prepare(
    `INSERT INTO questions (exam_id, question, option_a, option_b, option_c, option_d, correct_answer, category)
     VALUES (?,?,?,?,?,?,?,?)`
  ).run(examId, question, options.A, options.B, options.C, options.D, correct, category);
  return getById(info.lastInsertRowid);
}

function getById(id) {
  return db.prepare('SELECT q.*, e.title AS exam_title FROM questions q JOIN exams e ON e.id=q.exam_id WHERE q.id = ?').get(id);
}

function getByExam(examId) {
  return db.prepare('SELECT * FROM questions WHERE exam_id = ? ORDER BY created_at DESC').all(examId);
}

/** Flexible filter: optional examId, search text, category. */
function filter({ examId, search, category, examinerId, admin }) {
  let sql = 'SELECT q.*, e.title AS exam_title FROM questions q JOIN exams e ON e.id = q.exam_id WHERE 1=1';
  const args = [];
  if (examinerId) { sql += ' AND e.created_by = ?'; args.push(examinerId); }
  if (examId) { sql += ' AND q.exam_id = ?'; args.push(examId); }
  if (category) { sql += ' AND q.category = ?'; args.push(category); }
  if (search) { sql += ' AND q.question LIKE ?'; args.push(`%${search}%`); }
  sql += ' ORDER BY q.created_at DESC';
  return db.prepare(sql).all(...args);
}

function update(id, { question, options, correct, category }) {
  db.prepare(
    'UPDATE questions SET question=?, option_a=?, option_b=?, option_c=?, option_d=?, correct_answer=?, category=? WHERE id=?'
  ).run(question, options.A, options.B, options.C, options.D, correct, category, id);
  return getById(id);
}

function remove(id) {
  db.prepare('DELETE FROM questions WHERE id = ?').run(id);
}

function countByExaminer(examinerId) {
  return db.prepare(
    'SELECT COUNT(*) AS c FROM questions q JOIN exams e ON e.id=q.exam_id WHERE e.created_by=?'
  ).get(examinerId).c;
}

function countAll() {
  return db.prepare('SELECT COUNT(*) AS c FROM questions').get().c;
}

function categories() {
  return db.prepare('SELECT DISTINCT category FROM questions ORDER BY category').all().map(r => r.category);
}

module.exports = {
  create, getById, getByExam, filter, update, remove,
  countByExaminer, countAll, categories
};
