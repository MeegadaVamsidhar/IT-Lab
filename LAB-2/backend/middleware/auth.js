/**
 * middleware/auth.js - JWT verification and role-based access control.
 */
const jwt = require('jsonwebtoken');
const userModel = require('../models/userModel');

const JWT_SECRET = process.env.JWT_SECRET || 'exam_system_secret_change_me_in_production';
const JWT_EXPIRES = '1d';

function sign(user) {
  return jwt.sign({ id: user.id, role: user.role }, JWT_SECRET, { expiresIn: JWT_EXPIRES });
}

/** Middleware: verifies the Bearer token and loads the user. */
function auth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'authentication required' });

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const user = userModel.findById(payload.id);
    if (!user) return res.status(401).json({ error: 'user no longer exists' });
    // blocked / unapproved accounts cannot use the API (admins always allowed)
    if (!user.approved && user.role !== 'admin') {
      return res.status(403).json({ error: 'account pending approval' });
    }
    req.user = user;
    next();
  } catch (e) {
    return res.status(401).json({ error: 'invalid or expired token' });
  }
}

/** Middleware factory: only allows listed roles through. */
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'authentication required' });
    if (!roles.includes(req.user.role)) return res.status(403).json({ error: 'forbidden' });
    next();
  };
}

module.exports = { sign, auth, requireRole, JWT_SECRET };
