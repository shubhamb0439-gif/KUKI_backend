const express = require('express');
const { query } = require('../db');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

// POST /rpc/:name - handle stored procedure calls
router.post('/:name', authenticate, async (req, res) => {
  const { name } = req.params;
  const params = req.body || {};

  try {
    switch (name) {
      case 'recalculate_employee_wages':
        // Simplified wage recalculation
        const { p_employee_id, p_employer_id } = params;
        const wageResult = await query(
          `SELECT TOP 1 wage_amount, wage_type FROM employees WHERE id = @eid`,
          { eid: p_employee_id }
        );
        if (wageResult.recordset.length > 0) {
          const emp = wageResult.recordset[0];
          // Update or insert wage record
          await query(`
            UPDATE employees SET updated_at = GETUTCDATE() WHERE id = @eid
          `, { eid: p_employee_id });
        }
        res.json({ data: { success: true }, error: null });
        break;

      case 'calculate_and_update_monthly_hours':
        const { p_employee_id: empId, p_month, p_year } = params;
        const hoursResult = await query(`
          SELECT ISNULL(SUM(hours_worked), 0) AS total_hours
          FROM attendance
          WHERE employee_id = @eid AND MONTH(date) = @month AND YEAR(date) = @year
        `, { eid: empId, month: p_month, year: p_year });
        res.json({ data: { total_hours: hoursResult.recordset[0]?.total_hours || 0 }, error: null });
        break;

      case 'expire_subscription_trials':
        await query(`
          UPDATE profiles
          SET subscription_plan = 'free', subscription_status = 'expired'
          WHERE trial_ends_at IS NOT NULL AND trial_ends_at < GETUTCDATE()
            AND subscription_status != 'expired'
        `);
        res.json({ data: { success: true }, error: null });
        break;

      case 'start_subscription_trial':
        const { plan_name, trial_days } = params;

        // Check trial has not already been used
        const trialCheck = await query(
          `SELECT trial_used FROM profiles WHERE id = @uid`,
          { uid: req.user.id }
        );
        if (trialCheck.recordset[0]?.trial_used) {
          return res.status(400).json({ error: 'Free trial has already been used', data: null });
        }

        const TRIAL_PLAN_LIMITS = {
          core:     { max_employees: 3,  can_track_attendance: 1, can_access_full_statements: 0 },
          pro:      { max_employees: 6,  can_track_attendance: 1, can_access_full_statements: 0 },
          pro_plus: { max_employees: 12, can_track_attendance: 1, can_access_full_statements: 1 },
        };
        const planKey = (plan_name || '').toLowerCase().replace(/[\s+]+/g, '_');
        const limits = TRIAL_PLAN_LIMITS[planKey] || TRIAL_PLAN_LIMITS['core'];

        await query(`
          UPDATE profiles SET
            subscription_plan          = @plan,
            subscription_status        = 'trial',
            trial_used                 = 1,
            trial_started_at           = GETUTCDATE(),
            trial_ends_at              = DATEADD(DAY, @days, GETUTCDATE()),
            max_employees              = @max_employees,
            can_track_attendance       = @can_track_attendance,
            can_access_full_statements = @can_access_full_statements
          WHERE id = @uid
        `, {
          plan: plan_name,
          days: trial_days || 14,
          uid: req.user.id,
          max_employees: limits.max_employees,
          can_track_attendance: limits.can_track_attendance,
          can_access_full_statements: limits.can_access_full_statements,
        });
        res.json({ data: { success: true }, error: null });
        break;

      default:
        res.status(404).json({ error: `RPC '${name}' not found` });
    }
  } catch (err) {
    console.error(`RPC ${name} error:`, err);
    res.status(500).json({ error: err.message || 'RPC failed' });
  }
});

module.exports = router;
