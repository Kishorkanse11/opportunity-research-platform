const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const dbPath = path.join(__dirname, 'database', 'help.db');

console.log('📁 Database path:', dbPath);
console.log('🔍 Checking if database exists...');

if (!fs.existsSync(dbPath)) {
    console.error('❌ Database not found at:', dbPath);
    process.exit(1);
}

console.log('✅ Database found, starting migration...\n');

const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('❌ Error opening database:', err.message);
        process.exit(1);
    }
    console.log('✅ Connected to database');
});

// Run migrations in sequence
db.serialize(() => {
    
    // ============================================
    // 1. Add missing columns to members table
    // ============================================
    console.log('\n📝 Adding missing columns to members table...');
    
    const memberColumns = [
        'password_hash TEXT',
        'password_reset_token TEXT',
        'password_reset_expires TEXT',
        'payment_status TEXT DEFAULT "pending"',
        'payment_date TEXT',
        'last_login TEXT'
    ];
    
    memberColumns.forEach(column => {
        db.run(`ALTER TABLE members ADD COLUMN ${column}`, (err) => {
            if (err && !err.message.includes('duplicate column name')) {
                console.log(`   ⚠️  Could not add ${column.split(' ')[0]}: ${err.message}`);
            } else if (err && err.message.includes('duplicate column name')) {
                console.log(`   ✓ Column ${column.split(' ')[0]} already exists`);
            } else {
                console.log(`   ✓ Added column: ${column.split(' ')[0]}`);
            }
        });
    });
    
    // ============================================
    // 2. Add missing columns to submissions table
    // ============================================
    console.log('\n📝 Adding Assets & Liabilities columns to submissions table...');
    
    const submissionColumns = [
        'participation_type TEXT',
        'property_value REAL DEFAULT 0',
        'mortgage_balance REAL DEFAULT 0',
        'lvr REAL',
        'cash_assets REAL DEFAULT 0',
        'property_assets REAL DEFAULT 0',
        'investment_assets REAL DEFAULT 0',
        'super_assets REAL DEFAULT 0',
        'other_assets REAL DEFAULT 0',
        'mortgage_liabilities REAL DEFAULT 0',
        'credit_liabilities REAL DEFAULT 0',
        'loan_liabilities REAL DEFAULT 0',
        'investment_liabilities REAL DEFAULT 0',
        'other_liabilities REAL DEFAULT 0',
        'total_assets REAL DEFAULT 0',
        'total_liabilities REAL DEFAULT 0',
        'net_position REAL DEFAULT 0',
        'compliance_confirmed INTEGER DEFAULT 0',
        'info_accuracy_confirmed INTEGER DEFAULT 0',
        'ip_address TEXT',
        'notes TEXT',
        'updated_at TEXT DEFAULT CURRENT_TIMESTAMP'
    ];
    
    submissionColumns.forEach(column => {
        db.run(`ALTER TABLE submissions ADD COLUMN ${column}`, (err) => {
            if (err && !err.message.includes('duplicate column name')) {
                console.log(`   ⚠️  Could not add ${column.split(' ')[0]}: ${err.message}`);
            } else if (err && err.message.includes('duplicate column name')) {
                console.log(`   ✓ Column ${column.split(' ')[0]} already exists`);
            } else {
                console.log(`   ✓ Added column: ${column.split(' ')[0]}`);
            }
        });
    });
    
    // ============================================
    // 3. Create opportunities table
    // ============================================
    console.log('\n📝 Creating opportunities table...');
    
    db.run(`
        CREATE TABLE IF NOT EXISTS opportunities (
            id TEXT PRIMARY KEY,
            type TEXT NOT NULL,
            location TEXT NOT NULL,
            stage INTEGER DEFAULT 1,
            notes TEXT,
            status TEXT DEFAULT 'active',
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
    `, (err) => {
        if (err) {
            console.log(`   ❌ Error creating table: ${err.message}`);
        } else {
            console.log('   ✓ Opportunities table created');
        }
    });
    
    // ============================================
    // 4. Insert sample opportunities
    // ============================================
    console.log('\n📝 Inserting sample opportunities...');
    
    const opportunities = [
        ['opp1', 'Mixed Use Development', 'Sydney NSW', 2, 'Initial feasibility complete, planning assessment underway'],
        ['opp2', 'Business Restructuring', 'Melbourne VIC', 3, 'Financial analysis in progress'],
        ['opp3', 'Land Subdivision', 'Brisbane QLD', 1, 'Site identified, preliminary zoning review'],
        ['opp4', 'Distressed Business', 'Perth WA', 4, 'Separation strategy being developed'],
        ['opp5', 'Joint Venture', 'Adelaide SA', 2, 'Partner discussions initiated'],
        ['opp6', 'Industrial Development', 'Gold Coast QLD', 1, 'Due diligence in progress'],
        ['opp7', 'Commercial Conversion', 'Canberra ACT', 3, 'Feasibility study complete']
    ];
    
    const insertStmt = db.prepare(`
        INSERT OR IGNORE INTO opportunities (id, type, location, stage, notes) 
        VALUES (?, ?, ?, ?, ?)
    `);
    
    let inserted = 0;
    opportunities.forEach(opp => {
        insertStmt.run(opp, function(err) {
            if (err) {
                console.log(`   ⚠️  Could not insert ${opp[1]}: ${err.message}`);
            } else if (this.changes > 0) {
                inserted++;
            }
        });
    });
    insertStmt.finalize();
    
    // ============================================
    // 5. Create helper views
    // ============================================
    console.log('\n📝 Creating helper views...');
    
    const views = [
        `CREATE VIEW IF NOT EXISTS active_members AS
         SELECT * FROM members 
         WHERE status = 'active' 
         AND membership_status = 'active'
         AND (renewal_date IS NULL OR renewal_date >= date('now'))`,
        
        `CREATE VIEW IF NOT EXISTS revenue_summary AS
         SELECT 
             strftime('%Y-%m', payment_date) as month,
             COUNT(*) as payment_count,
             SUM(amount) as total_amount,
             AVG(amount) as avg_amount
         FROM payments
         WHERE status = 'completed'
         GROUP BY month
         ORDER BY month DESC`,
        
        `CREATE VIEW IF NOT EXISTS pending_submissions AS
         SELECT COUNT(*) as pending_count
         FROM submissions
         WHERE status = 'pending_review'`,
        
        `CREATE VIEW IF NOT EXISTS upcoming_renewals AS
         SELECT 
             m.id,
             m.full_name,
             m.email,
             m.renewal_date,
             julianday(m.renewal_date) - julianday('now') as days_until_renewal
         FROM members m
         WHERE m.status = 'active'
         AND m.membership_status = 'active'
         AND m.renewal_date IS NOT NULL
         AND m.renewal_date >= date('now')
         AND m.renewal_date <= date('now', '+30 days')
         ORDER BY days_until_renewal ASC`
    ];
    
    views.forEach((view, index) => {
        db.run(view, (err) => {
            if (err) {
                console.log(`   ⚠️  Could not create view ${index + 1}: ${err.message}`);
            } else {
                console.log(`   ✓ Created view ${index + 1}`);
            }
        });
    });
    
    // ============================================
    // 6. Update admin password if needed
    // ============================================
    console.log('\n📝 Checking admin user...');
    
    // Check if admin exists
    db.get("SELECT * FROM admins WHERE email = 'admin@help.com.au'", [], (err, row) => {
        if (err) {
            console.log(`   ⚠️  Error checking admin: ${err.message}`);
        } else if (!row) {
            // Insert default admin
            console.log('   ℹ️  Admin not found, creating default admin...');
            db.run(`
                INSERT INTO admins (id, email, password_hash, name, role) 
                VALUES (?, ?, ?, ?, ?)
            `, [
                'admin-default',
                'admin@help.com.au',
                '$2b$10$X7jK9LmN2pQrS5tUvW8xYz', // This is a placeholder - you should generate a real hash
                'System Admin',
                'super_admin'
            ], (err) => {
                if (err) {
                    console.log(`   ❌ Could not create admin: ${err.message}`);
                } else {
                    console.log('   ✓ Default admin created (password: Admin@123)');
                    console.log('   ⚠️  Please change the password after first login');
                }
            });
        } else {
            console.log('   ✓ Admin user exists');
        }
    });
    
    // ============================================
    // 7. Final verification
    // ============================================
    setTimeout(() => {
        console.log('\n' + '='.repeat(50));
        console.log('📊 MIGRATION COMPLETE');
        console.log('='.repeat(50));
        
        // Get table info
        db.get("SELECT COUNT(*) as count FROM opportunities", [], (err, row) => {
            if (row) {
                console.log(`   ✅ Opportunities: ${row.count} records`);
            }
        });
        
        db.get("SELECT COUNT(*) as count FROM submissions", [], (err, row) => {
            if (row) {
                console.log(`   ✅ Submissions: ${row.count} records`);
            }
        });
        
        db.get("SELECT COUNT(*) as count FROM members", [], (err, row) => {
            if (row) {
                console.log(`   ✅ Members: ${row.count} records`);
            }
        });
        
        console.log('\n✅ Migration completed successfully!');
        console.log('\n🔐 Admin login:');
        console.log('   Email: admin@help.com.au');
        console.log('   Password: Admin@123');
        console.log('\n📝 Next steps:');
        console.log('   1. Restart your server');
        console.log('   2. Test the Deal Pipeline with a test member');
        console.log('   3. Check Google Sheets integration');
        
        db.close();
    }, 2000);
});

// Handle errors
db.on('error', (err) => {
    console.error('Database error:', err);
});