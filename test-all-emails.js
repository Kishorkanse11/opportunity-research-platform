// test-all-emails.js
require('dotenv').config();
const emailService = require('./src/services/emailService');
const { v4: uuidv4 } = require('uuid');

async function testAllEmails() {
    console.log('📧 TESTING ALL EMAIL NOTIFICATIONS');
    console.log('===================================\n');

    // Create test member data
    const testMember = {
        id: uuidv4(),
        full_name: 'Test User',
        email: process.env.EMAIL_ADMIN || 'kishorkanse11@gmail.com', // Send to yourself
        phone: '0400111222',
        status: 'active',
        joined_date: new Date().toISOString().split('T')[0],
        renewal_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0], // 30 days from now
        property_count: 3,
        total_mortgage: 750000,
        total_valuation: 1500000,
        lvr: 50.0
    };

    // Create test payment data
    const testPayment = {
        id: uuidv4(),
        transaction_id: 'TEST-' + Date.now(),
        amount: 299.00,
        payment_date: new Date().toISOString(),
        payment_method: 'Credit Card',
        status: 'completed'
    };

    // Test 1: Welcome Email
    console.log('1️⃣ Testing WELCOME EMAIL...');
    try {
        await emailService.sendWelcomeEmail(testMember);
        console.log('   ✅ Welcome email sent\n');
    } catch (error) {
        console.error('   ❌ Welcome email failed:', error.message, '\n');
    }

    // Test 2: Payment Confirmation
    console.log('2️⃣ Testing PAYMENT CONFIRMATION...');
    try {
        await emailService.sendPaymentConfirmation(testPayment, testMember);
        console.log('   ✅ Payment confirmation sent\n');
    } catch (error) {
        console.error('   ❌ Payment confirmation failed:', error.message, '\n');
    }

    // Test 3: Payment Receipt (Detailed Bill)
    console.log('3️⃣ Testing PAYMENT RECEIPT (DETAILED BILL)...');
    try {
        await emailService.sendPaymentReceipt(testPayment, testMember);
        console.log('   ✅ Payment receipt sent\n');
    } catch (error) {
        console.error('   ❌ Payment receipt failed:', error.message, '\n');
    }

    // Test 4: Renewal Notice (14 days)
    console.log('4️⃣ Testing RENEWAL NOTICE (14 days)...');
    try {
        await emailService.sendRenewalNotice(testMember, 14);
        console.log('   ✅ 14-day renewal notice sent\n');
    } catch (error) {
        console.error('   ❌ Renewal notice failed:', error.message, '\n');
    }

    // Test 5: Renewal Notice (7 days - urgent)
    console.log('5️⃣ Testing RENEWAL NOTICE (7 days - URGENT)...');
    try {
        await emailService.sendRenewalNotice(testMember, 7);
        console.log('   ✅ 7-day urgent renewal notice sent\n');
    } catch (error) {
        console.error('   ❌ Urgent renewal notice failed:', error.message, '\n');
    }

    // Test 6: Renewal Notice (3 days - very urgent)
    console.log('6️⃣ Testing RENEWAL NOTICE (3 days - VERY URGENT)...');
    try {
        await emailService.sendRenewalNotice(testMember, 3);
        console.log('   ✅ 3-day very urgent renewal notice sent\n');
    } catch (error) {
        console.error('   ❌ Very urgent renewal notice failed:', error.message, '\n');
    }

    // Test 7: Admin Notification - New Member
    console.log('7️⃣ Testing ADMIN NOTIFICATION (New Member)...');
    try {
        await emailService.sendAdminNotification('new_member', {
            memberName: testMember.full_name,
            email: testMember.email,
            memberId: testMember.id,
            propertyCount: testMember.property_count,
            lvr: testMember.lvr.toFixed(1) + '%'
        });
        console.log('   ✅ New member admin notification sent\n');
    } catch (error) {
        console.error('   ❌ Admin notification failed:', error.message, '\n');
    }

    // Test 8: Admin Notification - Payment Received
    console.log('8️⃣ Testing ADMIN NOTIFICATION (Payment Received)...');
    try {
        await emailService.sendAdminNotification('payment_received', {
            memberName: testMember.full_name,
            amount: testPayment.amount,
            transactionId: testPayment.transaction_id,
            paymentId: testPayment.id
        });
        console.log('   ✅ Payment received admin notification sent\n');
    } catch (error) {
        console.error('   ❌ Payment admin notification failed:', error.message, '\n');
    }

    // Test 9: Admin Notification - Payment Failed
    console.log('9️⃣ Testing ADMIN NOTIFICATION (Payment Failed)...');
    try {
        await emailService.sendAdminNotification('payment_failed', {
            memberName: testMember.full_name,
            amount: testPayment.amount,
            memberId: testMember.id,
            error: 'Card declined'
        });
        console.log('   ✅ Payment failed admin notification sent\n');
    } catch (error) {
        console.error('   ❌ Payment failed notification failed:', error.message, '\n');
    }

    // Test 10: Admin Notification - Member Expiring
    console.log('🔟 Testing ADMIN NOTIFICATION (Member Expiring)...');
    try {
        await emailService.sendAdminNotification('member_expiring', {
            memberName: testMember.full_name,
            email: testMember.email,
            memberId: testMember.id,
            daysLeft: 14,
            expiryDate: testMember.renewal_date
        });
        console.log('   ✅ Member expiring admin notification sent\n');
    } catch (error) {
        console.error('   ❌ Member expiring notification failed:', error.message, '\n');
    }

    console.log('===================================');
    console.log('📬 Check your inbox at:', process.env.EMAIL_ADMIN);
    console.log('📧 Also check SPAM folder if not received');
}

// Run all tests
testAllEmails().catch(console.error);