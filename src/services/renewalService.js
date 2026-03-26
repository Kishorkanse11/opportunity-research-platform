// src/cron/renewalCheck.js
const cron = require('node-cron');
const renewalService = require('../services/renewalService');
const { query } = require('../config/database');

// Run daily at 8:00 AM
const scheduleRenewalCheck = () => {
    cron.schedule('0 8 * * *', async () => {
        console.log('⏰ Running scheduled renewal check at', new Date().toLocaleString());
        
        try {
            const results = await renewalService.checkRenewals();
            
            console.log('📊 Renewal check results:', {
                total: results.total,
                sent: results.sent,
                failed: results.failed,
                timestamp: new Date().toISOString()
            });

            // Log to database
            await query(
                `INSERT INTO system_jobs (id, job_name, status, result, run_at)
                 VALUES (?, 'renewal_check', 'completed', ?, datetime('now'))`,
                [require('uuid').v4(), JSON.stringify(results)]
            );

        } catch (error) {
            console.error('❌ Renewal check failed:', error);
            
            await query(
                `INSERT INTO system_jobs (id, job_name, status, error, run_at)
                 VALUES (?, 'renewal_check', 'failed', ?, datetime('now'))`,
                [require('uuid').v4(), error.message]
            );
        }
    }, {
        scheduled: true,
        timezone: "Australia/Sydney"
    });

    console.log('✅ Renewal check scheduled for 8:00 AM daily');
};

// Run immediately for testing (optional)
const runNow = async () => {
    console.log('🚀 Running manual renewal check...');
    const results = await renewalService.checkRenewals();
    console.log('✅ Manual check complete:', results);
    return results;
};

module.exports = {
    scheduleRenewalCheck,
    runNow
};