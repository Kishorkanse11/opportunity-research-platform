// src/services/googleSheetsService.js
const { google } = require('googleapis');
const { Log } = require('../models');

class GoogleSheetsService {
    constructor() {
        this.sheets = null;
        this.spreadsheetId = process.env.GOOGLE_SHEET_ID;
        this.initialized = false;
    }

    async initialize() {
        try {
            // Using service account for authentication
            const auth = new google.auth.GoogleAuth({
                keyFile: process.env.GOOGLE_SERVICE_ACCOUNT_PATH || './google-credentials.json',
                scopes: ['https://www.googleapis.com/auth/spreadsheets'],
            });

            const client = await auth.getClient();
            this.sheets = google.sheets({ version: 'v4', auth: client });
            this.initialized = true;
            console.log('✅ Google Sheets service initialized');
            
            // Ensure headers exist
            await this.ensureHeaders();
        } catch (error) {
            console.error('❌ Google Sheets initialization failed:', error.message);
            // Don't throw - we want the app to continue even if sheets fails
        }
    }

    async ensureHeaders() {
        if (!this.initialized || !this.spreadsheetId) return;

        try {
            // Check if sheet has headers
            const response = await this.sheets.spreadsheets.values.get({
                spreadsheetId: this.spreadsheetId,
                range: 'Sheet1!A1:O1',
            });

            const headers = response.data.values ? response.data.values[0] : [];
            
            // If no headers, add them
            if (headers.length === 0) {
                const headerRow = [
                    'Timestamp',
                    'Full Name',
                    'Email',
                    'Phone',
                    'Property/Business Profile',
                    'Options Explored',
                    'Participation Type',
                    'Property Value',
                    'Mortgage Balance',
                    'LVR',
                    'Cash Assets',
                    'Property Assets',
                    'Investments',
                    'Liabilities',
                    'Net Position',
                    'IP Address',
                    'Compliance Confirmed',
                    'Info Accuracy Confirmed',
                    'Member ID',
                    'Payment Status'
                ];

                await this.sheets.spreadsheets.values.update({
                    spreadsheetId: this.spreadsheetId,
                    range: 'Sheet1!A1:T1',
                    valueInputOption: 'RAW',
                    resource: { values: [headerRow] },
                });
                
                console.log('✅ Google Sheets headers created');
            }
        } catch (error) {
            console.error('❌ Error ensuring headers:', error.message);
        }
    }

    async addSubmission(data) {
        if (!this.initialized || !this.spreadsheetId) {
            console.log('📝 Google Sheets not configured, skipping...');
            return false;
        }

        try {
            // Calculate LVR if property value exists
            const lvr = data.propertyValue && data.propertyValue > 0 
                ? ((data.mortgageBalance || 0) / data.propertyValue * 100).toFixed(1) + '%' 
                : '—';

            // Calculate net position if assets/liabilities exist
            const totalAssets = (data.cashAssets || 0) + (data.propertyAssets || 0) + 
                               (data.investmentAssets || 0) + (data.superAssets || 0) + 
                               (data.otherAssets || 0);
            const totalLiabilities = (data.mortgageLiabilities || 0) + (data.creditLiabilities || 0) + 
                                    (data.loanLiabilities || 0) + (data.investmentLiabilities || 0) + 
                                    (data.otherLiabilities || 0);
            const netPosition = totalAssets - totalLiabilities;

            const row = [
                new Date().toLocaleString(),                    // Timestamp
                data.fullName || '',                             // Full Name
                data.email || '',                                // Email
                data.phone || '',                                // Phone
                data.propertyProfile || '',                      // Property/Business Profile
                data.optionsExplored || '',                      // Options Explored
                data.participationType || '',                    // Participation Type
                data.propertyValue || 0,                         // Property Value
                data.mortgageBalance || 0,                       // Mortgage Balance
                lvr,                                              // LVR
                data.cashAssets || 0,                            // Cash Assets
                data.propertyAssets || 0,                        // Property Assets
                (data.investmentAssets || 0) + (data.superAssets || 0) + (data.otherAssets || 0), // Investments
                totalLiabilities,                                 // Liabilities
                netPosition > 0 ? '$' + netPosition.toLocaleString() : '$0', // Net Position
                data.ipAddress || '',                             // IP Address
                data.complianceConfirmed ? 'Yes' : 'No',          // Compliance Confirmed
                data.infoAccuracyConfirmed ? 'Yes' : 'No',        // Info Accuracy Confirmed
                data.memberId || '',                              // Member ID
                data.paymentStatus || 'Pending'                   // Payment Status
            ];

            await this.sheets.spreadsheets.values.append({
                spreadsheetId: this.spreadsheetId,
                range: 'Sheet1!A:T',
                valueInputOption: 'RAW',
                resource: { values: [row] },
            });

            console.log(`✅ Submission added to Google Sheets for ${data.email}`);
            return true;
        } catch (error) {
            console.error('❌ Error adding to Google Sheets:', error.message);
            await Log.error('GOOGLE_SHEETS_ERROR', error.message);
            return false;
        }
    }

    async updatePaymentStatus(email, memberId, status) {
        if (!this.initialized || !this.spreadsheetId) return false;

        try {
            // Find the row with matching email or member ID
            const response = await this.sheets.spreadsheets.values.get({
                spreadsheetId: this.spreadsheetId,
                range: 'Sheet1!A:T',
            });

            const rows = response.data.values || [];
            if (rows.length <= 1) return false; // No data rows

            // Find the row index (skip header)
            let rowIndex = -1;
            for (let i = 1; i < rows.length; i++) {
                if (rows[i][2] === email || rows[i][18] === memberId) {
                    rowIndex = i + 1; // 1-indexed for API
                    break;
                }
            }

            if (rowIndex > 0) {
                // Update payment status in column T (20th column)
                await this.sheets.spreadsheets.values.update({
                    spreadsheetId: this.spreadsheetId,
                    range: `Sheet1!T${rowIndex}`,
                    valueInputOption: 'RAW',
                    resource: { values: [[status]] },
                });
                console.log(`✅ Payment status updated for ${email}`);
            }
        } catch (error) {
            console.error('❌ Error updating payment status:', error.message);
        }
    }
}

module.exports = new GoogleSheetsService();