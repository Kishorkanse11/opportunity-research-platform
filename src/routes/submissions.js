const express = require('express');
const router = express.Router();
const { all, get, run } = require('../config/database');
const googleSheetsService = require('../services/googleSheetsService'); // Add this

// GET all submissions
router.get('/', async (req, res) => {
    try {
        console.log('📋 Fetching all submissions...');
        const submissions = await all(`
            SELECT s.*, 
                   m.full_name as member_name,
                   m.email as member_email
            FROM submissions s
            LEFT JOIN members m ON s.member_id = m.id
            ORDER BY s.created_at DESC
        `);
        console.log(`✅ Found ${submissions.length} submissions`);
        res.json(submissions);
    } catch (error) {
        console.error('❌ Error fetching submissions:', error);
        res.status(500).json({ error: error.message });
    }
});

// GET single submission
router.get('/:id', async (req, res) => {
    try {
        const submission = await get('SELECT * FROM submissions WHERE id = ?', [req.params.id]);
        if (!submission) {
            return res.status(404).json({ error: 'Submission not found' });
        }
        res.json(submission);
    } catch (error) {
        console.error('❌ Error fetching submission:', error);
        res.status(500).json({ error: error.message });
    }
});

// ============================================
// NEW: POST new submission (from EOI form)
// ============================================
router.post('/', async (req, res) => {
    try {
        const {
            fullName,
            email,
            phone,
            propertyProfile,
            optionsExplored,
            participationType,
            propertyValue,
            mortgageBalance,
            cashAssets,
            propertyAssets,
            investmentAssets,
            superAssets,
            otherAssets,
            mortgageLiabilities,
            creditLiabilities,
            loanLiabilities,
            investmentLiabilities,
            otherLiabilities,
            complianceConfirmed,
            infoAccuracyConfirmed,
            ipAddress
        } = req.body;

        // Validate required fields
        if (!fullName || !email || !propertyProfile) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        // Calculate LVR
        const lvr = propertyValue && propertyValue > 0 
            ? ((mortgageBalance || 0) / propertyValue * 100).toFixed(1)
            : null;

        // Calculate totals
        const totalAssets = (parseFloat(cashAssets) || 0) + 
                           (parseFloat(propertyAssets) || 0) + 
                           (parseFloat(investmentAssets) || 0) + 
                           (parseFloat(superAssets) || 0) + 
                           (parseFloat(otherAssets) || 0);
        
        const totalLiabilities = (parseFloat(mortgageLiabilities) || 0) + 
                                (parseFloat(creditLiabilities) || 0) + 
                                (parseFloat(loanLiabilities) || 0) + 
                                (parseFloat(investmentLiabilities) || 0) + 
                                (parseFloat(otherLiabilities) || 0);
        
        const netPosition = totalAssets - totalLiabilities;

        // Insert into database
        const result = await run(
            `INSERT INTO submissions (
                full_name, email, phone, property_profile, options_explored,
                participation_type, property_value, mortgage_balance, lvr,
                cash_assets, property_assets, investment_assets, super_assets, other_assets,
                mortgage_liabilities, credit_liabilities, loan_liabilities, 
                investment_liabilities, other_liabilities,
                total_assets, total_liabilities, net_position,
                compliance_confirmed, info_accuracy_confirmed, ip_address,
                status, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending_review', datetime('now'))`,
            [
                fullName, email, phone, propertyProfile, optionsExplored,
                participationType, propertyValue, mortgageBalance, lvr,
                cashAssets, propertyAssets, investmentAssets, superAssets, otherAssets,
                mortgageLiabilities, creditLiabilities, loanLiabilities,
                investmentLiabilities, otherLiabilities,
                totalAssets, totalLiabilities, netPosition,
                complianceConfirmed ? 1 : 0, infoAccuracyConfirmed ? 1 : 0, ipAddress
            ]
        );

        const newSubmission = await get('SELECT * FROM submissions WHERE id = ?', [result.id]);

        // ============================================
        // SAVE TO GOOGLE SHEETS (don't await - run in background)
        // ============================================
        googleSheetsService.addSubmission({
            fullName,
            email,
            phone,
            propertyProfile,
            optionsExplored,
            participationType,
            propertyValue,
            mortgageBalance,
            cashAssets,
            propertyAssets,
            investmentAssets,
            superAssets,
            otherAssets,
            mortgageLiabilities,
            creditLiabilities,
            loanLiabilities,
            investmentLiabilities,
            otherLiabilities,
            totalAssets,
            totalLiabilities,
            netPosition,
            lvr: lvr ? lvr + '%' : '—',
            complianceConfirmed,
            infoAccuracyConfirmed,
            ipAddress,
            memberId: null, // Will be updated after payment
            paymentStatus: 'Pending'
        }).catch(err => {
            console.error('❌ Failed to save to Google Sheets:', err.message);
            // Don't fail the request - just log the error
        });

        console.log(`✅ New submission saved with ID: ${result.id}`);
        res.status(201).json(newSubmission);

    } catch (error) {
        console.error('❌ Error creating submission:', error);
        res.status(500).json({ error: error.message });
    }
});

// PUT update submission status (with notes)
router.put('/:id/review', async (req, res) => {
    try {
        const { id } = req.params;
        const { status, reviewed_by, notes } = req.body;
        
        await run(
            `UPDATE submissions 
             SET status = ?, reviewed_by = ?, reviewed_at = datetime('now'), notes = ?
             WHERE id = ?`,
            [status, reviewed_by, notes || '', id]
        );
        
        const updated = await get('SELECT * FROM submissions WHERE id = ?', [id]);
        
        // If status changed to 'completed', this could trigger something else
        if (status === 'completed') {
            console.log(`✅ Submission ${id} marked as completed`);
            // Could trigger email to member, etc.
        }
        
        res.json(updated);
    } catch (error) {
        console.error('❌ Error updating submission:', error);
        res.status(500).json({ error: error.message });
    }
});

// ============================================
// NEW: Update payment status (called from payment webhook)
// ============================================
router.patch('/:id/payment-status', async (req, res) => {
    try {
        const { id } = req.params;
        const { paymentStatus, memberId } = req.body;
        
        await run(
            'UPDATE submissions SET payment_status = ?, member_id = ? WHERE id = ?',
            [paymentStatus, memberId, id]
        );
        
        // Also update Google Sheets
        const submission = await get('SELECT email FROM submissions WHERE id = ?', [id]);
        if (submission) {
            googleSheetsService.updatePaymentStatus(
                submission.email,
                memberId,
                paymentStatus
            ).catch(err => console.error('Failed to update sheets:', err));
        }
        
        res.json({ success: true });
    } catch (error) {
        console.error('❌ Error updating payment status:', error);
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;