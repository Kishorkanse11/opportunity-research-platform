const { query, get, run } = require('../config/database');
const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcrypt');

class Admin {
    /**
     * Create a new admin user
     * @param {Object} adminData - Admin data
     * @returns {Promise<Object>} Created admin (without password)
     */
    static async create(adminData) {
        const id = uuidv4();
        const {
            email,
            password,
            name,
            role = 'admin'
        } = adminData;

        // Hash password
        const password_hash = await bcrypt.hash(password, 10);

        await run(
            `INSERT INTO admins (id, email, password_hash, name, role, created_at)
             VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
            [id, email, password_hash, name, role]
        );

        return this.findById(id);
    }

    /**
     * Find admin by ID
     * @param {string} id - Admin UUID
     * @returns {Promise<Object>} Admin object (without password)
     */
    static async findById(id) {
        const admin = await get(
            'SELECT id, email, name, role, last_login, created_at FROM admins WHERE id = ?',
            [id]
        );
        return admin;
    }

    /**
     * Find admin by email
     * @param {string} email - Admin email
     * @returns {Promise<Object>} Admin object (with password for auth)
     */
    static async findByEmail(email) {
        const admin = await get('SELECT * FROM admins WHERE email = ?', [email]);
        return admin;
    }

    /**
     * Get all admins
     * @returns {Promise<Array>} Array of admins (without passwords)
     */
    static async findAll() {
        const result = await query(
            'SELECT id, email, name, role, last_login, created_at FROM admins ORDER BY created_at DESC'
        );
        return result.rows;
    }

    /**
     * Authenticate admin
     * @param {string} email - Admin email
     * @param {string} password - Plain password
     * @returns {Promise<Object>} Admin if authenticated, null otherwise
     */
    static async authenticate(email, password) {
        const admin = await this.findByEmail(email);
        if (!admin) return null;

        const valid = await bcrypt.compare(password, admin.password_hash);
        if (!valid) return null;

        // Update last login
        await run(
            'UPDATE admins SET last_login = CURRENT_TIMESTAMP WHERE id = ?',
            [admin.id]
        );

        // Return without password
        const { password_hash, ...adminWithoutPassword } = admin;
        return adminWithoutPassword;
    }

    /**
     * Update admin
     * @param {string} id - Admin UUID
     * @param {Object} updates - Fields to update
     * @returns {Promise<Object>} Updated admin
     */
    static async update(id, updates) {
        const fields = [];
        const params = [];

        if (updates.name) {
            fields.push('name = ?');
            params.push(updates.name);
        }

        if (updates.email) {
            fields.push('email = ?');
            params.push(updates.email);
        }

        if (updates.role) {
            fields.push('role = ?');
            params.push(updates.role);
        }

        if (updates.password) {
            const password_hash = await bcrypt.hash(updates.password, 10);
            fields.push('password_hash = ?');
            params.push(password_hash);
        }

        if (fields.length === 0) {
            return null;
        }

        params.push(id);
        await run(
            `UPDATE admins SET ${fields.join(', ')} WHERE id = ?`,
            params
        );

        return this.findById(id);
    }

    /**
     * Change password
     * @param {string} id - Admin UUID
     * @param {string} oldPassword - Current password
     * @param {string} newPassword - New password
     * @returns {Promise<boolean>} True if changed
     */
    static async changePassword(id, oldPassword, newPassword) {
        const admin = await get('SELECT * FROM admins WHERE id = ?', [id]);
        if (!admin) return false;

        const valid = await bcrypt.compare(oldPassword, admin.password_hash);
        if (!valid) return false;

        const password_hash = await bcrypt.hash(newPassword, 10);
        await run(
            'UPDATE admins SET password_hash = ? WHERE id = ?',
            [password_hash, id]
        );

        return true;
    }

    /**
     * Delete admin
     * @param {string} id - Admin UUID
     * @returns {Promise<boolean>} True if deleted
     */
    static async delete(id) {
        const result = await run('DELETE FROM admins WHERE id = ?', [id]);
        return result.changes > 0;
    }

    /**
     * Get admin statistics
     * @returns {Promise<Object>} Admin statistics
     */
    static async getStats() {
        const stats = {};

        // Total admins
        const total = await get('SELECT COUNT(*) as count FROM admins');
        stats.total = total.count;

        // Recently active
        const active = await get(
            "SELECT COUNT(*) as count FROM admins WHERE last_login >= date('now', '-7 days')"
        );
        stats.active_last_7_days = active.count;

        return stats;
    }
}

module.exports = Admin;