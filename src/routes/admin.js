const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { query } = require('../db');
const { authenticate, requireAdmin } = require('../middleware/auth');

const router = express.Router();

// GET /admin/stats
router.get('/stats', authenticate, requireAdmin, async (req, res) => {
  try {
    const [users, employees, employers, jobPosts, applications, loans, bonuses, employments] = await Promise.all([
      query("SELECT COUNT(*) AS count FROM profiles"),
      query("SELECT COUNT(*) AS count FROM profiles WHERE role = 'employee'"),
      query("SELECT COUNT(*) AS count FROM profiles WHERE role = 'employer'"),
      query("SELECT COUNT(*) AS count FROM job_postings WHERE status = 'active'"),
      query("SELECT COUNT(*) AS count FROM job_applications"),
      query("SELECT COUNT(*) AS count FROM employee_loans"),
      query("SELECT COUNT(*) AS count FROM employee_bonuses"),
      query("SELECT COUNT(*) AS count FROM employees WHERE status = 'active'"),
    ]);

    res.json({
      totalUsers: users.recordset[0].count,
      totalEmployees: employees.recordset[0].count,
      totalEmployers: employers.recordset[0].count,
      activeJobPosts: jobPosts.recordset[0].count,
      totalApplications: applications.recordset[0].count,
      totalLoans: loans.recordset[0].count,
      totalBonuses: bonuses.recordset[0].count,
      activeEmployments: employments.recordset[0].count,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load stats' });
  }
});

// ─── JOB ROLES ────────────────────────────────────────────────────────────────

router.get('/job-roles', authenticate, async (req, res) => {
  try {
    const result = await query("SELECT * FROM job_roles WHERE is_active = 1 ORDER BY name");
    res.json(result.recordset);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch job roles' });
  }
});

router.post('/job-roles', authenticate, requireAdmin, async (req, res) => {
  const { name, description } = req.body;
  try {
    const id = uuidv4();
    await query(
      "INSERT INTO job_roles (id, name, description, is_active, created_at) VALUES (@id, @name, @desc, 1, GETUTCDATE())",
      { id, name, desc: description || null }
    );
    res.status(201).json({ id });
  } catch (err) {
    res.status(500).json({ error: 'Failed to create job role' });
  }
});

router.patch('/job-roles/:id', authenticate, requireAdmin, async (req, res) => {
  const { name, description, is_active } = req.body;
  try {
    await query(
      "UPDATE job_roles SET name = ISNULL(@name, name), description = @desc, is_active = ISNULL(@active, is_active), updated_at = GETUTCDATE() WHERE id = @id",
      { id: req.params.id, name: name || null, desc: description || null, active: is_active ?? null }
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update job role' });
  }
});

router.delete('/job-roles/:id', authenticate, requireAdmin, async (req, res) => {
  try {
    await query("UPDATE job_roles SET is_active = 0 WHERE id = @id", { id: req.params.id });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete job role' });
  }
});

// ─── ADVERTISEMENTS ───────────────────────────────────────────────────────────

router.get('/ads', authenticate, async (req, res) => {
  try {
    const result = await query("SELECT * FROM advertisements ORDER BY created_at DESC");
    res.json(result.recordset);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch ads' });
  }
});

router.post('/ads', authenticate, requireAdmin, async (req, res) => {
  const { title, description, video_url, brand_name, rate_per_display, currency } = req.body;
  try {
    const id = uuidv4();
    await query(`
      INSERT INTO advertisements (id, title, description, video_url, brand_name, rate_per_display, currency, is_active, created_at)
      VALUES (@id, @title, @desc, @video_url, @brand, @rate, @currency, 1, GETUTCDATE())
    `, { id, title, desc: description || null, video_url, brand: brand_name, rate: rate_per_display || 0, currency: currency || 'USD' });
    res.status(201).json({ id });
  } catch (err) {
    res.status(500).json({ error: 'Failed to create ad' });
  }
});

router.patch('/ads/:id', authenticate, requireAdmin, async (req, res) => {
  const { title, description, video_url, brand_name, rate_per_display, currency, is_active } = req.body;
  try {
    await query(`
      UPDATE advertisements
      SET title = ISNULL(@title, title), description = @desc, video_url = ISNULL(@video_url, video_url),
          brand_name = ISNULL(@brand, brand_name), rate_per_display = ISNULL(@rate, rate_per_display),
          currency = ISNULL(@currency, currency), is_active = ISNULL(@active, is_active), updated_at = GETUTCDATE()
      WHERE id = @id
    `, { id: req.params.id, title: title || null, desc: description || null, video_url: video_url || null, brand: brand_name || null, rate: rate_per_display || null, currency: currency || null, active: is_active ?? null });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update ad' });
  }
});

router.delete('/ads/:id', authenticate, requireAdmin, async (req, res) => {
  try {
    await query("DELETE FROM advertisements WHERE id = @id", { id: req.params.id });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete ad' });
  }
});

// GET /admin/ad-impressions
router.get('/ad-impressions', authenticate, requireAdmin, async (req, res) => {
  try {
    const result = await query("SELECT ad_id, COUNT(*) AS count FROM ad_impressions GROUP BY ad_id");
    const map = {};
    result.recordset.forEach(r => { map[r.ad_id] = r.count; });
    res.json(map);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch impressions' });
  }
});

// POST /admin/ad-impressions - record a view
router.post('/ad-impressions', authenticate, async (req, res) => {
  const { ad_id } = req.body;
  try {
    await query(
      "INSERT INTO ad_impressions (id, ad_id, user_id, viewed_at) VALUES (@id, @ad_id, @user_id, GETUTCDATE())",
      { id: uuidv4(), ad_id, user_id: req.user.id }
    );
    res.status(201).json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to record impression' });
  }
});

// ─── SUBSCRIPTIONS ────────────────────────────────────────────────────────────

router.get('/subscriptions', authenticate, requireAdmin, async (req, res) => {
  try {
    const result = await query("SELECT * FROM subscription_transactions ORDER BY created_at DESC");
    res.json(result.recordset);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch subscriptions' });
  }
});

router.patch('/subscriptions/:id/approve', authenticate, requireAdmin, async (req, res) => {
  try {
    await query(
      "UPDATE subscription_transactions SET status = 'approved', updated_at = GETUTCDATE() WHERE id = @id",
      { id: req.params.id }
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to approve' });
  }
});

// GET /admin/login-logs
router.get('/login-logs', authenticate, requireAdmin, async (req, res) => {
  try {
    const result = await query("SELECT TOP 500 * FROM login_logs ORDER BY login_time DESC");
    res.json(result.recordset);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch logs' });
  }
});

module.exports = router;
