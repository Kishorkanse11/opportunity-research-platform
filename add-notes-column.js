// add-notes-column.js
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, 'database', 'help.db');
const db = new sqlite3.Database(dbPath);

console.log('📦 Connecting to database...');

// Check if notes column exists
db.all("PRAGMA table_info(submissions)", (err, columns) => {
    if (err) {
        console.error('❌ Error checking table:', err);
        process.exit(1);
    }

    const hasNotes = columns.some(col => col.name === 'notes');
    
    if (hasNotes) {
        console.log('✅ Notes column already exists');
    } else {
        console.log('📝 Adding notes column to submissions table...');
        db.run("ALTER TABLE submissions ADD COLUMN notes TEXT", (err) => {
            if (err) {
                console.error('❌ Error adding column:', err);
            } else {
                console.log('✅ Notes column added successfully!');
            }
            
            // Show table structure
            db.all("PRAGMA table_info(submissions)", (err, columns) => {
                console.log('\n📊 Submissions table structure:');
                columns.forEach(col => {
                    console.log(`   - ${col.name}: ${col.type} ${col.notnull ? 'NOT NULL' : ''}`);
                });
                db.close();
            });
        });
    }
});