/**
 * models/attemptModel.js - all SQL for exam_attempts and answers.
 */
const db = require('../database/db');

function createAttempt({ studentId, examId, questionSet, duration, totalQuestions }) {
  const info = db.prepare(
    `INSERT INTO exam_attempts (student_id, exam_id, question_set, saved_answers, duration, start_time, total_questions)
     VALUES (?,?,?,?,?,?,?)`
  ).run(studentId, examId, JSON.stringify(questionSet), '{}', duration, Date.now(), totalQuestions);
  return getById(info.lastInsertRowid);
}

function getById(id) {
  return db.prepare('SELECT * FROM exam_attempts WHERE id = ?').get(id);
}

function findActive(studentId, examId) {
  return db.prepare(
    "SELECT * FROM exam_attempts WHERE student_id=? AND exam_id=? AND status='in_progress'"
  ).get(studentId, examId);
}

function byStudent(studentId) {
  return db.prepare(`
    SELECT a.*, e.title AS exam_title
    FROM exam_attempts a JOIN exams e ON e.id = a.exam_id
    WHERE a.student_id = ? ORDER BY a.id DESC
  `).all(studentId);
}

function getAttemptWithExam(id) {
  return db.prepare(`
    SELECT a.*, e.title AS exam_title, u.name AS student_name
    FROM exam_attempts a JOIN exams e ON e.id = a.exam_id JOIN users u ON u.id = a.student_id
    WHERE a.id = ?
  `).get(id);
}

/** Upsert a saved answer for an attempt/question. */
function saveAnswer(attemptId, questionId, selectedOption, isCorrect) {
  const existing = db.prepare('SELECT id FROM answers WHERE attempt_id=? AND question_id=?').get(attemptId, questionId);
  if (existing) {
    db.prepare(
      'UPDATE answers SET selected_option=?, is_correct=? WHERE id=?'
    ).run(selectedOption, isCorrect ? 1 : 0, existing.id);
  } else {
    db.prepare(
      'INSERT INTO answers (attempt_id, question_id, selected_option, is_correct) VALUES (?,?,?,?)'
    ).run(attemptId, questionId, selectedOption, isCorrect ? 1 : 0);
  }
}

function getAnswersForAttempt(attemptId) {
  return db.prepare('SELECT * FROM answers WHERE attempt_id = ?').all(attemptId);
}

function finalizeSnapshot(attemptId, savedAnswersJson) {
  db.prepare('UPDATE exam_attempts SET saved_answers = ? WHERE id = ?').run(savedAnswersJson, attemptId);
}

function finalize(attemptId, result) {
  db.prepare(
    `UPDATE exam_attempts SET status='submitted', end_time=?, correct=?, wrong=?, unattempted=?,
       score=?, percentage=?, passed=?, saved_answers=? WHERE id=?`
  ).run(result.endTime, result.correct, result.wrong, result.unattempted,
       result.score, result.percentage, result.passed ? 1 : 0,
       JSON.stringify(result.savedAnswers), attemptId);
}

/** Aggregate stats used by the student dashboard. */
function studentStats(studentId) {
  return db.prepare(`
    SELECT COUNT(*) AS attempts,
           COALESCE(MAX(percentage), 0) AS highest,
           COALESCE(AVG(percentage), 0) AS average
    FROM exam_attempts WHERE student_id=? AND status='submitted'
  `).get(studentId);
}

function countByExam(examId) {
  return db.prepare(
    "SELECT COUNT(*) AS c FROM exam_attempts WHERE exam_id=? AND status='submitted'"
  ).get(examId).c;
}

/** Global ranking: highest percentage, then score, then earliest submission. */
function rankings() {
  return db.prepare(`
    SELECT a.id, u.name AS student_name, u.email AS student_email, e.title AS exam_title,
           a.score, a.percentage, a.correct, a.wrong, a.unattempted, a.end_time
    FROM exam_attempts a
    JOIN users u ON u.id = a.student_id
    JOIN exams e ON e.id = a.exam_id
    WHERE a.status='submitted'
    ORDER BY a.percentage DESC, a.score DESC, a.end_time ASC
  `).all();
}

function report() {
  return db.prepare(`
    SELECT a.id, u.name AS student_name, u.email AS student_email, e.title AS exam_title,
           a.total_questions, a.correct, a.wrong, a.unattempted, a.score, a.percentage,
           a.passed, a.start_time, a.end_time
    FROM exam_attempts a
    JOIN users u ON u.id = a.student_id
    JOIN exams e ON e.id = a.exam_id
    WHERE a.status='submitted'
    ORDER BY a.end_time DESC
  `).all();
}

function perExamStats() {
  return db.prepare(`
    SELECT e.id, e.title,
           COUNT(a.id) AS attempts,
           COALESCE(AVG(a.percentage),0) AS avg_percentage,
           COALESCE(MAX(a.percentage),0) AS highest
    FROM exams e LEFT JOIN exam_attempts a ON a.exam_id=e.id AND a.status='submitted'
    GROUP BY e.id
  `).all();
}

module.exports = {
  createAttempt, getById, findActive, byStudent, getAttemptWithExam,
  saveAnswer, getAnswersForAttempt, finalizeSnapshot, finalize, studentStats,
  countByExam, rankings, report, perExamStats
};
