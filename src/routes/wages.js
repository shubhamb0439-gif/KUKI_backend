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
  const { employee_id } = req.query;
  try {
    let q = `SELECT * FROM wage_loans WHERE employer_id = @employer_id`;
    const params = { employer_id: req.user.id };
    if (employee_id) { q += ' AND employee_id = @employee_id'; params.employee_id = employee_id; }
    q += ' ORDER BY created_at DESC';
    const result = await query(q, params);
    res.json(result.recordset);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch loans' });
  }
});

// GET /wages/loans/:id
router.get('/loans/:id', authenticate, async (req, res) => {
  try {
    const result = await query(`SELECT * FROM wage_loans WHERE id = @id`, { id: req.params.id });
    if (!result.recordset.length) return res.status(404).json({ error: 'Loan not found' });
    res.json(result.recordset[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch loan' });
  }
});

// POST /wages/loans
router.post('/loans', authenticate, requireEmployer, async (req, res) => {
  const { employee_id, amount, repayment_amount, repayment_frequency, notes, status, qr_code } = req.body;
  try {
    const id = uuidv4();
    await query(`
      INSERT INTO wage_loans (id, employee_id, employer_id, amount, repayment_amount, repayment_frequency, notes, status, qr_code, created_at)
      VALUES (@id, @employee_id, @employer_id, @amount, @repayment_amount, @repayment_frequency, @notes, @status, @qr_code, GETUTCDATE())
    `, { id, employee_id, employer_id: req.user.id, amount, repayment_amount: repayment_amount || null, repayment_frequency: repayment_frequency || null, notes: notes || null, status: status || 'active', qr_code: qr_code || null });
    res.status(201).json({ id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create loan' });
  }
});

// PATCH /wages/loans/:id
router.patch('/loans/:id', authenticate, requireEmployer, async (req, res) => {
  const { amount, repayment_amount, repayment_frequency, notes, status, qr_code } = req.body;
  try {
    const result = await query(`
      UPDATE wage_loans
      SET amount = ISNULL(@amount, amount),
          repayment_amount = ISNULL(@repayment_amount, repayment_amount),
          repayment_frequency = ISNULL(@repayment_frequency, repayment_frequency),
          notes = ISNULL(@notes, notes),
          status = ISNULL(@status, status),
          qr_code = ISNULL(@qr_code, qr_code)
      OUTPUT INSERTED.*
      WHERE id = @id
    `, { id: req.params.id, amount: amount ?? null, repayment_amount: repayment_amount ?? null, repayment_frequency: repayment_frequency ?? null, notes: notes ?? null, status: status ?? null, qr_code: qr_code ?? null });
    res.json(result.recordset[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update loan' });
  }
});

// ─── BONUSES ─────────────────────────────────────────────────────────────────

// GET /wages/bonuses
router.get('/bonuses', authenticate, async (req, res) => {
  const { employee_id } = req.query;
  try {
    let q = `SELECT * FROM wage_bonuses WHERE employer_id = @employer_id`;
    const params = { employer_id: req.user.id };
    if (employee_id) { q += ' AND employee_id = @employee_id'; params.employee_id = employee_id; }
    q += ' ORDER BY created_at DESC';
    const result = await query(q, params);
    res.json(result.recordset);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch bonuses' });
  }
});

// POST /wages/bonuses
router.post('/bonuses', authenticate, requireEmployer, async (req, res) => {
  const { employee_id, type, amount, reason } = req.body;
  try {
    const id = uuidv4();
    await query(`
      INSERT INTO wage_bonuses (id, employee_id, employer_id, type, amount, reason, created_at)
      VALUES (@id, @employee_id, @employer_id, @type, @amount, @reason, GETUTCDATE())
    `, { id, employee_id, employer_id: req.user.id, type: type || 'bonus', amount, reason: reason || null });
    res.status(201).json({ id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create bonus' });
  }
});

// ─── CONTRACTS ───────────────────────────────────────────────────────────────

// GET /wages/contracts
router.get('/contracts', authenticate, async (req, res) => {
  const { employee_id } = req.query;
  try {
    let q = `SELECT * FROM wage_contracts WHERE employer_id = @employer_id`;
    const params = { employer_id: req.user.id };
    if (employee_id) { q += ' AND employee_id = @employee_id'; params.employee_id = employee_id; }
    const result = await query(q, params);
    res.json(result.recordset);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch contracts' });
  }
});

// POST /wages/contracts
router.post('/contracts', authenticate, requireEmployer, async (req, res) => {
  const { employee_id, amount, description, payment_date } = req.body;
  try {
    const id = uuidv4();
    await query(`
      INSERT INTO wage_contracts (id, employee_id, employer_id, amount, description, payment_date, created_at)
      VALUES (@id, @employee_id, @employer_id, @amount, @description, @payment_date, GETUTCDATE())
    `, { id, employee_id, employer_id: req.user.id, amount, description: description || null, payment_date: payment_date || null });
    res.status(201).json({ id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create contract' });
  }
});

// ─── STATEMENTS ──────────────────────────────────────────────────────────────

// GET /wages/statements
router.get('/statements', authenticate, async (req, res) => {
  const { user_id, employee_id } = req.query;
  try {
    let q = `SELECT * FROM wage_statements WHERE employer_id = @employer_id`;
    const params = { employer_id: req.user.id };
    if (user_id) { q += ' AND user_id = @user_id'; params.user_id = user_id; }
    if (employee_id) { q += ' AND employee_id = @employee_id'; params.employee_id = employee_id; }
    q += ' ORDER BY created_at DESC';
    const result = await query(q, params);
    res.json(result.recordset);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch statements' });
  }
});

// POST /wages/statements
router.post('/statements', authenticate, requireEmployer, async (req, res) => {
  const { employee_id, user_id, type, amount, description, period_start, period_end, details } = req.body;
  try {
    const id = uuidv4();
    await query(`
      INSERT INTO wage_statements (id, employee_id, user_id, employer_id, type, amount, description, period_start, period_end, details, created_at)
      VALUES (@id, @employee_id, @user_id, @employer_id, @type, @amount, @description, @period_start, @period_end, @details, GETUTCDATE())
    `, { id, employee_id, user_id: user_id || null, employer_id: req.user.id, type: type || null, amount, description: description || null, period_start: period_start || null, period_end: period_end || null, details: details ? JSON.stringify(details) : null });
    res.status(201).json({ id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create statement' });
  }
});

module.exports = router;
