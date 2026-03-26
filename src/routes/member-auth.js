const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const { get, run, all } = require('../config/database');
const emailService = require('../services/emailService');

// ============================================
// MEMBER LOGIN
// ============================================
router.post('/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        
        if (!email || !password) {
            return res.status(400).json({ 
                error: 'Email and password required',
                code: 'MISSING_FIELDS'
            });
        }
        
        // Find member by email
        const member = await get(`
            SELECT m.*, 
                   s.property_count, s.total_mortgage, s.total_valuation, s.lvr,
                   s.property_profile, s.options_explored
            FROM members m
            LEFT JOIN submissions s ON m.id = s.member_id
            WHERE m.email = ?
        `, [email]);
        
        if (!member) {
            // Log failed attempt
            await run(
                `INSERT INTO logs (id, level, action, details, ip_address, created_at)
                 VALUES (?, 'WARN', 'MEMBER_LOGIN_FAILED', ?, ?, datetime('now'))`,
                [uuidv4(), `Failed login attempt for email: ${email}`, req.ip || '127.0.0.1']
            );
            
            return res.status(401).json({ 
                error: 'Invalid credentials',
                code: 'INVALID_CREDENTIALS'
            });
        }
        
        // Check if member has password set
        if (!member.password_hash) {
            return res.status(403).json({ 
                error: 'Account not activated',
                message: 'Please complete your membership payment first. Check your email for payment link.',
                code: 'ACCOUNT_NOT_ACTIVATED',
                requiresPayment: true
            });
        }
        
        // Verify password
        let validPassword = false;
        try {
            validPassword = await bcrypt.compare(password, member.password_hash);
        } catch (err) {
            console.error('Password verification error:', err);
        }
        
        if (!validPassword) {
            // Log failed attempt
            await run(
                `INSERT INTO logs (id, level, action, details, ip_address, created_at)
                 VALUES (?, 'WARN', 'MEMBER_LOGIN_FAILED', ?, ?, datetime('now'))`,
                [uuidv4(), `Invalid password for: ${email}`, req.ip || '127.0.0.1']
            );
            
            return res.status(401).json({ 
                error: 'Invalid credentials',
                code: 'INVALID_CREDENTIALS'
            });
        }
        
        // Check membership status
        if (member.status !== 'active' || member.membership_status !== 'active') {
            const renewalDate = member.renewal_date ? new Date(member.renewal_date) : null;
            const isExpired = renewalDate && renewalDate < new Date();
            
            return res.status(403).json({ 
                error: 'Membership not active',
                message: isExpired ? 'Your membership has expired. Please renew to continue accessing the Deal Pipeline.' : 'Your membership is pending activation. Please contact support.',
                code: 'MEMBERSHIP_INACTIVE',
                isExpired: isExpired,
                renewalDate: member.renewal_date
            });
        }
        
        // Generate JWT token
        const token = jwt.sign(
            { 
                id: member.id, 
                email: member.email, 
                type: 'member',
                fullName: member.full_name,
                role: 'member'
            },
            process.env.JWT_SECRET || 'your-secret-key-change-in-production',
            { expiresIn: '30d' }
        );
        
        // Log successful login
        await run(
            `INSERT INTO logs (id, level, action, details, ip_address, created_at)
             VALUES (?, 'INFO', 'MEMBER_LOGIN_SUCCESS', ?, ?, datetime('now'))`,
            [uuidv4(), `Member ${member.email} logged in`, req.ip || '127.0.0.1']
        );
        
        // Update last login timestamp
        await run(
            'UPDATE members SET last_login = datetime("now") WHERE id = ?',
            [member.id]
        );
        
        // Return member data (excluding sensitive fields)
        res.json({
            success: true,
            token,
            member: {
                id: member.id,
                full_name: member.full_name,
                email: member.email,
                phone: member.phone,
                status: member.status,
                membership_status: member.membership_status,
                joined_date: member.joined_date,
                renewal_date: member.renewal_date,
                lvr: member.lvr,
                property_count: member.property_count,
                total_valuation: member.total_valuation,
                total_mortgage: member.total_mortgage
            }
        });
        
    } catch (error) {
        console.error('❌ Member login error:', error);
        res.status(500).json({ 
            error: 'Login failed. Please try again later.',
            code: 'SERVER_ERROR'
        });
    }
});

// ============================================
// VERIFY MEMBER TOKEN
// ============================================
router.get('/verify', async (req, res) => {
    try {
        const authHeader = req.headers.authorization;
        const token = authHeader?.split(' ')[1];
        
        if (!token) {
            return res.status(401).json({ 
                valid: false, 
                error: 'No token provided' 
            });
        }
        
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key-change-in-production');
        
        // Get fresh member data
        const member = await get(`
            SELECT id, full_name, email, phone, status, membership_status, 
                   joined_date, renewal_date, last_login
            FROM members 
            WHERE id = ? AND status = 'active'
        `, [decoded.id]);
        
        if (!member) {
            return res.status(401).json({ 
                valid: false, 
                error: 'Member not found or inactive' 
            });
        }
        
        res.json({ 
            valid: true, 
            member: {
                id: member.id,
                full_name: member.full_name,
                email: member.email,
                phone: member.phone,
                status: member.status,
                membership_status: member.membership_status,
                joined_date: member.joined_date,
                renewal_date: member.renewal_date
            }
        });
        
    } catch (error) {
        if (error.name === 'JsonWebTokenError') {
            return res.status(401).json({ valid: false, error: 'Invalid token' });
        }
        if (error.name === 'TokenExpiredError') {
            return res.status(401).json({ valid: false, error: 'Token expired' });
        }
        
        console.error('❌ Token verification error:', error);
        res.status(500).json({ valid: false, error: 'Verification failed' });
    }
});

// ============================================
// FORGOT PASSWORD - Send Reset Email
// ============================================
router.post('/forgot-password', async (req, res) => {
    try {
        const { email } = req.body;
        
        if (!email) {
            return res.status(400).json({ error: 'Email required' });
        }
        
        const member = await get('SELECT * FROM members WHERE email = ?', [email]);
        
        if (!member) {
            // Don't reveal that email doesn't exist for security
            return res.json({ 
                success: true, 
                message: 'If an account exists with this email, you will receive a reset link.' 
            });
        }
        
        // Generate reset token
        const resetToken = jwt.sign(
            { memberId: member.id, email: member.email, type: 'password_reset' },
            process.env.JWT_SECRET || 'your-secret-key-change-in-production',
            { expiresIn: '1h' }
        );
        
        // Store token in database
        await run(
            `UPDATE members SET 
                password_reset_token = ?, 
                password_reset_expires = datetime('now', '+1 hour')
             WHERE id = ?`,
            [resetToken, member.id]
        );
        
        // Send reset email
        const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3001';
        const resetUrl = `${frontendUrl}/reset-password.html?token=${resetToken}`;
        
        const html = `
            <!DOCTYPE html>
            <html>
            <head>
                <style>
                    body { font-family: 'Inter', Arial, sans-serif; line-height: 1.6; color: #1F2933; }
                    .container { max-width: 500px; margin: 0 auto; padding: 20px; }
                    .header { background: #2F5D8C; color: white; padding: 30px; text-align: center; border-radius: 8px 8px 0 0; }
                    .content { background: #F9FAFC; padding: 30px; border-radius: 0 0 8px 8px; }
                    .button { background: #2F5D8C; color: white; padding: 14px 32px; text-decoration: none; border-radius: 8px; display: inline-block; margin: 20px 0; }
                    .warning { background: #FEF3C7; padding: 15px; border-radius: 8px; color: #92400E; margin: 20px 0; font-size: 14px; }
                    .footer { text-align: center; padding: 20px; font-size: 12px; color: #6B7280; }
                </style>
            </head>
            <body>
                <div class="container">
                    <div class="header">
                        <h2>Reset Your Password</h2>
                    </div>
                    <div class="content">
                        <p>Hello ${member.full_name},</p>
                        <p>We received a request to reset your password. Click the button below to create a new password:</p>
                        
                        <p style="text-align: center;">
                            <a href="${resetUrl}" class="button">Reset Password</a>
                        </p>
                        
                        <div class="warning">
                            ⚠️ This link will expire in 1 hour. If you didn't request this, please ignore this email.
                        </div>
                        
                        <p>If the button doesn't work, copy and paste this link into your browser:</p>
                        <p style="font-size: 12px; word-break: break-all; color: #6B7280;">${resetUrl}</p>
                    </div>
                    <div class="footer">
                        <p>Opportunity Research Platform - Property & Business Research Since 1970</p>
                    </div>
                </div>
            </body>
            </html>
        `;
        
        await emailService.sendEmail(member.email, 'Reset Your Password - Opportunity Research Platform', html);
        
        res.json({ 
            success: true, 
            message: 'If an account exists with this email, you will receive a reset link.' 
        });
        
    } catch (error) {
        console.error('❌ Forgot password error:', error);
        res.status(500).json({ error: 'Failed to send reset email' });
    }
});

// ============================================
// RESET PASSWORD - Set New Password
// ============================================
router.post('/reset-password', async (req, res) => {
    try {
        const { token, newPassword } = req.body;
        
        if (!token || !newPassword) {
            return res.status(400).json({ error: 'Token and password required' });
        }
        
        if (newPassword.length < 6) {
            return res.status(400).json({ error: 'Password must be at least 6 characters' });
        }
        
        // Verify token
        let decoded;
        try {
            decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key-change-in-production');
        } catch (err) {
            if (err.name === 'TokenExpiredError') {
                return res.status(403).json({ error: 'Reset link has expired. Please request a new one.' });
            }
            return res.status(403).json({ error: 'Invalid reset token' });
        }
        
        // Check if token exists in database and not expired
        const member = await get(
            `SELECT * FROM members 
             WHERE id = ? 
             AND password_reset_token = ? 
             AND password_reset_expires > datetime('now')`,
            [decoded.memberId, token]
        );
        
        if (!member) {
            return res.status(403).json({ error: 'Invalid or expired reset token' });
        }
        
        // Hash new password
        const saltRounds = 10;
        const passwordHash = await bcrypt.hash(newPassword, saltRounds);
        
        // Update password and clear reset token
        await run(
            `UPDATE members SET 
                password_hash = ?, 
                password_reset_token = NULL, 
                password_reset_expires = NULL,
                updated_at = datetime('now')
             WHERE id = ?`,
            [passwordHash, member.id]
        );
        
        // Log password reset
        await run(
            `INSERT INTO logs (id, level, action, details, created_at)
             VALUES (?, 'INFO', 'PASSWORD_RESET', ?, datetime('now'))`,
            [uuidv4(), `Member ${member.email} reset password`]
        );
        
        // Send confirmation email
        const html = `
            <!DOCTYPE html>
            <html>
            <head>
                <style>
                    body { font-family: 'Inter', Arial; line-height: 1.6; }
                    .container { max-width: 500px; margin: 0 auto; padding: 20px; }
                    .header { background: #2F5D8C; color: white; padding: 30px; text-align: center; }
                </style>
            </head>
            <body>
                <div class="container">
                    <div class="header">
                        <h2>Password Reset Successful</h2>
                    </div>
                    <p>Hello ${member.full_name},</p>
                    <p>Your password has been successfully reset. You can now log in with your new password.</p>
                    <p>If you did not make this change, please contact support immediately.</p>
                    <p>Best regards,<br>Opportunity Research Team</p>
                </div>
            </body>
            </html>
        `;
        
        await emailService.sendEmail(member.email, 'Password Reset Successful - Opportunity Research Platform', html);
        
        res.json({ 
            success: true, 
            message: 'Password reset successfully. You can now log in with your new password.' 
        });
        
    } catch (error) {
        console.error('❌ Reset password error:', error);
        res.status(500).json({ error: 'Failed to reset password' });
    }
});

// ============================================
// CHANGE PASSWORD (when logged in)
// ============================================
router.post('/change-password', async (req, res) => {
    try {
        const token = req.headers.authorization?.split(' ')[1];
        
        if (!token) {
            return res.status(401).json({ error: 'Not authenticated' });
        }
        
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key-change-in-production');
        
        const { currentPassword, newPassword } = req.body;
        
        if (!currentPassword || !newPassword) {
            return res.status(400).json({ error: 'Current password and new password required' });
        }
        
        if (newPassword.length < 6) {
            return res.status(400).json({ error: 'New password must be at least 6 characters' });
        }
        
        // Get member with password
        const member = await get('SELECT * FROM members WHERE id = ?', [decoded.id]);
        
        if (!member) {
            return res.status(404).json({ error: 'Member not found' });
        }
        
        // Verify current password
        const validPassword = await bcrypt.compare(currentPassword, member.password_hash);
        if (!validPassword) {
            return res.status(401).json({ error: 'Current password is incorrect' });
        }
        
        // Hash new password
        const saltRounds = 10;
        const passwordHash = await bcrypt.hash(newPassword, saltRounds);
        
        // Update password
        await run(
            'UPDATE members SET password_hash = ?, updated_at = datetime("now") WHERE id = ?',
            [passwordHash, member.id]
        );
        
        // Log password change
        await run(
            `INSERT INTO logs (id, level, action, details, created_at)
             VALUES (?, 'INFO', 'PASSWORD_CHANGED', ?, datetime('now'))`,
            [uuidv4(), `Member ${member.email} changed password`]
        );
        
        res.json({ success: true, message: 'Password changed successfully' });
        
    } catch (error) {
        console.error('❌ Change password error:', error);
        res.status(500).json({ error: 'Failed to change password' });
    }
});

// ============================================
// GET MEMBER PROFILE (for dashboard)
// ============================================
router.get('/profile', async (req, res) => {
    try {
        const token = req.headers.authorization?.split(' ')[1];
        
        if (!token) {
            return res.status(401).json({ error: 'Not authenticated' });
        }
        
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key-change-in-production');
        
        // Get member with all data
        const member = await get(`
            SELECT m.*, 
                   s.property_count, s.total_mortgage, s.total_valuation, s.lvr,
                   s.property_profile, s.options_explored,
                   s.cash_assets, s.property_assets, s.investment_assets,
                   s.total_assets, s.total_liabilities, s.net_position
            FROM members m
            LEFT JOIN submissions s ON m.id = s.member_id
            WHERE m.id = ?
        `, [decoded.id]);
        
        if (!member) {
            return res.status(404).json({ error: 'Member not found' });
        }
        
        // Get recent payments
        const payments = await all(`
            SELECT * FROM payments 
            WHERE member_id = ? 
            ORDER BY payment_date DESC 
            LIMIT 5
        `, [member.id]);
        
        // Get upcoming renewal
        const renewal = await get(`
            SELECT * FROM renewals 
            WHERE member_id = ? AND status = 'pending'
            ORDER BY renewal_date ASC 
            LIMIT 1
        `, [member.id]);
        
        // Remove sensitive fields
        delete member.password_hash;
        delete member.password_reset_token;
        
        res.json({
            member,
            payments,
            upcomingRenewal: renewal,
            profile_complete: !!(member.full_name && member.email)
        });
        
    } catch (error) {
        console.error('❌ Get profile error:', error);
        res.status(500).json({ error: 'Failed to load profile' });
    }
});

// ============================================
// UPDATE MEMBER PROFILE
// ============================================
router.put('/profile', async (req, res) => {
    try {
        const token = req.headers.authorization?.split(' ')[1];
        
        if (!token) {
            return res.status(401).json({ error: 'Not authenticated' });
        }
        
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key-change-in-production');
        
        const { phone, property_profile, options_explored } = req.body;
        
        // Update member basic info
        if (phone) {
            await run(
                'UPDATE members SET phone = ?, updated_at = datetime("now") WHERE id = ?',
                [phone, decoded.id]
            );
        }
        
        // Update submission profile if exists
        if (property_profile || options_explored) {
            await run(
                `UPDATE submissions SET 
                    property_profile = COALESCE(?, property_profile),
                    options_explored = COALESCE(?, options_explored),
                    updated_at = datetime('now')
                 WHERE member_id = ?`,
                [property_profile, options_explored, decoded.id]
            );
        }
        
        res.json({ success: true, message: 'Profile updated successfully' });
        
    } catch (error) {
        console.error('❌ Update profile error:', error);
        res.status(500).json({ error: 'Failed to update profile' });
    }
});

// ============================================
// LOGOUT (invalidate token - client side only)
// ============================================
router.post('/logout', async (req, res) => {
    try {
        const token = req.headers.authorization?.split(' ')[1];
        
        if (token) {
            // Optionally add token to blacklist here
            // For now, just log the logout
            console.log('Member logged out');
        }
        
        res.json({ success: true, message: 'Logged out successfully' });
    } catch (error) {
        res.status(500).json({ error: 'Logout failed' });
    }
});

module.exports = router;