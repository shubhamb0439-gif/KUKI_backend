const express = require('express');
const { query } = require('../db');
const { authenticate, requireAdmin } = require('../middleware/auth');
const { uploadToBlob } = require('../utils/storage');
const multer = require('multer');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

// Max employees and feature flags per plan
const PLAN_LIMITS = {
  free:         { max_employees: 1,  can_track_attendance: 0, can_access_full_statements: 0 },
  core:         { max_employees: 3,  can_track_attendance: 1, can_access_full_statements: 0 },
  pro:          { max_employees: 6,  can_track_attendance: 1, can_access_full_statements: 0 },
  'pro plus':   { max_employees: 12, can_track_attendance: 1, can_access_full_statements: 1 },
  pro_plus:     { max_employees: 12, can_track_attendance: 1, can_access_full_statements: 1 },
  professional: { max_employees: 12, can_track_attendance: 1, can_access_full_statements: 1 },
  enterprise:   { max_employees: 12, can_track_attendance: 1, can_access_full_statements: 1 },
};

const PROFILE_COLS = `id, name, email, phone, role, ads_enabled, subscription_plan, subscription_status,
  subscription_expires_at, trial_ends_at, trial_used, trial_started_at, account_tier,
  max_employees, can_track_attendance, can_access_full_statements, created_at`;

// GET /profiles — admin gets all rows, anyone else gets their own row
router.get('/', authenticate, async (req, res) => {
  try {
    if (req.user.role === 'admin') {
      const result = await query(`SELECT ${PROFILE_COLS} FROM profiles ORDER BY created_at DESC`);
      return res.json(result.recordset);
    }
    const result = await query(`SELECT ${PROFILE_COLS} FROM profiles WHERE id = @id`, { id: req.user.id });
    res.json(result.recordset[0] || null);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch profiles' });
  }
});

// GET /profiles/:id — any authenticated user can read any profile (password_hash stripped)
router.get('/:id', authenticate, async (req, res) => {
  try {
    const result = await query('SELECT * FROM profiles WHERE id = @id', { id: req.params.id });
    if (result.recordset.length === 0) return res.status(404).json({ error: 'Profile not found' });
    const { password_hash, ...safe } = result.recordset[0];
    res.json(safe);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch profile' });
  }
});

// PATCH /profiles/:id
router.patch('/:id', authenticate, async (req, res) => {
  if (req.params.id.toLowerCase() !== req.user.id.toLowerCase() && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Access denied' });
  }

  const allowed = [
    'name', 'phone', 'email', 'profession', 'job_status', 'show_status_ring',
    'account_type', 'account_tier', 'ads_enabled', 'profile_photo', 'currency',
    'language_preference', 'subscription_plan', 'subscription_status',
    'subscription_expires_at', 'trial_ends_at', 'trial_used', 'trial_started_at',
    'max_employees', 'can_track_attendance', 'can_access_full_statements', 'payment_method_added',
  ];

  // Auto-apply plan limits when subscription_plan changes
  let bodyWithLimits = { ...req.body };
  if (req.body.subscription_plan) {
    const limits = PLAN_LIMITS[(req.body.subscription_plan || '').toLowerCase()];
    if (limits) Object.assign(bodyWithLimits, limits);
  }

  const updates = Object.keys(bodyWithLimits)
    .filter(k => allowed.includes(k))
    .map(k => `${k} = @${k}`)
    .join(', ');

  if (!updates) return res.status(400).json({ error: 'No valid fields to update' });

  try {
    await query(
      `UPDATE profiles SET ${updates}, updated_at = GETUTCDATE() WHERE id = @id`,
      { ...bodyWithLimits, id: req.params.id }
    );
    const result = await query('SELECT * FROM profiles WHERE id = @id', { id: req.params.id });
    const { password_hash, ...safe } = result.recordset[0];
    res.json(safe);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

// POST /profiles/:id/photo
// :id can be either a profiles.id OR an employees.id — we resolve it
router.post('/:id/photo', authenticate, upload.single('photo'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file provided' });

  try {
    // Resolve profile ID — the caller may pass employees.id instead of profiles.id
    let profileId = req.params.id;
    const profileCheck = await query('SELECT id FROM profiles WHERE id = @id', { id: req.params.id });
    if (!profileCheck.recordset.length) {
      // Try treating it as an employees table ID
      const empCheck = await query('SELECT user_id FROM employees WHERE id = @id', { id: req.params.id });
      if (!empCheck.recordset.length) return res.status(404).json({ error: 'Profile not found' });
      profileId = empCheck.recordset[0].user_id;
    }

    const isOwnPhoto = profileId.toLowerCase() === req.user.id.toLowerCase();
    const isAdmin = req.user.role === 'admin';

    // Employers can upload photos for their active employees
    let isEmployerOfTarget = false;
    if (!isOwnPhoto && !isAdmin && req.user.role === 'employer') {
      const emp = await query(
        `SELECT id FROM employees WHERE user_id = @uid AND employer_id = @eid AND status = 'active'`,
        { uid: profileId, eid: req.user.id }
      );
      isEmployerOfTarget = emp.recordset.length > 0;
    }

    if (!isOwnPhoto && !isAdmin && !isEmployerOfTarget) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const blobName = `${profileId}-${Date.now()}.jpg`;
    const url = await uploadToBlob(blobName, req.file.buffer, req.file.mimetype);
    await query(
      'UPDATE profiles SET profile_photo = @url, updated_at = GETUTCDATE() WHERE id = @id',
      { url, id: profileId }
    );
    res.json({ profile_photo: url });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Photo upload failed' });
  }
});

// PATCH /profiles/:id/ads-toggle (admin only)
router.patch('/:id/ads-toggle', authenticate, requireAdmin, async (req, res) => {
  const { ads_enabled } = req.body;
  try {
    await query(
      'UPDATE profiles SET ads_enabled = @ads_enabled, updated_at = GETUTCDATE() WHERE id = @id',
      { ads_enabled, id: req.params.id }
    );
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to toggle ads' });
  }
});

module.exports = router;
