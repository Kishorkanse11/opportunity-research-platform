const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const { run, get, all } = require('../config/database');
const emailService = require('../services/emailService');
const googleSheetsService = require('../services/googleSheetsService');

// ============================================
// GET ALL MEMBERS with portfolio data
// ============================================
router.get('/', async (req, res) => {
    try {
        console.log('📋 Fetching all members with portfolio data...');
        
        const members = await all(`
            SELECT m.*, 
                   s.property_count,
                   s.total_mortgage,
                   s.total_valuation,
                   s.lvr,
                   s.property_profile,
                   s.options_explored,
                   s.completion_date as submission_date
            FROM members m
            LEFT JOIN submissions s ON m.id = s.member_id
            ORDER BY m.created_at DESC
        `);
        
        console.log(`✅ Found ${members.length} members`);
        res.json(members);
    } catch (error) {
        console.error('❌ Error fetching members:', error);
        res.status(500).json({ error: error.message });
    }
});

// ============================================
// GET SINGLE MEMBER with all related data
// ============================================
router.get('/:id', async (req, res) => {
    try {
        const member = await get(`
            SELECT m.*, 
                   s.property_count,
                   s.total_mortgage,
                   s.total_valuation,
                   s.lvr,
                   s.property_profile,
                   s.options_explored,
                   s.completion_date as submission_date,
                   s.status as submission_status
            FROM members m
            LEFT JOIN submissions s ON m.id = s.member_id
            WHERE m.id = ?
        `, [req.params.id]);
        
        if (!member) {
            return res.status(404).json({ error: 'Member not found' });
        }
        
        const payments = await all(`
            SELECT * FROM payments 
            WHERE member_id = ? 
            ORDER BY payment_date DESC
        `, [req.params.id]);
        member.payments = payments;
        
        const submissions = await all(`
            SELECT * FROM submissions 
            WHERE member_id = ? 
            ORDER BY created_at DESC
        `, [req.params.id]);
        member.submissions = submissions;
        
        const renewals = await all(`
            SELECT * FROM renewals 
            WHERE member_id = ? 
            ORDER BY renewal_date DESC
        `, [req.params.id]);
        member.renewals = renewals;
        
        res.json(member);
    } catch (error) {
        console.error('❌ Error fetching member:', error);
        res.status(500).json({ error: error.message });
    }
});

// ============================================
// QUICK CREATE MEMBER - Payment First Flow (No A&L Data)
// ============================================
router.post('/quick', async (req, res) => {
    try {
        console.log('📥 Quick member creation (payment first):', req.body);
        
        const { 
            fullName,
            email,
            phone,
            propertyProfile,
            optionsExplored,
            participationType,
            complianceConfirmed,
            infoAccuracyConfirmed,
            ipAddress
        } = req.body;
        
        // Validate required fields
        if (!fullName || !email) {
            return res.status(400).json({ 
                error: 'Full name and email are required' 
            });
        }
        
        // Check if email already exists
        const existingMember = await get('SELECT id FROM members WHERE email = ?', [email]);
        if (existingMember) {
            return res.status(400).json({ 
                error: 'Email already exists',
                message: 'This email is already registered.'
            });
        }
        
        // Generate IDs
        const memberId = uuidv4();
        const joinedDate = new Date().toISOString().split('T')[0];
        
        const renewalDate = new Date();
        renewalDate.setFullYear(renewalDate.getFullYear() + 1);
        const renewalDateStr = renewalDate.toISOString().split('T')[0];
        
        // Insert into members table (status = pending until payment)
        await run(
            `INSERT INTO members (
                id, full_name, email, phone, status,
                joined_date, renewal_date, created_at
            ) VALUES (?, ?, ?, ?, 'pending', ?, ?, datetime('now'))`,
            [memberId, fullName, email, phone || null, joinedDate, renewalDateStr]
        );
        
        // Create a placeholder submission (will be updated after A&L completion)
        const submissionId = uuidv4();
        await run(
            `INSERT INTO submissions (
                id, member_id, full_name, email, date_of_birth,
                property_profile, options_explored, property_count,
                property_value, mortgage_balance, lvr,
                cash_assets, property_assets, investment_assets, super_assets, other_assets,
                mortgage_liabilities, credit_liabilities, loan_liabilities, 
                investment_liabilities, other_liabilities,
                total_assets, total_liabilities, net_position,
                participation_type,
                compliance_confirmed, info_accuracy_confirmed, ip_address,
                completion_date, status, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending_ahl', datetime('now'))`,
            [
                submissionId, memberId, fullName, email, '1970-01-01',
                propertyProfile || 'Pending completion', optionsExplored || 'Pending completion', 0,
                0, 0, null,
                0, 0, 0, 0, 0,
                0, 0, 0, 0, 0,
                0, 0, 0,
                participationType || 'pending',
                complianceConfirmed ? 1 : 0, infoAccuracyConfirmed ? 1 : 0, ipAddress || '127.0.0.1',
                joinedDate
            ]
        );
        
        console.log(`✅ Quick member created (pending A&L): ${memberId}`);
        
        // Log the action
        await run(
            `INSERT INTO logs (id, level, action, details, ip_address, created_at)
             VALUES (?, 'INFO', 'QUICK_MEMBER_CREATED', ?, ?, datetime('now'))`,
            [uuidv4(), `Quick member created: ${email} - Awaiting payment`, req.ip || '127.0.0.1']
        );
        
        res.status(201).json({ 
            id: memberId,
            message: 'Member created successfully. Please complete payment to activate.',
            fullName: fullName,
            email: email,
            requiresPayment: true
        });
        
    } catch (error) {
        console.error('❌ Error creating quick member:', error);
        
        if (error.message.includes('UNIQUE')) {
            res.status(400).json({ 
                error: 'Email already exists',
                message: 'This email is already registered.'
            });
        } else {
            res.status(500).json({ 
                error: 'Failed to create member',
                message: error.message 
            });
        }
    }
});

// ============================================
// CREATE NEW MEMBER from EOI form - Full Flow (With A&L Data)
// ============================================
router.post('/', async (req, res) => {
    try {
        console.log('📥 Received member data from index.html:', req.body);
        
        const { 
            fullName,
            email,
            phone,
            propertyProfile,
            optionsExplored,
            completionDate,
            
            // LVR Calculator data
            propertyValue,
            mortgageBalance,
            
            // Assets & Liabilities data
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
            
            // Participation type
            participationType,
            
            // Compliance
            complianceConfirmed,
            infoAccuracyConfirmed,
            ipAddress
        } = req.body;
        
        // Validate required fields
        const missingFields = [];
        if (!fullName) missingFields.push('Full name');
        if (!email) missingFields.push('Email');
        if (!propertyProfile) missingFields.push('Property profile');
        if (!optionsExplored) missingFields.push('Options explored');
        if (!participationType) missingFields.push('Participation type');
        
        if (missingFields.length > 0) {
            return res.status(400).json({ 
                error: 'Missing required fields', 
                missing: missingFields 
            });
        }
        
        const existingMember = await get('SELECT id FROM members WHERE email = ?', [email]);
        if (existingMember) {
            return res.status(400).json({ 
                error: 'Email already exists',
                message: 'This email is already registered.'
            });
        }
        
        // Generate IDs
        const memberId = uuidv4();
        const submissionId = uuidv4();
        const joinedDate = new Date().toISOString().split('T')[0];
        
        const renewalDate = new Date();
        renewalDate.setFullYear(renewalDate.getFullYear() + 1);
        const renewalDateStr = renewalDate.toISOString().split('T')[0];
        
        // Calculate values
        const propVal = parseFloat(propertyValue) || 0;
        const mortBal = parseFloat(mortgageBalance) || 0;
        const lvr = propVal > 0 ? (mortBal / propVal) * 100 : null;
        
        const cashAssetsVal = parseFloat(cashAssets) || 0;
        const propertyAssetsVal = parseFloat(propertyAssets) || 0;
        const investmentAssetsVal = parseFloat(investmentAssets) || 0;
        const superAssetsVal = parseFloat(superAssets) || 0;
        const otherAssetsVal = parseFloat(otherAssets) || 0;
        
        const mortgageLiabilitiesVal = parseFloat(mortgageLiabilities) || 0;
        const creditLiabilitiesVal = parseFloat(creditLiabilities) || 0;
        const loanLiabilitiesVal = parseFloat(loanLiabilities) || 0;
        const investmentLiabilitiesVal = parseFloat(investmentLiabilities) || 0;
        const otherLiabilitiesVal = parseFloat(otherLiabilities) || 0;
        
        const totalAssets = cashAssetsVal + propertyAssetsVal + investmentAssetsVal + superAssetsVal + otherAssetsVal;
        const totalLiabilities = mortgageLiabilitiesVal + creditLiabilitiesVal + loanLiabilitiesVal + investmentLiabilitiesVal + otherLiabilitiesVal;
        const netPosition = totalAssets - totalLiabilities;
        
        // Insert into members table
        await run(
            `INSERT INTO members (
                id, full_name, email, phone, status,
                joined_date, renewal_date, created_at
            ) VALUES (?, ?, ?, ?, 'pending', ?, ?, datetime('now'))`,
            [memberId, fullName, email, phone || null, joinedDate, renewalDateStr]
        );
        
        // Insert ALL financial data into submissions
        await run(
            `INSERT INTO submissions (
                id, member_id, full_name, email, date_of_birth,
                property_profile, options_explored, property_count,
                property_value, mortgage_balance, lvr,
                cash_assets, property_assets, investment_assets, super_assets, other_assets,
                mortgage_liabilities, credit_liabilities, loan_liabilities, 
                investment_liabilities, other_liabilities,
                total_assets, total_liabilities, net_position,
                participation_type,
                compliance_confirmed, info_accuracy_confirmed, ip_address,
                completion_date, status, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending_review', datetime('now'))`,
            [
                submissionId, memberId, fullName, email, '1970-01-01',
                propertyProfile || '', optionsExplored || '', 1,
                propVal, mortBal, lvr,
                cashAssetsVal, propertyAssetsVal, investmentAssetsVal, superAssetsVal, otherAssetsVal,
                mortgageLiabilitiesVal, creditLiabilitiesVal, loanLiabilitiesVal,
                investmentLiabilitiesVal, otherLiabilitiesVal,
                totalAssets, totalLiabilities, netPosition,
                participationType,
                complianceConfirmed ? 1 : 0, infoAccuracyConfirmed ? 1 : 0, ipAddress || '127.0.0.1',
                completionDate || joinedDate
            ]
        );
        
        console.log(`✅ Member created: ${memberId}`);
        console.log(`✅ Submission created: ${submissionId}`);
        console.log(`📊 Financial data saved: Assets: $${totalAssets}, Liabilities: $${totalLiabilities}, Net: $${netPosition}`);
        
        // Create renewal record
        await run(
            `INSERT INTO renewals (id, member_id, renewal_date, status, created_at)
             VALUES (?, ?, ?, 'pending', datetime('now'))`,
            [uuidv4(), memberId, renewalDateStr]
        );
        
        // Prepare data for Google Sheets
        const sheetData = {
            fullName, email, phone, propertyProfile, optionsExplored, participationType,
            propertyValue: propVal, mortgageBalance: mortBal,
            cashAssets: cashAssetsVal, propertyAssets: propertyAssetsVal,
            investmentAssets: investmentAssetsVal, superAssets: superAssetsVal, otherAssets: otherAssetsVal,
            mortgageLiabilities: mortgageLiabilitiesVal, creditLiabilities: creditLiabilitiesVal,
            loanLiabilities: loanLiabilitiesVal, investmentLiabilities: investmentLiabilitiesVal,
            otherLiabilities: otherLiabilitiesVal,
            ipAddress, complianceConfirmed: !!complianceConfirmed,
            infoAccuracyConfirmed: !!infoAccuracyConfirmed, memberId, paymentStatus: 'Pending'
        };
        
        googleSheetsService.addSubmission(sheetData).catch(err => {
            console.error('Google Sheets error:', err.message);
        });
        
        // Send welcome email
        try {
            const newMember = await get(`
                SELECT m.*, s.property_count, s.total_mortgage, s.total_valuation, s.lvr,
                       s.property_profile, s.options_explored
                FROM members m
                LEFT JOIN submissions s ON m.id = s.member_id
                WHERE m.id = ?
            `, [memberId]);
            
            await emailService.sendWelcomeEmail(newMember);
            console.log(`📧 Welcome email sent to: ${email}`);
            
            await emailService.sendAdminNotification('new_member', {
                memberName: fullName, email: email, memberId: memberId,
                propertyCount: 1, lvr: lvr ? lvr.toFixed(1) + '%' : 'N/A'
            });
            console.log(`📧 Admin notification sent`);
            
        } catch (emailError) {
            console.error('❌ Failed to send welcome email:', emailError.message);
        }
        
        await run(
            `INSERT INTO logs (id, level, action, details, ip_address, created_at)
             VALUES (?, 'INFO', 'MEMBER_CREATED', ?, ?, datetime('now'))`,
            [uuidv4(), `New member created: ${email}`, req.ip || '127.0.0.1']
        );
        
        res.status(201).json({ 
            id: memberId,
            message: 'EOI submitted successfully',
            fullName: fullName,
            email: email,
            lvr: lvr ? lvr.toFixed(1) + '%' : null
        });
        
    } catch (error) {
        console.error('❌ Error creating member:', error);
        
        if (error.message.includes('UNIQUE')) {
            res.status(400).json({ 
                error: 'Email already exists',
                message: 'This email is already registered.'
            });
        } else {
            res.status(500).json({ 
                error: 'Failed to create member',
                message: error.message 
            });
        }
    }
});

// ============================================
// UPDATE MEMBER A&L DATA (After Payment & Login) - FIXED (no updated_at)
// ============================================
router.put('/:id/ahl', async (req, res) => {
    try {
        const { id } = req.params;
        const {
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
            otherLiabilities
        } = req.body;
        
        console.log(`📊 Updating A&L data for member: ${id}`);
        console.log('Received data:', req.body);
        
        // Calculate values
        const propVal = parseFloat(propertyValue) || 0;
        const mortBal = parseFloat(mortgageBalance) || 0;
        const lvr = propVal > 0 ? (mortBal / propVal) * 100 : null;
        
        const cashAssetsVal = parseFloat(cashAssets) || 0;
        const propertyAssetsVal = parseFloat(propertyAssets) || 0;
        const investmentAssetsVal = parseFloat(investmentAssets) || 0;
        const superAssetsVal = parseFloat(superAssets) || 0;
        const otherAssetsVal = parseFloat(otherAssets) || 0;
        
        const mortgageLiabilitiesVal = parseFloat(mortgageLiabilities) || 0;
        const creditLiabilitiesVal = parseFloat(creditLiabilities) || 0;
        const loanLiabilitiesVal = parseFloat(loanLiabilities) || 0;
        const investmentLiabilitiesVal = parseFloat(investmentLiabilities) || 0;
        const otherLiabilitiesVal = parseFloat(otherLiabilities) || 0;
        
        const totalAssets = cashAssetsVal + propertyAssetsVal + investmentAssetsVal + superAssetsVal + otherAssetsVal;
        const totalLiabilities = mortgageLiabilitiesVal + creditLiabilitiesVal + loanLiabilitiesVal + investmentLiabilitiesVal + otherLiabilitiesVal;
        const netPosition = totalAssets - totalLiabilities;
        
        // Get member details
        const member = await get('SELECT * FROM members WHERE id = ?', [id]);
        
        if (!member) {
            return res.status(404).json({ error: 'Member not found' });
        }
        
        // Get the most recent submission ID first
        const latestSubmission = await get(`
            SELECT id FROM submissions WHERE member_id = ? ORDER BY created_at DESC LIMIT 1
        `, [id]);
        
        if (latestSubmission) {
            // Update existing submission by ID (NO updated_at column)
            await run(`
                UPDATE submissions 
                SET 
                    property_value = ?,
                    mortgage_balance = ?,
                    lvr = ?,
                    cash_assets = ?,
                    property_assets = ?,
                    investment_assets = ?,
                    super_assets = ?,
                    other_assets = ?,
                    mortgage_liabilities = ?,
                    credit_liabilities = ?,
                    loan_liabilities = ?,
                    investment_liabilities = ?,
                    other_liabilities = ?,
                    total_assets = ?,
                    total_liabilities = ?,
                    net_position = ?,
                    property_profile = 'A&L Form Submission',
                    options_explored = 'A&L Form Submission',
                    status = 'completed'
                WHERE id = ?
            `, [
                propVal, mortBal, lvr,
                cashAssetsVal, propertyAssetsVal, investmentAssetsVal, superAssetsVal, otherAssetsVal,
                mortgageLiabilitiesVal, creditLiabilitiesVal, loanLiabilitiesVal,
                investmentLiabilitiesVal, otherLiabilitiesVal,
                totalAssets, totalLiabilities, netPosition,
                latestSubmission.id
            ]);
            console.log(`✅ Updated existing submission for member ${id}`);
        } else {
            // Create new submission
            const submissionId = uuidv4();
            const joinedDate = new Date().toISOString().split('T')[0];
            
            await run(`
                INSERT INTO submissions (
                    id, member_id, full_name, email, date_of_birth,
                    property_profile, options_explored, property_count,
                    property_value, mortgage_balance, lvr,
                    cash_assets, property_assets, investment_assets, super_assets, other_assets,
                    mortgage_liabilities, credit_liabilities, loan_liabilities, 
                    investment_liabilities, other_liabilities,
                    total_assets, total_liabilities, net_position,
                    participation_type,
                    completion_date, status, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'completed', datetime('now'))
            `, [
                submissionId, id, member.full_name, member.email, '1970-01-01',
                'A&L Form Submission', 'A&L Form Submission', 1,
                propVal, mortBal, lvr,
                cashAssetsVal, propertyAssetsVal, investmentAssetsVal, superAssetsVal, otherAssetsVal,
                mortgageLiabilitiesVal, creditLiabilitiesVal, loanLiabilitiesVal,
                investmentLiabilitiesVal, otherLiabilitiesVal,
                totalAssets, totalLiabilities, netPosition,
                'pending',
                joinedDate
            ]);
            console.log(`✅ Created new submission for member ${id}`);
        }
        
        // Update Google Sheets
        try {
            const sheetData = {
                fullName: member.full_name,
                email: member.email,
                phone: member.phone || '',
                propertyProfile: 'A&L Form Submission',
                optionsExplored: 'A&L Form Submission',
                participationType: 'pending',
                propertyValue: propVal,
                mortgageBalance: mortBal,
                cashAssets: cashAssetsVal,
                propertyAssets: propertyAssetsVal,
                investmentAssets: investmentAssetsVal,
                superAssets: superAssetsVal,
                otherAssets: otherAssetsVal,
                mortgageLiabilities: mortgageLiabilitiesVal,
                creditLiabilities: creditLiabilitiesVal,
                loanLiabilities: loanLiabilitiesVal,
                investmentLiabilities: investmentLiabilitiesVal,
                otherLiabilities: otherLiabilitiesVal,
                ipAddress: req.ip || '127.0.0.1',
                complianceConfirmed: true,
                infoAccuracyConfirmed: true,
                memberId: id,
                paymentStatus: 'Paid'
            };
            await googleSheetsService.addSubmission(sheetData);
            console.log(`✅ Google Sheets updated for member ${member.email}`);
        } catch (sheetsError) {
            console.error('Google Sheets error:', sheetsError.message);
        }
        
        console.log(`✅ A&L data saved for member: ${id}`);
        console.log(`📊 Totals: Assets: $${totalAssets}, Liabilities: $${totalLiabilities}, Net: $${netPosition}`);
        
        res.json({ 
            success: true, 
            message: 'Financial profile updated successfully',
            data: { 
                totalAssets, 
                totalLiabilities, 
                netPosition,
                lvr: lvr ? lvr.toFixed(1) + '%' : '—'
            }
        });
        
    } catch (error) {
        console.error('❌ Error updating A&L data:', error);
        res.status(500).json({ error: error.message });
    }
});

// ============================================
// UPDATE MEMBER
// ============================================
router.put('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const updates = req.body;
        
        const existingMember = await get('SELECT * FROM members WHERE id = ?', [id]);
        if (!existingMember) {
            return res.status(404).json({ error: 'Member not found' });
        }
        
        const fields = [];
        const values = [];
        
        const allowedFields = [
            'full_name', 'email', 'phone', 'status', 
            'membership_status', 'renewal_date', 'notes',
            'payment_method', 'last_notice_sent'
        ];
        
        Object.entries(updates).forEach(([key, value]) => {
            if (value !== undefined && allowedFields.includes(key)) {
                fields.push(`${key} = ?`);
                values.push(value);
            }
        });
        
        if (fields.length === 0) {
            return res.status(400).json({ error: 'No valid fields to update' });
        }
        
        values.push(id);
        
        await run(
            `UPDATE members SET ${fields.join(', ')}, updated_at = datetime('now') WHERE id = ?`,
            values
        );
        
        const updatedMember = await get(`
            SELECT m.*, 
                   s.property_count, s.total_mortgage, s.total_valuation, s.lvr,
                   s.property_profile, s.options_explored
            FROM members m
            LEFT JOIN submissions s ON m.id = s.member_id
            WHERE m.id = ?
        `, [id]);
        
        await run(
            `INSERT INTO logs (id, level, action, details, created_at)
             VALUES (?, 'INFO', 'MEMBER_UPDATED', ?, datetime('now'))`,
            [uuidv4(), `Member ${id} updated`]
        );
        
        res.json(updatedMember);
    } catch (error) {
        console.error('❌ Error updating member:', error);
        res.status(500).json({ error: error.message });
    }
});

// ============================================
// DELETE MEMBER
// ============================================
router.delete('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        
        const member = await get('SELECT * FROM members WHERE id = ?', [id]);
        if (!member) {
            return res.status(404).json({ error: 'Member not found' });
        }
        
        await run(
            `INSERT INTO logs (id, level, action, details, created_at)
             VALUES (?, 'WARN', 'MEMBER_DELETED', ?, datetime('now'))`,
            [uuidv4(), `Member ${member.email} deleted`]
        );
        
        await run('DELETE FROM members WHERE id = ?', [id]);
        console.log(`✅ Member deleted: ${id} (${member.email})`);
        
        res.json({ 
            message: 'Member deleted successfully',
            id: id,
            email: member.email
        });
    } catch (error) {
        console.error('❌ Error deleting member:', error);
        res.status(500).json({ error: error.message });
    }
});

// ============================================
// GET MEMBER STATISTICS
// ============================================
router.get('/stats/summary', async (req, res) => {
    try {
        const total = await get('SELECT COUNT(*) as count FROM members');
        const active = await get("SELECT COUNT(*) as count FROM members WHERE status = 'active'");
        const pending = await get("SELECT COUNT(*) as count FROM members WHERE status = 'pending'");
        const expired = await get("SELECT COUNT(*) as count FROM members WHERE status = 'expired'");
        
        const recent = await all(`
            SELECT id, full_name, email, status, created_at 
            FROM members 
            WHERE created_at >= datetime('now', '-30 days')
            ORDER BY created_at DESC
            LIMIT 10
        `);
        
        const upcomingRenewals = await all(`
            SELECT id, full_name, email, renewal_date,
                   julianday(renewal_date) - julianday('now') as days_left
            FROM members
            WHERE status = 'active'
              AND renewal_date >= date('now')
              AND renewal_date <= date('now', '+30 days')
            ORDER BY renewal_date ASC
        `);
        
        res.json({
            counts: {
                total: total.count,
                active: active.count,
                pending: pending.count,
                expired: expired.count
            },
            recent: recent,
            upcomingRenewals: upcomingRenewals
        });
    } catch (error) {
        console.error('❌ Error fetching member stats:', error);
        res.status(500).json({ error: error.message });
    }
});

// ============================================
// SEARCH MEMBERS
// ============================================
router.get('/search/:query', async (req, res) => {
    try {
        const searchQuery = `%${req.params.query}%`;
        
        const members = await all(`
            SELECT m.*, 
                   s.property_count, s.total_mortgage, s.total_valuation, s.lvr
            FROM members m
            LEFT JOIN submissions s ON m.id = s.member_id
            WHERE m.full_name LIKE ? 
               OR m.email LIKE ? 
               OR m.phone LIKE ?
            ORDER BY m.created_at DESC
        `, [searchQuery, searchQuery, searchQuery]);
        
        res.json({
            query: req.params.query,
            count: members.length,
            members: members
        });
    } catch (error) {
        console.error('❌ Error searching members:', error);
        res.status(500).json({ error: error.message });
    }
});

// ============================================
// BULK OPERATIONS
// ============================================
router.patch('/bulk/status', async (req, res) => {
    try {
        const { memberIds, status } = req.body;
        
        if (!Array.isArray(memberIds) || memberIds.length === 0) {
            return res.status(400).json({ error: 'Member IDs array required' });
        }
        
        if (!status) {
            return res.status(400).json({ error: 'Status required' });
        }
        
        const placeholders = memberIds.map(() => '?').join(',');
        await run(
            `UPDATE members SET status = ?, updated_at = datetime('now') 
             WHERE id IN (${placeholders})`,
            [status, ...memberIds]
        );
        
        res.json({ 
            message: `Updated ${memberIds.length} members to status: ${status}`,
            count: memberIds.length
        });
    } catch (error) {
        console.error('❌ Error bulk updating members:', error);
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;