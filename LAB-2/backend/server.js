/**
 * backend/server.js - Express app wiring controllers and serving frontend.
 */
const express = require('express');
const path = require('path');
const authController = require('./controllers/authController');
const examController = require('./controllers/examController');
const examModel = require('./models/examModel');
const questionModel = require('./models/questionModel');
const userModel = require('./models/userModel');
const attemptModel = require('./models/attemptModel');
const { auth, requireRole } = require('./middleware/auth');

const app = express();
app.use(express.json());

// basic CORS for front-end served from same server or file system
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

/* ---------------- Public Auth ---------------- */
app.post('/api/register', authController.register);
app.post('/api/login', authController.login);

/* ---------------- Exams & Session ---------------- */
app.get('/api/exams', auth, examController.listExams);
app.post('/api/exams', auth, requireRole('examiner','admin'), examController.createExam);
app.get('/api/exams/:id', auth, examController.getExam);

app.post('/api/start-exam', auth, examController.startExam);
app.get('/api/exam-session/:attemptId', auth, examController.getSession);
app.post('/api/save-answer', auth, examController.saveAnswer);
app.post('/api/submit-exam', auth, examController.submitExam);

/* ---------------- Questions (examiner/admin) ---------------- */
app.post('/api/questions', auth, requireRole('examiner','admin'), (req, res) => {
  const { examId, question, options, correct, category } = req.body || {};
  if (!examId || !question || !options || !options.A || !options.B || !options.C || !options.D || !correct || !category) {
    return res.status(400).json({ error: 'missing fields' });
  }
  if (!['A','B','C','D'].includes(correct)) return res.status(400).json({ error: 'correct must be A-D' });

  const exam = examModel.getById(Number(examId));
  if (!exam) return res.status(404).json({ error: 'exam not found' });
  if (req.user.role === 'examiner' && exam.created_by !== req.user.id) {
    return res.status(403).json({ error: 'you can only add questions to your own exams' });
  }

  const q = questionModel.create({ examId, question, options, correct, category });
  res.status(201).json(q);
});

app.get('/api/questions', auth, (req, res) => {
  const { examId, search, category } = req.query;
  const examinerId = req.user.role === 'examiner' ? req.user.id : null;
  const q = questionModel.filter({ examId: examId ? Number(examId) : undefined, search, category, examinerId });
  res.json(q);
});

app.put('/api/questions/:id', auth, requireRole('examiner','admin'), (req, res) => {
  const id = Number(req.params.id);
  const { question, options, correct, category } = req.body || {};
  const updated = questionModel.update(id, { question, options, correct, category });
  res.json(updated);
});

app.delete('/api/questions/:id', auth, requireRole('examiner','admin'), (req, res) => {
  const id = Number(req.params.id);
  questionModel.remove(id);
  res.json({ ok: true });
});

/* ---------------- Admin endpoints ---------------- */
app.get('/api/admin/rankings', auth, requireRole('admin'), (req, res) => {
  res.json(attemptModel.rankings());
});

app.get('/api/admin/statistics', auth, requireRole('admin'), (req, res) => {
  const totalStudents = userModel.countByRole('student');
  const totalExaminers = userModel.countByRole('examiner');
  const totalExams = examModel.countAll();
  const totalQuestions = questionModel.countAll();
  res.json({ totalStudents, totalExaminers, totalExams, totalQuestions });
});

app.get('/api/admin/users', auth, requireRole('admin'), (req, res) => {
  res.json(userModel.all());
});

app.put('/api/admin/users/:id/approve', auth, requireRole('admin'), (req, res) => {
  const id = Number(req.params.id);
  userModel.setApproved(id, true);
  res.json({ ok: true });
});

app.delete('/api/admin/users/:id', auth, requireRole('admin'), (req, res) => {
  const id = Number(req.params.id);
  userModel.remove(id);
  res.json({ ok: true });
});

/* ---------------- Results / Attempts ---------------- */
// GET /api/results/:studentId  - student or admin
app.get('/api/results/:studentId', auth, (req, res) => {
  const sid = Number(req.params.studentId);
  if (req.user.role === 'student' && req.user.id !== sid) return res.status(403).json({ error: 'forbidden' });
  if (req.user.role === 'examiner' && req.user.id !== sid) return res.status(403).json({ error: 'forbidden' });
  res.json(attemptModel.byStudent(sid));
});

// GET /api/attempt/:id - get attempt details + answers (student owner or admin)
app.get('/api/attempt/:id', auth, (req, res) => {
  const id = Number(req.params.id);
  const attempt = attemptModel.getAttemptWithExam(id);
  if (!attempt) return res.status(404).json({ error: 'attempt not found' });
  if (req.user.role !== 'admin' && req.user.id !== attempt.student_id) return res.status(403).json({ error: 'forbidden' });
  const answers = attemptModel.getAnswersForAttempt(id);
  res.json({ attempt, answers });
});

/* ---------------- Serve frontend static pages ---------------- */
const FRONT = path.join(__dirname, '..', 'frontend', 'html');
const STYLES = path.join(__dirname, '..', 'frontend', 'css');
app.use('/css', express.static(STYLES));
app.use(express.static(FRONT));

app.get('/', (req, res) => res.sendFile(path.join(FRONT, 'index.html')));

/* ---------------- Start server ---------------- */
const requestedPort = Number.parseInt(process.env.PORT, 10) || 0;

function startServer(port) {
  const server = app.listen(port);

  server.once('listening', () => {
    const { port: activePort } = server.address();
    console.log(`[server] running on http://localhost:${activePort}`);
  });

  server.once('error', (error) => {
    if (error.code === 'EADDRINUSE' && port !== 0) {
      console.warn(`[server] port ${port} is busy; selecting a free port instead`);
      startServer(0);
      return;
    }

    throw error;
  });
}

startServer(requestedPort);

module.exports = app;
