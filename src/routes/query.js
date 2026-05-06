const express = require('express');
const { query, sql } = require('../db');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

// Allowed tables (whitelist for security)
const ALLOWED_TABLES = [
  'profiles', 'employees', 'attendance', 'wages', 'employee_wages',
  'employee_loans', 'employee_bonuses', 'statements', 'job_roles',
  'job_postings', 'job_applications', 'messages', 'advertisements',
  'ad_impressions', 'subscription_transactions', 'login_logs',
  'otp_verifications', 'salary_adjustments', 'contract_payments',
  'qr_transactions', 'performance_ratings', 'employer_ratings',
  'friend_requests', 'account_links', 'payment_requests',
  'plan_change_requests'
];

function sanitizeTable(table) {
  if (!ALLOWED_TABLES.includes(table)) {
    throw new Error(`Table '${table}' is not allowed`);
  }
  return `[${table}]`;
}

// GET /query/:table - generic select with filters
router.get('/:table', authenticate, async (req, res) => {
  try {
    const table = sanitizeTable(req.params.table);
    const params = {};
    let conditions = [];
    let paramIndex = 0;

    // Parse filters
    Object.entries(req.query).forEach(([key, value]) => {
      if (key.startsWith('filter_')) {
        const col = key.replace('filter_', '');
        const paramName = `p${paramIndex++}`;
        conditions.push(`[${col}] = @${paramName}`);
        params[paramName] = value;
      } else if (key.startsWith('gte_')) {
        const col = key.replace('gte_', '');
        const paramName = `p${paramIndex++}`;
        conditions.push(`[${col}] >= @${paramName}`);
        params[paramName] = value;
      } else if (key.startsWith('lte_')) {
        const col = key.replace('lte_', '');
        const paramName = `p${paramIndex++}`;
        conditions.push(`[${col}] <= @${paramName}`);
        params[paramName] = value;
      } else if (key.startsWith('neq_')) {
        const col = key.replace('neq_', '');
        const paramName = `p${paramIndex++}`;
        conditions.push(`[${col}] != @${paramName}`);
        params[paramName] = value;
      } else if (key.startsWith('ilike_')) {
        const col = key.replace('ilike_', '');
        const paramName = `p${paramIndex++}`;
        conditions.push(`[${col}] LIKE @${paramName}`);
        params[paramName] = value.replace(/%/g, '%');
      } else if (key.startsWith('in_')) {
        const col = key.replace('in_', '');
        const vals = String(value).split(',');
        const inParams = vals.map((v, i) => {
          const pn = `p${paramIndex++}`;
          params[pn] = v;
          return `@${pn}`;
        });
        conditions.push(`[${col}] IN (${inParams.join(',')})`);
      }
    });

    // Build select
    let selectCols = '*';
    if (req.query.select && req.query.select !== '*') {
      // Handle basic column selection (ignore relation syntax like profiles!fkey(name))
      selectCols = req.query.select
        .replace(/\s+/g, '')
        .split(',')
        .map(c => {
          // Skip relation syntax
          if (c.includes('(') || c.includes('!')) return null;
          return `[${c}]`;
        })
        .filter(Boolean)
        .join(', ') || '*';
    }

    // Handle count-only (head) queries
    if (req.query.head === 'true') {
      let countQuery = `SELECT COUNT(*) AS count FROM ${table}`;
      if (conditions.length > 0) countQuery += ` WHERE ${conditions.join(' AND ')}`;
      const result = await query(countQuery, params);
      return res.json({ data: null, count: result.recordset[0].count });
    }

    let q = `SELECT ${selectCols} FROM ${table}`;
    if (conditions.length > 0) q += ` WHERE ${conditions.join(' AND ')}`;

    // Order
    if (req.query.order) {
      const [col, dir] = req.query.order.split('.');
      q += ` ORDER BY [${col}] ${dir === 'desc' ? 'DESC' : 'ASC'}`;
    }

    // Limit
    if (req.query.limit) {
      if (!req.query.order) q += ' ORDER BY created_at DESC';
      q += ` OFFSET 0 ROWS FETCH NEXT ${parseInt(req.query.limit)} ROWS ONLY`;
    }

    const result = await query(q, params);
    let data = result.recordset;
    const count = data.length;

    if (req.query.single === 'true') {
      data = data[0] || null;
    }

    res.json({ data, count });
  } catch (err) {
    console.error('Query error:', err);
    res.status(500).json({ error: err.message || 'Query failed' });
  }
});

// POST /query/:table - insert
router.post('/:table', authenticate, async (req, res) => {
  try {
    const table = sanitizeTable(req.params.table);
    const { data: insertData } = req.body;
    if (!insertData) return res.status(400).json({ error: 'No data provided' });

    const row = Array.isArray(insertData) ? insertData[0] : insertData;
    const cols = Object.keys(row);
    const paramNames = cols.map((_, i) => `@p${i}`);
    const params = {};
    cols.forEach((col, i) => { params[`p${i}`] = row[col]; });

    const q = `INSERT INTO ${table} (${cols.map(c => `[${c}]`).join(', ')}) VALUES (${paramNames.join(', ')})`;
    await query(q, params);

    res.status(201).json({ data: row, error: null });
  } catch (err) {
    console.error('Insert error:', err);
    res.status(500).json({ error: err.message || 'Insert failed' });
  }
});

// PUT /query/:table - update
router.put('/:table', authenticate, async (req, res) => {
  try {
    const table = sanitizeTable(req.params.table);
    const { data: updateData, filters, upsert } = req.body;
    if (!updateData) return res.status(400).json({ error: 'No data provided' });

    const row = Array.isArray(updateData) ? updateData[0] : updateData;
    const setClauses = [];
    const params = {};
    let paramIndex = 0;

    Object.entries(row).forEach(([col, value]) => {
      const pn = `p${paramIndex++}`;
      setClauses.push(`[${col}] = @${pn}`);
      params[pn] = value;
    });

    const conditions = [];
    if (filters) {
      Object.entries(filters).forEach(([col, value]) => {
        const pn = `p${paramIndex++}`;
        conditions.push(`[${col}] = @${pn}`);
        params[pn] = value;
      });
    }

    let q;
    if (upsert) {
      // Simple upsert: try update, if no rows affected, insert
      q = `UPDATE ${table} SET ${setClauses.join(', ')}`;
      if (conditions.length > 0) q += ` WHERE ${conditions.join(' AND ')}`;
      const result = await query(q, params);
      if (result.rowsAffected[0] === 0) {
        const allData = { ...row, ...filters };
        const cols = Object.keys(allData);
        const insertParams = {};
        cols.forEach((col, i) => { insertParams[`ip${i}`] = allData[col]; });
        const iq = `INSERT INTO ${table} (${cols.map(c => `[${c}]`).join(', ')}) VALUES (${cols.map((_, i) => `@ip${i}`).join(', ')})`;
        await query(iq, insertParams);
      }
    } else {
      q = `UPDATE ${table} SET ${setClauses.join(', ')}`;
      if (conditions.length > 0) q += ` WHERE ${conditions.join(' AND ')}`;
      await query(q, params);
    }

    res.json({ data: row, error: null });
  } catch (err) {
    console.error('Update error:', err);
    res.status(500).json({ error: err.message || 'Update failed' });
  }
});

// DELETE /query/:table - delete
router.delete('/:table', authenticate, async (req, res) => {
  try {
    const table = sanitizeTable(req.params.table);
    const { filters } = req.body;
    if (!filters || Object.keys(filters).length === 0) {
      return res.status(400).json({ error: 'Delete requires filters' });
    }

    const conditions = [];
    const params = {};
    let i = 0;
    Object.entries(filters).forEach(([col, value]) => {
      const pn = `p${i++}`;
      conditions.push(`[${col}] = @${pn}`);
      params[pn] = value;
    });

    await query(`DELETE FROM ${table} WHERE ${conditions.join(' AND ')}`, params);
    res.json({ data: null, error: null });
  } catch (err) {
    console.error('Delete error:', err);
    res.status(500).json({ error: err.message || 'Delete failed' });
  }
});

module.exports = router;
