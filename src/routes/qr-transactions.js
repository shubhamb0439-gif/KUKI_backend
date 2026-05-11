const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { query } = require('../db');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

// ─── QR TRANSACTIONS ─────────────────────────────────────────────────────────

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
