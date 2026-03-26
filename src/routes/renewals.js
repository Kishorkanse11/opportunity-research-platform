const express = require('express');
const router = express.Router();

// GET all renewals
router.get('/', async (req, res) => {
    try {
        res.json([]);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;