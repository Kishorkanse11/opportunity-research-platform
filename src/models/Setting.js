const { query, get, run } = require('../config/database');
const { v4: uuidv4 } = require('uuid');

class Setting {
    /**
     * Get a setting value
     * @param {string} key - Setting key
     * @returns {Promise<string>} Setting value
     */
    static async get(key) {
        const setting = await get('SELECT value FROM settings WHERE key = ?', [key]);
        return setting ? setting.value : null;
    }

    /**
     * Set a setting value
     * @param {string} key - Setting key
     * @param {string} value - Setting value
     * @returns {Promise<void>}
     */
    static async set(key, value) {
        await run(
            `INSERT INTO settings (key, value, updated_at) 
             VALUES (?, ?, CURRENT_TIMESTAMP)
             ON CONFLICT(key) DO UPDATE SET 
                value = excluded.value,
                updated_at = CURRENT_TIMESTAMP`,
            [key, value]
        );
    }

    /**
     * Get all settings
     * @returns {Promise<Object>} All settings
     */
    static async getAll() {
        const result = await query('SELECT * FROM settings ORDER BY key');
        const settings = {};
        result.rows.forEach(row => {
            settings[row.key] = row.value;
        });
        return settings;
    }

    /**
     * Get multiple settings
     * @param {Array<string>} keys - Array of setting keys
     * @returns {Promise<Object>} Requested settings
     */
    static async getMultiple(keys) {
        const placeholders = keys.map(() => '?').join(',');
        const result = await query(
            `SELECT * FROM settings WHERE key IN (${placeholders})`,
            keys
        );
        const settings = {};
        result.rows.forEach(row => {
            settings[row.key] = row.value;
        });
        return settings;
    }

    /**
     * Update multiple settings
     * @param {Object} settings - Key-value pairs
     * @returns {Promise<void>}
     */
    static async updateMultiple(settings) {
        for (const [key, value] of Object.entries(settings)) {
            await this.set(key, value);
        }
    }

    /**
     * Delete a setting
     * @param {string} key - Setting key
     * @returns {Promise<boolean>} True if deleted
     */
    static async delete(key) {
        const result = await run('DELETE FROM settings WHERE key = ?', [key]);
        return result.changes > 0;
    }

    /**
     * Get membership fee
     * @returns {Promise<number>} Membership fee
     */
    static async getMembershipFee() {
        const fee = await this.get('membership_fee');
        return fee ? parseFloat(fee) : 299;
    }

    /**
     * Get renewal notice days
     * @returns {Promise<number>} Renewal notice days
     */
    static async getRenewalDays() {
        const days = await this.get('renewal_days');
        return days ? parseInt(days) : 14;
    }

    /**
     * Get admin email
     * @returns {Promise<string>} Admin email
     */
    static async getAdminEmail() {
        const email = await this.get('admin_email');
        return email || 'admin@help.com.au';
    }

    /**
     * Get Stripe configuration
     * @returns {Promise<Object>} Stripe config
     */
    static async getStripeConfig() {
        const secretKey = process.env.STRIPE_SECRET_KEY;
        const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
        
        return {
            secret_key: secretKey,
            webhook_secret: webhookSecret,
            price_id: await this.get('stripe_price_id')
        };
    }

    /**
     * Get email configuration
     * @returns {Promise<Object>} Email config
     */
    static async getEmailConfig() {
        return {
            host: process.env.SMTP_HOST,
            port: parseInt(process.env.SMTP_PORT),
            user: process.env.SMTP_USER,
            from: process.env.EMAIL_FROM,
            enabled: await this.get('email_enabled') !== 'false'
        };
    }
}

module.exports = Setting;