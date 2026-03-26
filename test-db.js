const sqlite3 = require('sqlite3').verbose();
const path = require('path');

// Connect to database
const dbPath = path.join(__dirname, 'database', 'help.db');
console.log('Checking database at:', dbPath);

const db = new sqlite3.Database(dbPath);

// Check if tables exist
db.all("SELECT name FROM sqlite_master WHERE type='table'", [], (err, tables) => {
    if (err) {
        console.error('Error:', err);
        return;
    }
    
    console.log('\n📊 Tables in database:');
    tables.forEach(t => console.log('   - ' + t.name));
    
    // Check members table
    db.all("SELECT * FROM members", [], (err, members) => {
        if (err) {
            console.error('Error reading members:', err);
        } else {
            console.log('\n👥 Members found:', members.length);
            console.log(members);
        }
        
        // Check submissions table
        db.all("SELECT * FROM submissions", [], (err, submissions) => {
            if (err) {
                console.error('Error reading submissions:', err);
            } else {
                console.log('\n📝 Submissions found:', submissions.length);
                console.log(submissions);
            }
            
            db.close();
        });
    });
});