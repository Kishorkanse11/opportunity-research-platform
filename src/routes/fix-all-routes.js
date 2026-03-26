const fs = require('fs');
const path = require('path');

const routesDir = path.join(__dirname, 'src', 'routes');

// Ensure directory exists
if (!fs.existsSync(routesDir)) {
    fs.mkdirSync(routesDir, { recursive: true });
}

const routeFiles = {
    'auth.js': `const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');

router.post('/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        if (email === 'admin@help.com.au' && password === 'admin123') {
            const token = jwt.sign(
                { email, role: 'admin' },
                process.env.JWT_SECRET || 'your-secret-key',
                { expiresIn: '7d' }
            );
            return res.json({ token, admin: { email } });
        }
        res.status(401).json({ error: 'Invalid credentials' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;`,

    'members.js': `const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');

let members = [];

router.get('/', (req, res) => {
    res.json(members);
});

router.get('/:id', (req, res) => {
    const member = members.find(m => m.id === req.params.id);
    if (!member) return res.status(404).json({ error: 'Not found' });
    res.json(member);
});

router.post('/', (req, res) => {
    const newMember = {
        id: uuidv4(),
        ...req.body,
        created_at: new Date().toISOString()
    };
    members.push(newMember);
    res.status(201).json(newMember);
});

module.exports = router;`,

    'payments.js': `const express = require('express');
const router = express.Router();

router.get('/', (req, res) => {
    res.json([]);
});

module.exports = router;`,

    'submissions.js': `const express = require('express');
const router = express.Router();

router.get('/', (req, res) => {
    res.json([]);
});

module.exports = router;`,

    'renewals.js': `const express = require('express');
const router = express.Router();

router.get('/', (req, res) => {
    res.json([]);
});

module.exports = router;`,

    'admin.js': `const express = require('express');
const router = express.Router();

router.get('/dashboard', (req, res) => {
    res.json({
        members: { total: 0, active: 0 },
        payments: { monthly_revenue: 0 },
        submissions: { pending: 0 }
    });
});

router.get('/logs', (req, res) => {
    res.json([]);
});

module.exports = router;`
};

// Write each file
Object.entries(routeFiles).forEach(([filename, content]) => {
    const filePath = path.join(routesDir, filename);
    fs.writeFileSync(filePath, content);
    console.log(`✅ Created/Updated: ${filename}`);
});

console.log('\n🚀 All route files fixed! Now run: npm start');