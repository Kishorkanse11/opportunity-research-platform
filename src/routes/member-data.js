const express = require('express');
const router = express.Router();
const { get, all } = require('../config/database');
const jwt = require('jsonwebtoken');

// ============================================
// MIDDLEWARE: Verify Member Token
// ============================================
async function verifyMemberToken(req, res, next) {
    const authHeader = req.headers.authorization;
    const token = authHeader?.split(' ')[1];
    
    if (!token) {
        return res.status(401).json({ error: 'No token provided' });
    }
    
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key');
        req.memberId = decoded.id;
        req.memberEmail = decoded.email;
        next();
    } catch (error) {
        console.error('Token verification error:', error);
        return res.status(401).json({ error: 'Invalid token' });
    }
}

// ============================================
// GET MEMBER STATUS (for dashboard)
// ============================================
router.get('/members/:memberId/status', verifyMemberToken, async (req, res) => {
    try {
        // Ensure the member is requesting their own data
        if (req.params.memberId !== req.memberId) {
            return res.status(403).json({ error: 'Unauthorized' });
        }
        
        const member = await get(`
            SELECT id, full_name, email, phone, status, membership_status, 
                   joined_date, renewal_date, created_at
            FROM members 
            WHERE id = ?
        `, [req.params.memberId]);
        
        if (!member) {
            return res.status(404).json({ error: 'Member not found' });
        }
        
        res.json(member);
    } catch (error) {
        console.error('Error fetching member status:', error);
        res.status(500).json({ error: error.message });
    }
});

// ============================================
// GET MEMBER'S FINANCIAL DATA
// ============================================
router.get('/financial/:memberId', verifyMemberToken, async (req, res) => {
    try {
        // Ensure the member is requesting their own data
        if (req.params.memberId !== req.memberId) {
            return res.status(403).json({ error: 'Unauthorized' });
        }
        
        // Get the most recent submission with all financial data
        const submission = await get(`
            SELECT 
                id,
                member_id,
                full_name,
                email,
                property_profile,
                options_explored,
                participation_type,
                property_value,
                mortgage_balance,
                lvr,
                cash_assets,
                property_assets,
                investment_assets,
                super_assets,
                other_assets,
                mortgage_liabilities,
                credit_liabilities,
                loan_liabilities,
                investment_liabilities,
                other_liabilities,
                total_assets,
                total_liabilities,
                net_position,
                status as submission_status,
                created_at
            FROM submissions 
            WHERE member_id = ? 
            ORDER BY created_at DESC 
            LIMIT 1
        `, [req.params.memberId]);
        
        if (!submission) {
            // Return empty data structure if no submission found
            return res.json({
                total_valuation: 0,
                total_mortgage: 0,
                lvr: null,
                cash_assets: 0,
                property_assets: 0,
                investment_assets: 0,
                super_assets: 0,
                other_assets: 0,
                mortgage_liabilities: 0,
                credit_liabilities: 0,
                loan_liabilities: 0,
                investment_liabilities: 0,
                other_liabilities: 0,
                total_assets: 0,
                total_liabilities: 0,
                net_position: 0
            });
        }
        
        // Format the response
        res.json({
            total_valuation: submission.property_value || 0,
            total_mortgage: submission.mortgage_balance || 0,
            lvr: submission.lvr,
            cash_assets: submission.cash_assets || 0,
            property_assets: submission.property_assets || 0,
            investment_assets: submission.investment_assets || 0,
            super_assets: submission.super_assets || 0,
            other_assets: submission.other_assets || 0,
            mortgage_liabilities: submission.mortgage_liabilities || 0,
            credit_liabilities: submission.credit_liabilities || 0,
            loan_liabilities: submission.loan_liabilities || 0,
            investment_liabilities: submission.investment_liabilities || 0,
            other_liabilities: submission.other_liabilities || 0,
            total_assets: submission.total_assets || 0,
            total_liabilities: submission.total_liabilities || 0,
            net_position: submission.net_position || 0,
            property_profile: submission.property_profile,
            options_explored: submission.options_explored,
            participation_type: submission.participation_type
        });
        
    } catch (error) {
        console.error('Error fetching financial data:', error);
        res.status(500).json({ error: error.message });
    }
});

// ============================================
// GET MEMBER'S SUBMISSIONS HISTORY
// ============================================
router.get('/submissions/member/:memberId', verifyMemberToken, async (req, res) => {
    try {
        // Ensure the member is requesting their own data
        if (req.params.memberId !== req.memberId) {
            return res.status(403).json({ error: 'Unauthorized' });
        }
        
        const submissions = await all(`
            SELECT 
                id,
                property_value,
                mortgage_balance,
                lvr,
                cash_assets,
                property_assets,
                investment_assets,
                super_assets,
                other_assets,
                mortgage_liabilities,
                credit_liabilities,
                loan_liabilities,
                investment_liabilities,
                other_liabilities,
                total_assets,
                total_liabilities,
                net_position,
                status,
                created_at
            FROM submissions 
            WHERE member_id = ? 
            ORDER BY created_at DESC
        `, [req.params.memberId]);
        
        res.json(submissions || []);
    } catch (error) {
        console.error('Error fetching submissions:', error);
        res.status(500).json({ error: error.message });
    }
});

// ============================================
// GET OPPORTUNITIES (Deal Pipeline)
// ============================================
router.get('/opportunities', verifyMemberToken, async (req, res) => {
    try {
        // Check if member is active before showing opportunities
        const member = await get('SELECT status, membership_status FROM members WHERE id = ?', [req.memberId]);
        
        if (!member || member.status !== 'active' || member.membership_status !== 'active') {
            return res.status(403).json({ error: 'Membership not active' });
        }
        
        // Fetch active opportunities from the database
        const opportunities = await all(`
            SELECT 
                id,
                type,
                location,
                stage,
                notes,
                created_at,
                updated_at
            FROM opportunities 
            WHERE status = 'active' 
            ORDER BY stage ASC, created_at DESC
        `);
        
        // If no opportunities in database, return sample data
        if (!opportunities || opportunities.length === 0) {
            return res.json([
                {
                    id: 'opp1',
                    type: 'Mixed Use Development',
                    location: 'Sydney NSW',
                    stage: 2,
                    notes: 'Initial feasibility complete, planning assessment underway'
                },
                {
                    id: 'opp2',
                    type: 'Business Restructuring',
                    location: 'Melbourne VIC',
                    stage: 3,
                    notes: 'Financial analysis in progress'
                },
                {
                    id: 'opp3',
                    type: 'Land Subdivision',
                    location: 'Brisbane QLD',
                    stage: 1,
                    notes: 'Site identified, preliminary zoning review'
                },
                {
                    id: 'opp4',
                    type: 'Distressed Business',
                    location: 'Perth WA',
                    stage: 4,
                    notes: 'Separation strategy being developed'
                },
                {
                    id: 'opp5',
                    type: 'Joint Venture',
                    location: 'Adelaide SA',
                    stage: 2,
                    notes: 'Partner discussions initiated'
                }
            ]);
        }
        
        res.json(opportunities);
        
    } catch (error) {
        console.error('Error fetching opportunities:', error);
        res.status(500).json({ error: error.message });
    }
});

// ============================================
// GET MEMBER'S OWN DATA (full profile)
// ============================================
router.get('/my-data', verifyMemberToken, async (req, res) => {
    try {
        const memberId = req.memberId;
        
        // Get member details
        const member = await get(`
            SELECT id, full_name, email, phone, status, membership_status, 
                   joined_date, renewal_date, created_at, last_login
            FROM members 
            WHERE id = ?
        `, [memberId]);
        
        if (!member) {
            return res.status(404).json({ error: 'Member not found' });
        }
        
        // Get their most recent submission data
        const submission = await get(`
            SELECT * FROM submissions 
            WHERE member_id = ? 
            ORDER BY created_at DESC LIMIT 1
        `, [memberId]);
        
        // Get their payment history
        const payments = await all(`
            SELECT id, amount, status, payment_method, payment_date, transaction_id
            FROM payments 
            WHERE member_id = ? 
            ORDER BY payment_date DESC 
            LIMIT 5
        `, [memberId]);
        
        res.json({
            member: {
                id: member.id,
                full_name: member.full_name,
                email: member.email,
                phone: member.phone,
                status: member.status,
                membership_status: member.membership_status,
                joined_date: member.joined_date,
                renewal_date: member.renewal_date,
                last_login: member.last_login
            },
            financial: submission ? {
                property_value: submission.property_value,
                mortgage_balance: submission.mortgage_balance,
                lvr: submission.lvr,
                cash_assets: submission.cash_assets,
                property_assets: submission.property_assets,
                investment_assets: submission.investment_assets,
                super_assets: submission.super_assets,
                other_assets: submission.other_assets,
                mortgage_liabilities: submission.mortgage_liabilities,
                credit_liabilities: submission.credit_liabilities,
                loan_liabilities: submission.loan_liabilities,
                investment_liabilities: submission.investment_liabilities,
                other_liabilities: submission.other_liabilities,
                total_assets: submission.total_assets,
                total_liabilities: submission.total_liabilities,
                net_position: submission.net_position
            } : null,
            payments: payments || [],
            profile_complete: !!(member.full_name && member.email)
        });
        
    } catch (error) {
        console.error('Error fetching member data:', error);
        res.status(500).json({ error: error.message });
    }
});

// ============================================
// UPDATE MEMBER PROFILE
// ============================================
router.put('/profile', verifyMemberToken, async (req, res) => {
    try {
        const memberId = req.memberId;
        const { phone } = req.body;
        
        if (phone) {
            await run(
                'UPDATE members SET phone = ?, updated_at = datetime("now") WHERE id = ?',
                [phone, memberId]
            );
        }
        
        res.json({ success: true, message: 'Profile updated successfully' });
        
    } catch (error) {
        console.error('Error updating profile:', error);
        res.status(500).json({ error: error.message });
    }
});

// ============================================
// MEMBER DASHBOARD STATS
// ============================================
router.get('/dashboard-stats', verifyMemberToken, async (req, res) => {
    try {
        const memberId = req.memberId;
        
        // Get total investment value (from submissions)
        const submission = await get(`
            SELECT total_valuation, total_assets, net_position
            FROM submissions 
            WHERE member_id = ? 
            ORDER BY created_at DESC LIMIT 1
        `, [memberId]);
        
        // Get opportunity count
        const opportunityCount = await get(`
            SELECT COUNT(*) as count 
            FROM opportunities 
            WHERE status = 'active'
        `);
        
        // Get member since date
        const member = await get('SELECT joined_date FROM members WHERE id = ?', [memberId]);
        
        res.json({
            total_valuation: submission?.total_valuation || 0,
            total_assets: submission?.total_assets || 0,
            net_position: submission?.net_position || 0,
            opportunity_count: opportunityCount?.count || 0,
            member_since: member?.joined_date || null
        });
        
    } catch (error) {
        console.error('Error fetching dashboard stats:', error);
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;