const express = require('express');
const router = express.Router();
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { Member, Payment } = require('../models');
const { get, all, run } = require('../config/database');
const emailService = require('../services/emailService'); // ADD THIS
const bcrypt = require('bcrypt'); // ADD THIS
const { v4: uuidv4 } = require('uuid'); // ADD THIS

// ============================================
// MIDDLEWARE: Verify Admin Token
// ============================================
const verifyAdmin = async (req, res, next) => {
    const authHeader = req.headers.authorization;
    const token = authHeader?.split(' ')[1];
    
    if (!token) {
        return res.status(401).json({ error: 'Unauthorized - No token provided' });
    }
    next();
};

// ============================================
// GENERATE RANDOM PASSWORD
// ============================================
const generateRandomPassword = () => {
    const length = 12;
    const charset = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%";
    let password = "";
    for (let i = 0; i < length; i++) {
        const randomIndex = Math.floor(Math.random() * charset.length);
        password += charset[randomIndex];
    }
    return password;
};

// ============================================
// SEND CREDENTIALS EMAIL
// ============================================
async function sendCredentialsEmail(member, plainPassword) {
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3001';
    
    const html = `
        <!DOCTYPE html>
        <html>
        <head>
            <style>
                body { font-family: 'Inter', Arial, sans-serif; line-height: 1.6; color: #1F2933; }
                .container { max-width: 600px; margin: 0 auto; padding: 20px; }
                .header { background: #2F5D8C; color: white; padding: 30px; text-align: center; border-radius: 8px 8px 0 0; }
                .content { background: #F9FAFC; padding: 30px; border-radius: 0 0 8px 8px; }
                .credentials { background: white; padding: 20px; border-radius: 8px; margin: 20px 0; border: 1px solid #E8EEF5; }
                .button { background: #2F5D8C; color: white; padding: 14px 32px; text-decoration: none; border-radius: 8px; display: inline-block; }
                .footer { text-align: center; padding: 20px; font-size: 12px; color: #6B7280; }
            </style>
        </head>
        <body>
            <div class="container">
                <div class="header">
                    <h2>Welcome to the Deal Pipeline!</h2>
                </div>
                <div class="content">
                    <p>Dear ${member.full_name},</p>
                    <p>Thank you for becoming a member. Your Deal Pipeline access has been activated.</p>
                    
                    <div class="credentials">
                        <h3>🔐 Your Login Credentials</h3>
                        <p><strong>Email:</strong> ${member.email}</p>
                        <p><strong>Password:</strong> <code style="background:#F3F4F6; padding:4px 8px; border-radius:4px;">${plainPassword}</code></p>
                        <p style="margin-top:15px; font-size:13px; color:#92400E;">⚠️ Please change your password after first login.</p>
                    </div>
                    
                    <p style="text-align: center;">
                        <a href="${frontendUrl}/deal-pipeline.html" class="button">Access Deal Pipeline →</a>
                    </p>
                    
                    <p>Best regards,<br><strong>Opportunity Research Team</strong></p>
                </div>
                <div class="footer">
                    <p>Opportunity Research Platform - Property & Business Research Since 1970</p>
                </div>
            </div>
        </body>
        </html>
    `;
    
    await emailService.sendEmail(member.email, '🎉 Welcome to the Deal Pipeline - Your Login Credentials', html);
    console.log(`📧 Credentials email sent to ${member.email}`);
}

// ============================================
// SEND PAYMENT CONFIRMATION EMAIL
// ============================================
async function sendPaymentConfirmationEmail(member, amount, transactionId) {
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3001';
    
    const html = `
        <!DOCTYPE html>
        <html>
        <head>
            <style>
                body { font-family: 'Inter', Arial, sans-serif; line-height: 1.6; }
                .container { max-width: 600px; margin: 0 auto; padding: 20px; }
                .header { background: #2F5D8C; color: white; padding: 30px; text-align: center; }
                .content { background: #F9FAFC; padding: 30px; border-radius: 0 0 8px 8px; }
                .button { background: #2F5D8C; color: white; padding: 12px 24px; text-decoration: none; border-radius: 8px; display: inline-block; }
            </style>
        </head>
        <body>
            <div class="container">
                <div class="header">
                    <h2>Payment Confirmation</h2>
                </div>
                <div class="content">
                    <p>Dear ${member.full_name},</p>
                    <p>Thank you for your payment. Your transaction has been completed successfully.</p>
                    <p><strong>Amount:</strong> $${amount} USD</p>
                    <p><strong>Transaction ID:</strong> ${transactionId}</p>
                    <p>Your membership is now active. You will receive your login credentials shortly.</p>
                    <p style="text-align: center;">
                        <a href="${frontendUrl}/deal-pipeline.html" class="button">Login to Dashboard</a>
                    </p>
                </div>
            </div>
        </body>
        </html>
    `;
    
    await emailService.sendEmail(member.email, `💰 Payment Confirmed - $${amount} USD`, html);
    console.log(`📧 Payment confirmation email sent to ${member.email}`);
}

// ============================================
// RECORD MANUAL PAYMENT - For Admin Dashboard
// ============================================
router.post('/manual', verifyAdmin, async (req, res) => {
    try {
        const { member_id, amount, payment_method, date, status } = req.body;
        
        if (!member_id || !amount) {
            return res.status(400).json({ error: 'Member ID and amount required' });
        }
        
        console.log(`💰 Recording manual payment: $${amount} for member ${member_id}`);
        
        // Get member details
        const member = await get('SELECT * FROM members WHERE id = ?', [member_id]);
        if (!member) {
            return res.status(404).json({ error: 'Member not found' });
        }
        
        const paymentId = uuidv4();
        const transactionId = `MANUAL-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
        const paymentDate = date || new Date().toISOString().split('T')[0];
        
        // Insert payment
        await run(`
            INSERT INTO payments (
                id, member_id, amount, payment_method, payment_date, 
                status, transaction_id, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
        `, [paymentId, member_id, amount, payment_method || 'manual', paymentDate, status || 'completed', transactionId]);
        
        // ============================================
        // GENERATE PASSWORD AND SEND EMAILS
        // ============================================
        
        // Generate random password
        const plainPassword = generateRandomPassword();
        const hashedPassword = await bcrypt.hash(plainPassword, 10);
        
        // Update member with password and activate
        await run(`
            UPDATE members SET 
                status = 'active',
                membership_status = 'active',
                payment_status = 'paid',
                payment_date = ?,
                renewal_date = date('now', '+1 year'),
                password_hash = ?,
                updated_at = datetime('now')
            WHERE id = ?
        `, [paymentDate, hashedPassword, member_id]);
        
        // Send PAYMENT CONFIRMATION email
        await sendPaymentConfirmationEmail(member, amount, transactionId);
        
        // Send CREDENTIALS email with password
        await sendCredentialsEmail(member, plainPassword);
        
        // Send ADMIN notification
        await emailService.sendAdminNotification('payment_received', {
            memberName: member.full_name,
            email: member.email,
            amount: amount,
            transactionId: transactionId,
            paymentId: paymentId,
            memberId: member_id
        });
        
        console.log(`✅ Manual payment recorded for member ${member_id}`);
        console.log(`📧 Emails sent to ${member.email}`);
        
        res.status(201).json({
            success: true,
            message: 'Payment recorded successfully',
            payment: { id: paymentId, member_id, amount, transaction_id: transactionId }
        });
        
    } catch (error) {
        console.error('❌ Error recording payment:', error);
        res.status(500).json({ error: error.message });
    }
});

// ============================================
// GET ALL PAYMENTS - For Admin Dashboard
// ============================================
router.get('/', verifyAdmin, async (req, res) => {
    try {
        console.log('📋 Fetching all payments...');
        
        const payments = await all(`
            SELECT 
                p.id,
                p.transaction_id,
                p.member_id,
                p.amount,
                p.currency,
                p.status,
                p.payment_method,
                p.payment_date,
                p.created_at,
                m.full_name as member_name,
                m.email as member_email
            FROM payments p
            LEFT JOIN members m ON p.member_id = m.id
            ORDER BY p.payment_date DESC
        `);
        
        console.log(`✅ Found ${payments.length} payments`);
        res.json(payments || []);
        
    } catch (error) {
        console.error('❌ Error fetching payments:', error);
        res.status(500).json({ error: error.message });
    }
});

// ============================================
// GET SINGLE PAYMENT
// ============================================
router.get('/:id', verifyAdmin, async (req, res) => {
    try {
        const payment = await get(`
            SELECT p.*, m.full_name as member_name, m.email as member_email
            FROM payments p
            LEFT JOIN members m ON p.member_id = m.id
            WHERE p.id = ?
        `, [req.params.id]);
        
        if (!payment) {
            return res.status(404).json({ error: 'Payment not found' });
        }
        
        res.json(payment);
        
    } catch (error) {
        console.error('Error fetching payment:', error);
        res.status(500).json({ error: error.message });
    }
});

// ============================================
// REFUND PAYMENT
// ============================================
router.post('/:id/refund', verifyAdmin, async (req, res) => {
    try {
        const payment = await get('SELECT * FROM payments WHERE id = ?', [req.params.id]);
        if (!payment) {
            return res.status(404).json({ error: 'Payment not found' });
        }
        
        await run(`
            UPDATE payments SET 
                status = 'refunded', 
                refunded_at = datetime('now')
            WHERE id = ?
        `, [req.params.id]);
        
        await run(`
            UPDATE members SET 
                status = 'inactive',
                membership_status = 'inactive',
                payment_status = 'refunded'
            WHERE id = ?
        `, [payment.member_id]);
        
        res.json({ success: true, message: 'Payment refunded successfully' });
        
    } catch (error) {
        console.error('Error refunding payment:', error);
        res.status(500).json({ error: error.message });
    }
});

// ============================================
// CREATE STRIPE CHECKOUT SESSION
// ============================================
router.post('/create-checkout-session', async (req, res) => {
    try {
        const { member_id } = req.body;
        
        const member = await get('SELECT * FROM members WHERE id = ?', [member_id]);
        if (!member) {
            return res.status(404).json({ error: 'Member not found' });
        }

        const session = await stripe.checkout.sessions.create({
            payment_method_types: ['card'],
            line_items: [{
                price_data: {
                    currency: 'aud',
                    product_data: {
                        name: 'Opportunity Research Platform Annual Membership',
                        description: 'Annual administrative membership - Access to Deal Pipeline',
                    },
                    unit_amount: 69500,
                },
                quantity: 1,
            }],
            mode: 'payment',
            success_url: `${process.env.FRONTEND_URL || 'http://localhost:3001'}/payment-success.html?session_id={CHECKOUT_SESSION_ID}&member_id=${member_id}`,
            cancel_url: `${process.env.FRONTEND_URL || 'http://localhost:3001'}/payment-cancelled.html`,
            metadata: { member_id },
            customer_email: member.email,
        });

        res.json({ sessionId: session.id, url: session.url });
        
    } catch (error) {
        console.error('Checkout session error:', error);
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;