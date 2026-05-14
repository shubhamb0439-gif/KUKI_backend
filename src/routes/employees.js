const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { query } = require('../db');
const { authenticate, requireEmployer } = require('../middleware/auth');

const router = express.Router();

function normalizeEmploymentType(val) {
  const v = (val || '').toLowerCase().replace(/[-\s]/g, '_');
  if (v.includes('part')) return 'part_time';
  if (v.includes('contract')) return 'contract';
  return 'full_time';
}

function normalizeWageType(val) {
  const v = (val || '').toLowerCase();
  if (v.includes('daily') || v.includes('day')) return 'daily';
  if (v.includes('hour')) return 'hourly';
  if (v.includes('contract')) return 'contract';
  return 'monthly';
}

// GET /employees - employer gets their employees, employee gets their own record
router.get('/', authenticate, async (req, res) => {
  try {
    let result;
    if (req.user.role === 'employer' || req.user.role === 'admin') {
      result = await query(`
        SELECT
          e.id, e.user_id, e.employer_id, e.employment_type, e.wage_amount, e.wage_type,
          e.status, e.start_date, e.end_date, e.created_at,
          p.name, p.email, p.phone,
          ISNULL(p.profile_photo, e.photo) AS photo_url,
          p.profession, p.job_status,
          ISNULL(ew.working_hours_per_day, 8)    AS working_hours_per_day,
          ISNULL(ew.total_working_days,   22)    AS working_days_per_month,
          ISNULL(ew.hourly_rate,          0)     AS hourly_rate,
          ISNULL(ew.monthly_wage, e.wage_amount) AS monthly_wage,
          ew.final_payable, ew.currency,
          CASE WHEN p.password_hash IS NOT NULL THEN 1 ELSE 0 END AS employee_has_app
        FROM employees e
        LEFT JOIN profiles p ON e.user_id = p.id
        LEFT JOIN employee_wages ew ON e.id = ew.employee_id AND e.employer_id = ew.employer_id
        WHERE e.employer_id = @employer_id AND e.status = 'active'
        ORDER BY e.created_at DESC
      `, { employer_id: req.user.id });
    } else {
      result = await query(`
        SELECT e.*, p.name AS employer_name
        FROM employees e
        LEFT JOIN profiles p ON e.employer_id = p.id
        WHERE e.user_id = @user_id AND e.status = 'active'
      `, { user_id: req.user.id });
    }
    res.json(result.recordset);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch employees' });
  }
});

// POST /employees - employer adds an employee
router.post('/', authenticate, requireEmployer, async (req, res) => {
  const { user_id, name, phone, email, employment_type, wage_amount, wage_type, start_date, profile_photo } = req.body;

  if (!user_id && !name) {
    return res.status(400).json({ error: 'name is required when adding a new employee' });
  }

  try {
    let employeeUserId = user_id;

    if (!employeeUserId) {
      // Manual add — find or create a profile
      let existingId = null;
      if (phone) {
        const r = await query('SELECT id FROM profiles WHERE phone = @phone', { phone });
        if (r.recordset.length) existingId = r.recordset[0].id;
      }
      if (!existingId && email) {
        const r = await query('SELECT id FROM profiles WHERE email = @email', { email });
        if (r.recordset.length) existingId = r.recordset[0].id;
      }
      if (existingId) {
        employeeUserId = existingId;
        // Update photo on existing profile if employer provided one
        if (profile_photo) {
          await query(
            'UPDATE profiles SET profile_photo = @profile_photo, updated_at = GETUTCDATE() WHERE id = @id',
            { profile_photo, id: existingId }
          );
        }
      } else {
        employeeUserId = uuidv4();
        await query(`
          INSERT INTO profiles (id, name, phone, email, role, profile_photo, created_at)
          VALUES (@id, @name, @phone, @email, 'employee', @profile_photo, GETUTCDATE())
        `, { id: employeeUserId, name, phone: phone || null, email: email || null, profile_photo: profile_photo || null });
      }
    }

    // Check if this user is already linked to this employer (e.g. manual add + QR scan)
    const existing = await query(
      `SELECT id, status FROM employees WHERE user_id = @uid AND employer_id = @eid`,
      { uid: employeeUserId, eid: req.user.id }
    );

    if (existing.recordset.length > 0) {
      const emp = existing.recordset[0];
      if (emp.status === 'active') {
        // Already linked and active — just return the existing record
        return res.status(200).json({ id: emp.id, user_id: employeeUserId, already_linked: true });
      }
      // Was removed — reactivate instead of creating a duplicate
      await query(
        `UPDATE employees SET status = 'active', updated_at = GETUTCDATE() WHERE id = @id`,
        { id: emp.id }
      );
      return res.status(200).json({ id: emp.id, user_id: employeeUserId, reactivated: true });
    }

    const employeeId = uuidv4();
    await query(`
      INSERT INTO employees (id, user_id, employer_id, employment_type, wage_amount, wage_type, start_date, status, created_at)
      VALUES (@id, @user_id, @employer_id, @employment_type, @wage_amount, @wage_type, @start_date, 'active', GETUTCDATE())
    `, {
      id: employeeId,
      user_id: employeeUserId,
      employer_id: req.user.id,
      employment_type: normalizeEmploymentType(employment_type),
      wage_amount: wage_amount || 0,
      wage_type: normalizeWageType(wage_type),
      start_date: start_date || null,
    });

    res.status(201).json({ id: employeeId, user_id: employeeUserId });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'Failed to add employee' });
  }
});

// POST /employees/link — employee scans employer QR code to link themselves
// Does NOT require employer role — called with the employee's own JWT
router.post('/link', authenticate, async (req, res) => {
  const { employer_id, employment_type, wage_amount, wage_type } = req.body;
  if (!employer_id) return res.status(400).json({ error: 'employer_id is required' });

  try {
    // Verify the employer exists
    const empProfile = await query('SELECT id FROM profiles WHERE id = @id', { id: employer_id });
    if (!empProfile.recordset.length) return res.status(404).json({ error: 'Employer not found' });

    // Check if already linked
    const existing = await query(
      `SELECT id, status FROM employees WHERE user_id = @uid AND employer_id = @eid`,
      { uid: req.user.id, eid: employer_id }
    );

    if (existing.recordset.length > 0) {
      const emp = existing.recordset[0];
      if (emp.status === 'active') {
        return res.status(200).json({ id: emp.id, user_id: req.user.id, already_linked: true });
      }
      // Reactivate if previously removed
      await query(
        `UPDATE employees SET status = 'active', updated_at = GETUTCDATE() WHERE id = @id`,
        { id: emp.id }
      );
      return res.status(200).json({ id: emp.id, user_id: req.user.id, reactivated: true });
    }

    const employeeId = uuidv4();
    await query(`
      INSERT INTO employees (id, user_id, employer_id, employment_type, wage_amount, wage_type, status, created_at)
      VALUES (@id, @user_id, @employer_id, @employment_type, @wage_amount, @wage_type, 'active', GETUTCDATE())
    `, {
      id: employeeId,
      user_id: req.user.id,
      employer_id,
      employment_type: normalizeEmploymentType(employment_type),
      wage_amount: wage_amount || 0,
      wage_type: normalizeWageType(wage_type),
    });

    res.status(201).json({ id: employeeId, user_id: req.user.id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'Failed to link to employer' });
  }
});

// PATCH /employees/:id
router.patch('/:id', authenticate, requireEmployer, async (req, res) => {
  const allowed = ['status', 'employment_type', 'wage_amount', 'wage_type', 'end_date'];
  const updates = Object.keys(req.body)
    .filter(k => allowed.includes(k))
    .map(k => `${k} = @${k}`)
    .join(', ');

  if (!updates) return res.status(400).json({ error: 'No valid fields' });

  try {
    await query(
      `UPDATE employees SET ${updates}, updated_at = GETUTCDATE() WHERE id = @id AND employer_id = @employer_id`,
      { ...req.body, id: req.params.id, employer_id: req.user.id }
    );
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update employee' });
  }
});

// DELETE /employees/:id - deactivate (not hard delete)
router.delete('/:id', authenticate, requireEmployer, async (req, res) => {
  try {
    const result = await query(
      `UPDATE employees SET status = 'inactive', updated_at = GETUTCDATE() WHERE id = @id AND employer_id = @employer_id`,
      { id: req.params.id, employer_id: req.user.id }
    );
    if (result.rowsAffected[0] === 0) return res.status(404).json({ error: 'Employee not found' });
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to remove employee' });
  }
});

module.exports = router;
