const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { query } = require('../db');
const { authenticate, requireEmployer } = require('../middleware/auth');

const router = express.Router();

// ─── WAGES ───────────────────────────────────────────────────────────────────

// GET /wages — returns employee_wages configuration records
router.get('/', authenticate, async (req, res) => {
  const { employee_id } = req.query;
  try {
    let q = `
      SELECT ew.*, p.name AS employee_name, e.user_id AS employee_user_id
      FROM employee_wages ew
      JOIN employees e ON ew.employee_id = e.id
      LEFT JOIN profiles p ON e.user_id = p.id
      WHERE 1=1
    `;
    const params = {};
    if (req.user.role === 'employer') { q += ' AND ew.employer_id = @employer_id'; params.employer_id = req.user.id; }
    else { q += ' AND e.user_id = @user_id'; params.user_id = req.user.id; }
    if (employee_id) { q += ' AND ew.employee_id = @employee_id'; params.employee_id = employee_id; }

    const result = await query(q, params);
    res.json(result.recordset);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch wages' });
  }
});

// POST /wages — UPSERT into employee_wages on (employee_id, employer_id)
router.post('/', authenticate, requireEmployer, async (req, res) => {
  const {
    employee_id, monthly_wage, currency,
    hourly_rate, working_hours_per_day, total_working_days,
    actual_hours_worked, merits, demerits, advances, loan_deductions,
  } = req.body;
  const employer_id = req.user.id;
  const id = uuidv4();
  try {
    await query(`
      MERGE employee_wages AS target
      USING (SELECT @employee_id AS employee_id, @employer_id AS employer_id) AS source
        ON target.employee_id = source.employee_id AND target.employer_id = source.employer_id
      WHEN MATCHED THEN
        UPDATE SET
          monthly_wage       = ISNULL(@monthly_wage, monthly_wage),
          currency           = ISNULL(@currency, currency),
          hourly_rate        = ISNULL(@hourly_rate, hourly_rate),
          working_hours_per_day = ISNULL(@working_hours_per_day, working_hours_per_day),
          total_working_days = ISNULL(@total_working_days, total_working_days),
          actual_hours_worked= ISNULL(@actual_hours_worked, actual_hours_worked),
          merits             = ISNULL(@merits, merits),
          demerits           = ISNULL(@demerits, demerits),
          advances           = ISNULL(@advances, advances),
          loan_deductions    = ISNULL(@loan_deductions, loan_deductions),
          updated_at         = GETUTCDATE()
      WHEN NOT MATCHED THEN
        INSERT (id, employee_id, employer_id, monthly_wage, currency, hourly_rate,
                working_hours_per_day, total_working_days, actual_hours_worked,
                merits, demerits, advances, loan_deductions, created_at, updated_at)
        VALUES (@id, @employee_id, @employer_id, ISNULL(@monthly_wage,0), ISNULL(@currency,'USD'),
                ISNULL(@hourly_rate,0), ISNULL(@working_hours_per_day,8), ISNULL(@total_working_days,22),
                ISNULL(@actual_hours_worked,0), ISNULL(@merits,0), ISNULL(@demerits,0),
                ISNULL(@advances,0), ISNULL(@loan_deductions,0), GETUTCDATE(), GETUTCDATE());
    `, {
      id, employee_id, employer_id,
      monthly_wage: monthly_wage ?? null,
      currency: currency || null,
      hourly_rate: hourly_rate ?? null,
      working_hours_per_day: working_hours_per_day ?? null,
      total_working_days: total_working_days ?? null,
      actual_hours_worked: actual_hours_worked ?? null,
      merits: merits ?? null,
      demerits: demerits ?? null,
      advances: advances ?? null,
      loan_deductions: loan_deductions ?? null,
    });

    // Recalculate final_payable = monthly_wage + merits - demerits - advances - loan_deductions (min 0)
    await query(`
      UPDATE employee_wages
      SET final_payable = CASE
        WHEN (monthly_wage + ISNULL(merits,0) - ISNULL(demerits,0) - ISNULL(advances,0) - ISNULL(loan_deductions,0)) < 0
          THEN 0
          ELSE (monthly_wage + ISNULL(merits,0) - ISNULL(demerits,0) - ISNULL(advances,0) - ISNULL(loan_deductions,0))
      END
      WHERE employee_id = @employee_id AND employer_id = @employer_id
    `, { employee_id, employer_id });

    const result = await query(
      `SELECT * FROM employee_wages WHERE employee_id = @employee_id AND employer_id = @employer_id`,
      { employee_id, employer_id }
    );
    res.json(result.recordset[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'Failed to upsert wage record' });
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
  const {
    employee_id, amount, interest_rate, total_amount, remaining_amount,
    monthly_deduction, currency, status, loan_date, paid_amount,
  } = req.body;
  try {
    const id = uuidv4();
    const result = await query(`
      INSERT INTO wage_loans (id, employee_id, employer_id, amount, interest_rate, total_amount,
        remaining_amount, monthly_deduction, currency, status, loan_date, paid_amount, created_at)
      OUTPUT INSERTED.*
      VALUES (@id, @employee_id, @employer_id, @amount, @interest_rate, @total_amount,
        @remaining_amount, @monthly_deduction, @currency, @status, @loan_date, @paid_amount, GETUTCDATE())
    `, {
      id, employee_id, employer_id: req.user.id, amount,
      interest_rate: interest_rate ?? 0,
      total_amount: total_amount ?? null,
      remaining_amount: remaining_amount ?? null,
      monthly_deduction: monthly_deduction ?? null,
      currency: currency || 'USD',
      status: status || 'active',
      loan_date: loan_date || null,
      paid_amount: paid_amount ?? 0,
    });
    // Tell frontend whether employee has the app so it knows to skip QR flow
    const empRow = await query('SELECT user_id FROM employees WHERE id = @id', { id: employee_id });
    const loan = result.recordset[0];
    res.status(201).json({ ...loan, employee_has_app: !!(empRow.recordset[0]?.user_id) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'Failed to create loan' });
  }
});

// PATCH /wages/loans/:id — dynamic update, return updated row
router.patch('/loans/:id', authenticate, requireEmployer, async (req, res) => {
  const ALLOWED = [
    'amount', 'interest_rate', 'total_amount', 'remaining_amount', 'monthly_deduction',
    'currency', 'status', 'loan_date', 'paid_amount', 'foreclosure_date',
  ];
  const keys = Object.keys(req.body).filter(k => ALLOWED.includes(k));
  if (!keys.length) return res.status(400).json({ error: 'No valid fields to update' });

  const params = { id: req.params.id };
  const set = keys.map(k => { params[k] = req.body[k] ?? null; return `${k} = @${k}`; }).join(', ');

  try {
    const result = await query(
      `UPDATE wage_loans SET ${set} OUTPUT INSERTED.* WHERE id = @id`,
      params
    );
    res.json(result.recordset[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'Failed to update loan' });
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

// POST /wages/bonuses — insert and recalculate employee_wages.final_payable
router.post('/bonuses', authenticate, requireEmployer, async (req, res) => {
  const { employee_id, type, category, amount, currency, comment } = req.body;
  const employer_id = req.user.id;
  try {
    const id = uuidv4();
    await query(`
      INSERT INTO wage_bonuses (id, employee_id, employer_id, type, category, amount, currency, comment, created_at)
      VALUES (@id, @employee_id, @employer_id, @type, @category, @amount, @currency, @comment, GETUTCDATE())
    `, {
      id, employee_id, employer_id,
      type: type || null,
      category: category || 'bonus',
      amount,
      currency: currency || 'USD',
      comment: comment || null,
    });

    // Recalculate totals in employee_wages from wage_bonuses
    await query(`
      UPDATE ew
      SET
        merits      = ISNULL(b.merit_total, 0),
        demerits    = ISNULL(b.demerit_total, 0),
        advances    = ISNULL(b.advance_total, 0),
        final_payable = CASE
          WHEN (ew.monthly_wage + ISNULL(b.merit_total,0) - ISNULL(b.demerit_total,0) - ISNULL(b.advance_total,0) - ISNULL(ew.loan_deductions,0)) < 0
            THEN 0
            ELSE (ew.monthly_wage + ISNULL(b.merit_total,0) - ISNULL(b.demerit_total,0) - ISNULL(b.advance_total,0) - ISNULL(ew.loan_deductions,0))
        END
      FROM employee_wages ew
      CROSS APPLY (
        SELECT
          SUM(CASE WHEN category IN ('merit','bonus') THEN amount ELSE 0 END) AS merit_total,
          SUM(CASE WHEN category = 'demerit'          THEN amount ELSE 0 END) AS demerit_total,
          SUM(CASE WHEN category = 'advance'          THEN amount ELSE 0 END) AS advance_total
        FROM wage_bonuses
        WHERE employee_id = @employee_id AND employer_id = @employer_id
      ) b
      WHERE ew.employee_id = @employee_id AND ew.employer_id = @employer_id
    `, { employee_id, employer_id });

    res.status(201).json({ id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'Failed to create bonus' });
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
  const { employee_id, amount, currency, description, payment_date } = req.body;
  try {
    const id = uuidv4();
    const result = await query(`
      INSERT INTO wage_contracts (id, employee_id, employer_id, amount, currency, description, payment_date, created_at)
      OUTPUT INSERTED.*
      VALUES (@id, @employee_id, @employer_id, @amount, @currency, @description, @payment_date, GETUTCDATE())
    `, {
      id, employee_id, employer_id: req.user.id, amount,
      currency: currency || 'USD',
      description: description || null,
      payment_date: payment_date || null,
    });
    res.status(201).json(result.recordset[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'Failed to create contract' });
  }
});

// ─── STATEMENTS ──────────────────────────────────────────────────────────────

// GET /wages/statements
router.get('/statements', authenticate, async (req, res) => {
  const { user_id, employee_id } = req.query;
  try {
    let q = `SELECT * FROM wage_statements WHERE 1=1`;
    const params = {};
    if (req.user.role === 'employer' || req.user.role === 'admin') {
      q += ' AND employer_id = @employer_id';
      params.employer_id = req.user.id;
    } else {
      // Employee sees statements addressed to them
      q += ' AND user_id = @user_id';
      params.user_id = req.user.id;
    }
    if (user_id) { q += ' AND user_id = @uid'; params.uid = user_id; }
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
  const { employee_id, user_id, type, amount, description, period_start, period_end, details, message } = req.body;
  try {
    const id = uuidv4();
    const result = await query(`
      INSERT INTO wage_statements (id, employee_id, user_id, employer_id, type, amount, description,
        period_start, period_end, details, message, created_at)
      OUTPUT INSERTED.*
      VALUES (@id, @employee_id, @user_id, @employer_id, @type, @amount, @description,
        @period_start, @period_end, @details, @message, GETUTCDATE())
    `, {
      id, employee_id, user_id: user_id || null, employer_id: req.user.id,
      type: type || null, amount,
      description: description || null,
      period_start: period_start || null,
      period_end: period_end || null,
      details: details ? JSON.stringify(details) : null,
      message: message || null,
    });

    // Resolve the employee's profile user_id for the message receiver
    let receiverId = user_id;
    if (!receiverId && employee_id) {
      const empRow = await query('SELECT user_id FROM employees WHERE id = @id', { id: employee_id });
      receiverId = empRow.recordset[0]?.user_id || null;
    }

    // Create a message so the statement appears in the employee's message feed.
    // Isolated try/catch: a message failure must not roll back the statement.
    if (receiverId) {
      try {
        const msgContent = message
          || `Wage statement: ${type || 'statement'} — ${amount}${description ? ` (${description})` : ''}`;
        await query(`
          INSERT INTO messages (id, sender_id, receiver_id, content, is_read, created_at)
          VALUES (@id, @sender, @receiver, @content, 0, GETUTCDATE())
        `, { id: uuidv4(), sender: req.user.id, receiver: receiverId, content: msgContent });
      } catch (msgErr) {
        console.error('Message creation failed (statement still saved):', msgErr.message);
      }
    }

    res.status(201).json(result.recordset[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'Failed to create statement' });
  }
});

module.exports = router;
