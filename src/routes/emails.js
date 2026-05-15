const express = require('express');
const { authenticate } = require('../middleware/auth');
const { sendEmail } = require('../utils/email');

const router = express.Router();

// POST /emails/statement
router.post('/statement', authenticate, async (req, res) => {
  const { to_email, subject, statement_content } = req.body;
  if (!to_email || !statement_content) {
    return res.status(400).json({ error: 'to_email and statement_content are required' });
  }

  try {
    await sendEmail({
      to: to_email,
      subject: subject || 'Your Wage Statement',
      text: statement_content,
      html: `
        <div style="font-family:sans-serif;max-width:600px;margin:auto;padding:24px;">
          <h2 style="color:#4F46E5;">KUKI Wage Statement</h2>
          <pre style="background:#f4f4f4;padding:16px;border-radius:6px;white-space:pre-wrap;font-size:14px;">${statement_content}</pre>
          <p style="color:#999;font-size:12px;margin-top:24px;">Sent via KUKI Workforce Management</p>
        </div>
      `,
    });
    res.json({ message: 'Statement sent successfully' });
  } catch (err) {
    console.error('Statement email error:', err.message);
    res.status(500).json({ error: 'Failed to send statement' });
  }
});

// POST /emails/referral
router.post('/referral', authenticate, async (req, res) => {
  const { to_email, from_name, referral_link } = req.body;
  if (!to_email || !from_name || !referral_link) {
    return res.status(400).json({ error: 'to_email, from_name, and referral_link are required' });
  }

  try {
    await sendEmail({
      to: to_email,
      subject: `${from_name} invited you to join KUKI`,
      text: `${from_name} has invited you to join KUKI — a smart workforce management app.\n\nSign up here: ${referral_link}`,
      html: `
        <div style="font-family:sans-serif;max-width:600px;margin:auto;padding:24px;">
          <h2 style="color:#4F46E5;">You're invited to join KUKI!</h2>
          <p><strong>${from_name}</strong> has invited you to join KUKI — a smart workforce management app.</p>
          <a href="${referral_link}" style="display:inline-block;margin-top:16px;padding:12px 24px;background:#4F46E5;color:#fff;border-radius:6px;text-decoration:none;font-weight:bold;">Accept Invitation</a>
          <p style="color:#999;font-size:12px;margin-top:24px;">If the button doesn't work, copy this link: ${referral_link}</p>
        </div>
      `,
    });
    res.json({ message: 'Referral sent successfully' });
  } catch (err) {
    console.error('Referral email error:', err.message);
    res.status(500).json({ error: 'Failed to send referral' });
  }
});

module.exports = router;
