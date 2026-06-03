const { query } = require('../db');

async function resolveViewAs(req, viewAs, requireWrite = false) {
  if (!viewAs) return { effectiveId: req.user.id };

  const result = await query(`
    SELECT access_type FROM account_links
    WHERE primary_account_id = @primary
      AND linked_account_id  = @linked
      AND status = 'active'
      AND (expires_at IS NULL OR expires_at > GETUTCDATE())
  `, { primary: viewAs, linked: req.user.id });

  if (!result.recordset.length) {
    return { error: { status: 403, message: 'No active link to this account' } };
  }

  if (requireWrite && result.recordset[0].access_type === 'read_only') {
    return { error: { status: 403, message: 'You have read-only access to this account' } };
  }

  return { effectiveId: viewAs };
}

module.exports = { resolveViewAs };
