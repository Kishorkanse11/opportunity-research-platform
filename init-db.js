const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcrypt');
const { v4: uuidv4 } = require('uuid');

// Ensure database directory exists
const dbDir = path.join(__dirname, 'database');
if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
}

const dbPath = path.join(dbDir, 'help.db');
const db = new sqlite3.Database(dbPath);

// Read schema
const schemaPath = path.join(dbDir, 'schema.sql');
let schema = '';

try {
    schema = fs.readFileSync(schemaPath, 'utf8');
} catch (error) {
    console.log('Schema file not found, creating default schema...');
    schema = `
-- Enable foreign keys
PRAGMA foreign_keys = ON;

-- Members table
CREATE TABLE IF NOT EXISTS members (
    id TEXT PRIMARY KEY,
    full_name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    date_of_birth TEXT,
    phone TEXT,
    status TEXT DEFAULT 'pending',
    membership_status TEXT DEFAULT 'inactive',
    joined_date TEXT DEFAULT CURRENT_DATE,
    renewal_date TEXT,
    last_notice_sent TEXT,
    payment_method TEXT,
    notes TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Payments table
CREATE TABLE IF NOT EXISTS payments (
    id TEXT PRIMARY KEY,
    transaction_id TEXT UNIQUE,
    member_id TEXT NOT NULL,
    amount REAL NOT NULL,
    currency TEXT DEFAULT 'AUD',
    status TEXT DEFAULT 'pending',
    payment_method TEXT,
    stripe_payment_intent_id TEXT,
    receipt_sent INTEGER DEFAULT 0,
    payment_date TEXT DEFAULT CURRENT_TIMESTAMP,
    metadata TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE
);

-- Submissions table
CREATE TABLE IF NOT EXISTS submissions (
    id TEXT PRIMARY KEY,
    member_id TEXT,
    full_name TEXT NOT NULL,
    email TEXT NOT NULL,
    date_of_birth TEXT NOT NULL,
    property_profile TEXT NOT NULL,
    options_explored TEXT NOT NULL,
    property_count INTEGER,
    total_mortgage REAL,
    total_valuation REAL,
    lvr REAL,
    status TEXT DEFAULT 'pending_review',
    reviewed_by TEXT,
    reviewed_at TEXT,
    completion_date TEXT NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE SET NULL
);

-- Renewals table
CREATE TABLE IF NOT EXISTS renewals (
    id TEXT PRIMARY KEY,
    member_id TEXT NOT NULL,
    renewal_date TEXT NOT NULL,
    notice_sent_date TEXT,
    notice_sent_count INTEGER DEFAULT 0,
    status TEXT DEFAULT 'pending',
    processed_at TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(member_id, renewal_date),
    FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE
);

-- Logs table
CREATE TABLE IF NOT EXISTS logs (
    id TEXT PRIMARY KEY,
    timestamp TEXT DEFAULT CURRENT_TIMESTAMP,
    level TEXT,
    action TEXT,
    details TEXT,
    ip_address TEXT,
    user_id TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Settings table
CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Admins table
CREATE TABLE IF NOT EXISTS admins (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    name TEXT,
    role TEXT DEFAULT 'admin',
    last_login TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Insert default settings
INSERT OR IGNORE INTO settings (key, value) VALUES
('membership_fee', '299'),
('renewal_days', '14'),
('admin_email', 'admin@help.com.au');
    `;
}

// Execute schema
db.exec(schema, async (err) => {
    if (err) {
        console.error('❌ Error creating tables:', err);
        process.exit(1);
    }
    
    console.log('✅ Database tables created');
    
    // Create default admin user
    const hashedPassword = await bcrypt.hash('admin123', 10);
    const adminId = uuidv4();
    
    db.run(
        `INSERT OR IGNORE INTO admins (id, email, password_hash, name, role)
         VALUES (?, ?, ?, ?, ?)`,
        [adminId, 'admin@help.com.au', hashedPassword, 'System Admin', 'super_admin'],
        function(err) {
            if (err) {
                console.error('❌ Error creating admin:', err);
            } else {
                console.log('✅ Admin user created');
                console.log('   Email: admin@help.com.au');
                console.log('   Password: admin123');
            }
            
            // Show all tables
            db.all("SELECT name FROM sqlite_master WHERE type='table'", (err, tables) => {
                if (!err) {
                    console.log('\n📊 Tables created:');
                    tables.forEach(t => console.log(`   - ${t.name}`));
                }
                
                db.close();
                console.log('\n✅ Database initialization complete');
            });
        }
    );
});