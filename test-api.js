const fetch = require('node-fetch');

const API_BASE = 'http://localhost:3000/api';

async function testAPI() {
    try {
        // First login to get token
        console.log('🔑 Logging in...');
        const loginRes = await fetch(`${API_BASE}/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                email: 'admin@help.com.au',
                password: 'admin123'
            })
        });
        
        const loginData = await loginRes.json();
        console.log('Login response:', loginData);
        
        if (!loginData.token) {
            console.log('❌ Login failed');
            return;
        }
        
        const token = loginData.token;
        
        // Get all members
        console.log('\n👥 Fetching members...');
        const membersRes = await fetch(`${API_BASE}/members`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        
        const members = await membersRes.json();
        console.log('Members:', members);
        
        // Get all submissions
        console.log('\n📝 Fetching submissions...');
        const submissionsRes = await fetch(`${API_BASE}/submissions`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        
        const submissions = await submissionsRes.json();
        console.log('Submissions:', submissions);
        
    } catch (error) {
        console.error('Error:', error.message);
    }
}

testAPI();