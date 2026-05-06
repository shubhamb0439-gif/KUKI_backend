const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { query } = require('../db');
const { authenticate, requireEmployer } = require('../middleware/auth');

const router = express.Router();

// ─── WAGES ───────────────────────────────────────────────────────────────────

// GET /wages
router.get('/', authenticate, async (req, res) => {
  const { employee_id } = req.query;
  try {
    let q = `
      SELECT w.*, p.name AS employee_name
      FROM wages w
      JOIN employees e ON w.employee_id = e.id
      JOIN profiles p ON e.user_id = p.id
      WHERE 1=1
    `;
    const params = {};
    if (req.user.role === 'employer') { q += ' AND e.employer_id = @employer_id'; params.employer_id = req.user.id; }
    else { q += ' AND e.user_id = @user_id'; params.user_id = req.user.id; }
    if (employee_id) { q += ' AND w.employee_id = @employee_id'; params.employee_id = employee_id; }
    q += ' ORDER BY w.period_start DESC';

    const result = await query(q, params);
    res.json(result.recordset);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch wages' });
  }
});

// POST /wages - create wage record
router.post('/', authenticate, requireEmployer, async (req, res) => {
  const { employee_id, amount, period_start, period_end, status } = req.body;
  try {
    const id = uuidv4();
    await query(`
      INSERT INTO wages (id, employee_id, amount, period_start, period_end, status, created_at)
      VALUES (@id, @employee_id, @amount, @period_start, @period_end, @status, GETUTCDATE())
    `, { id, employee_id, amount, period_start, period_end, status: status || 'pending' });
    res.status(201).json({ id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create wage record' });
  }
});

// PATCH /wages/:id
router.patch('/:id', authenticate, requireEmployer, async (req, res) => {
  const { status, amount, notes } = req.body;
  try {
    await query(
      'UPDATE wages SET status = @status, amount = ISNULL(@amount, amount), notes = @notes, updated_at = GETUTCDATE() WHERE id = @id',
      { id: req.params.id, status: status || null, amount: amount || null, notes: notes || null }
    );
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update wage' });
  }
});

// ─── LOANS ───────────────────────────────────────────────────────────────────

// GET /wages/loans
router.get('/loans', authenticate, async (req, res) => {
  try {
    let q = `
      SELECT l.*, p.name AS employee_name
      FROM employee_loans l
      JOIN employees e ON l.employee_id = e.id
      JOIN profiles p ON e.user_id = p.id
      WHERE 1=1
    `;
    const params = {};
    if (req.user.role === 'employer') { q += ' AND e.employer_id = @eid'; params.eid = req.user.id; }
    else { q += ' AND e.user_id = @uid'; params.uid = req.user.id; }
    q += ' ORDER BY l.created_at DESC';
    const result = await query(q, params);
    res.json(result.recordset);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch loans' });
  }
});

// POST /wages/loans
router.post('/loans', authenticate, requireEmployer, async (req, res) => {
  const { employee_id, amount, description } = req.body;
  try {
    const id = uuidv4();
    await query(`
      INSERT INTO employee_loans (id, employee_id, amount, description, status, created_at)
      VALUES (@id, @employee_id, @amount, @description, 'active', GETUTCDATE())
    `, { id, employee_id, amount, description: description || null });
    res.status(201).json({ id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create loan' });
  }
});

// ─── BONUSES ─────────────────────────────────────────────────────────────────

// GET /wages/bonuses
router.get('/bonuses', authenticate, async (req, res) => {
  try {
    let q = `
      SELECT b.*, p.name AS employee_name
      FROM employee_bonuses b
      JOIN employees e ON b.employee_id = e.id
      JOIN profiles p ON e.user_id = p.id
      WHERE 1=1
    `;
    const params = {};
    if (req.user.role === 'employer') { q += ' AND e.employer_id = @eid'; params.eid = req.user.id; }
    else { q += ' AND e.user_id = @uid'; params.uid = req.user.id; }
    q += ' ORDER BY b.created_at DESC';
    const result = await query(q, params);
    res.json(result.recordset);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch bonuses' });
  }
});

// POST /wages/bonuses
router.post('/bonuses', authenticate, requireEmployer, async (req, res) => {
  const { employee_id, amount, description } = req.body;
  try {
    const id = uuidv4();
    await query(`
      INSERT INTO employee_bonuses (id, employee_id, amount, description, created_at)
      VALUES (@id, @employee_id, @amount, @description, GETUTCDATE())
    `, { id, employee_id, amount, description: description || null });
    res.status(201).json({ id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create bonus' });
  }
});

// ─── STATEMENTS ──────────────────────────────────────────────────────────────

// GET /wages/statements
router.get('/statements', authenticate, async (req, res) => {
  try {
    let q = `SELECT s.* FROM statements s WHERE 1=1`;
    const params = {};
    if (req.user.role !== 'admin') { q += ' AND s.user_id = @uid'; params.uid = req.user.id; }
    q += ' ORDER BY s.created_at DESC';
    const result = await query(q, params);
    res.json(result.recordset);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch statements' });
  }
});

module.exports = router;
