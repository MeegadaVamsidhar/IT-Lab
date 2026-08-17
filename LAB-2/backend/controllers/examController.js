/**
 * controllers/examController.js - exam creation, viewing, exam sessions.
 */
const examModel = require('../models/examModel');
const questionModel = require('../models/questionModel');
const attemptModel = require('../models/attemptModel');
const userModel = require('../models/userModel');
const { generateQuestionSet } = require('../utils/random');
const logger = require('../utils/logger');
const notify = require('../utils/notify');

// GET /api/exams - available exams (student view adds "attempted" flag)
exports.listExams = (req, res) => {
  const visibleExams = req.user.role === 'examiner'
    ? examModel.byExaminer(req.user.id)
    : examModel.all();

  const exams = visibleExams.map((e) => {
    const attempted = req.user.role === 'student'
      ? !!attemptModel.findActive(req.user.id, e.id) || !!attemptModel.byStudent(req.user.id)
          .find((a) => a.exam_id === e.id && a.status === 'submitted')
      : false;
    return { ...e, attempted };
  });
  res.json(exams);
};

// POST /api/exams  { title, duration, total_questions }  (examiner only)
exports.createExam = (req, res) => {
  const title = String(req.body.title || '').trim();
  const duration = Number(req.body.duration);
  const totalQuestions = Number(req.body.total_questions);

  if (!title || title.length > 200) return res.status(400).json({ error: 'valid exam title required' });
  if (!Number.isInteger(duration) || duration < 1 || duration > 240) {
    return res.status(400).json({ error: 'duration must be 1-240 minutes' });
  }
  if (!Number.isInteger(totalQuestions) || totalQuestions < 1 || totalQuestions > 200) {
    return res.status(400).json({ error: 'total_questions must be 1-200' });
  }

  const exam = examModel.create({ title, duration, totalQuestions, createdBy: req.user.id });
  logger.log(req.user.id, 'EXAM_CREATED', `exam "${exam.title}" (id=${exam.id})`);
  res.status(201).json(exam);
};

// GET /api/exams/:id - one exam + its questions (examiner/owner or admin)
exports.getExam = (req, res) => {
  const exam = examModel.getById(Number(req.params.id));
  if (!exam) return res.status(404).json({ error: 'exam not found' });

  if (req.user.role === 'examiner' && exam.created_by !== req.user.id) {
    return res.status(403).json({ error: 'you can only view your own exams' });
  }
  const questions = questionModel.getByExam(exam.id);
  res.json({ ...exam, questions });
};

// POST /api/start-exam  { examId }  (student)
// Generates a fresh random paper, creates an attempt, returns the session.
exports.startExam = (req, res) => {
  if (req.user.role !== 'student') return res.status(403).json({ error: 'only students can take exams' });

  const exam = examModel.getById(Number(req.body.examId));
  if (!exam) return res.status(404).json({ error: 'exam not found' });

  const active = attemptModel.findActive(req.user.id, exam.id);
  if (active) {
    return res.json({ attemptId: active.id, resumed: true });
  }

  const bank = questionModel.getByExam(exam.id);
  const available = Math.min(exam.total_questions, bank.length);
  if (available < 1) return res.status(400).json({ error: 'this exam has no questions yet' });

  const paper = generateQuestionSet(bank, available);
  const attempt = attemptModel.createAttempt({
    studentId: req.user.id,
    examId: exam.id,
    questionSet: paper,
    duration: exam.duration,
    totalQuestions: paper.length
  });

  logger.log(req.user.id, 'EXAM_STARTED', `started "${exam.title}" (attempt=${attempt.id})`);
  res.status(201).json({ attemptId: attempt.id, resumed: false });
};

// GET /api/exam-session/:attemptId - load/resume an exam (student owner only)
exports.getSession = (req, res) => {
  const attempt = attemptModel.getById(Number(req.params.attemptId));
  if (!attempt) return res.status(404).json({ error: 'attempt not found' });
  if (attempt.student_id !== req.user.id) return res.status(403).json({ error: 'forbidden' });
  if (attempt.status === 'submitted') return res.status(410).json({ error: 'exam already submitted' });

  const exam = examModel.getById(attempt.exam_id);
  const paper = JSON.parse(attempt.question_set);

  // strip the correct answers before sending to the client
  const clientPaper = paper.map((q) => ({
    id: q.id, category: q.category, question: q.question, options: q.options
  }));

  res.json({
    attemptId: attempt.id,
    examTitle: exam.title,
    durationMin: attempt.duration,
    startTime: attempt.start_time,
    totalQuestions: attempt.total_questions,
    questions: clientPaper,
    savedAnswers: JSON.parse(attempt.saved_answers || '{}')
  });
};

// POST /api/save-answer  { attemptId, questionId, selectedOption }
exports.saveAnswer = (req, res) => {
  const attemptId = Number(req.body.attemptId);
  const questionId = Number(req.body.questionId);
  const selectedOption = String(req.body.selectedOption || '').toUpperCase();

  const attempt = attemptModel.getById(attemptId);
  if (!attempt || attempt.student_id !== req.user.id) return res.status(403).json({ error: 'forbidden' });
  if (attempt.status === 'submitted') return res.status(410).json({ error: 'exam already submitted' });

  if (!['A', 'B', 'C', 'D'].includes(selectedOption)) {
    return res.status(400).json({ error: 'selectedOption must be A-D' });
  }

  const paper = JSON.parse(attempt.question_set);
  const q = paper.find((p) => p.id === questionId);
  if (!q) return res.status(400).json({ error: 'question not part of this paper' });

  const isCorrect = q.correct === selectedOption;
  attemptModel.saveAnswer(attemptId, questionId, selectedOption, isCorrect);

  // persist quick snapshot for resume + faster evaluation
  const saved = JSON.parse(attempt.saved_answers || '{}');
  saved[questionId] = selectedOption;
  attemptModel.finalizeSnapshot(attemptId, JSON.stringify(saved));

  res.json({ ok: true, isCorrect });
};

// POST /api/submit-exam  { attemptId }
exports.submitExam = (req, res) => {
  const attemptId = Number(req.body.attemptId);
  const attempt = attemptModel.getById(attemptId);
  if (!attempt || attempt.student_id !== req.user.id) return res.status(403).json({ error: 'forbidden' });
  if (attempt.status === 'submitted') {
    return res.status(410).json({ error: 'exam already submitted', alreadySubmitted: true });
  }

  const paper = JSON.parse(attempt.question_set);
  const answers = attemptModel.getAnswersForAttempt(attemptId);

  const byQ = {};
  for (const a of answers) byQ[a.question_id] = a;

  let correct = 0, wrong = 0, unattempted = 0;
  const savedAnswers = {};
  const marksPerQuestion = 1; // 1 mark per question; extend with exam marks config if needed

  for (const q of paper) {
    const ans = byQ[q.id];
    if (!ans || !ans.selected_option) {
      unattempted++;
      continue;
    }
    savedAnswers[q.id] = ans.selected_option;
    if (ans.selected_option === q.correct) correct++;
    else wrong++;
  }

  const total = paper.length;
  const score = correct * marksPerQuestion;
  const percentage = total ? Math.round((score / total) * 10000) / 100 : 0;
  const passed = percentage >= 50;

  const result = {
    endTime: Date.now(),
    correct, wrong, unattempted,
    score, percentage, passed,
    savedAnswers
  };
  attemptModel.finalize(attemptId, result);

  const exam = examModel.getById(attempt.exam_id);
  const student = userModel.findById(attempt.student_id);
  logger.log(attempt.student_id, 'EXAM_SUBMITTED',
    `submitted "${exam.title}" score=${score} (${percentage}%)`);

  // email notification (stub transport, see utils/notify.js)
  notify.sendExamEmail(student, attempt, exam, result);

  res.json({
    attemptId,
    examTitle: exam.title,
    totalQuestions: total,
    correct, wrong, unattempted, score, percentage, passed
  });
};
