const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { query } = require('../db');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

// ─── QR TRANSACTIONS ─────────────────────────────────────────────────────────

// POST /qr-transactions/process — employee scans any QR code
// Employee identified from JWT. Attendance QRs are reusable; loan/wage QRs are one-time.
router.post('/process', authenticate, async (req, res) => {
  const { qr_code } = req.body;
  if (!qr_code) return res.status(400).json({ error: 'qr_code is required' });

  try {
    // Lookup by qr_code field OR by transaction id (TRY_CAST prevents uniqueidentifier conversion error)
    const txResult = await query(
      `SELECT * FROM qr_transactions WHERE qr_code = @val OR id = TRY_CAST(@val AS uniqueidentifier)`,
      { val: qr_code }
    );
    if (!txResult.recordset.length) return res.status(404).json({ error: 'Invalid QR code' });

    const tx = txResult.recordset[0];
    let metadata = {};
    try { metadata = tx.metadata ? JSON.parse(tx.metadata) : {}; } catch (_) {}

    const type = (tx.transaction_type || '').toLowerCase();
    const isAttendance = type === 'attendance';

    // Non-attendance QRs are one-time
    if (!isAttendance && tx.status !== 'pending') {
      return res.status(409).json({ error: 'This QR has already been used' });
    }

    // Find employee record — use employer_id from QR transaction to resolve correct employee
    const employerIdFromTx = tx.employer_id || metadata.employer_id;
    let empQ = `SELECT id, employer_id FROM employees WHERE user_id = @uid AND status = 'active'`;
    const empP = { uid: req.user.id };
    if (employerIdFromTx) { empQ += ' AND employer_id = @eid'; empP.eid = employerIdFromTx; }
    empQ += ' ORDER BY created_at DESC';

    const empResult = await query(empQ + ' OFFSET 0 ROWS FETCH NEXT 1 ROWS ONLY', empP);
    if (!empResult.recordset.length) {
      return res.status(404).json({ error: 'Employee record not found. Make sure you are linked to this employer.' });
    }
    const emp = empResult.recordset[0];
    const employeeId = emp.id;
    const resolvedEmployerId = emp.employer_id;

    let actionResult = {};
    const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
    // For regularization QRs, metadata.attendance_date targets a specific past date
    const isRegularization = !!(metadata.attendance_date);
    const targetDate = metadata.attendance_date || today;

    if (isAttendance) {
      // Check attendance record for the target date
      const todayAtt = await query(`
        SELECT id,
          ISNULL(login_time, clock_in) AS login_time,
          ISNULL(logout_time, clock_out) AS logout_time
        FROM attendance
        WHERE employee_id = @emp_id
          AND CAST(ISNULL(attendance_date, [date]) AS DATE) = @targetDate
          AND employer_id = @eid
      `, { emp_id: employeeId, targetDate, eid: resolvedEmployerId });

      if (!todayAtt.recordset.length) {
        // Clock in (or regularize: insert with the specific date)
        const attId = uuidv4();
        if (isRegularization) {
          // Regularization insert: set login_time to start of that day (midnight UTC as placeholder)
          await query(`
            INSERT INTO attendance
              (id, employee_id, employer_id, attendance_date, [date], login_time, clock_in, logout_time, clock_out,
               total_hours, hours_worked, [status], qr_scan, is_manual, created_at)
            VALUES
              (@id, @emp_id, @eid, @targetDate, @targetDate,
               CAST(@targetDate AS DATETIME), CAST(@targetDate AS DATETIME),
               CAST(@targetDate AS DATETIME), CAST(@targetDate AS DATETIME),
               8, 8, 'present', 1, 1, GETUTCDATE())
          `, { id: attId, emp_id: employeeId, eid: resolvedEmployerId, targetDate });
          actionResult = { action: 'regularized', attendance_id: attId, date: targetDate };
        } else {
          await query(`
            INSERT INTO attendance
              (id, employee_id, employer_id, attendance_date, [date], login_time, clock_in, [status], qr_scan, created_at)
            VALUES
              (@id, @emp_id, @eid, @today, @today, GETUTCDATE(), GETUTCDATE(), 'present', 1, GETUTCDATE())
          `, { id: attId, emp_id: employeeId, eid: resolvedEmployerId, today });
          actionResult = { action: 'clock_in', attendance_id: attId };
        }

      } else {
        const att = todayAtt.recordset[0];
        if (att.login_time && att.logout_time) {
          if (isRegularization) {
            // Regularization on a complete record — overwrite to mark as regularized
            await query(`
              UPDATE attendance SET
                [status]    = 'present',
                is_manual   = 1,
                updated_at  = GETUTCDATE()
              WHERE id = @id
            `, { id: att.id });
            actionResult = { action: 'regularized', attendance_id: att.id, date: targetDate };
          } else {
            return res.status(409).json({ error: 'Attendance already completed for today' });
          }
        } else if (att.login_time) {
          // Clock out
          await query(`
            UPDATE attendance SET
              logout_time   = GETUTCDATE(),
              clock_out     = GETUTCDATE(),
              total_hours   = DATEDIFF(MINUTE, ISNULL(login_time, clock_in), GETUTCDATE()) / 60.0,
              hours_worked  = DATEDIFF(MINUTE, ISNULL(login_time, clock_in), GETUTCDATE()) / 60.0,
              updated_at    = GETUTCDATE()
            WHERE id = @id
          `, { id: att.id });
          const hoursResult = await query(
            `SELECT ISNULL(total_hours, hours_worked) AS hours FROM attendance WHERE id = @id`,
            { id: att.id }
          );
          actionResult = {
            action: 'clock_out',
            attendance_id: att.id,
            hours_worked: hoursResult.recordset[0]?.hours,
          };
        }
      }
      // Keep attendance QR reusable — only update scanned_at
      await query(`UPDATE qr_transactions SET scanned_at = GETUTCDATE() WHERE id = @id`, { id: tx.id });

    } else if (type === 'loan') {
      // Create the loan record at scan time using QR transaction data + metadata
      const loanAmount   = Number(tx.amount) || 0;
      const interestRate = Number(metadata.interest_rate) || 0;
      const tenureMonths = metadata.tenure_months ? Number(metadata.tenure_months) : null;
      const totalAmount  = loanAmount + (loanAmount * interestRate / 100);
      const monthlyDeduction = tenureMonths ? totalAmount / tenureMonths : loanAmount;
      const loanCurrency = metadata.currency || 'INR';

      // Use IDs from QR transaction — more reliable than resolved from JWT
      const loanEmployeeId = tx.employee_id || employeeId;
      const loanEmployerId = tx.employer_id || resolvedEmployerId;

      let createdLoanId = null;
      try {
        createdLoanId = uuidv4();
        await query(`
          INSERT INTO wage_loans
            (id, employee_id, employer_id, amount, interest_rate, total_amount,
             monthly_deduction, tenure_months, currency, status, remaining_amount, paid_amount, created_at)
          VALUES
            (@id, @employee_id, @employer_id, @amount, @interest_rate, @total_amount,
             @monthly_deduction, @tenure_months, @currency, 'active', @total_amount, 0, GETUTCDATE())
        `, {
          id: createdLoanId,
          employee_id: loanEmployeeId,
          employer_id: loanEmployerId,
          amount: loanAmount,
          interest_rate: interestRate,
          total_amount: totalAmount,
          monthly_deduction: monthlyDeduction,
          tenure_months: tenureMonths,
          currency: loanCurrency,
        });
        console.log(`Loan created at scan: ${createdLoanId} emp=${loanEmployeeId} amount=${loanAmount}`);
      } catch (loanErr) {
        console.error('Loan creation failed at scan:', loanErr.message);
      }

      // Update loan_deductions in employee_wages
      try {
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
        `, { employee_id: loanEmployeeId, employer_id: loanEmployerId });
      } catch (_) {}

      // Wage statement
      try {
        await query(`
          INSERT INTO wage_statements (id, employee_id, user_id, employer_id, type, amount, message, created_at)
          VALUES (@id, @emp_id, @user_id, @eid, 'loan', @amount, @message, GETUTCDATE())
        `, {
          id: uuidv4(), emp_id: loanEmployeeId, user_id: req.user.id,
          eid: loanEmployerId, amount: loanAmount,
          message: `LOAN RECEIVED\nAmount: ${loanAmount} ${loanCurrency}`,
        });
      } catch (_) {}

      await query(
        `UPDATE qr_transactions SET status = 'processed', scanned_at = GETUTCDATE() WHERE id = @id`,
        { id: tx.id }
      );
      actionResult = { loan_id: createdLoanId };

    } else if (type === 'wage_payment') {
      const wageRow = await query(
        `SELECT final_payable, currency FROM employee_wages WHERE employee_id = @emp_id AND employer_id = @eid`,
        { emp_id: employeeId, eid: resolvedEmployerId }
      );
      const wage = wageRow.recordset[0] || {};
      try {
        await query(`
          INSERT INTO wage_statements (id, employee_id, user_id, employer_id, type, amount, message, created_at)
          VALUES (@id, @emp_id, @user_id, @eid, 'payment', @amount, @message, GETUTCDATE())
        `, {
          id: uuidv4(), emp_id: employeeId, user_id: req.user.id,
          eid: resolvedEmployerId, amount: wage.final_payable || 0,
          message: `WAGE PAYMENT RECEIVED\nAmount: ${wage.final_payable || 0} ${wage.currency || 'USD'}`,
        });
      } catch (_) {}
      await query(
        `UPDATE qr_transactions SET status = 'processed', scanned_at = GETUTCDATE() WHERE id = @id`,
        { id: tx.id }
      );

    } else {
      await query(
        `UPDATE qr_transactions SET status = 'processed', scanned_at = GETUTCDATE() WHERE id = @id`,
        { id: tx.id }
      );
    }

    res.json({ success: true, transaction_type: tx.transaction_type, ...actionResult });
  } catch (err) {
    console.error('QR process error:', err);
    res.status(500).json({ error: err.message || 'QR processing failed' });
  }
});

// POST /qr-transactions — employer creates a QR transaction
// employer_id is read from JWT — do NOT pass it in the body
router.post('/', authenticate, async (req, res) => {
  const { employee_id, transaction_type, amount, qr_code, status, metadata } = req.body;
  try {
    let resolvedMetadata = metadata ? { ...metadata } : {};

    // Loan details are stored in metadata — loan record is created at scan time (POST /process)

    const id = uuidv4();
    const result = await query(`
      INSERT INTO qr_transactions
        (id, employee_id, employer_id, transaction_type, amount, qr_code, status, metadata, created_at)
      OUTPUT INSERTED.*
      VALUES
        (@id, @employee_id, @employer_id, @transaction_type, @amount, @qr_code, @status, @metadata, GETUTCDATE())
    `, {
      id,
      employee_id: employee_id || null,
      employer_id: req.user.id,
      transaction_type: transaction_type || null,
      amount: amount || 0,
      qr_code: qr_code || null,
      status: status || 'pending',
      metadata: Object.keys(resolvedMetadata).length ? JSON.stringify(resolvedMetadata) : null,
    });
    res.status(201).json(result.recordset[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'Failed to create QR transaction' });
  }
});

// GET /qr-transactions?qr_code=... — returns single object
router.get('/', authenticate, async (req, res) => {
  const { qr_code } = req.query;
  if (!qr_code) return res.status(400).json({ error: 'qr_code is required' });
  try {
    const result = await query(
      `SELECT * FROM qr_transactions WHERE qr_code = @qr_code OR id = TRY_CAST(@qr_code AS uniqueidentifier)`,
      { qr_code }
    );
    if (!result.recordset.length) return res.status(404).json({ error: 'Not found' });
    res.json(result.recordset[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch QR transaction' });
  }
});

// PATCH /qr-transactions/:id
router.patch('/:id', authenticate, async (req, res) => {
  const ALLOWED = ['transaction_type', 'amount', 'qr_code', 'status', 'metadata', 'scanned_at'];
  const keys = Object.keys(req.body).filter(k => ALLOWED.includes(k));
  if (!keys.length) return res.status(400).json({ error: 'No valid fields to update' });

  const params = { id: req.params.id };
  const set = keys.map(k => {
    params[k] = k === 'metadata' ? (req.body[k] ? JSON.stringify(req.body[k]) : null) : (req.body[k] ?? null);
    return `${k} = @${k}`;
  }).join(', ');

  try {
    const result = await query(
      `UPDATE qr_transactions SET ${set} OUTPUT INSERTED.* WHERE id = @id`,
      params
    );
    res.json(result.recordset[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'Failed to update QR transaction' });
  }
});

module.exports = router;
