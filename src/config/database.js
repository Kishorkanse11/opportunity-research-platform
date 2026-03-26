const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

// Ensure database directory exists
const dbDir = path.join(__dirname, '../../database');
if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
}

const dbPath = path.join(dbDir, 'help.db');
console.log('📁 Database path:', dbPath);

// Open database connection
const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('❌ Error opening database:', err.message);
    } else {
        console.log('✅ Connected to SQLite database');
    }
});

// Enable foreign keys
db.run('PRAGMA foreign_keys = ON');

// Promisified query functions
const run = (sql, params = []) => {
    return new Promise((resolve, reject) => {
        db.run(sql, params, function(err) {
            if (err) {
                console.error('❌ Run error:', err.message);
                console.error('   SQL:', sql);
                console.error('   Params:', params);
                reject(err);
            } else {
                resolve({ 
                    lastID: this.lastID,
                    changes: this.changes 
                });
            }
        });
    });
};

const get = (sql, params = []) => {
    return new Promise((resolve, reject) => {
        db.get(sql, params, (err, result) => {
            if (err) {
                console.error('❌ Get error:', err.message);
                console.error('   SQL:', sql);
                console.error('   Params:', params);
                reject(err);
            } else {
                resolve(result);
            }
        });
    });
};

const all = (sql, params = []) => {
    return new Promise((resolve, reject) => {
        db.all(sql, params, (err, rows) => {
            if (err) {
                console.error('❌ All error:', err.message);
                console.error('   SQL:', sql);
                console.error('   Params:', params);
                reject(err);
            } else {
                resolve(rows);
            }
        });
    });
};

const testConnection = () => {
    return new Promise((resolve) => {
        db.get('SELECT 1', (err) => {
            if (err) {
                console.error('❌ Database connection failed:', err.message);
                resolve(false);
            } else {
                console.log('✅ SQLite database connected successfully');
                resolve(true);
            }
        });
    });
};

module.exports = {
    db,
    run,
    get,
    all,
    testConnection
};