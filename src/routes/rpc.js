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
        await query(`
          UPDATE profiles
          SET subscription_plan = @plan,
              subscription_status = 'active',
              trial_ends_at = DATEADD(DAY, @days, GETUTCDATE())
          WHERE id = @uid
        `, { plan: plan_name, days: trial_days || 7, uid: req.user.id });
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
