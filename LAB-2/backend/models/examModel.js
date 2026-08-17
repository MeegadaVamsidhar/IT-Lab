/**
 * models/examModel.js - all SQL for the exams table.
 */
const db = require('../database/db');

function create({ title, duration, totalQuestions, createdBy }) {
  const info = db.prepare(
    'INSERT INTO exams (title, duration, total_questions, created_by) VALUES (?,?,?,?)'
  ).run(title, duration, totalQuestions, createdBy);
  return getById(info.lastInsertRowid);
}

function getById(id) {
  return db.prepare(`
    SELECT e.*, u.name AS examiner_name,
      (SELECT COUNT(*) FROM questions q WHERE q.exam_id = e.id) AS question_count,
      (SELECT COUNT(*) FROM exam_attempts a WHERE a.exam_id = e.id AND a.status='submitted') AS attempt_count
    FROM exams e JOIN users u ON u.id = e.created_by
    WHERE e.id = ?
  `).get(id);
}

function all() {
  return db.prepare(`
    SELECT e.*, u.name AS examiner_name,
      (SELECT COUNT(*) FROM questions q WHERE q.exam_id = e.id) AS question_count,
      (SELECT COUNT(*) FROM exam_attempts a WHERE a.exam_id = e.id AND a.status='submitted') AS attempt_count
    FROM exams e JOIN users u ON u.id = e.created_by
    ORDER BY e.created_at DESC
  `).all();
}

function byExaminer(examinerId) {
  return db.prepare(`
    SELECT e.*,
      (SELECT COUNT(*) FROM questions q WHERE q.exam_id = e.id) AS question_count,
      (SELECT COUNT(*) FROM exam_attempts a WHERE a.exam_id = e.id AND a.status='submitted') AS attempt_count
    FROM exams e WHERE e.created_by = ?
    ORDER BY e.created_at DESC
  `).all(examinerId);
}

function countByExaminer(examinerId) {
  return db.prepare('SELECT COUNT(*) AS c FROM exams WHERE created_by = ?').get(examinerId).c;
}

function countAll() {
  return db.prepare('SELECT COUNT(*) AS c FROM exams').get().c;
}

function countActiveByExaminer(examinerId) {
  return db.prepare(
    'SELECT COUNT(DISTINCT exam_id) AS c FROM exam_attempts a JOIN exams e ON e.id=a.exam_id WHERE e.created_by=? AND a.status="submitted"'
  ).get(examinerId).c;
}

function remove(id) {
  db.prepare('DELETE FROM exams WHERE id = ?').run(id);
}

module.exports = {
  create, getById, all, byExaminer, countByExaminer, countAll, countActiveByExaminer, remove
};
