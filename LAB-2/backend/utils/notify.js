/**
 * utils/notify.js - email notification helper.
 *
 * This is a lightweight stub: real SMTP transport (e.g. Nodemailer with
 * Gmail / Mailgun / SendGrid credentials) can be dropped in here without
 * changing any controller code. For this lab the "email" is recorded in the
 * activity log and printed to the console.
 */
const logger = require('./logger');
const db = require('../database/db');

function sendExamEmail(user, attempt, exam, result) {
  const subject = `Exam Result: ${exam.title}`;
  const body =
    `Hi ${user.name},\n\n` +
    `You scored ${result.score} (${result.percentage.toFixed(1)}%) in "${exam.title}".\n` +
    `Correct: ${result.correct} | Wrong: ${result.wrong} | Unattempted: ${result.unattempted}\n\n` +
    (result.passed ? 'Congratulations, you passed!' : 'Better luck next time!') +
    `\n\n- Exam System (MCQ)`;

  // TODO: integrate Nodemailer / SMTP here, e.g.
  //   transporter.sendMail({ to: user.email, subject, text: body });
  logger.log(attempt.student_id, 'EMAIL_SENT', `${subject} -> ${user.email}`);

  // keep the audit trail of the email body as well
  db.prepare(
    'INSERT INTO activity_logs (user_id, action, detail) VALUES (?,?,?)'
  ).run(attempt.student_id, 'EMAIL_BODY', body.slice(0, 500));

  console.log(`[notify] email to ${user.email}: ${subject}`);
}

module.exports = { sendExamEmail };
