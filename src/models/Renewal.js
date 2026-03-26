const { query, get, run, transaction } = require('../config/database');
const { v4: uuidv4 } = require('uuid');

class Renewal {
    /**
     * Create a new renewal record
     * @param {Object} renewalData - Renewal data
     * @returns {Promise<Object>} Created renewal
     */
    static async create(renewalData) {
        const id = uuidv4();
        const {
            member_id,
            renewal_date,
            status = 'pending'
        } = renewalData;

        await run(
            `INSERT INTO renewals (id, member_id, renewal_date, status, created_at, updated_at)
             VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
            [id, member_id, renewal_date, status]
        );

        return this.findById(id);
    }

    /**
     * Find renewal by ID
     * @param {string} id - Renewal UUID
     * @returns {Promise<Object>} Renewal object
     */
    static async findById(id) {
        const renewal = await get(
            `SELECT r.*, m.full_name, m.email, m.status as member_status
             FROM renewals r
             JOIN members m ON r.member_id = m.id
             WHERE r.id = ?`,
            [id]
        );
        return renewal;
    }

    /**
     * Get all renewals with optional filters
     * @param {Object} filters - Search filters
     * @returns {Promise<Array>} Array of renewals
     */
    static async findAll(filters = {}) {
        let sql = `
            SELECT r.*, m.full_name, m.email, m.status as member_status
            FROM renewals r
            JOIN members m ON r.member_id = m.id
            WHERE 1=1
        `;
        const params = [];

        if (filters.status) {
            sql += ' AND r.status = ?';
            params.push(filters.status);
        }

        if (filters.member_id) {
            sql += ' AND r.member_id = ?';
            params.push(filters.member_id);
        }

        if (filters.upcoming) {
            sql += ` AND r.renewal_date BETWEEN date('now') AND date('now', '+30 days')`;
        }

        sql += ' ORDER BY r.renewal_date ASC';
        
        if (filters.limit) {
            sql += ' LIMIT ?';
            params.push(parseInt(filters.limit));
        }

        const result = await query(sql, params);
        return result.rows;
    }

    /**
     * Get upcoming renewals
     * @param {number} days - Days ahead to check
     * @returns {Promise<Array>} Upcoming renewals
     */
    static async getUpcoming(days = 30) {
        const result = await query(
            `SELECT r.*, m.full_name, m.email, m.phone,
                julianday(r.renewal_date) - julianday('now') as days_left
             FROM renewals r
             JOIN members m ON r.member_id = m.id
             WHERE r.renewal_date BETWEEN date('now') AND date('now', ?)
                AND r.status = 'pending'
             ORDER BY r.renewal_date ASC`,
            [`+${days} days`]
        );

        return result.rows;
    }

    /**
     * Get renewals due for notice
     * @param {number} noticeDays - Days before renewal to send notice
     * @returns {Promise<Array>} Renewals needing notice
     */
    static async getDueForNotice(noticeDays = 14) {
        const result = await query(
            `SELECT r.*, m.full_name, m.email, m.phone
             FROM renewals r
             JOIN members m ON r.member_id = m.id
             WHERE r.renewal_date = date('now', ?)
                AND (r.notice_sent_date IS NULL OR r.notice_sent_count < 2)
                AND r.status = 'pending'
             ORDER BY r.renewal_date ASC`,
            [`+${noticeDays} days`]
        );

        return result.rows;
    }

    /**
     * Mark notice as sent
     * @param {string} id - Renewal UUID
     * @returns {Promise<void>}
     */
    static async markNoticeSent(id) {
        await run(
            `UPDATE renewals 
             SET notice_sent_date = date('now'), 
                 notice_sent_count = notice_sent_count + 1,
                 updated_at = CURRENT_TIMESTAMP
             WHERE id = ?`,
            [id]
        );
    }

    /**
     * Process a renewal (mark as processed)
     * @param {string} id - Renewal UUID
     * @returns {Promise<Object>} Updated renewal
     */
    static async process(id) {
        await run(
            `UPDATE renewals 
             SET status = 'processed', 
                 processed_at = CURRENT_TIMESTAMP,
                 updated_at = CURRENT_TIMESTAMP
             WHERE id = ?`,
            [id]
        );

        return this.findById(id);
    }

    /**
     * Get renewal statistics
     * @returns {Promise<Object>} Renewal statistics
     */
    static async getStats() {
        const stats = {};

        // Upcoming renewals (next 14 days)
        const upcoming14 = await get(
            `SELECT COUNT(*) as count 
             FROM renewals 
             WHERE renewal_date BETWEEN date('now') AND date('now', '+14 days')
                AND status = 'pending'`
        );
        stats.upcoming_14_days = upcoming14.count;

        // Upcoming renewals (next 30 days)
        const upcoming30 = await get(
            `SELECT COUNT(*) as count 
             FROM renewals 
             WHERE renewal_date BETWEEN date('now') AND date('now', '+30 days')
                AND status = 'pending'`
        );
        stats.upcoming_30_days = upcoming30.count;

        // Overdue renewals
        const overdue = await get(
            `SELECT COUNT(*) as count 
             FROM renewals 
             WHERE renewal_date < date('now') AND status = 'pending'`
        );
        stats.overdue = overdue.count;

        // Notices sent today
        const noticesToday = await get(
            `SELECT COUNT(*) as count 
             FROM renewals 
             WHERE notice_sent_date = date('now')`
        );
        stats.notices_sent_today = noticesToday.count;

        return stats;
    }

    /**
     * Get member's renewal history
     * @param {string} memberId - Member UUID
     * @returns {Promise<Array>} Member's renewal history
     */
    static async getByMember(memberId) {
        const result = await query(
            'SELECT * FROM renewals WHERE member_id = ? ORDER BY renewal_date DESC',
            [memberId]
        );
        return result.rows;
    }
}

module.exports = Renewal;