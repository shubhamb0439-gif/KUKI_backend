const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { query } = require('../db');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

// ─── QR TRANSACTIONS ─────────────────────────────────────────────────────────

// POST /qr-transactions/process — scan and process any QR transaction type
// Lookup tries both qr_code field AND id field so either can be encoded in the QR image.
// Attendance QRs are REUSABLE (scan every day); loan/wage QRs are one-time.
router.post('/process', authenticate, async (req, res) => {
  const { qr_code } = req.body;
  if (!qr_code) return res.status(400).json({ error: 'qr_code is required' });

  try {
    // Look up by qr_code value OR by transaction id — no status filter yet
    const txResult = await query(
      `SELECT * FROM qr_transactions WHERE qr_code = @val OR id = @val`,
      { val: qr_code }
    );
    if (!txResult.recordset.length) {
      return res.status(404).json({ error: 'QR code not found' });
    }

    const tx = txResult.recordset[0];
    let metadata = {};
    try { metadata = tx.metadata ? JSON.parse(tx.metadata) : {}; } catch (_) {}

    const type = (tx.transaction_type || '').toLowerCase();
    const isAttendance = type === 'attendance' || type === 'clock_in' || type === 'clock_out';

    // Non-attendance QRs are one-time use
    if (!isAttendance && tx.status === 'completed') {
      return res.status(409).json({ error: 'QR code already used' });
    }

    let actionResult = {};

    if (isAttendance) {
      // Check if employee already clocked in today without clocking out
      const todayRecord = await query(`
        SELECT id, clock_in, clock_out FROM attendance
        WHERE employee_id = @emp_id AND CAST(date AS DATE) = CAST(GETUTCDATE() AS DATE)
          AND clock_out IS NULL
      `, { emp_id: tx.employee_id });

      if (todayRecord.recordset.length > 0) {
        // Clock out
        const rec = todayRecord.recordset[0];
        await query(`
          UPDATE attendance
          SET clock_out = GETUTCDATE(),
              hours_worked = DATEDIFF(MINUTE, clock_in, GETUTCDATE()) / 60.0,
              updated_at = GETUTCDATE()
          WHERE id = @id
        `, { id: rec.id });
        actionResult = { action: 'clock_out', attendance_id: rec.id };
      } else {
        // Clock in
        const attendanceId = uuidv4();
        await query(`
          INSERT INTO attendance (id, employee_id, clock_in, date, location, qr_scan, created_at)
          VALUES (@id, @emp_id, GETUTCDATE(), CAST(GETUTCDATE() AS DATE), @loc, 1, GETUTCDATE())
        `, { id: attendanceId, emp_id: tx.employee_id, loc: metadata.location || null });
        actionResult = { action: 'clock_in', attendance_id: attendanceId };
      }
      // Keep attendance QR reusable — update scanned_at but keep status as-is
      await query(
        `UPDATE qr_transactions SET scanned_at = GETUTCDATE() WHERE id = @id`,
        { id: tx.id }
      );

    } else if (type === 'loan') {
      if (metadata.loan_id) {
        await query(
          `UPDATE wage_loans SET status = 'active', updated_at = GETUTCDATE() WHERE id = @id`,
          { id: metadata.loan_id }
        );
      }
      actionResult = { loan_id: metadata.loan_id || null };
      await query(
        `UPDATE qr_transactions SET status = 'completed', scanned_at = GETUTCDATE() WHERE id = @id`,
        { id: tx.id }
      );

    } else if (type === 'wages' || type === 'payment' || type === 'wage_payment') {
      if (metadata.statement_id) {
        await query(
          `UPDATE wage_statements SET is_paid = 1, updated_at = GETUTCDATE() WHERE id = @id`,
          { id: metadata.statement_id }
        );
      }
      actionResult = { statement_id: metadata.statement_id || null };
      await query(
        `UPDATE qr_transactions SET status = 'completed', scanned_at = GETUTCDATE() WHERE id = @id`,
        { id: tx.id }
      );
    } else {
      // Unknown type — just mark completed
      await query(
        `UPDATE qr_transactions SET status = 'completed', scanned_at = GETUTCDATE() WHERE id = @id`,
        { id: tx.id }
      );
    }

    res.json({ success: true, transaction_type: tx.transaction_type, ...actionResult });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'QR processing failed' });
  }
});

// POST /qr-transactions
router.post('/', authenticate, async (req, res) => {
  const { employee_id, transaction_type, amount, qr_code, status, metadata } = req.body;
  try {
    const id = uuidv4();
    const result = await query(`
      INSERT INTO qr_transactions (id, employee_id, employer_id, transaction_type, amount, qr_code, status, metadata, created_at)
      OUTPUT INSERTED.*
      VALUES (@id, @employee_id, @employer_id, @transaction_type, @amount, @qr_code, @status, @metadata, GETUTCDATE())
    `, {
      id,
      employee_id,
      employer_id: req.user.id,
      transaction_type: transaction_type || null,
      amount,
      qr_code: qr_code || null,
      status: status || 'pending',
      metadata: metadata ? JSON.stringify(metadata) : null,
    });
    res.status(201).json(result.recordset[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'Failed to create QR transaction' });
  }
});

// GET /qr-transactions?qr_code=...
router.get('/', authenticate, async (req, res) => {
  const { qr_code } = req.query;
  if (!qr_code) return res.status(400).json({ error: 'qr_code is required' });
  try {
    const result = await query(`SELECT * FROM qr_transactions WHERE qr_code = @qr_code`, { qr_code });
    if (!result.recordset.length) return res.status(404).json({ error: 'Transaction not found' });
    res.json(result.recordset[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch QR transaction' });
  }
});

// PATCH /qr-transactions/:id — dynamic update, return updated row
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
