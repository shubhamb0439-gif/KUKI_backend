const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { query } = require('../db');
const { authenticate, requireEmployer } = require('../middleware/auth');

const router = express.Router();

// GET /employees - employer gets their employees, employee gets their own record
router.get('/', authenticate, async (req, res) => {
  try {
    let result;
    if (req.user.role === 'employer' || req.user.role === 'admin') {
      result = await query(`
        SELECT e.*, p.name, p.email, p.phone, p.profile_photo, p.profession, p.job_status
        FROM employees e
        JOIN profiles p ON e.user_id = p.id
        WHERE e.employer_id = @employer_id
        ORDER BY e.created_at DESC
      `, { employer_id: req.user.id });
    } else {
      result = await query(`
        SELECT e.*, p.name AS employer_name
        FROM employees e
        JOIN profiles p ON e.employer_id = p.id
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
  const { user_id, name, phone, email, employment_type, wage_amount, wage_type, start_date } = req.body;

  try {
    // If user_id provided, link existing profile. Otherwise create manual entry.
    let employeeUserId = user_id;

    if (!employeeUserId) {
      // Manual add - create a profile shell
      employeeUserId = uuidv4();
      await query(`
        INSERT INTO profiles (id, name, phone, email, role, created_at)
        VALUES (@id, @name, @phone, @email, 'employee', GETUTCDATE())
      `, { id: employeeUserId, name, phone: phone || null, email: email || null });
    }

    const employeeId = uuidv4();
    await query(`
      INSERT INTO employees (id, user_id, employer_id, employment_type, wage_amount, wage_type, start_date, status, created_at)
      VALUES (@id, @user_id, @employer_id, @employment_type, @wage_amount, @wage_type, @start_date, 'active', GETUTCDATE())
    `, {
      id: employeeId,
      user_id: employeeUserId,
      employer_id: req.user.id,
      employment_type: employment_type || 'full_time',
      wage_amount: wage_amount || 0,
      wage_type: wage_type || 'monthly',
      start_date: start_date || null,
    });

    res.status(201).json({ id: employeeId, user_id: employeeUserId });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to add employee' });
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
    await query(
      `UPDATE employees SET status = 'inactive', updated_at = GETUTCDATE() WHERE id = @id AND employer_id = @employer_id`,
      { id: req.params.id, employer_id: req.user.id }
    );
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to remove employee' });
  }
});

module.exports = router;
