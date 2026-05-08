const express = require('express');
const { query } = require('../db');
const { authenticate, requireAdmin } = require('../middleware/auth');
const { uploadToBlob, deleteFromBlob } = require('../utils/storage');
const multer = require('multer');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

// GET /profiles/:id
router.get('/:id', authenticate, async (req, res) => {
  try {
    // Users can only read their own profile unless admin
    if (req.params.id.toLowerCase() !== req.user.id.toLowerCase() && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Access denied' });
    }
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

  const allowed = ['name', 'phone', 'email', 'profession', 'job_status', 'show_status_ring', 'account_type', 'account_tier', 'ads_enabled', 'profile_photo', 'currency', 'language_preference', 'subscription_plan', 'subscription_status', 'subscription_expires_at', 'trial_ends_at', 'max_employees', 'can_track_attendance', 'can_access_full_statements', 'payment_method_added'];
  const updates = Object.keys(req.body)
    .filter(k => allowed.includes(k))
    .map(k => `${k} = @${k}`)
    .join(', ');

  if (!updates) return res.status(400).json({ error: 'No valid fields to update' });

  try {
    await query(
      `UPDATE profiles SET ${updates}, updated_at = GETUTCDATE() WHERE id = @id`,
      { ...req.body, id: req.params.id }
    );
    const result = await query('SELECT * FROM profiles WHERE id = @id', { id: req.params.id });
    const { password_hash, ...safe } = result.recordset[0];
    res.json(safe);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

// POST /profiles/:id/photo - upload profile photo to Azure Blob Storage
router.post('/:id/photo', authenticate, upload.single('photo'), async (req, res) => {
  if (req.params.id.toLowerCase() !== req.user.id.toLowerCase() && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Access denied' });
  }
  if (!req.file) return res.status(400).json({ error: 'No file provided' });

  try {
    const blobName = `${req.params.id}-${Date.now()}.jpg`;
    const url = await uploadToBlob(blobName, req.file.buffer, req.file.mimetype);

    await query(
      'UPDATE profiles SET profile_photo = @url, updated_at = GETUTCDATE() WHERE id = @id',
      { url, id: req.params.id }
    );
    res.json({ profile_photo: url });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Photo upload failed' });
  }
});

// GET /profiles (admin only - list all users)
router.get('/', authenticate, requireAdmin, async (req, res) => {
  try {
    const result = await query('SELECT id, name, email, phone, role, ads_enabled, created_at FROM profiles ORDER BY created_at DESC');
    res.json(result.recordset);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch users' });
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
