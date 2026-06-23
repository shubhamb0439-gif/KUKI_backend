const express = require('express');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const { query } = require('../db');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

const PLAN_CONFIG = {
  core:     { amount: 641,  currency: 'KES', max_employees: 3,  can_track_attendance: 1, can_access_full_statements: 0 },
  pro:      { amount: 2584, currency: 'KES', max_employees: 6,  can_track_attendance: 1, can_access_full_statements: 0 },
  pro_plus: { amount: 3879, currency: 'KES', max_employees: 12, can_track_attendance: 1, can_access_full_statements: 1 },
};

function normalizePlan(plan) {
  return (plan || '').toLowerCase().replace(/[\s+]+/g, '_').replace('pro__plus', 'pro_plus');
}

// POST /payments/pesawise/create-link
router.post('/pesawise/create-link', authenticate, async (req, res) => {
  const planKey = normalizePlan(req.body.plan);
  const planConfig = PLAN_CONFIG[planKey];
  if (!planConfig) {
    return res.status(400).json({ error: 'Invalid plan. Must be core, pro, or pro_plus' });
  }

  const merchantId   = process.env.PESAWISE_MERCHANT_ID;
  const callerName   = process.env.PESAWISE_CALLER_NAME;
  const callerPass   = process.env.PESAWISE_CALLER_PASSWORD;
  const paywallBase  = process.env.PESAWISE_PAYWALL_BASE_URL || 'https://payment.pesawise.xyz/pwv4/launch';
  const webhookUrl   = `${(process.env.API_BASE_URL || '').replace(/\/$/, '')}/payments/pesawise/webhook`;
  const returnUrl    = `${(process.env.FRONTEND_URL || 'https://wonderful-coast-0dc3fda00.7.azurestaticapps.net').replace(/\/$/, '')}/#/payment-result`;

  const reference = uuidv4();

  try {
    // Save pending transaction
    await query(`
      INSERT INTO subscription_transactions
        (id, user_id, subscription_plan, amount, currency, status, reference, created_at)
      VALUES
        (@id, @user_id, @plan, @amount, @currency, 'pending', @reference, GETUTCDATE())
    `, {
      id: uuidv4(),
      user_id: req.user.id,
      plan: planKey,
      amount: planConfig.amount,
      currency: planConfig.currency,
      reference,
    });

    // Build Pesawise Paywall v4 signed URL
    // Key: PESAWISE_SECRET_KEY from dashboard (falls back to notification key, then caller password)
    // Signature: HMAC-SHA256 over merchantId|amount|currency|reference (pipe-delimited)
    const secretKey = process.env.PESAWISE_SECRET_KEY
                   || process.env.PESAWISE_NOTIFICATION_SECRET_KEY
                   || callerPass;
    const sigData   = [merchantId, planConfig.amount, planConfig.currency, reference].join('|');
    const sig       = crypto.createHmac('sha256', secretKey).update(sigData).digest('hex');
    console.log('Pesawise sig input:', sigData, '| key starts with:', secretKey?.slice(0, 4));

    const params = new URLSearchParams({
      mid:         merchantId,
      amount:      planConfig.amount,
      currency:    planConfig.currency,
      ref:         reference,
      desc:        `KUKI ${planKey.replace(/_/g, ' ')} plan`,
      returnUrl,
      callbackUrl: webhookUrl,
      sig,
    });

    const paymentUrl = `${paywallBase}?${params.toString()}`;
    console.log('Pesawise paywall URL:', paymentUrl);

    res.json({ payment_url: paymentUrl, reference });
  } catch (err) {
    console.error('Pesawise create-link error:', err);
    res.status(500).json({ error: 'Failed to create payment link' });
  }
});

// POST /payments/pesawise/webhook — called by Pesawise when payment completes
router.post('/pesawise/webhook', async (req, res) => {
  console.log('Pesawise webhook received:', JSON.stringify(req.body));

  try {
    const notifKey  = process.env.PESAWISE_NOTIFICATION_SECRET_KEY;
    const { reference, status, transactionId, signature } = req.body;

    // Verify signature
    const sigData = `${reference}${status}${transactionId || ''}`;
    const expected = crypto.createHmac('sha256', notifKey).update(sigData).digest('hex');
    const received = signature || req.headers['x-pesawise-signature'] || '';

    if (received && received !== expected) {
      console.error('Pesawise webhook: invalid signature');
      return res.status(401).json({ error: 'Invalid signature' });
    }

    // Only process successful payments
    if ((status || '').toUpperCase() !== 'SUCCESS') {
      await query(
        `UPDATE subscription_transactions SET status = 'failed', updated_at = GETUTCDATE() WHERE reference = @ref`,
        { ref: reference }
      );
      return res.json({ received: true });
    }

    // Look up the pending transaction
    const txResult = await query(
      `SELECT * FROM subscription_transactions WHERE reference = @ref`,
      { ref: reference }
    );
    if (!txResult.recordset.length) {
      console.error('Pesawise webhook: no transaction for reference', reference);
      return res.status(404).json({ error: 'Transaction not found' });
    }

    const tx = txResult.recordset[0];
    const planConfig = PLAN_CONFIG[tx.subscription_plan];
    if (!planConfig) {
      return res.status(400).json({ error: 'Unknown plan in transaction' });
    }

    // Upgrade the account — subscription active for 30 days
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 30);

    await query(`
      UPDATE profiles SET
        subscription_plan            = @plan,
        subscription_status          = 'active',
        subscription_expires_at      = @expires_at,
        max_employees                = @max_employees,
        can_track_attendance         = @can_track_attendance,
        can_access_full_statements   = @can_access_full_statements,
        updated_at                   = GETUTCDATE()
      WHERE id = @user_id
    `, {
      plan:                         tx.subscription_plan,
      expires_at:                   expiresAt,
      max_employees:                planConfig.max_employees,
      can_track_attendance:         planConfig.can_track_attendance,
      can_access_full_statements:   planConfig.can_access_full_statements,
      user_id:                      tx.user_id,
    });

    // Mark transaction completed
    await query(`
      UPDATE subscription_transactions SET
        status         = 'completed',
        transaction_id = @tid,
        updated_at     = GETUTCDATE()
      WHERE reference = @ref
    `, { tid: transactionId || null, ref: reference });

    res.json({ received: true });
  } catch (err) {
    console.error('Pesawise webhook error:', err);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});

module.exports = router;
