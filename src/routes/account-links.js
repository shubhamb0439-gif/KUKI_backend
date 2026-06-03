const express = require('express');
const { query } = require('../db');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

// GET /account-links/my-links
router.get('/my-links', authenticate, async (req, res) => {
  try {
    const result = await query(`
      SELECT
        al.id, al.primary_account_id, al.linked_account_id,
        al.status, al.access_type, al.shares_subscription, al.expires_at,
        al.created_at,
        -- Primary account info
        pp.name              AS primary_name,
        pp.profile_photo     AS primary_photo,
        pp.subscription_plan AS primary_subscription_plan,
        -- Linked account info
        lp.name              AS linked_name,
        lp.profile_photo     AS linked_photo,
        lp.subscription_plan AS linked_subscription_plan
      FROM account_links al
      LEFT JOIN profiles pp ON al.primary_account_id = pp.id
      LEFT JOIN profiles lp ON al.linked_account_id  = lp.id
      WHERE al.status = 'active'
        AND (al.primary_account_id = @uid OR al.linked_account_id = @uid)
      ORDER BY al.created_at DESC
    `, { uid: req.user.id });

    res.json(result.recordset);
  } catch (err) {
    console.error('Get account links error:', err);
    res.status(500).json({ error: 'Failed to fetch account links' });
  }
});

module.exports = router;
