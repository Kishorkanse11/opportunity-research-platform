const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const { Admin, Log } = require('../models');
const { get } = require('../config/database');

// Admin login
router.post('/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        
        // For testing - hardcoded admin
        if (email === 'admin' && password === 'Admin@123') {
            const token = jwt.sign(
                { id: 'admin1', email, role: 'admin' },
                process.env.JWT_SECRET || 'your-secret-key',
                { expiresIn: '7d' }
            );
            
            return res.json({
                token,
                admin: { email, name: 'System Admin', role: 'admin' }
            });
        }
        
        res.status(401).json({ error: 'Invalid credentials' });
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ error: 'Login failed' });
    }
});

// ============================================
// MEMBER LOGIN (for Deal Pipeline access)
// ============================================
router.post('/member-login', async (req, res) => {
    try {
        const { email, password } = req.body;
        
        if (!email || !password) {
            return res.status(400).json({ error: 'Email and password required' });
        }
        
        // Find member by email
        const member = await get('SELECT * FROM members WHERE email = ?', [email]);
        
        if (!member) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }
        
        // Check if member has password (if not, they need to complete payment)
        if (!member.password_hash) {
            return res.status(403).json({ 
                error: 'Account not activated',
                message: 'Please complete your membership payment first.'
            });
        }
        
        // Verify password
        const validPassword = await bcrypt.compare(password, member.password_hash);
        if (!validPassword) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }
        
        // Check if member has active membership
        if (member.status !== 'active' || member.membership_status !== 'active') {
            return res.status(403).json({ 
                error: 'Membership not active',
                message: 'Your membership is inactive or expired. Please renew to access the Deal Pipeline.'
            });
        }
        
        // Generate JWT token for member
        const token = jwt.sign(
            { 
                id: member.id, 
                email: member.email, 
                type: 'member',
                isAdmin: false 
            },
            process.env.JWT_SECRET || 'your-secret-key',
            { expiresIn: '30d' }
        );
        
        // Log member login
        await Log.info('MEMBER_LOGIN', `Member ${member.email} logged in`);
        
        res.json({
            token,
            member: {
                id: member.id,
                full_name: member.full_name,
                email: member.email,
                status: member.status,
                membership_status: member.membership_status,
                renewal_date: member.renewal_date
            }
        });
        
    } catch (error) {
        console.error('Member login error:', error);
        res.status(500).json({ error: 'Login failed' });
    }
});

// ============================================
// GET MEMBER STATUS
// ============================================
router.get('/members/:id/status', async (req, res) => {
    try {
        // Verify token from header
        const authHeader = req.headers.authorization;
        if (!authHeader) {
            return res.status(401).json({ error: 'No token provided' });
        }
        
        const token = authHeader.split(' ')[1];
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key');
        
        // Check if token matches requested member
        if (decoded.id !== req.params.id && decoded.type !== 'admin') {
            return res.status(403).json({ error: 'Unauthorized' });
        }
        
        // Get member details
        const member = await get('SELECT * FROM members WHERE id = ?', [req.params.id]);
        
        if (!member) {
            return res.status(404).json({ error: 'Member not found' });
        }
        
        res.json({
            id: member.id,
            full_name: member.full_name,
            email: member.email,
            status: member.status,
            membership_status: member.membership_status,
            renewal_date: member.renewal_date,
            joined_date: member.joined_date
        });
        
    } catch (error) {
        console.error('Member status error:', error);
        
        if (error.name === 'JsonWebTokenError') {
            return res.status(401).json({ error: 'Invalid token' });
        }
        if (error.name === 'TokenExpiredError') {
            return res.status(401).json({ error: 'Token expired' });
        }
        
        res.status(500).json({ error: 'Failed to get member status' });
    }
});

// ============================================
// VERIFY TOKEN (for both admin and members)
// ============================================
router.get('/verify', async (req, res) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader) {
            return res.status(401).json({ valid: false });
        }

        const token = authHeader.split(' ')[1];
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key');
        
        // Check if it's admin or member
        if (decoded.role === 'admin') {
            const admin = await Admin.findById(decoded.id);
            if (!admin) {
                return res.status(401).json({ valid: false });
            }
            return res.json({ valid: true, user: { ...admin, type: 'admin' } });
        }
        
        // It's a member
        const member = await get('SELECT id, full_name, email, status, membership_status FROM members WHERE id = ?', [decoded.id]);
        if (!member) {
            return res.status(401).json({ valid: false });
        }
        
        res.json({ valid: true, user: { ...member, type: 'member' } });
        
    } catch (error) {
        console.error('Token verification error:', error);
        res.status(401).json({ valid: false });
    }
});

module.exports = router;