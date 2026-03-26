const { query, get, run, transaction } = require('../config/database');
const { v4: uuidv4 } = require('uuid');

class Member {
    /**
     * Create a new member
     * @param {Object} memberData - Member data
     * @returns {Promise<Object>} Created member
     */
    static async create(memberData) {
        const id = uuidv4();
        const now = new Date().toISOString();
        const renewalDate = new Date();
        renewalDate.setFullYear(renewalDate.getFullYear() + 1);
        
        const {
            full_name,
            email,
            date_of_birth,
            phone,
            status = 'pending',
            membership_status = 'inactive',
            payment_method,
            notes
        } = memberData;

        await run(
            `INSERT INTO members (
                id, full_name, email, date_of_birth, phone, 
                status, membership_status, joined_date, renewal_date,
                payment_method, notes, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, date('now'), ?, ?, ?, ?, ?)`,
            [
                id, full_name, email, date_of_birth, phone,
                status, membership_status, renewalDate.toISOString().split('T')[0],
                payment_method, notes, now, now
            ]
        );

        return this.findById(id);
    }

    /**
     * Find member by ID
     * @param {string} id - Member UUID
     * @returns {Promise<Object>} Member object
     */
    static async findById(id) {
        const member = await get('SELECT * FROM members WHERE id = ?', [id]);
        return member;
    }

    /**
     * Find member by email
     * @param {string} email - Member email
     * @returns {Promise<Object>} Member object
     */
    static async findByEmail(email) {
        const member = await get('SELECT * FROM members WHERE email = ?', [email]);
        return member;
    }

    /**
     * Get all members with optional filters
     * @param {Object} filters - Search filters
     * @returns {Promise<Array>} Array of members
     */
    static async findAll(filters = {}) {
        let sql = 'SELECT * FROM members WHERE 1=1';
        const params = [];

        if (filters.status) {
            sql += ' AND status = ?';
            params.push(filters.status);
        }

        if (filters.membership_status) {
            sql += ' AND membership_status = ?';
            params.push(filters.membership_status);
        }

        if (filters.search) {
            sql += ' AND (full_name LIKE ? OR email LIKE ?)';
            params.push(`%${filters.search}%`, `%${filters.search}%`);
        }

        if (filters.renewal_soon) {
            sql += ` AND renewal_date BETWEEN date('now') AND date('now', '+14 days')`;
        }

        if (filters.expired) {
            sql += ` AND renewal_date < date('now') AND status = 'active'`;
        }

        sql += ' ORDER BY created_at DESC';
        
        if (filters.limit) {
            sql += ' LIMIT ?';
            params.push(parseInt(filters.limit));
        }

        const result = await query(sql, params);
        return result.rows;
    }

    /**
     * Update member
     * @param {string} id - Member UUID
     * @param {Object} updates - Fields to update
     * @returns {Promise<Object>} Updated member
     */
    static async update(id, updates) {
        const fields = [];
        const params = [];

        Object.entries(updates).forEach(([key, value]) => {
            if (value !== undefined && key !== 'id') {
                fields.push(`${key} = ?`);
                params.push(value);
            }
        });

        if (fields.length === 0) {
            return null;
        }

        params.push(id);
        await run(
            `UPDATE members SET ${fields.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
            params
        );

        return this.findById(id);
    }

    /**
     * Delete member
     * @param {string} id - Member UUID
     * @returns {Promise<boolean>} True if deleted
     */
    static async delete(id) {
        const result = await run('DELETE FROM members WHERE id = ?', [id]);
        return result.changes > 0;
    }

    /**
     * Get member with related data (payments, submissions)
     * @param {string} id - Member UUID
     * @returns {Promise<Object>} Member with relations
     */
    static async getWithRelations(id) {
        const member = await this.findById(id);
        if (!member) return null;

        // Get payments
        const payments = await query(
            'SELECT * FROM payments WHERE member_id = ? ORDER BY payment_date DESC',
            [id]
        );

        // Get submissions
        const submissions = await query(
            'SELECT * FROM submissions WHERE member_id = ? ORDER BY created_at DESC',
            [id]
        );

        // Get renewals
        const renewals = await query(
            'SELECT * FROM renewals WHERE member_id = ? ORDER BY renewal_date DESC',
            [id]
        );

        return {
            ...member,
            payments: payments.rows,
            submissions: submissions.rows,
            renewals: renewals.rows
        };
    }

    /**
     * Activate member membership
     * @param {string} id - Member UUID
     * @returns {Promise<Object>} Updated member
     */
    static async activateMembership(id) {
        const renewalDate = new Date();
        renewalDate.setFullYear(renewalDate.getFullYear() + 1);

        return this.update(id, {
            status: 'active',
            membership_status: 'active',
            renewal_date: renewalDate.toISOString().split('T')[0]
        });
    }

    /**
     * Deactivate member membership
     * @param {string} id - Member UUID
     * @returns {Promise<Object>} Updated member
     */
    static async deactivateMembership(id) {
        return this.update(id, {
            membership_status: 'inactive',
            status: 'inactive'
        });
    }

    /**
     * Get members due for renewal
     * @param {number} days - Days ahead to check
     * @returns {Promise<Array>} Members due for renewal
     */
    static async getDueForRenewal(days = 14) {
        const result = await query(
            `SELECT m.*, 
                julianday(m.renewal_date) - julianday('now') as days_left
             FROM members m
             WHERE m.status = 'active'
                AND m.renewal_date BETWEEN date('now') AND date('now', ?)
                AND (m.last_notice_sent IS NULL 
                     OR m.last_notice_sent < date('now', '-7 days'))
             ORDER BY m.renewal_date ASC`,
            [`+${days} days`]
        );

        return result.rows;
    }

    /**
     * Mark renewal notice as sent
     * @param {string} id - Member UUID
     * @returns {Promise<void>}
     */
    static async markNoticeSent(id) {
        await run(
            'UPDATE members SET last_notice_sent = date("now") WHERE id = ?',
            [id]
        );
    }

    /**
     * Get member statistics
     * @returns {Promise<Object>} Member statistics
     */
    static async getStats() {
        const stats = {};

        // Total members
        const total = await get('SELECT COUNT(*) as count FROM members');
        stats.total = total.count;

        // Active members
        const active = await get("SELECT COUNT(*) as count FROM members WHERE status = 'active'");
        stats.active = active.count;

        // Pending members
        const pending = await get("SELECT COUNT(*) as count FROM members WHERE status = 'pending'");
        stats.pending = pending.count;

        // Expired members
        const expired = await get(
            "SELECT COUNT(*) as count FROM members WHERE renewal_date < date('now') AND status = 'active'"
        );
        stats.expired = expired.count;

        // New this month
        const newThisMonth = await get(
            "SELECT COUNT(*) as count FROM members WHERE strftime('%Y-%m', joined_date) = strftime('%Y-%m', 'now')"
        );
        stats.new_this_month = newThisMonth.count;

        return stats;
    }
}

module.exports = Member;