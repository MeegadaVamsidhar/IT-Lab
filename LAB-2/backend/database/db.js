/**
 * database/db.js
 * Central SQLite connection, schema creation and seed data.
 * Uses better-sqlite3 (synchronous) with parameterized prepared statements
 * to protect against SQL injection.
 */
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');

const DB_DIR = path.join(__dirname, '..', '..', 'database');
if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });

const DB_PATH = process.env.DB_PATH || path.join(DB_DIR, 'exam.db');
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

/* ------------------------------ SCHEMA ------------------------------ */
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT NOT NULL,
    email      TEXT NOT NULL UNIQUE,
    password   TEXT NOT NULL,
    role       TEXT NOT NULL CHECK (role IN ('student','examiner','admin')),
    approved   INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );

  CREATE TABLE IF NOT EXISTS exams (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    title          TEXT NOT NULL,
    duration       INTEGER NOT NULL,          -- minutes
    total_questions INTEGER NOT NULL,
    created_by     INTEGER NOT NULL REFERENCES users(id),
    created_at     TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );

  CREATE TABLE IF NOT EXISTS questions (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    exam_id       INTEGER NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
    question      TEXT NOT NULL,
    option_a      TEXT NOT NULL,
    option_b      TEXT NOT NULL,
    option_c      TEXT NOT NULL,
    option_d      TEXT NOT NULL,
    correct_answer TEXT NOT NULL CHECK (correct_answer IN ('A','B','C','D')),
    category      TEXT NOT NULL,
    created_at    TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );

  CREATE TABLE IF NOT EXISTS exam_attempts (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    student_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    exam_id         INTEGER NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
    question_set    TEXT NOT NULL,   -- JSON: random per-student question paper
    saved_answers   TEXT DEFAULT '{}',
    duration        INTEGER NOT NULL,  -- minutes
    start_time      INTEGER NOT NULL,  -- epoch ms
    end_time        INTEGER,
    status          TEXT NOT NULL DEFAULT 'in_progress',
    total_questions INTEGER NOT NULL,
    correct         INTEGER DEFAULT 0,
    wrong           INTEGER DEFAULT 0,
    unattempted     INTEGER DEFAULT 0,
    score           REAL DEFAULT 0,
    percentage      REAL DEFAULT 0,
    passed          INTEGER DEFAULT 0,
    created_at      TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );

  CREATE TABLE IF NOT EXISTS answers (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    attempt_id      INTEGER NOT NULL REFERENCES exam_attempts(id) ON DELETE CASCADE,
    question_id     INTEGER NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
    selected_option TEXT,           -- 'A'..'D' or NULL
    is_correct      INTEGER DEFAULT 0,
    created_at      TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );

  CREATE TABLE IF NOT EXISTS activity_logs (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER,
    action     TEXT NOT NULL,
    detail     TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );
`);

/* ------------------------------ SEED ------------------------------ */
const CATEGORIES = [
  'National News', 'International News', 'Sports', 'Science & Technology',
  'Economy', 'Awards', 'Government Schemes', 'Environment'
];

function seed() {
  const userCount = db.prepare('SELECT COUNT(*) AS c FROM users').get().c;
  if (userCount > 0) return;

  const insertUser = db.prepare(
    'INSERT INTO users (name, email, password, role, approved) VALUES (?,?,?,?,?)'
  );
  insertUser.run('System Admin', 'admin@exam.com', bcrypt.hashSync('Admin@123', 10), 'admin', 1);
  insertUser.run('Demo Examiner', 'examiner@exam.com', bcrypt.hashSync('Exam@123', 10), 'examiner', 1);
  insertUser.run('Demo Student', 'student@exam.com', bcrypt.hashSync('Stu@123', 10), 'student', 1);

  const examiner = db.prepare("SELECT id FROM users WHERE email='examiner@exam.com'").get();

  const examInfo = db.prepare(
    'INSERT INTO exams (title, duration, total_questions, created_by) VALUES (?,?,?,?)'
  );
  const examId = examInfo.run('Current Affairs 2023', 10, 10, examiner.id).lastInsertRowid;

  const insertQ = db.prepare(
    `INSERT INTO questions (exam_id, question, option_a, option_b, option_c, option_d, correct_answer, category)
     VALUES (?,?,?,?,?,?,?,?)`
  );

  const questions = [
    ['Which country hosted the G20 Summit in 2023?', 'India', 'USA', 'Japan', 'France', 'A', 'International News'],
    ['Who won the men\u2019s singles title at Wimbledon 2023?', 'Novak Djokovic', 'Carlos Alcaraz', 'Daniil Medvedev', 'Rafael Nadal', 'A', 'Sports'],
    ['ISRO successfully launched which lunar mission in 2023?', 'Chandrayaan-3', 'Chandrayaan-2', 'Mangalyaan-2', 'Aditya-L1', 'A', 'Science & Technology'],
    ['Which ministry launched the \u201cPM Vishwakarma\u201d scheme in 2023?', 'Ministry of MSME', 'Ministry of Home', 'Ministry of Finance', 'Ministry of Agriculture', 'A', 'Government Schemes'],
    ['Who received the Bharat Ratna in 2024?', 'Karpoori Thakur', 'Lal Bahadur Shastri', 'Sardar Patel', 'B.R. Ambedkar', 'A', 'Awards'],
    ['What is India\u2019s target year for achieving Net Zero carbon emissions?', '2070', '2030', '2050', '2060', 'A', 'Environment'],
    ['Which country assumed the presidency of the G20 in 2023?', 'India', 'Brazil', 'South Africa', 'Indonesia', 'A', 'International News'],
    ['The 2023 Cricket World Cup was won by which team?', 'Australia', 'India', 'England', 'New Zealand', 'A', 'Sports'],
    ['Which spacecraft successfully landed on the Moon in August 2023?', 'Chandrayaan-3 Vikram', 'Chang\u2019e-5', 'Artemis 1', 'Lunar-25', 'A', 'Science & Technology'],
    ['The Nobel Peace Prize 2023 was awarded to whom?', 'Narges Mohammadi', 'Maria Ressa', 'Abiy Ahmed', 'Juan Manuel Santos', 'A', 'Awards'],
    ['What is the full form of GST?', 'Goods and Services Tax', 'General Sales Tax', 'Government Service Tax', 'Goods and Service Tariff', 'A', 'Economy'],
    ['Which national park is famous for the one-horned rhinoceros?', 'Kaziranga', 'Sundarbans', 'Jim Corbett', 'Gir', 'A', 'Environment'],
    ['Who is known as the \u201cMissile Man of India\u201d?', 'Dr. A.P.J. Abdul Kalam', 'Dr. Vikram Sarabhai', 'Dr. Homi Bhabha', 'Dr. C.V. Raman', 'A', 'National News'],
    ['The headquarters of the Reserve Bank of India is located in?', 'Mumbai', 'New Delhi', 'Kolkata', 'Chennai', 'A', 'Economy'],
    ['Which scheme provides free food grains under PM Garib Kalyan Yojana?', 'NFSA', 'POSHAN Abhiyan', 'AYUSHMAN', 'Kisan Samman', 'A', 'Government Schemes'],
    ['India\u2019s first solar observatory mission is called?', 'Aditya-L1', 'Chandrayaan-3', 'Mangalyaan', 'Gaganyaan', 'A', 'Science & Technology']
  ];

  const insert = db.transaction(() => {
    for (const q of questions) insertQ.run(examId, ...q);
  });
  insert();

  console.log('[db] Seeded demo data: admin, examiner, student, 1 exam, 16 questions.');
}

seed();

module.exports = db;
