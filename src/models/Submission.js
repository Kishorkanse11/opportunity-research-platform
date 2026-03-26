const { query, get, run } = require('../config/database');
const { v4: uuidv4 } = require('uuid');
const Member = require('./Member');

class Submission {
    /**
     * Create a new submission (EOI)
     * @param {Object} submissionData - Submission data
     * @returns {Promise<Object>} Created submission
     */
    static async create(submissionData) {
        const id = uuidv4();
        const now = new Date().toISOString();

        const {
            member_id,
            full_name,
            email,
            date_of_birth,
            property_profile,
            options_explored,
            property_count,
            total_mortgage,
            total_valuation,
            completion_date
        } = submissionData;

        // Calculate LVR
        const lvr = total_valuation > 0 ? (total_mortgage / total_valuation) * 100 : null;

        await run(
            `INSERT INTO submissions (
                id, member_id, full_name, email, date_of_birth,
                property_profile, options_explored, property_count,
                total_mortgage, total_valuation, lvr, completion_date,
                status, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending_review', ?)`,
            [
                id, member_id, full_name, email, date_of_birth,
                property_profile, options_explored, property_count,
                total_mortgage, total_valuation, lvr, completion_date, now
            ]
        );

        return this.findById(id);
    }

    /**
     * Find submission by ID
     * @param {string} id - Submission UUID
     * @returns {Promise<Object>} Submission object
     */
    static async findById(id) {
        const submission = await get(
            `SELECT s.*, m.full_name as member_name, m.email as member_email
             FROM submissions s
             LEFT JOIN members m ON s.member_id = m.id
             WHERE s.id = ?`,
            [id]
        );
        return submission;
    }

    /**
     * Get all submissions with optional filters
     * @param {Object} filters - Search filters
     * @returns {Promise<Array>} Array of submissions
     */
    static async findAll(filters = {}) {
        let sql = `
            SELECT s.*, m.full_name as member_name, m.email as member_email
            FROM submissions s
            LEFT JOIN members m ON s.member_id = m.id
            WHERE 1=1
        `;
        const params = [];

        if (filters.status) {
            sql += ' AND s.status = ?';
            params.push(filters.status);
        }

        if (filters.member_id) {
            sql += ' AND s.member_id = ?';
            params.push(filters.member_id);
        }

        if (filters.search) {
            sql += ' AND (s.full_name LIKE ? OR s.email LIKE ?)';
            params.push(`%${filters.search}%`, `%${filters.search}%`);
        }

        sql += ' ORDER BY s.created_at DESC';
        
        if (filters.limit) {
            sql += ' LIMIT ?';
            params.push(parseInt(filters.limit));
        }

        const result = await query(sql, params);
        return result.rows;
    }

    /**
     * Update submission status (review)
     * @param {string} id - Submission UUID
     * @param {string} status - New status
     * @param {string} reviewedBy - Reviewer name/email
     * @param {string} notes - Review notes
     * @returns {Promise<Object>} Updated submission
     */
    static async review(id, status, reviewedBy, notes = null) {
        await run(
            `UPDATE submissions 
             SET status = ?, reviewed_by = ?, reviewed_at = CURRENT_TIMESTAMP, notes = ?
             WHERE id = ?`,
            [status, reviewedBy, notes, id]
        );

        return this.findById(id);
    }

    /**
     * Get submissions by member
     * @param {string} memberId - Member UUID
     * @returns {Promise<Array>} Member's submissions
     */
    static async getByMember(memberId) {
        const result = await query(
            'SELECT * FROM submissions WHERE member_id = ? ORDER BY created_at DESC',
            [memberId]
        );
        return result.rows;
    }

    /**
     * Get submission statistics
     * @returns {Promise<Object>} Submission statistics
     */
    static async getStats() {
        const stats = {};

        // Total submissions
        const total = await get('SELECT COUNT(*) as count FROM submissions');
        stats.total = total.count;

        // By status
        const pending = await get("SELECT COUNT(*) as count FROM submissions WHERE status = 'pending_review'");
        stats.pending = pending.count;

        const reviewing = await get("SELECT COUNT(*) as count FROM submissions WHERE status = 'reviewing'");
        stats.reviewing = reviewing.count;

        const completed = await get("SELECT COUNT(*) as count FROM submissions WHERE status = 'completed'");
        stats.completed = completed.count;

        const rejected = await get("SELECT COUNT(*) as count FROM submissions WHERE status = 'rejected'");
        stats.rejected = rejected.count;

        // Today's submissions
        const today = await get(
            "SELECT COUNT(*) as count FROM submissions WHERE date(created_at) = date('now')"
        );
        stats.today = today.count;

        // This month's submissions
        const month = await get(
            "SELECT COUNT(*) as count FROM submissions WHERE strftime('%Y-%m', created_at) = strftime('%Y-%m', 'now')"
        );
        stats.this_month = month.count;

        return stats;
    }

    /**
     * Delete submission
     * @param {string} id - Submission UUID
     * @returns {Promise<boolean>} True if deleted
     */
    static async delete(id) {
        const result = await run('DELETE FROM submissions WHERE id = ?', [id]);
        return result.changes > 0;
    }
}

module.exports = Submission;