/**
 * controllers/authController.js - register / login.
 */
const bcrypt = require('bcryptjs');
const userModel = require('../models/userModel');
const { sign } = require('../middleware/auth');
const logger = require('../utils/logger');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function publicUser(u) {
  return { id: u.id, name: u.name, email: u.email, role: u.role, approved: !!u.approved };
}

// POST /api/register  { name, email, password, role }
exports.register = (req, res) => {
  const { name, email, password, role } = req.body || {};

  // ---- validation (defense in depth) ----
  if (!name || !String(name).trim() || String(name).trim().length > 100) {
    return res.status(400).json({ error: 'valid name is required' });
  }
  if (!email || !EMAIL_RE.test(String(email).trim())) {
    return res.status(400).json({ error: 'valid email is required' });
  }
  if (!password || String(password).length < 6) {
    return res.status(400).json({ error: 'password must be at least 6 characters' });
  }
  if (!['student', 'examiner'].includes(role)) {
    return res.status(400).json({ error: 'role must be student or examiner' });
  }

  if (userModel.findByEmail(email.trim().toLowerCase())) {
    return res.status(409).json({ error: 'email already registered' });
  }

  // students are auto-approved; examiners require admin approval
  const approved = role === 'student';
  const hash = bcrypt.hashSync(String(password), 10);
  const user = userModel.create({
    name: String(name).trim(),
    email: email.trim().toLowerCase(),
    password: hash,
    role,
    approved
  });

  logger.log(user.id, 'REGISTER', `${role} ${user.email} registered`);
  if (!approved) logger.log(null, 'REVIEW_REQUIRED', `examiner ${user.email} awaits approval`);

  // examiners must wait for admin approval, so we do NOT auto-login them
  if (role === 'examiner') {
    return res.status(201).json({ pendingApproval: true, message: 'Account created. Await admin approval to login.' });
  }

  return res.status(201).json({ token: sign(user), user: publicUser(user) });
};

// POST /api/login  { email, password }
exports.login = (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'email and password are required' });

  const user = userModel.findByEmail(String(email).trim().toLowerCase());
  if (!user || !bcrypt.compareSync(String(password), user.password)) {
    return res.status(401).json({ error: 'invalid email or password' });
  }
  if (!user.approved && user.role !== 'admin') {
    return res.status(403).json({ error: 'account pending admin approval' });
  }

  logger.log(user.id, 'LOGIN', `${user.role} ${user.email} logged in`);
  return res.json({ token: sign(user), user: publicUser(user) });
};
