const express = require('express');
const { query } = require('../db');
const { authenticate, requireAdmin } = require('../middleware/auth');
const { uploadToBlob } = require('../utils/storage');
const multer = require('multer');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

function normalizePhotoUrl(url) {
  if (!url) return url;
  const apiBase = process.env.API_BASE_URL;
  const container = process.env.AZURE_STORAGE_CONTAINER || 'profile-photos';
  const account = process.env.AZURE_STORAGE_ACCOUNT || 'kukistorageprod';

  let blobName = null;
  if (url.startsWith('/storage/')) {
    blobName = url.replace(/^\/storage\/[^/]+\//, '');
  } else if (url.includes('.blob.core.windows.net/')) {
    const match = url.match(/\.blob\.core\.windows\.net\/[^/]+\/(.+)/);
    if (match) blobName = match[1];
  }

  if (!blobName) return url; // Already a proxied URL or unknown format

  if (apiBase) {
    return `${apiBase.replace(/\/$/, '')}/storage/${container}/${blobName}`;
  }
  // API_BASE_URL not set — keep direct Azure URL (enable public access in Azure Portal if needed)
  return url.startsWith('http') ? url : `https://${account}.blob.core.windows.net/${container}/${blobName}`;
}

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

const PROFILE_COLS = `id, name, email, phone, role, profile_photo, profession, job_status,
  ads_enabled, subscription_plan, subscription_status,
  subscription_expires_at, trial_ends_at, trial_used, trial_started_at, account_tier,
  max_employees, can_track_attendance, can_access_full_statements, created_at`;

// GET /profiles — admin gets all rows, anyone else gets their own row
router.get('/', authenticate, async (req, res) => {
  try {
    if (req.user.role === 'admin') {
      const result = await query(`SELECT ${PROFILE_COLS} FROM profiles ORDER BY created_at DESC`);
      return res.json(result.recordset.map(r => ({ ...r, profile_photo: normalizePhotoUrl(r.profile_photo) })));
    }
    const result = await query(`SELECT ${PROFILE_COLS} FROM profiles WHERE id = @id`, { id: req.user.id });
    const row = result.recordset[0];
    res.json(row ? { ...row, profile_photo: normalizePhotoUrl(row.profile_photo) } : null);
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
    res.json({ ...safe, profile_photo: normalizePhotoUrl(safe.profile_photo) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch profile' });
  }
});

// PATCH /profiles/:id — accepts JSON body OR multipart/form-data (with optional photo file)
router.patch('/:id', authenticate, upload.single('photo'), async (req, res) => {
  if (req.params.id.toLowerCase() !== req.user.id.toLowerCase() && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Access denied' });
  }

  try {
    // If a photo file was uploaded, push it to Azure and inject the URL into the update body
    if (req.file) {
      const ext = (req.file.mimetype || 'image/jpeg').split('/')[1] || 'jpg';
      const blobName = `${req.params.id}-${Date.now()}.${ext}`;
      const photoUrl = await uploadToBlob(blobName, req.file.buffer, req.file.mimetype);
      req.body.profile_photo = photoUrl;
    }

    // Only columns confirmed to exist in the profiles table
    const allowed = [
      'name', 'phone', 'email', 'profession', 'job_status',
      'account_type', 'account_tier', 'ads_enabled', 'profile_photo',
      'subscription_plan', 'subscription_status',
      'subscription_expires_at', 'trial_ends_at', 'trial_used', 'trial_started_at',
      'max_employees', 'can_track_attendance', 'can_access_full_statements', 'payment_method_added',
      'currency',
    ];

    // Auto-apply plan limits when subscription_plan changes
    let bodyWithLimits = { ...req.body };
    if (req.body.subscription_plan) {
      const limits = PLAN_LIMITS[(req.body.subscription_plan || '').toLowerCase()];
      if (limits) Object.assign(bodyWithLimits, limits);
    }

    const updates = Object.keys(bodyWithLimits)
      .filter(k => {
        if (!allowed.includes(k)) return false;
        if (k === 'profile_photo' && !bodyWithLimits[k]) return false;
        return true;
      })
      .map(k => `${k} = @${k}`)
      .join(', ');

    if (!updates) {
      // No recognised fields sent — return current profile unchanged rather than erroring
      const current = await query('SELECT * FROM profiles WHERE id = @id', { id: req.params.id });
      const { password_hash, ...safe } = current.recordset[0];
      return res.json({ ...safe, profile_photo: normalizePhotoUrl(safe.profile_photo) });
    }

    await query(
      `UPDATE profiles SET ${updates}, updated_at = GETUTCDATE() WHERE id = @id`,
      { ...bodyWithLimits, id: req.params.id }
    );
    const result = await query('SELECT * FROM profiles WHERE id = @id', { id: req.params.id });
    const { password_hash, ...safe } = result.recordset[0];
    res.json({ ...safe, profile_photo: normalizePhotoUrl(safe.profile_photo) });
  } catch (err) {
    console.error('PATCH /profiles error:', err.message);
    if (err.message && err.message.includes('Invalid column name')) {
      const col = err.message.match(/'([^']+)'/)?.[1] || 'unknown';
      return res.status(400).json({ error: `Field '${col}' is not supported in profile updates` });
    }
    res.status(500).json({ error: err.message || 'Failed to update profile' });
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
      if (!empCheck.recordset[0].user_id) {
        // Manually added employee with no user account — upload to Azure, store on employees table
        const ext = (req.file.mimetype || 'image/jpeg').split('/')[1] || 'jpg';
        const blobName = `emp-${req.params.id}-${Date.now()}.${ext}`;
        const photoUrl = await uploadToBlob(blobName, req.file.buffer, req.file.mimetype);
        await query('UPDATE employees SET photo = @url WHERE id = @id', { url: photoUrl, id: req.params.id });
        return res.json({ employee_id: req.params.id, profile_photo: normalizePhotoUrl(photoUrl) });
      }
      profileId = empCheck.recordset[0].user_id;
    }

    const isOwnPhoto = profileId.toLowerCase() === req.user.id.toLowerCase();
    const isAdmin = req.user.role === 'admin';

    // Employers can upload photos for their active employees
    let isEmployerOfTarget = false;
    if (!isOwnPhoto && !isAdmin && req.user.role === 'employer') {
      const emp = await query(
        `SELECT id FROM employees WHERE user_id = @uid AND employer_id = @eid`,
        { uid: profileId, eid: req.user.id }
      );
      isEmployerOfTarget = emp.recordset.length > 0;
    }

    if (!isOwnPhoto && !isAdmin && !isEmployerOfTarget) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const ext = (req.file.mimetype || 'image/jpeg').split('/')[1] || 'jpg';
    const blobName = `${profileId}-${Date.now()}.${ext}`;
    const url = await uploadToBlob(blobName, req.file.buffer, req.file.mimetype);
    if (!url) throw new Error('Storage returned empty URL');

    const normalizedUrl = normalizePhotoUrl(url);

    // Save to profiles.profile_photo
    try {
      await query(
        'UPDATE profiles SET profile_photo = @url WHERE id = @id',
        { url: normalizedUrl, id: profileId }
      );
      console.log(`profile_photo saved for profileId=${profileId}`);
    } catch (updateErr) {
      console.error('Failed to update profiles.profile_photo:', updateErr.message);
      throw updateErr;
    }

    // Also save to employees.photo so ISNULL fallbacks work
    try {
      await query(
        `UPDATE employees SET photo = @url WHERE user_id = @pid OR id = @rid`,
        { url: normalizedUrl, pid: profileId, rid: req.params.id }
      );
    } catch (_) {}

    const updated = await query('SELECT * FROM profiles WHERE id = @id', { id: profileId });
    const { password_hash, ...safe } = updated.recordset[0];
    res.json({ ...safe, profile_photo: normalizedUrl });
  } catch (err) {
    console.error('POST /photo error:', err.message);
    res.status(500).json({ error: err.message || 'Photo upload failed' });
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
