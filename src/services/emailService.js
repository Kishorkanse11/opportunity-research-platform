const nodemailer = require('nodemailer');
const fs = require('fs');
const path = require('path');
const { run } = require('../config/database');
const { v4: uuidv4 } = require('uuid');

class EmailService {
    constructor() {
        this.transporter = null;
        this.templates = {};
        this.init();
    }

    async init() {
        // Create transporter
        this.transporter = nodemailer.createTransport({
            host: process.env.SMTP_HOST,
            port: parseInt(process.env.SMTP_PORT),
            secure: process.env.SMTP_SECURE === 'true',
            auth: {
                user: process.env.SMTP_USER,
                pass: process.env.SMTP_PASS
            },
            pool: true,
            maxConnections: 5,
            maxMessages: 100
        });

        // Load email templates
        await this.loadTemplates();

        // Verify connection
        try {
            await this.transporter.verify();
            console.log('✅ Email service initialized');
        } catch (error) {
            console.error('❌ Email service failed:', error.message);
        }
    }

    async loadTemplates() {
        const templateDir = path.join(__dirname, '../templates');
        const templates = ['receipt.html', 'renewal-notice.html', 'welcome.html'];
        
        for (const template of templates) {
            try {
                const content = fs.readFileSync(path.join(templateDir, template), 'utf8');
                this.templates[template.replace('.html', '')] = content;
                console.log(`✅ Loaded template: ${template}`);
            } catch (error) {
                console.error(`❌ Failed to load template ${template}:`, error.message);
            }
        }
    }

    // Replace template variables
    renderTemplate(templateName, variables) {
        let html = this.templates[templateName];
        if (!html) {
            throw new Error(`Template ${templateName} not found`);
        }

        Object.keys(variables).forEach(key => {
            const regex = new RegExp(`{{${key}}}`, 'g');
            html = html.replace(regex, variables[key] || '');
        });

        html = html.replace(/{{year}}/g, new Date().getFullYear().toString());
        return html;
    }

    // Send email
    async sendEmail(to, subject, html, options = {}) {
        try {
            console.log(`📧 Sending email to: ${to}`);
            
            if (!this.transporter) {
                console.error('❌ Email transporter not initialized!');
                return { error: 'Email service not configured' };
            }

            const mailOptions = {
                from: process.env.EMAIL_FROM,
                to,
                subject,
                html,
                ...options
            };

            const info = await this.transporter.sendMail(mailOptions);
            console.log(`✅ Email sent to ${to}: ${subject}`);
            
            await run(
                `INSERT INTO email_logs (id, recipient, subject, status, sent_at, created_at) 
                 VALUES (?, ?, ?, 'sent', datetime('now'), datetime('now'))`,
                [uuidv4(), to, subject]
            );

            return info;
        } catch (error) {
            console.error(`❌ Failed to send email to ${to}:`, error.message);
            
            await run(
                `INSERT INTO email_logs (id, recipient, subject, status, error, sent_at, created_at) 
                 VALUES (?, ?, ?, 'failed', ?, datetime('now'), datetime('now'))`,
                [uuidv4(), to, subject, error.message]
            );
            
            throw error;
        }
    }

    // ============================================
    // WELCOME EMAIL - THIS IS THE MISSING METHOD
    // ============================================
    async sendWelcomeEmail(member) {
        try {
            console.log(`📧 Sending welcome email to: ${member.email}`);
            
            const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3001';
            
            const html = `
                <!DOCTYPE html>
                <html>
                <head>
                    <meta charset="UTF-8">
                    <style>
                        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
                        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
                        .header { background: #2F5D8C; color: white; padding: 30px; text-align: center; border-radius: 8px 8px 0 0; }
                        .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 8px 8px; }
                        .button { background: #2F5D8C; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; display: inline-block; margin: 20px 0; }
                        .footer { text-align: center; padding: 20px; font-size: 12px; color: #666; border-top: 1px solid #ddd; margin-top: 20px; }
                    </style>
                </head>
                <body>
                    <div class="container">
                        <div class="header">
                            <h2>Welcome to Opportunity Research Platform!</h2>
                        </div>
                        <div class="content">
                            <p>Dear ${member.full_name},</p>
                            
                            <p>Thank you for submitting your Expression of Interest to the Opportunity Research Platform.</p>
                            
                            <p><strong>What happens next?</strong></p>
                            <ul>
                                <li>✅ Our team will review your submission within 48 hours</li>
                                <li>✅ You'll receive a payment link to activate your membership</li>
                                <li>✅ After payment, you'll get login credentials for the Deal Pipeline</li>
                            </ul>
                            
                            <p style="text-align: center;">
                                <a href="${frontendUrl}/member-login.html" class="button">View Your Profile</a>
                            </p>
                            
                            <p>If you have any questions, please contact our support team.</p>
                            
                            <p>Best regards,<br><strong>Opportunity Research Team</strong></p>
                        </div>
                        <div class="footer">
                            <p>Opportunity Research Platform - Property & Business Research Since 1970</p>
                            <p>Independent professional advice is mandatory before making any participation decision.</p>
                        </div>
                    </div>
                </body>
                </html>
            `;
            
            return await this.sendEmail(
                member.email,
                '🎉 Welcome to the Opportunity Research Platform!',
                html
            );
        } catch (error) {
            console.error('❌ Failed to send welcome email:', error.message);
            throw error;
        }
    }

    // ============================================
    // PAYMENT CONFIRMATION EMAIL
    // ============================================
    async sendPaymentConfirmation(payment, member) {
        const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3001';
        
        const html = `
            <!DOCTYPE html>
            <html>
            <head>
                <style>
                    body { font-family: Arial; line-height: 1.6; }
                    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
                    .header { background: #2F5D8C; color: white; padding: 20px; text-align: center; }
                    .content { padding: 30px; background: #f9f9f9; }
                    .button { background: #2F5D8C; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; display: inline-block; }
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
                        <p><strong>Amount:</strong> $${payment.amount} USD</p>
                        <p><strong>Transaction ID:</strong> ${payment.transaction_id}</p>
                        <p>Your membership is now active.</p>
                        <p style="text-align: center;">
                            <a href="${frontendUrl}/member-login.html" class="button">Login to Dashboard</a>
                        </p>
                    </div>
                </div>
            </body>
            </html>
        `;
        
        return await this.sendEmail(
            member.email,
            `💰 Payment Confirmed - $${payment.amount} USD`,
            html
        );
    }

    // ============================================
    // PAYMENT RECEIPT
    // ============================================
    async sendPaymentReceipt(payment, member) {
        const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3001';
        
        const html = `
            <!DOCTYPE html>
            <html>
            <head>
                <style>
                    body { font-family: Arial; line-height: 1.6; }
                    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
                    .header { background: #2F5D8C; color: white; padding: 20px; text-align: center; }
                </style>
            </head>
            <body>
                <div class="container">
                    <div class="header">
                        <h2>Tax Invoice / Receipt</h2>
                    </div>
                    <div class="content">
                        <p>Dear ${member.full_name},</p>
                        <p><strong>Transaction ID:</strong> ${payment.transaction_id}</p>
                        <p><strong>Amount:</strong> $${payment.amount} USD</p>
                        <p><strong>Date:</strong> ${new Date(payment.payment_date).toLocaleDateString()}</p>
                        <p><strong>Valid Until:</strong> ${new Date(member.renewal_date).toLocaleDateString()}</p>
                        <p>This is an administrative fee, not an investment. Independent professional advice is mandatory.</p>
                    </div>
                </div>
            </body>
            </html>
        `;
        
        return await this.sendEmail(
            member.email,
            `🧾 Your Receipt - ${payment.transaction_id}`,
            html
        );
    }

    // ============================================
    // RENEWAL NOTIFICATION
    // ============================================
    async sendRenewalNotice(member, daysLeft) {
        const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3001';
        
        const subject = daysLeft <= 3 
            ? `⚠️ URGENT: Your membership renews in ${daysLeft} days`
            : `⏰ Reminder: Your membership renews in ${daysLeft} days`;
            
        const html = `
            <!DOCTYPE html>
            <html>
            <head>
                <style>
                    body { font-family: Arial; line-height: 1.6; }
                    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
                </style>
            </head>
            <body>
                <div class="container">
                    <h2>Membership Renewal Notice</h2>
                    <p>Dear ${member.full_name},</p>
                    <p>Your membership will automatically renew in <strong>${daysLeft} days</strong>.</p>
                    <p><strong>Renewal Date:</strong> ${new Date(member.renewal_date).toLocaleDateString()}</p>
                    <p>If you wish to cancel, please log in to your dashboard.</p>
                    <p><a href="${frontendUrl}/member-login.html">Manage Membership</a></p>
                </div>
            </body>
            </html>
        `;
        
        return await this.sendEmail(member.email, subject, html);
    }

    // ============================================
    // ADMIN NOTIFICATIONS
    // ============================================
    async sendAdminNotification(type, data) {
        const adminEmail = process.env.EMAIL_ADMIN;
        
        let subject, html;
        
        switch(type) {
            case 'new_member':
                subject = `👤 New Member: ${data.memberName}`;
                html = `<h2>New Member</h2><p>Name: ${data.memberName}</p><p>Email: ${data.email}</p>`;
                break;
            case 'payment_received':
                subject = `💰 Payment: $${data.amount} from ${data.memberName}`;
                html = `<h2>Payment Received</h2><p>Member: ${data.memberName}</p><p>Amount: $${data.amount}</p>`;
                break;
            default:
                return;
        }
        
        if (adminEmail && subject) {
            await this.sendEmail(adminEmail, subject, html);
        }
    }
}

module.exports = new EmailService();