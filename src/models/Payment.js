const { query, get, run, transaction } = require('../config/database');
const { v4: uuidv4 } = require('uuid');
const Member = require('./Member');

class Payment {
    /**
     * Create a new payment
     * @param {Object} paymentData - Payment data
     * @returns {Promise<Object>} Created payment
     */
    static async create(paymentData) {
        return await transaction(async () => {
            const id = uuidv4();
            const transactionId = paymentData.transaction_id || `TXN-${Date.now()}`;
            const now = new Date().toISOString();

            const {
                member_id,
                amount,
                currency = 'AUD',
                status = 'pending',
                payment_method,
                stripe_payment_intent_id,
                metadata
            } = paymentData;

            await run(
                `INSERT INTO payments (
                    id, transaction_id, member_id, amount, currency,
                    status, payment_method, stripe_payment_intent_id,
                    metadata, payment_date, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    id, transactionId, member_id, amount, currency,
                    status, payment_method, stripe_payment_intent_id,
                    metadata ? JSON.stringify(metadata) : null,
                    now, now
                ]
            );

            // If payment is completed, activate member
            if (status === 'completed') {
                await Member.activateMembership(member_id);
                
                // Create renewal record
                const renewalDate = new Date();
                renewalDate.setFullYear(renewalDate.getFullYear() + 1);
                
                await run(
                    `INSERT INTO renewals (id, member_id, renewal_date, status)
                     VALUES (?, ?, ?, 'pending')`,
                    [uuidv4(), member_id, renewalDate.toISOString().split('T')[0]]
                );
            }

            return this.findById(id);
        });
    }

    /**
     * Find payment by ID
     * @param {string} id - Payment UUID
     * @returns {Promise<Object>} Payment object
     */
    static async findById(id) {
        const payment = await get(
            `SELECT p.*, m.full_name as member_name, m.email as member_email
             FROM payments p
             JOIN members m ON p.member_id = m.id
             WHERE p.id = ?`,
            [id]
        );
        return payment;
    }

    /**
     * Find payment by transaction ID
     * @param {string} transactionId - Transaction ID
     * @returns {Promise<Object>} Payment object
     */
    static async findByTransactionId(transactionId) {
        const payment = await get(
            `SELECT p.*, m.full_name as member_name
             FROM payments p
             JOIN members m ON p.member_id = m.id
             WHERE p.transaction_id = ?`,
            [transactionId]
        );
        return payment;
    }

    /**
     * Find payment by Stripe payment intent ID
     * @param {string} intentId - Stripe payment intent ID
     * @returns {Promise<Object>} Payment object
     */
    static async findByStripeIntentId(intentId) {
        const payment = await get(
            'SELECT * FROM payments WHERE stripe_payment_intent_id = ?',
            [intentId]
        );
        return payment;
    }

    /**
     * Get all payments with optional filters
     * @param {Object} filters - Search filters
     * @returns {Promise<Array>} Array of payments
     */
    static async findAll(filters = {}) {
        let sql = `
            SELECT p.*, m.full_name as member_name, m.email as member_email
            FROM payments p
            JOIN members m ON p.member_id = m.id
            WHERE 1=1
        `;
        const params = [];

        if (filters.status) {
            sql += ' AND p.status = ?';
            params.push(filters.status);
        }

        if (filters.member_id) {
            sql += ' AND p.member_id = ?';
            params.push(filters.member_id);
        }

        if (filters.payment_method) {
            sql += ' AND p.payment_method = ?';
            params.push(filters.payment_method);
        }

        if (filters.start_date) {
            sql += ' AND date(p.payment_date) >= ?';
            params.push(filters.start_date);
        }

        if (filters.end_date) {
            sql += ' AND date(p.payment_date) <= ?';
            params.push(filters.end_date);
        }

        sql += ' ORDER BY p.payment_date DESC';
        
        if (filters.limit) {
            sql += ' LIMIT ?';
            params.push(parseInt(filters.limit));
        }

        const result = await query(sql, params);
        return result.rows;
    }

    /**
     * Update payment status
     * @param {string} id - Payment UUID
     * @param {string} status - New status
     * @returns {Promise<Object>} Updated payment
     */
    static async updateStatus(id, status) {
        await run(
            'UPDATE payments SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
            [status, id]
        );
        return this.findById(id);
    }

    /**
     * Mark receipt as sent
     * @param {string} id - Payment UUID
     * @returns {Promise<void>}
     */
    static async markReceiptSent(id) {
        await run(
            'UPDATE payments SET receipt_sent = 1 WHERE id = ?',
            [id]
        );
    }

    /**
     * Get payments by member
     * @param {string} memberId - Member UUID
     * @returns {Promise<Array>} Member's payments
     */
    static async getByMember(memberId) {
        const result = await query(
            'SELECT * FROM payments WHERE member_id = ? ORDER BY payment_date DESC',
            [memberId]
        );
        return result.rows;
    }

    /**
     * Get payment statistics
     * @returns {Promise<Object>} Payment statistics
     */
    static async getStats() {
        const stats = {};

        // Today's revenue
        const today = await get(
            `SELECT COALESCE(SUM(amount), 0) as total
             FROM payments
             WHERE date(payment_date) = date('now') AND status = 'completed'`
        );
        stats.today_revenue = today.total;

        // This month's revenue
        const month = await get(
            `SELECT COALESCE(SUM(amount), 0) as total
             FROM payments
             WHERE strftime('%Y-%m', payment_date) = strftime('%Y-%m', 'now')
             AND status = 'completed'`
        );
        stats.monthly_revenue = month.total;

        // This year's revenue
        const year = await get(
            `SELECT COALESCE(SUM(amount), 0) as total
             FROM payments
             WHERE strftime('%Y', payment_date) = strftime('%Y', 'now')
             AND status = 'completed'`
        );
        stats.yearly_revenue = year.total;

        // Pending payments
        const pending = await get(
            "SELECT COUNT(*) as count, COALESCE(SUM(amount), 0) as total FROM payments WHERE status = 'pending'"
        );
        stats.pending_count = pending.count;
        stats.pending_total = pending.total;

        // Refunded payments
        const refunded = await get(
            "SELECT COUNT(*) as count, COALESCE(SUM(amount), 0) as total FROM payments WHERE status = 'refunded'"
        );
        stats.refunded_count = refunded.count;
        stats.refunded_total = refunded.total;

        return stats;
    }

    /**
     * Process refund
     * @param {string} id - Payment UUID
     * @returns {Promise<Object>} Refunded payment
     */
    static async refund(id) {
        return await transaction(async () => {
            const payment = await this.findById(id);
            if (!payment) {
                throw new Error('Payment not found');
            }

            await run(
                'UPDATE payments SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
                ['refunded', id]
            );

            // Log the refund
            await run(
                `INSERT INTO logs (id, level, action, details)
                 VALUES (?, 'WARN', 'PAYMENT_REFUNDED', ?)`,
                [uuidv4(), `Payment ${payment.transaction_id} refunded`]
            );

            return this.findById(id);
        });
    }
}

module.exports = Payment;