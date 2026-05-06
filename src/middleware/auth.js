const jwt = require('jsonwebtoken');
const { query } = require('../db');

async function authenticate(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token provided' });
  }

  const token = authHeader.split(' ')[1];

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    // Attach user to request
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// Only allow admin role
function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}

// Only allow employer role
function requireEmployer(req, res, next) {
  if (req.user?.role !== 'employer' && req.user?.role !== 'admin') {
    return res.status(403).json({ error: 'Employer access required' });
  }
  next();
}

module.exports = { authenticate, requireAdmin, requireEmployer };
