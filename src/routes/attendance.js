const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { query } = require('../db');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

// Columns use ISNULL(new, old) so both old data and new data are handled correctly.
// New column names: attendance_date, login_time, logout_time, total_hours, status, employer_id
// Old column names: date, clock_in, clock_out, hours_worked (kept for backward compat)

// GET /attendance
router.get('/', authenticate, async (req, res) => {
  const { employee_id, from, to } = req.query;
  try {
    let q = `
      SELECT
        a.id, a.employee_id, a.employer_id,
        CONVERT(VARCHAR(10), ISNULL(a.attendance_date, a.[date]), 120) AS attendance_date,
        ISNULL(a.login_time,  a.clock_in)                          AS login_time,
        ISNULL(a.logout_time, a.clock_out)                         AS logout_time,
        ISNULL(a.total_hours, a.hours_worked)                      AS total_hours,
        ISNULL(a.[status], 'present')                              AS [status],
        a.qr_scan, a.is_manual, a.notes, a.location, a.created_at,
        p.name AS employee_name, p.profile_photo AS employee_photo
      FROM attendance a
      JOIN employees e ON a.employee_id = e.id
      LEFT JOIN profiles p ON e.user_id = p.id
      WHERE 1=1
    `;
    const params = {};

    if (req.user.role === 'employer' || req.user.role === 'admin') {
      q += ' AND e.employer_id = @employer_id';
      params.employer_id = req.user.id;
    } else {
      q += ' AND e.user_id = @user_id';
      params.user_id = req.user.id;
    }

    if (employee_id) { q += ' AND a.employee_id = @employee_id'; params.employee_id = employee_id; }
    if (from) { q += ' AND CAST(ISNULL(a.attendance_date, a.[date]) AS DATE) >= @from'; params.from = from; }
    if (to)   { q += ' AND CAST(ISNULL(a.attendance_date, a.[date]) AS DATE) <= @to';  params.to = to; }
    q += ' ORDER BY CAST(ISNULL(a.attendance_date, a.[date]) AS DATE) DESC, ISNULL(a.login_time, a.clock_in) DESC';

    const result = await query(q, params);
    res.json(result.recordset);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch attendance' });
  }
});

// POST /attendance/clock-in — manual or QR clock-in
router.post('/clock-in', authenticate, async (req, res) => {
  const { employee_id, location, qr_scan } = req.body;
  try {
    const id = uuidv4();
    const today = new Date().toISOString().split('T')[0];
    await query(`
      INSERT INTO attendance
        (id, employee_id, attendance_date, [date], login_time, clock_in, [status], location, qr_scan, created_at)
      VALUES
        (@id, @employee_id, @today, @today, GETUTCDATE(), GETUTCDATE(), 'present', @location, @qr_scan, GETUTCDATE())
    `, { id, employee_id, today, location: location || null, qr_scan: qr_scan || 0 });
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
      UPDATE attendance SET
        clock_out    = GETUTCDATE(),
        logout_time  = GETUTCDATE(),
        hours_worked = DATEDIFF(MINUTE, ISNULL(login_time, clock_in), GETUTCDATE()) / 60.0,
        total_hours  = DATEDIFF(MINUTE, ISNULL(login_time, clock_in), GETUTCDATE()) / 60.0,
        updated_at   = GETUTCDATE()
      WHERE id = @id
    `, { id: req.params.id });
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Clock out failed' });
  }
});

// POST /attendance/manual — upsert
// Employer: pass employee_id in body. Employee: identified from JWT, pass employer_id in body.
router.post('/manual', authenticate, async (req, res) => {
  const {
    employee_id: bodyEmpId, employer_id,
    attendance_date, date: bodyDate,
    status, login_time, logout_time, clock_in, clock_out, notes,
  } = req.body;

  const VALID_STATUSES = ['present', 'absent', 'leave', 'sick_leave'];
  if (status && !VALID_STATUSES.includes(status)) {
    return res.status(400).json({ error: `status must be one of: ${VALID_STATUSES.join(', ')}` });
  }

  try {
    let empId = bodyEmpId;
    let empEmployerId = employer_id || req.user.id;

    if (req.user.role === 'employer' || req.user.role === 'admin') {
      // Employer marking attendance for an employee — verify ownership
      if (!empId) return res.status(400).json({ error: 'employee_id is required' });
      const empCheck = await query(
        `SELECT id FROM employees WHERE id = @empId AND employer_id = @eid`,
        { empId, eid: req.user.id }
      );
      if (!empCheck.recordset.length) {
        return res.status(403).json({ error: 'Employee not found or does not belong to you' });
      }
      empEmployerId = req.user.id;
    } else {
      // Employee self-report: find their employee record
      const empQ = employer_id
        ? `SELECT TOP 1 id, employer_id FROM employees WHERE user_id = @uid AND employer_id = @eid AND status = 'active'`
        : `SELECT TOP 1 id, employer_id FROM employees WHERE user_id = @uid AND status = 'active' ORDER BY created_at DESC`;
      const empP = employer_id ? { uid: req.user.id, eid: employer_id } : { uid: req.user.id };
      const empResult = await query(empQ, empP);
      if (!empResult.recordset.length) return res.status(404).json({ error: 'Employee record not found' });
      empId = empResult.recordset[0].id;
      empEmployerId = empResult.recordset[0].employer_id;
    }

    const attDate = attendance_date || bodyDate;
    const loginT  = login_time  || clock_in  || null;
    const logoutT = logout_time || clock_out || null;

    // Upsert based on employee + date
    const existing = await query(`
      SELECT id FROM attendance
      WHERE employee_id = @emp_id
        AND CAST(ISNULL(attendance_date, [date]) AS DATE) = @att_date
    `, { emp_id: empId, att_date: attDate });

    let recordId;

    if (existing.recordset.length > 0) {
      recordId = existing.recordset[0].id;
      await query(`
        UPDATE attendance SET
          [status]     = ISNULL(@status, [status]),
          login_time   = ISNULL(@loginT,  login_time),
          logout_time  = ISNULL(@logoutT, logout_time),
          clock_in     = ISNULL(@loginT,  clock_in),
          clock_out    = ISNULL(@logoutT, clock_out),
          total_hours  = CASE WHEN @loginT IS NOT NULL AND @logoutT IS NOT NULL
                           THEN DATEDIFF(MINUTE, @loginT, @logoutT) / 60.0 ELSE total_hours END,
          hours_worked = CASE WHEN @loginT IS NOT NULL AND @logoutT IS NOT NULL
                           THEN DATEDIFF(MINUTE, @loginT, @logoutT) / 60.0 ELSE hours_worked END,
          notes        = ISNULL(@notes, notes),
          is_manual    = 1,
          updated_at   = GETUTCDATE()
        WHERE id = @id
      `, { id: recordId, status: status || null, loginT, logoutT, notes: notes || null });
    } else {
      recordId = uuidv4();
      await query(`
        INSERT INTO attendance
          (id, employee_id, employer_id, attendance_date, [date], login_time, logout_time,
           clock_in, clock_out, [status], is_manual, notes, total_hours, hours_worked, created_at)
        VALUES
          (@id, @emp_id, @eid, @attDate, @attDate, @loginT, @logoutT, @loginT, @logoutT,
           ISNULL(@status, 'present'), 1, @notes,
           CASE WHEN @loginT IS NOT NULL AND @logoutT IS NOT NULL
                THEN DATEDIFF(MINUTE, @loginT, @logoutT) / 60.0 ELSE NULL END,
           CASE WHEN @loginT IS NOT NULL AND @logoutT IS NOT NULL
                THEN DATEDIFF(MINUTE, @loginT, @logoutT) / 60.0 ELSE NULL END,
           GETUTCDATE())
      `, { id: recordId, emp_id: empId, eid: empEmployerId, attDate, loginT, logoutT, status: status || 'present', notes: notes || null });
    }

    const record = await query(`
      SELECT
        a.id, a.employee_id, a.employer_id,
        CONVERT(VARCHAR(10), ISNULL(a.attendance_date, a.[date]), 120) AS attendance_date,
        ISNULL(a.login_time,  a.clock_in)     AS login_time,
        ISNULL(a.logout_time, a.clock_out)    AS logout_time,
        ISNULL(a.total_hours, a.hours_worked) AS total_hours,
        ISNULL(a.[status], 'present')         AS [status],
        a.is_manual, a.notes, a.created_at
      FROM attendance a WHERE a.id = @id
    `, { id: recordId });

    res.json({ message: 'Attendance marked successfully', data: record.recordset[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'Manual entry failed' });
  }
});

module.exports = router;
