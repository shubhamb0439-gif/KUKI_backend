const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { query } = require('../db');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

// GET /attendance - get attendance records
router.get('/', authenticate, async (req, res) => {
  const { employee_id, from, to } = req.query;
  try {
    let q = `
      SELECT a.*, p.name AS employee_name
      FROM attendance a
      JOIN employees e ON a.employee_id = e.id
      JOIN profiles p ON e.user_id = p.id
      WHERE 1=1
    `;
    const params = {};

    if (req.user.role === 'employer') {
      q += ' AND e.employer_id = @employer_id';
      params.employer_id = req.user.id;
    } else {
      q += ' AND e.user_id = @user_id';
      params.user_id = req.user.id;
    }
    if (employee_id) { q += ' AND a.employee_id = @employee_id'; params.employee_id = employee_id; }
    if (from) { q += ' AND a.date >= @from'; params.from = from; }
    if (to) { q += ' AND a.date <= @to'; params.to = to; }
    q += ' ORDER BY a.date DESC, a.clock_in DESC';

    const result = await query(q, params);
    res.json(result.recordset);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch attendance' });
  }
});

// POST /attendance/clock-in
router.post('/clock-in', authenticate, async (req, res) => {
  const { employee_id, location, qr_scan } = req.body;
  try {
    const id = uuidv4();
    await query(`
      INSERT INTO attendance (id, employee_id, clock_in, date, location, qr_scan, created_at)
      VALUES (@id, @employee_id, GETUTCDATE(), CAST(GETUTCDATE() AS DATE), @location, @qr_scan, GETUTCDATE())
    `, { id, employee_id, location: location || null, qr_scan: qr_scan || 0 });
    res.status(201).json({ id, clocked_in_at: new Date() });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Clock in failed' });
  }
});

// PATCH /attendance/:id/clock-out
router.patch('/:id/clock-out', authenticate, async (req, res) => {
  try {
    await query(`
      UPDATE attendance
      SET clock_out = GETUTCDATE(),
          hours_worked = DATEDIFF(MINUTE, clock_in, GETUTCDATE()) / 60.0,
          updated_at = GETUTCDATE()
      WHERE id = @id
    `, { id: req.params.id });
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Clock out failed' });
  }
});

// POST /attendance/manual - employer manual entry
router.post('/manual', authenticate, async (req, res) => {
  const { employee_id, date, clock_in, clock_out, notes } = req.body;
  try {
    const id = uuidv4();
    await query(`
      INSERT INTO attendance (id, employee_id, date, clock_in, clock_out, hours_worked, notes, is_manual, created_at)
      VALUES (@id, @employee_id, @date, @clock_in, @clock_out,
        DATEDIFF(MINUTE, @clock_in, @clock_out) / 60.0,
        @notes, 1, GETUTCDATE())
    `, { id, employee_id, date, clock_in, clock_out, notes: notes || null });
    res.status(201).json({ id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Manual entry failed' });
  }
});

module.exports = router;
