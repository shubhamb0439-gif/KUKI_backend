const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { query } = require('../db');
const { authenticate, requireEmployer } = require('../middleware/auth');

const router = express.Router();

// ─── WAGES ───────────────────────────────────────────────────────────────────

// GET /wages — returns employee_wages with live loan totals from wage_loans
router.get('/', authenticate, async (req, res) => {
  const { employee_id } = req.query;
  try {
    let q = `
      SELECT
        ew.*,
        p.name              AS employee_name,
        ISNULL(p.profile_photo, e.photo) AS employee_photo,
        e.user_id           AS employee_user_id,
        ISNULL(ln.total_loan_amount,   0) AS total_loan_amount,
        ISNULL(ln.total_loan_balance,  0) AS total_loan_balance,
        ISNULL(ln.total_monthly_deduction, 0) AS total_monthly_deduction,
        ln.active_loan_count
      FROM employee_wages ew
      JOIN employees e ON ew.employee_id = e.id
      LEFT JOIN profiles p ON e.user_id = p.id
      OUTER APPLY (
        SELECT
          SUM(amount)             AS total_loan_amount,
          SUM(ISNULL(remaining_amount, amount - ISNULL(paid_amount,0))) AS total_loan_balance,
          SUM(monthly_deduction)  AS total_monthly_deduction,
          COUNT(*)                AS active_loan_count
        FROM wage_loans
        WHERE employee_id = ew.employee_id
          AND employer_id = ew.employer_id
          AND status = 'active'
      ) ln
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
          monthly_wage       = ISNULL(CAST(@monthly_wage AS DECIMAL(18,2)), monthly_wage),
          currency           = ISNULL(@currency, currency),
          hourly_rate        = ISNULL(CAST(@hourly_rate AS DECIMAL(18,2)), hourly_rate),
          working_hours_per_day = ISNULL(CAST(@working_hours_per_day AS DECIMAL(18,2)), working_hours_per_day),
          total_working_days = ISNULL(CAST(@total_working_days AS DECIMAL(18,2)), total_working_days),
          actual_hours_worked= ISNULL(CAST(@actual_hours_worked AS DECIMAL(18,2)), actual_hours_worked),
          merits             = ISNULL(CAST(@merits AS DECIMAL(18,2)), merits),
          demerits           = ISNULL(CAST(@demerits AS DECIMAL(18,2)), demerits),
          advances           = ISNULL(CAST(@advances AS DECIMAL(18,2)), advances),
          loan_deductions    = ISNULL(CAST(@loan_deductions AS DECIMAL(18,2)), loan_deductions),
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
        WHEN (CAST(ISNULL(monthly_wage,0) AS DECIMAL(18,2)) + CAST(ISNULL(merits,0) AS DECIMAL(18,2))
              - CAST(ISNULL(demerits,0) AS DECIMAL(18,2)) - CAST(ISNULL(advances,0) AS DECIMAL(18,2))
              - CAST(ISNULL(loan_deductions,0) AS DECIMAL(18,2))) < 0
          THEN 0
          ELSE (CAST(ISNULL(monthly_wage,0) AS DECIMAL(18,2)) + CAST(ISNULL(merits,0) AS DECIMAL(18,2))
                - CAST(ISNULL(demerits,0) AS DECIMAL(18,2)) - CAST(ISNULL(advances,0) AS DECIMAL(18,2))
                - CAST(ISNULL(loan_deductions,0) AS DECIMAL(18,2)))
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
    let q, params = {};
    if (req.user.role === 'employer' || req.user.role === 'admin') {
      q = `SELECT wl.*, p.name AS employee_name FROM wage_loans wl
           LEFT JOIN employees e ON wl.employee_id = e.id
           LEFT JOIN profiles p ON e.user_id = p.id
           WHERE wl.employer_id = @employer_id`;
      params.employer_id = req.user.id;
    } else {
      q = `SELECT wl.*, p.name AS employer_name FROM wage_loans wl
           LEFT JOIN profiles p ON wl.employer_id = p.id
           JOIN employees e ON wl.employee_id = e.id
           WHERE e.user_id = @user_id`;
      params.user_id = req.user.id;
    }
    if (employee_id) { q += ' AND wl.employee_id = @employee_id'; params.employee_id = employee_id; }
    q += ' ORDER BY wl.created_at DESC';
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
    monthly_deduction, currency, status, loan_date, paid_amount, tenure_months,
  } = req.body;
  try {
    const id = uuidv4();
    // Calculate monthly_deduction if not provided: total_amount/tenure or full amount
    const resolvedTotal = total_amount ?? amount;
    const resolvedMonthlyDeduction = monthly_deduction
      ?? (tenure_months && resolvedTotal ? Math.ceil(resolvedTotal / tenure_months) : resolvedTotal)
      ?? 0;
    const result = await query(`
      INSERT INTO wage_loans (id, employee_id, employer_id, amount, interest_rate, total_amount,
        remaining_amount, monthly_deduction, currency, status, loan_date, paid_amount, tenure_months, created_at)
      OUTPUT INSERTED.*
      VALUES (@id, @employee_id, @employer_id, @amount, @interest_rate, @total_amount,
        @remaining_amount, @monthly_deduction, @currency, @status, @loan_date, @paid_amount, @tenure_months, GETUTCDATE())
    `, {
      id, employee_id, employer_id: req.user.id, amount,
      interest_rate: interest_rate ?? 0,
      total_amount: resolvedTotal ?? null,
      remaining_amount: remaining_amount ?? resolvedTotal ?? null,
      monthly_deduction: resolvedMonthlyDeduction,
      currency: currency || 'USD',
      status: status || 'active',
      loan_date: loan_date || null,
      paid_amount: paid_amount ?? 0,
      tenure_months: tenure_months ?? null,
    });
    // Ensure employee_wages row exists, then update loan_deductions
    const ewCheck = await query(
      'SELECT id FROM employee_wages WHERE employee_id = @employee_id AND employer_id = @employer_id',
      { employee_id, employer_id: req.user.id }
    );
    if (!ewCheck.recordset.length) {
      await query(`
        INSERT INTO employee_wages
          (id, employee_id, employer_id, monthly_wage, merits, demerits, advances,
           loan_deductions, final_payable, currency, created_at, updated_at)
        VALUES
          (NEWID(), @employee_id, @employer_id, 0, 0, 0, 0,
           @monthly_deduction, 0, 'INR', GETUTCDATE(), GETUTCDATE())
      `, { employee_id, employer_id: req.user.id, monthly_deduction: resolvedMonthlyDeduction });
    } else {
      await query(`
        UPDATE employee_wages
        SET loan_deductions = (
              SELECT ISNULL(SUM(monthly_deduction), 0)
              FROM wage_loans
              WHERE employee_id = @employee_id AND employer_id = @employer_id AND status = 'active'
            ),
            final_payable = CASE
              WHEN (monthly_wage + ISNULL(merits,0) - ISNULL(demerits,0) - ISNULL(advances,0) - (
                      SELECT ISNULL(SUM(monthly_deduction), 0)
                      FROM wage_loans
                      WHERE employee_id = @employee_id AND employer_id = @employer_id AND status = 'active'
                    )) < 0 THEN 0
              ELSE monthly_wage + ISNULL(merits,0) - ISNULL(demerits,0) - ISNULL(advances,0) - (
                     SELECT ISNULL(SUM(monthly_deduction), 0)
                     FROM wage_loans
                     WHERE employee_id = @employee_id AND employer_id = @employer_id AND status = 'active'
                   )
            END,
            updated_at = GETUTCDATE()
        WHERE employee_id = @employee_id AND employer_id = @employer_id
      `, { employee_id, employer_id: req.user.id });
    }

    // employee_has_app = true only if employee has a real account (password_hash set)
    // Manually added employees have no password_hash so skip QR and grant directly
    const empRow = await query(
      'SELECT p.password_hash FROM employees e LEFT JOIN profiles p ON e.user_id = p.id WHERE e.id = @id',
      { id: employee_id }
    );
    const loan = result.recordset[0];
    res.status(201).json({ ...loan, employee_has_app: !!(empRow.recordset[0]?.password_hash) });
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
    let q, params = {};
    if (req.user.role === 'employer' || req.user.role === 'admin') {
      q = `SELECT wb.*, p.name AS employee_name FROM wage_bonuses wb
           LEFT JOIN employees e ON wb.employee_id = e.id
           LEFT JOIN profiles p ON e.user_id = p.id
           WHERE wb.employer_id = @employer_id`;
      params.employer_id = req.user.id;
    } else {
      q = `SELECT wb.* FROM wage_bonuses wb
           JOIN employees e ON wb.employee_id = e.id
           WHERE e.user_id = @user_id`;
      params.user_id = req.user.id;
    }
    if (employee_id) { q += ' AND wb.employee_id = @employee_id'; params.employee_id = employee_id; }
    q += ' ORDER BY wb.created_at DESC';
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

  // Normalize category from both type and category fields so demerits are always subtracted
  const resolvedCategory = (() => {
    const t = (type     || '').toLowerCase();
    const c = (category || '').toLowerCase();
    if (t === 'demerit' || c === 'demerit') return 'demerit';
    if (t === 'advance' || c === 'advance') return 'advance';
    if (t === 'merit'   || c === 'merit')   return 'merit';
    return 'bonus';
  })();

  try {
    const id = uuidv4();
    // Always store demerits/advances as positive — the formula subtracts them
    const storedAmount = Math.abs(Number(amount));
    await query(`
      INSERT INTO wage_bonuses (id, employee_id, employer_id, type, category, amount, currency, comment, created_at)
      VALUES (@id, @employee_id, @employer_id, @type, @category, @amount, @currency, @comment, GETUTCDATE())
    `, {
      id, employee_id, employer_id,
      type: resolvedCategory,
      category: resolvedCategory,
      amount: storedAmount,
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

// POST /wages/statements — employer creates for employee, OR employee generates their own
router.post('/statements', authenticate, async (req, res) => {
  const { employee_id, user_id, type, amount, description, period_start, period_end, details, message } = req.body;
  try {
    let resolvedEmployeeId = employee_id || null;
    let resolvedUserId = user_id || null;
    let resolvedEmployerId = req.user.id;

    if (req.user.role === 'employer' || req.user.role === 'admin') {
      // Admin can override user_id to route the statement to the correct recipient
      resolvedUserId = (req.user.role === 'admin' && user_id) ? user_id : req.user.id;
    } else {
      // Employee generating their own statement
      const empRecord = await query(
        `SELECT TOP 1 id, employer_id FROM employees WHERE user_id = @uid AND status = 'active' ORDER BY created_at DESC`,
        { uid: req.user.id }
      );
      if (!empRecord.recordset.length) return res.status(404).json({ error: 'Employee record not found' });
      resolvedEmployeeId = empRecord.recordset[0].id;
      resolvedUserId = req.user.id;
      resolvedEmployerId = empRecord.recordset[0].employer_id;
    }

    const id = uuidv4();
    const result = await query(`
      INSERT INTO wage_statements (id, employee_id, user_id, employer_id, type, amount, description,
        period_start, period_end, details, message, created_at)
      OUTPUT INSERTED.*
      VALUES (@id, @employee_id, @user_id, @employer_id, @type, @amount, @description,
        @period_start, @period_end, @details, @message, GETUTCDATE())
    `, {
      id, employee_id: resolvedEmployeeId, user_id: resolvedUserId, employer_id: resolvedEmployerId,
      type: type || null, amount: amount || 0,
      description: description || null,
      period_start: period_start || null,
      period_end: period_end || null,
      details: details ? JSON.stringify(details) : null,
      message: message || null,
    });

    // Resolve the employee's profile user_id for the message receiver
    let receiverId = resolvedUserId;
    if (!receiverId && resolvedEmployeeId) {
      const empRow = await query('SELECT user_id FROM employees WHERE id = @id', { id: resolvedEmployeeId });
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
