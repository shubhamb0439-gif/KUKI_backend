const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { query } = require('../db');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

// ─── MESSAGES ────────────────────────────────────────────────────────────────

// GET /messages
router.get('/', authenticate, async (req, res) => {
  try {
    const result = await query(`
      SELECT m.*,
        sp.name AS sender_name, sp.profile_photo AS sender_photo,
        rp.name AS receiver_name
      FROM messages m
      JOIN profiles sp ON m.sender_id = sp.id
      JOIN profiles rp ON m.receiver_id = rp.id
      WHERE m.sender_id = @uid OR m.receiver_id = @uid
      ORDER BY m.created_at DESC
    `, { uid: req.user.id });
    res.json(result.recordset);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch messages' });
  }
});

// POST /messages
router.post('/', authenticate, async (req, res) => {
  const { receiver_id, content } = req.body;
  try {
    const id = uuidv4();
    await query(`
      INSERT INTO messages (id, sender_id, receiver_id, content, is_read, created_at)
      VALUES (@id, @sender, @receiver, @content, 0, GETUTCDATE())
    `, { id, sender: req.user.id, receiver: receiver_id, content });
    res.status(201).json({ id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to send message' });
  }
});

// PATCH /messages/:id/read
router.patch('/:id/read', authenticate, async (req, res) => {
  try {
    await query(
      'UPDATE messages SET is_read = 1 WHERE id = @id AND receiver_id = @uid',
      { id: req.params.id, uid: req.user.id }
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to mark as read' });
  }
});

// ─── JOB POSTINGS ─────────────────────────────────────────────────────────────

// GET /messages/jobs
router.get('/jobs', authenticate, async (req, res) => {
  try {
    const result = await query(`
      SELECT j.*, p.name AS employer_name
      FROM job_postings j
      JOIN profiles p ON j.employer_id = p.id
      WHERE j.status = 'active'
      ORDER BY j.created_at DESC
    `);
    res.json(result.recordset);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch jobs' });
  }
});

// POST /messages/jobs
router.post('/jobs', authenticate, async (req, res) => {
  const { title, description, location, wage, employment_type, job_role_id } = req.body;
  try {
    const id = uuidv4();
    await query(`
      INSERT INTO job_postings (id, employer_id, title, description, location, wage, employment_type, job_role_id, status, created_at)
      VALUES (@id, @employer_id, @title, @desc, @location, @wage, @emp_type, @role_id, 'active', GETUTCDATE())
    `, { id, employer_id: req.user.id, title, desc: description || null, location: location || null, wage: wage || null, emp_type: employment_type || null, role_id: job_role_id || null });
    res.status(201).json({ id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'Failed to create job posting' });
  }
});

// POST /messages/jobs/:id/apply
router.post('/jobs/:id/apply', authenticate, async (req, res) => {
  try {
    const jobRow = await query('SELECT employer_id FROM job_postings WHERE id = @job_id', { job_id: req.params.id });
    if (!jobRow.recordset.length) return res.status(404).json({ error: 'Job not found' });
    const employer_id = jobRow.recordset[0].employer_id;

    const id = uuidv4();
    await query(`
      INSERT INTO job_applications (id, job_id, applicant_id, employer_id, status, created_at)
      VALUES (@id, @job_id, @applicant_id, @employer_id, 'pending', GETUTCDATE())
    `, { id, job_id: req.params.id, applicant_id: req.user.id, employer_id });
    res.status(201).json({ id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'Failed to apply' });
  }
});

// ─── JOB APPLICATIONS ─────────────────────────────────────────────────────────

// GET /messages/jobs/applications — employer sees applications for their postings
router.get('/jobs/applications', authenticate, async (req, res) => {
  try {
    const result = await query(`
      SELECT
        ja.id, ja.job_id, ja.applicant_id, ja.status, ja.created_at,
        p.name            AS applicant_name,
        p.email           AS applicant_email,
        p.phone           AS applicant_phone,
        p.profession      AS applicant_profession,
        p.profile_photo   AS applicant_profile_photo,
        jp.title          AS job_title,
        jp.description    AS job_description
      FROM job_applications ja
      JOIN profiles p     ON ja.applicant_id = p.id
      JOIN job_postings jp ON ja.job_id = jp.id
      WHERE jp.employer_id = @employer_id
      ORDER BY ja.created_at DESC
    `, { employer_id: req.user.id });
    res.json(result.recordset);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch applications' });
  }
});

// PATCH /messages/jobs/applications/:id — update status, return updated row
router.patch('/jobs/applications/:id', authenticate, async (req, res) => {
  const { status } = req.body;
  try {
    const result = await query(`
      UPDATE job_applications
      SET status = @status, updated_at = GETUTCDATE()
      OUTPUT INSERTED.*
      WHERE id = @id
    `, { id: req.params.id, status });
    if (!result.recordset.length) return res.status(404).json({ error: 'Application not found' });
    res.json(result.recordset[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'Failed to update application' });
  }
});

module.exports = router;
