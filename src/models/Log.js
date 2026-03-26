const { query, get, run } = require('../config/database');
const { v4: uuidv4 } = require('uuid');

class Log {
    /**
     * Create a new log entry
     * @param {Object} logData - Log data
     * @returns {Promise<Object>} Created log
     */
    static async create(logData) {
        const id = uuidv4();
        const {
            level = 'INFO',
            action,
            details,
            ip_address,
            user_id
        } = logData;

        await run(
            `INSERT INTO logs (id, level, action, details, ip_address, user_id, timestamp, created_at)
             VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
            [id, level, action, details, ip_address, user_id]
        );

        return this.findById(id);
    }

    /**
     * Find log by ID
     * @param {string} id - Log UUID
     * @returns {Promise<Object>} Log object
     */
    static async findById(id) {
        const log = await get('SELECT * FROM logs WHERE id = ?', [id]);
        return log;
    }

    /**
     * Get all logs with filters
     * @param {Object} filters - Search filters
     * @returns {Promise<Array>} Array of logs
     */
    static async findAll(filters = {}) {
        let sql = 'SELECT * FROM logs WHERE 1=1';
        const params = [];

        if (filters.level) {
            sql += ' AND level = ?';
            params.push(filters.level);
        }

        if (filters.action) {
            sql += ' AND action LIKE ?';
            params.push(`%${filters.action}%`);
        }

        if (filters.start_date) {
            sql += ' AND date(timestamp) >= ?';
            params.push(filters.start_date);
        }

        if (filters.end_date) {
            sql += ' AND date(timestamp) <= ?';
            params.push(filters.end_date);
        }

        sql += ' ORDER BY timestamp DESC';
        
        if (filters.limit) {
            sql += ' LIMIT ?';
            params.push(parseInt(filters.limit));
        }

        const result = await query(sql, params);
        return result.rows;
    }

    /**
     * Get recent logs
     * @param {number} limit - Number of logs to return
     * @returns {Promise<Array>} Recent logs
     */
    static async getRecent(limit = 100) {
        const result = await query(
            'SELECT * FROM logs ORDER BY timestamp DESC LIMIT ?',
            [limit]
        );
        return result.rows;
    }

    /**
     * Get logs by level
     * @param {string} level - Log level (INFO, WARN, ERROR)
     * @param {number} limit - Number of logs to return
     * @returns {Promise<Array>} Filtered logs
     */
    static async getByLevel(level, limit = 100) {
        const result = await query(
            'SELECT * FROM logs WHERE level = ? ORDER BY timestamp DESC LIMIT ?',
            [level, limit]
        );
        return result.rows;
    }

    /**
     * Get logs by action type
     * @param {string} action - Action type
     * @param {number} limit - Number of logs to return
     * @returns {Promise<Array>} Filtered logs
     */
    static async getByAction(action, limit = 100) {
        const result = await query(
            'SELECT * FROM logs WHERE action = ? ORDER BY timestamp DESC LIMIT ?',
            [action, limit]
        );
        return result.rows;
    }

    /**
     * Get logs by date range
     * @param {string} startDate - Start date (YYYY-MM-DD)
     * @param {string} endDate - End date (YYYY-MM-DD)
     * @returns {Promise<Array>} Logs in date range
     */
    static async getByDateRange(startDate, endDate) {
        const result = await query(
            'SELECT * FROM logs WHERE date(timestamp) BETWEEN ? AND ? ORDER BY timestamp DESC',
            [startDate, endDate]
        );
        return result.rows;
    }

    /**
     * Get log statistics
     * @returns {Promise<Object>} Log statistics
     */
    static async getStats() {
        const stats = {};

        // Total logs
        const total = await get('SELECT COUNT(*) as count FROM logs');
        stats.total = total.count;

        // Count by level
        const info = await get("SELECT COUNT(*) as count FROM logs WHERE level = 'INFO'");
        stats.info = info.count;

        const warn = await get("SELECT COUNT(*) as count FROM logs WHERE level = 'WARN'");
        stats.warn = warn.count;

        const error = await get("SELECT COUNT(*) as count FROM logs WHERE level = 'ERROR'");
        stats.error = error.count;

        // Today's logs
        const today = await get(
            "SELECT COUNT(*) as count FROM logs WHERE date(timestamp) = date('now')"
        );
        stats.today = today.count;

        // Last 7 days
        const week = await get(
            "SELECT COUNT(*) as count FROM logs WHERE timestamp >= date('now', '-7 days')"
        );
        stats.last_7_days = week.count;

        return stats;
    }

    /**
     * Clear old logs
     * @param {number} days - Keep logs from last X days
     * @returns {Promise<number>} Number of deleted logs
     */
    static async clearOld(days = 90) {
        const result = await run(
            'DELETE FROM logs WHERE timestamp < date("now", ?)',
            [`-${days} days`]
        );
        return result.changes;
    }

    /**
     * Log an info message
     * @param {string} action - Action type
     * @param {string} details - Details
     * @param {string} ip - IP address
     */
    static async info(action, details, ip = null) {
        return this.create({
            level: 'INFO',
            action,
            details,
            ip_address: ip
        });
    }

    /**
     * Log a warning message
     * @param {string} action - Action type
     * @param {string} details - Details
     * @param {string} ip - IP address
     */
    static async warn(action, details, ip = null) {
        return this.create({
            level: 'WARN',
            action,
            details,
            ip_address: ip
        });
    }

    /**
     * Log an error message
     * @param {string} action - Action type
     * @param {string} details - Details
     * @param {string} ip - IP address
     */
    static async error(action, details, ip = null) {
        return this.create({
            level: 'ERROR',
            action,
            details,
            ip_address: ip
        });
    }
}

module.exports = Log;