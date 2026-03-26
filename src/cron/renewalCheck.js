// src/cron/renewalCheck.js
const cron = require('node-cron');
const renewalService = require('../services/renewalService');
const { run } = require('../config/database');
const { v4: uuidv4 } = require('uuid');

// Schedule renewal checks
const scheduleRenewalCheck = () => {
    // Run daily at 8:00 AM
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
            await run(
                `INSERT INTO system_jobs (id, job_name, status, result, run_at)
                 VALUES (?, 'renewal_check', 'completed', ?, datetime('now'))`,
                [uuidv4(), JSON.stringify(results)]
            );

        } catch (error) {
            console.error('❌ Renewal check failed:', error);
            
            await run(
                `INSERT INTO system_jobs (id, job_name, status, error, run_at)
                 VALUES (?, 'renewal_check', 'failed', ?, datetime('now'))`,
                [uuidv4(), error.message]
            );
        }
    }, {
        scheduled: true,
        timezone: "Australia/Sydney"
    });

    console.log('✅ Renewal check scheduled for 8:00 AM daily (Australia/Sydney)');
    
    // Also schedule a check at 2:00 PM as backup
    cron.schedule('0 14 * * *', async () => {
        console.log('⏰ Running afternoon renewal check...');
        try {
            await renewalService.checkRenewals();
        } catch (error) {
            console.error('❌ Afternoon renewal check failed:', error);
        }
    }, {
        scheduled: true,
        timezone: "Australia/Sydney"
    });
};

// Manual trigger for testing
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