const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { Payment, Member, Log } = require('../models');
const emailService = require('./emailService');
const googleSheetsService = require('./googleSheetsService');
const bcrypt = require('bcrypt');
const { run, get } = require('../config/database');
const { v4: uuidv4 } = require('uuid');

// ============================================
// HELPER FUNCTIONS
// ============================================

// Generate random password for new members
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

// Send credentials email to new member (with A&L completion link)
async function sendMemberCredentialsEmail(member, plainPassword) {
    const subject = '🎉 Welcome to the Deal Pipeline - Complete Your Profile';
    
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
                .credentials { background: white; padding: 25px; border-radius: 8px; margin: 20px 0; border: 1px solid #E8EEF5; }
                .credentials h3 { color: #2F5D8C; margin-bottom: 15px; }
                .credential-row { display: flex; margin-bottom: 10px; padding: 8px 0; border-bottom: 1px solid #F0F4F9; }
                .credential-label { font-weight: 600; width: 100px; color: #4B5563; }
                .credential-value { font-weight: 600; color: #1F2933; font-size: 16px; font-family: monospace; background: #F3F4F6; padding: 4px 8px; border-radius: 4px; }
                .warning { background: #FEF3C7; padding: 15px; border-radius: 8px; color: #92400E; margin: 20px 0; border-left: 4px solid #F59E0B; }
                .info-box { background: #E0F2FE; padding: 15px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #2F5D8C; }
                .button { background: #2F5D8C; color: white; padding: 14px 32px; text-decoration: none; border-radius: 8px; display: inline-block; margin: 20px 0; font-weight: 500; }
                .button:hover { background: #1f4a73; }
                .footer { text-align: center; padding: 20px; font-size: 12px; color: #6B7280; border-top: 1px solid #E8EEF5; margin-top: 20px; }
                ul { padding-left: 20px; }
                li { margin-bottom: 8px; color: #4B5563; }
            </style>
        </head>
        <body>
            <div class="container">
                <div class="header">
                    <h1 style="margin: 0;">Welcome to the Deal Pipeline!</h1>
                </div>
                <div class="content">
                    <p style="font-size: 18px;">Dear ${member.full_name},</p>
                    
                    <p>Thank you for becoming a member of the Opportunity Research Platform. Your payment has been received and your account is ready.</p>
                    
                    <div class="credentials">
                        <h3>🔐 Your Login Credentials</h3>
                        <div class="credential-row">
                            <span class="credential-label">Email:</span>
                            <span class="credential-value">${member.email}</span>
                        </div>
                        <div class="credential-row">
                            <span class="credential-label">Password:</span>
                            <span class="credential-value">${plainPassword}</span>
                        </div>
                        
                        <div class="info-box">
                            <strong>⚠️ Important:</strong> You must complete your financial profile before accessing opportunities.
                        </div>
                    </div>
                    
                    <p style="text-align: center;">
                        <a href="${frontendUrl}/deal-pipeline.html" class="button">📝 Complete Your Profile →</a>
                    </p>
                    
                    <h3 style="color: #2F5D8C; margin-top: 30px;">Next Steps:</h3>
                    <ul>
                        <li>✅ Step 1: Login using the credentials above</li>
                        <li>✅ Step 2: Complete your Assets & Liabilities form</li>
                        <li>✅ Step 3: Access exclusive Deal Pipeline opportunities</li>
                    </ul>
                    
                    <p>If you have any questions, please contact our support team.</p>
                    
                    <p>Best regards,<br><strong>The Opportunity Research Team</strong></p>
                </div>
                <div class="footer">
                    <p>Opportunity Research Platform - Property & Business Research Since 1970</p>
                    <p>Independent professional advice is mandatory before making any participation decision.</p>
                    <p>© ${new Date().getFullYear()} Opportunity Research Platform. All rights reserved.</p>
                </div>
            </div>
        </body>
        </html>
    `;
    
    await emailService.sendEmail(member.email, subject, html);
    console.log(`📧 Credentials email sent to ${member.email}`);
}

// Send A&L reminder email (if member hasn't completed)
async function sendAhlReminderEmail(member) {
    const subject = '⏰ Action Required: Complete Your Financial Profile';
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3001';
    
    const html = `
        <!DOCTYPE html>
        <html>
        <head>
            <style>
                body { font-family: 'Inter', Arial, sans-serif; line-height: 1.6; }
                .container { max-width: 600px; margin: 0 auto; padding: 20px; }
                .header { background: #F59E0B; color: white; padding: 30px; text-align: center; }
                .button { background: #2F5D8C; color: white; padding: 12px 24px; text-decoration: none; border-radius: 8px; display: inline-block; }
            </style>
        </head>
        <body>
            <div class="container">
                <div class="header">
                    <h2>Complete Your Profile</h2>
                </div>
                <p>Dear ${member.full_name},</p>
                <p>Your membership is active, but you haven't completed your financial profile yet.</p>
                <p>Please complete your Assets & Liabilities to access the Deal Pipeline opportunities.</p>
                <p style="text-align: center;">
                    <a href="${frontendUrl}/deal-pipeline.html" class="button">Complete Profile →</a>
                </p>
            </div>
        </body>
        </html>
    `;
    
    await emailService.sendEmail(member.email, subject, html);
    console.log(`📧 A&L reminder sent to ${member.email}`);
}

// ============================================
// STRIPE CHECKOUT SESSION
// ============================================
const createCheckoutSession = async (memberId, memberEmail, memberName) => {
    try {
        const session = await stripe.checkout.sessions.create({
            payment_method_types: ['card'],
            line_items: [
                {
                    price_data: {
                        currency: 'usd',
                        product_data: {
                            name: 'Opportunity Research Platform Annual Membership',
                            description: 'Annual membership for property and business opportunity research',
                        },
                        unit_amount: 69500, // $695 in cents
                    },
                    quantity: 1,
                },
            ],
            mode: 'payment',
            success_url: `${process.env.FRONTEND_URL || 'http://localhost:3001'}/payment-success.html?session_id={CHECKOUT_SESSION_ID}&member_id=${memberId}`,
            cancel_url: `${process.env.FRONTEND_URL || 'http://localhost:3001'}/payment-cancelled.html`,
            metadata: {
                member_id: memberId,
                member_email: memberEmail,
                member_name: memberName
            },
            customer_email: memberEmail,
            customer_creation: 'always'
        });

        return {
            sessionId: session.id,
            url: session.url
        };
    } catch (error) {
        await Log.error('CHECKOUT_SESSION_CREATE_FAILED', error.message);
        throw error;
    }
};

// ============================================
// HANDLE SUCCESSFUL PAYMENT
// ============================================
const handleSuccessfulPayment = async (paymentIntent) => {
    try {
        const { member_id, member_email } = paymentIntent.metadata;
        const amount = paymentIntent.amount / 100;

        console.log(`💰 Processing successful payment for member ${member_id}: $${amount}`);

        // Check for duplicate payment
        const existingPayment = await get(
            'SELECT * FROM payments WHERE stripe_payment_intent_id = ?',
            [paymentIntent.id]
        );

        if (existingPayment) {
            console.log(`⚠️ Payment already processed, skipping...`);
            return existingPayment;
        }

        // Create payment record
        const paymentId = uuidv4();
        const transactionId = `STRIPE-${paymentIntent.id.substring(0, 8)}-${Date.now()}`;
        
        await run(
            `INSERT INTO payments (
                id, member_id, amount, status, payment_method, 
                stripe_payment_intent_id, transaction_id, metadata, 
                payment_date, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
            [
                paymentId, member_id, amount, 'completed', 'stripe',
                paymentIntent.id, transactionId,
                JSON.stringify({
                    stripe_payment_intent: paymentIntent.id,
                    stripe_charge_id: paymentIntent.latest_charge
                })
            ]
        );

        // Get member details
        const member = await get('SELECT * FROM members WHERE id = ?', [member_id]);
        
        if (!member) {
            throw new Error(`Member ${member_id} not found`);
        }

        // ============================================
        // ACTIVATE MEMBERSHIP AND SET PASSWORD
        // ============================================
        
        const renewalDate = new Date();
        renewalDate.setFullYear(renewalDate.getFullYear() + 1);
        
        const plainPassword = generateRandomPassword();
        const hashedPassword = await bcrypt.hash(plainPassword, 10);
        
        // Update member with active status and password (A&L not completed yet)
        await run(
            `UPDATE members SET 
                status = 'active',
                membership_status = 'active',
                password_hash = ?,
                payment_status = 'paid',
                payment_date = datetime('now'),
                renewal_date = ?,
                updated_at = datetime('now')
            WHERE id = ?`,
            [hashedPassword, renewalDate.toISOString().split('T')[0], member_id]
        );
        
        console.log(`✅ Member ${member_id} activated (A&L pending)`);

        // ============================================
        // SEND EMAILS
        // ============================================
        
        const memberObj = {
            ...member,
            full_name: member.full_name,
            email: member.email
        };
        
        // Send credentials email (with A&L completion link)
        await sendMemberCredentialsEmail(memberObj, plainPassword);
        
        // Send payment confirmation email
        const paymentObj = {
            id: paymentId,
            transaction_id: transactionId,
            amount: amount,
            payment_date: new Date().toISOString(),
            payment_method: 'stripe'
        };
        await emailService.sendPaymentConfirmation(paymentObj, memberObj);
        
        // Send detailed receipt
        await emailService.sendPaymentReceipt(paymentObj, memberObj);
        
        // Send admin notification
        await emailService.sendAdminNotification('payment_received', {
            memberName: member.full_name,
            email: member.email,
            amount: amount,
            transactionId: transactionId,
            paymentId: paymentId,
            memberId: member_id
        });

        // ============================================
        // UPDATE GOOGLE SHEETS
        // ============================================
        try {
            await googleSheetsService.updatePaymentStatus(
                member.email,
                member_id,
                'Paid'
            );
            console.log(`✅ Google Sheets updated for ${member.email}`);
        } catch (sheetsError) {
            console.error('Failed to update Google Sheets:', sheetsError.message);
        }

        await Log.info('STRIPE_PAYMENT_SUCCESS', `Payment $${amount} from member ${member_id}`);

        return {
            id: paymentId,
            member_id,
            amount,
            transaction_id: transactionId
        };
        
    } catch (error) {
        console.error('❌ Payment handling failed:', error);
        await Log.error('STRIPE_PAYMENT_HANDLING_FAILED', error.message);
        throw error;
    }
};

// ============================================
// HANDLE FAILED PAYMENT
// ============================================
const handleFailedPayment = async (paymentIntent) => {
    try {
        const { member_id } = paymentIntent.metadata;
        const amount = paymentIntent.amount / 100;
        
        console.log(`❌ Processing failed payment for member ${member_id}: $${amount}`);
        
        const paymentId = uuidv4();
        await run(
            `INSERT INTO payments (
                id, member_id, amount, status, payment_method, 
                stripe_payment_intent_id, transaction_id, metadata, 
                error_message, payment_date, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
            [
                paymentId, member_id, amount, 'failed', 'stripe',
                paymentIntent.id, `STRIPE-${paymentIntent.id.substring(0, 8)}`,
                JSON.stringify({ stripe_payment_intent: paymentIntent.id }),
                paymentIntent.last_payment_error?.message || 'Payment failed'
            ]
        );
        
        const member = await get('SELECT * FROM members WHERE id = ?', [member_id]);
        if (member) {
            await emailService.sendAdminNotification('payment_failed', {
                memberName: member.full_name,
                email: member.email,
                amount: amount,
                memberId: member_id,
                error: paymentIntent.last_payment_error?.message || 'Payment failed'
            });
        }
        
        await Log.warn('STRIPE_PAYMENT_FAILED', `Payment failed for member ${member_id}`);
        
        return { id: paymentId, member_id, amount, status: 'failed' };
        
    } catch (error) {
        await Log.error('FAILED_PAYMENT_HANDLING_FAILED', error.message);
        throw error;
    }
};

// ============================================
// HANDLE STRIPE WEBHOOK
// ============================================
const handleStripeWebhook = async (event) => {
    console.log(`🔔 Received webhook event: ${event.type}`);
    
    switch (event.type) {
        case 'payment_intent.succeeded':
            await handleSuccessfulPayment(event.data.object);
            break;
            
        case 'payment_intent.payment_failed':
            await handleFailedPayment(event.data.object);
            break;
            
        case 'checkout.session.completed':
            const session = event.data.object;
            if (session.payment_intent) {
                const paymentIntent = await stripe.paymentIntents.retrieve(session.payment_intent);
                await handleSuccessfulPayment(paymentIntent);
            }
            break;
            
        default:
            console.log(`⚠️ Unhandled event type: ${event.type}`);
    }
};

// ============================================
// EXPORTS
// ============================================
module.exports = {
    createCheckoutSession,
    handleSuccessfulPayment,
    handleFailedPayment,
    handleStripeWebhook,
    sendAhlReminderEmail,
    stripe
};