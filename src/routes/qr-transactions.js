const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { query } = require('../db');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

// ─── QR TRANSACTIONS ─────────────────────────────────────────────────────────

// POST /qr-transactions
router.post('/', authenticate, async (req, res) => {
  const { employee_id, type, amount, qr_code, status, metadata } = req.body;
  try {
    const id = uuidv4();
    await query(`
      INSERT INTO qr_transactions (id, employee_id, employer_id, type, amount, qr_code, status, metadata, created_at)
      VALUES (@id, @employee_id, @employer_id, @type, @amount, @qr_code, @status, @metadata, GETUTCDATE())
    `, { id, employee_id, employer_id: req.user.id, type, amount, qr_code: qr_code || null, status: status || 'pending', metadata: metadata ? JSON.stringify(metadata) : null });
    res.status(201).json({ id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create QR transaction' });
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

// PATCH /qr-transactions/:id
router.patch('/:id', authenticate, async (req, res) => {
  const { type, amount, qr_code, status, metadata } = req.body;
  try {
    const result = await query(`
      UPDATE qr_transactions
      SET type = ISNULL(@type, type),
          amount = ISNULL(@amount, amount),
          qr_code = ISNULL(@qr_code, qr_code),
          status = ISNULL(@status, status),
          metadata = ISNULL(@metadata, metadata)
      OUTPUT INSERTED.*
      WHERE id = @id
    `, { id: req.params.id, type: type ?? null, amount: amount ?? null, qr_code: qr_code ?? null, status: status ?? null, metadata: metadata ? JSON.stringify(metadata) : null });
    res.json(result.recordset[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update QR transaction' });
  }
});

module.exports = router;
