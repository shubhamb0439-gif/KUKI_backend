const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { query } = require('../db');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

const VALID_RATING_TYPES = ['employer_to_employee', 'employee_to_employer'];

// POST /ratings — upsert a rating, then recalculate average on the rated profile
router.post('/', authenticate, async (req, res) => {
  const { employee_id, employer_id, rating, feedback, rating_date, rating_type } = req.body;

  if (!employee_id || !employer_id || rating === undefined) {
    return res.status(400).json({ error: 'employee_id, employer_id, and rating are required' });
  }
  if (!rating_type || !VALID_RATING_TYPES.includes(rating_type)) {
    return res.status(400).json({ error: `rating_type is required and must be one of: ${VALID_RATING_TYPES.join(', ')}` });
  }

  try {
    const attDate = rating_date || new Date().toISOString().split('T')[0];

    // Upsert key: employee_id + employer_id + rating_type
    const existing = await query(`
      SELECT id FROM performance_ratings
      WHERE employee_id = @emp_id AND employer_id = @eid AND rating_type = @rating_type
    `, { emp_id: employee_id, eid: employer_id, rating_type });

    let recordId;

    if (existing.recordset.length > 0) {
      recordId = existing.recordset[0].id;
      await query(`
        UPDATE performance_ratings SET
          rating      = @rating,
          feedback    = ISNULL(@feedback, feedback),
          rating_date = @rating_date,
          updated_at  = GETUTCDATE()
        WHERE id = @id
      `, { id: recordId, rating, feedback: feedback || null, rating_date: attDate });
    } else {
      recordId = uuidv4();
      await query(`
        INSERT INTO performance_ratings
          (id, employee_id, employer_id, rating, feedback, rating_date, rating_type, created_at)
        VALUES
          (@id, @emp_id, @eid, @rating, @feedback, @rating_date, @rating_type, GETUTCDATE())
      `, { id: recordId, emp_id: employee_id, eid: employer_id, rating, feedback: feedback || null, rating_date: attDate, rating_type });
    }

    // Recalculate and push average to the correct profile
    if (rating_type === 'employer_to_employee') {
      // Average of all employer ratings for this employee → update employee's profile
      const avgResult = await query(`
        SELECT AVG(CAST(rating AS DECIMAL(10,2))) AS avg_rating
        FROM performance_ratings
        WHERE employee_id = @emp_id AND rating_type = 'employer_to_employee'
      `, { emp_id: employee_id });

      const avg = avgResult.recordset[0]?.avg_rating;
      if (avg !== null && avg !== undefined) {
        // employee_id is employees.id — resolve to profiles.id via user_id
        await query(`
          UPDATE profiles SET average_rating = @avg
          WHERE id = (SELECT user_id FROM employees WHERE id = @emp_id)
        `, { avg, emp_id: employee_id });
      }
    } else {
      // employee_to_employer: average of all employee ratings for this employer → update employer's profile
      const avgResult = await query(`
        SELECT AVG(CAST(rating AS DECIMAL(10,2))) AS avg_rating
        FROM performance_ratings
        WHERE employer_id = @eid AND rating_type = 'employee_to_employer'
      `, { eid: employer_id });

      const avg = avgResult.recordset[0]?.avg_rating;
      if (avg !== null && avg !== undefined) {
        // employer_id maps directly to profiles.id
        await query(`
          UPDATE profiles SET average_rating = @avg WHERE id = @eid
        `, { avg, eid: employer_id });
      }
    }

    const record = await query(
      `SELECT * FROM performance_ratings WHERE id = @id`,
      { id: recordId }
    );

    res.json({ message: 'Rating saved successfully', data: record.recordset[0] });
  } catch (err) {
    console.error('Ratings upsert error:', err);
    res.status(500).json({ error: err.message || 'Failed to save rating' });
  }
});

// GET /ratings/employee/:id — get all ratings for an employee
router.get('/employee/:id', authenticate, async (req, res) => {
  try {
    const result = await query(`
      SELECT
        pr.id, pr.employee_id, pr.employer_id,
        pr.rating, pr.feedback, pr.rating_type,
        CONVERT(VARCHAR(10), pr.rating_date, 120) AS rating_date,
        pr.created_at, pr.updated_at,
        p.name AS employer_name
      FROM performance_ratings pr
      LEFT JOIN profiles p ON pr.employer_id = p.id
      WHERE pr.employee_id = @emp_id
      ORDER BY pr.created_at DESC
    `, { emp_id: req.params.id });

    res.json(result.recordset);
  } catch (err) {
    console.error('Get ratings error:', err);
    res.status(500).json({ error: 'Failed to fetch ratings' });
  }
});

module.exports = router;
