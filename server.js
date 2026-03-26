require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const cron = require('node-cron');
const path = require('path');
const { testConnection } = require('./src/config/database');
const { scheduleRenewalCheck } = require('./src/cron/renewalCheck');
const emailService = require('./src/services/emailService');
const googleSheetsService = require('./src/services/googleSheetsService');

const app = express();

// ============================================
// KILL SWITCH - Maintenance Mode (MUST BE FIRST!)
// ============================================
let maintenanceMode = false;

// IMPORTANT: This middleware must come BEFORE any other routes
app.use((req, res, next) => {
    // Log every request for debugging
    console.log(`🔍 Request: ${req.method} ${req.path} | Maintenance Mode: ${maintenanceMode}`);
    
    // Skip for critical paths - these must work even in maintenance mode
    const skipPaths = [
        '/health',
        '/webhook/stripe',
        '/api/admin/site-status',
        '/api/admin/kill-switch',
        '/maintenance.html'
    ];
    
    if (skipPaths.some(p => req.path === p)) {
        console.log(`✅ Skipping maintenance check for: ${req.path}`);
        return next();
    }
    
    // Allow access to super admin panel (secret URL)
    if (req.path.includes('dev-super-9x7k2m')) {
        console.log(`🔐 Super admin access allowed: ${req.path}`);
        return next();
    }
    
    // If maintenance mode is ON, redirect to maintenance page
    if (maintenanceMode) {
        console.log(`🔴 MAINTENANCE MODE: Blocking ${req.path}`);
        return res.status(503).sendFile(path.join(__dirname, 'frontend', 'maintenance.html'));
    }
    
    next();
});

// Security middleware
app.use(helmet({
    contentSecurityPolicy: false
}));

// CORS
app.use(cors({
    origin: process.env.NODE_ENV === 'production' 
        ? ['https://help.com.au', 'https://admin.help.com.au']
        : ['http://localhost:3001', 'http://127.0.0.1:3001'],
    credentials: true
}));

// Rate limiting
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100
});
app.use('/api/', limiter);

// Body parsing
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Request logging
app.use(async (req, res, next) => {
    console.log(`${req.method} ${req.path}`);
    next();
});

// Health check
app.get('/health', async (req, res) => {
    const dbStatus = await testConnection();
    res.json({
        status: 'running',
        database: dbStatus ? 'connected' : 'disconnected',
        maintenance_mode: maintenanceMode,
        timestamp: new Date().toISOString()
    });
});

// ============================================
// KILL SWITCH ROUTES
// ============================================

// Get site status
app.get('/api/admin/site-status', (req, res) => {
    console.log(`📊 Site status requested: maintenance_mode = ${maintenanceMode}`);
    res.json({ 
        maintenance_mode: maintenanceMode,
        status: maintenanceMode ? 'offline' : 'online'
    });
});

// Activate/Deactivate kill switch
app.post('/api/admin/kill-switch', (req, res) => {
    const { action } = req.body;
    console.log(`🔧 Kill switch action: ${action}`);
    
    if (action === 'activate') {
        maintenanceMode = true;
        console.log('🔴🔴🔴 KILL SWITCH ACTIVATED - Site is now OFFLINE 🔴🔴🔴');
        res.json({ 
            success: true, 
            maintenance_mode: true,
            message: 'Site is now in maintenance mode'
        });
    } else if (action === 'deactivate') {
        maintenanceMode = false;
        console.log('🟢🟢🟢 SITE RESTORED - Site is now ONLINE 🟢🟢🟢');
        res.json({ 
            success: true, 
            maintenance_mode: false,
            message: 'Site is back online'
        });
    } else {
        res.status(400).json({ error: 'Invalid action. Use "activate" or "deactivate"' });
    }
});

// ============================================
// API Routes
// ============================================
app.use('/api/auth', require('./src/routes/auth'));
app.use('/api/members', require('./src/routes/members'));
app.use('/api/member-auth', require('./src/routes/member-auth'));
app.use('/api/member', require('./src/routes/member-data'));
app.use('/api/submissions', require('./src/routes/submissions'));
app.use('/api/renewals', require('./src/routes/renewals'));
app.use('/api/admin', require('./src/routes/admin'));
app.use('/api/payments', require('./src/routes/payments'));

// Serve frontend static files (for maintenance.html)
app.use(express.static(path.join(__dirname, 'frontend')));

// Stripe webhook (raw body required)
app.post('/webhook/stripe', express.raw({ type: 'application/json' }), async (req, res) => {
    const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
    const sig = req.headers['stripe-signature'];
    let event;

    try {
        event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
    } catch (err) {
        console.log(`Webhook signature verification failed.`, err.message);
        return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    if (event.type === 'checkout.session.completed') {
        const session = event.data.object;
        const memberId = session.metadata.member_id;
        const { handleSuccessfulPayment } = require('./src/services/paymentService');
        await handleSuccessfulPayment(session, memberId);
    }

    res.json({ received: true });
});

// Error handler
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({ error: 'Internal server error' });
});

// Start server
const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, async () => {
    console.log(`🚀 Server running on port ${PORT}`);
    
    const dbConnected = await testConnection();
    
    if (dbConnected) {
        console.log('📊 Initializing Google Sheets...');
        try {
            await googleSheetsService.initialize();
            console.log('✅ Google Sheets initialized');
        } catch (error) {
            console.error('❌ Google Sheets initialization failed:', error.message);
        }
        
        console.log('📧 Initializing email service...');
        console.log('⏰ Starting scheduled jobs...');
        scheduleRenewalCheck();
        
        console.log(`✅ Server fully initialized at ${new Date().toLocaleString()}`);
        console.log(`📊 Environment: ${process.env.NODE_ENV || 'development'}`);
        console.log(`📧 Email notifications: ${process.env.SMTP_USER ? 'Configured' : 'Not configured'}`);
        console.log(`💳 Payments: ${process.env.STRIPE_SECRET_KEY ? 'Configured' : 'Not configured'}`);
        console.log(`🔐 Kill Switch: ${maintenanceMode ? 'ACTIVE (Site Offline)' : 'INACTIVE (Site Online)'}`);
    }
});

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('SIGTERM received, shutting down gracefully...');
    server.close(() => {
        console.log('Server closed');
        process.exit(0);
    });
});

process.on('SIGINT', () => {
    console.log('SIGINT received, shutting down gracefully...');
    server.close(() => {
        console.log('Server closed');
        process.exit(0);
    });
});

module.exports = app;