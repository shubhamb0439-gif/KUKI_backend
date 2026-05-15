const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const { query, sql } = require('../db');
const { authenticate } = require('../middleware/auth');
const { sendEmail } = require('../utils/email');

const router = express.Router();

// POST /auth/signup
router.post('/signup', async (req, res) => {
  const { email, phone, password, name, role } = req.body;

  if (!password || !name || (!email && !phone)) {
    return res.status(400).json({ error: 'Name, password, and email or phone are required' });
  }
  if (!['employer', 'employee'].includes(role)) {
    return res.status(400).json({ error: 'Role must be employer or employee' });
  }

  try {
    // Check if email/phone already exists
    if (email) {
      const existing = await query('SELECT id FROM profiles WHERE email = @email', { email });
      if (existing.recordset.length > 0) {
        return res.status(409).json({ error: 'Email already in use' });
      }
    }
    if (phone) {
      const existing = await query('SELECT id FROM profiles WHERE phone = @phone', { phone });
      if (existing.recordset.length > 0) {
        return res.status(409).json({ error: 'Phone already in use' });
      }
    }

    const hashedPassword = await bcrypt.hash(password, 12);
    const userId = uuidv4();

    await query(`
      INSERT INTO profiles (id, email, phone, name, role, password_hash, account_type, created_at)
      VALUES (@id, @email, @phone, @name, @role, @password_hash, 'normal', GETUTCDATE())
    `, {
      id: userId,
      email: email || null,
      phone: phone || null,
      name,
      role,
      password_hash: hashedPassword,
    });

    // Re-fetch from DB so the id is in the same format (uppercase UNIQUEIDENTIFIER) as login
    const inserted = await query('SELECT * FROM profiles WHERE id = @id', { id: userId });
    const { password_hash: _, ...newProfile } = inserted.recordset[0];

    const token = jwt.sign(
      { id: newProfile.id, email: newProfile.email, phone: newProfile.phone, name: newProfile.name, role: newProfile.role },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
    );

    res.status(201).json({ token, user: newProfile });
  } catch (err) {
    console.error('Signup error:', err);
    res.status(500).json({ error: 'Failed to create account' });
  }
});

// POST /auth/login
router.post('/login', async (req, res) => {
  const { emailOrPhone, password } = req.body;

  if (!emailOrPhone || !password) {
    return res.status(400).json({ error: 'Email/phone and password are required' });
  }

  try {
    const isEmail = emailOrPhone.includes('@');
    const field = isEmail ? 'email' : 'phone';

    const result = await query(
      `SELECT * FROM profiles WHERE ${field} = @identifier`,
      { identifier: emailOrPhone }
    );

    if (result.recordset.length === 0) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const profile = result.recordset[0];

    const passwordMatch = await bcrypt.compare(password, profile.password_hash);
    if (!passwordMatch) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Update last login
    await query(
      'UPDATE profiles SET last_login_at = GETUTCDATE() WHERE id = @id',
      { id: profile.id }
    );

    // Log login activity
    try {
      const userAgent = req.headers['user-agent'] || '';
      const deviceType = /Mobile|Android|iPhone|iPad/.test(userAgent) ? 'mobile' : 'desktop';
      await query(`
        INSERT INTO login_logs (id, user_id, email, phone, name, account_type, login_time, user_agent, device_type, login_method)
        VALUES (@id, @user_id, @email, @phone, @name, @account_type, GETUTCDATE(), @user_agent, @device_type, @login_method)
      `, {
        id: uuidv4(),
        user_id: profile.id,
        email: profile.email,
        phone: profile.phone,
        name: profile.name,
        account_type: profile.role,
        user_agent: userAgent,
        device_type: deviceType,
        login_method: isEmail ? 'email' : 'phone',
      });
    } catch (logErr) {
      console.error('Login log error (non-fatal):', logErr);
    }

    const token = jwt.sign(
      {
        id: profile.id,
        email: profile.email,
        phone: profile.phone,
        name: profile.name,
        role: profile.role,
        account_type: profile.account_type,
        subscription_plan: profile.subscription_plan,
      },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
    );

    // Return full profile (mirrors old Supabase shape)
    const { password_hash, ...safeProfile } = profile;
    res.json({ token, user: safeProfile });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Login failed' });
  }
});

// GET /auth/me - get current user profile (replaces supabase.auth.getSession)
router.get('/me', authenticate, async (req, res) => {
  try {
    const result = await query(
      'SELECT * FROM profiles WHERE id = @id',
      { id: req.user.id }
    );
    if (result.recordset.length === 0) {
      return res.status(404).json({ error: 'Profile not found' });
    }
    const { password_hash, ...safeProfile } = result.recordset[0];
    res.json({ user: safeProfile });
  } catch (err) {
    console.error('Get me error:', err);
    res.status(500).json({ error: 'Failed to fetch profile' });
  }
});

// POST /auth/logout - client-side JWT logout (just signal server for logging)
router.post('/logout', authenticate, async (req, res) => {
  // JWT is stateless — actual logout is handled on frontend by deleting the token
  // Optionally log the logout event here
  res.json({ success: true });
});

// POST /auth/forgot-password
router.post('/forgot-password', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email is required' });

  try {
    const result = await query('SELECT id FROM profiles WHERE email = @email', { email });

    // Always return 200 — don't reveal if email exists
    if (result.recordset.length === 0) {
      return res.json({ message: 'If an account exists, a reset email has been sent' });
    }

    const userId = result.recordset[0].id;
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    await query(`
      INSERT INTO password_reset_tokens (token, user_id, expires_at, used, created_at)
      VALUES (@token, @user_id, @expires_at, 0, GETUTCDATE())
    `, { token, user_id: userId, expires_at: expiresAt });

    const frontendUrl = (process.env.FRONTEND_URL || '').replace(/\/$/, '');
    const resetLink = `${frontendUrl}/#/reset-password?token=${token}`;

    await sendEmail({
      to: email,
      subject: 'Reset your KUKI password',
      text: `You requested a password reset. Click the link below to reset your password:\n\n${resetLink}\n\nThis link expires in 1 hour. If you did not request this, ignore this email.`,
      html: `
        <h2>Reset your KUKI password</h2>
        <p>You requested a password reset. Click the button below to reset your password:</p>
        <a href="${resetLink}" style="display:inline-block;padding:12px 24px;background:#4F46E5;color:#fff;border-radius:6px;text-decoration:none;font-weight:bold;">Reset Password</a>
        <p style="margin-top:16px;color:#666;">This link expires in 1 hour. If you did not request this, ignore this email.</p>
      `,
    });

    res.json({ message: 'If an account exists, a reset email has been sent' });
  } catch (err) {
    console.error('Forgot password error:', err.message);
    res.status(500).json({ error: err.message || 'Failed to process request' });
  }
});

// POST /auth/reset-password
router.post('/reset-password', async (req, res) => {
  const { token, new_password } = req.body;
  if (!token || !new_password) return res.status(400).json({ error: 'Token and new_password are required' });

  try {
    const result = await query(
      `SELECT * FROM password_reset_tokens WHERE token = @token AND used = 0 AND expires_at > GETUTCDATE()`,
      { token }
    );

    if (!result.recordset.length) {
      return res.status(400).json({ error: 'Invalid or expired reset token' });
    }

    const { user_id } = result.recordset[0];
    const hashedPassword = await bcrypt.hash(new_password, 12);

    await query('UPDATE profiles SET password_hash = @hash WHERE id = @id', { hash: hashedPassword, id: user_id });
    await query('UPDATE password_reset_tokens SET used = 1 WHERE token = @token', { token });

    res.json({ message: 'Password reset successful' });
  } catch (err) {
    console.error('Reset password error:', err.message);
    res.status(500).json({ error: 'Failed to reset password' });
  }
});

module.exports = router;