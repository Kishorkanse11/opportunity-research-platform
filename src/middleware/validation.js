const validateMember = (req, res, next) => {
    const { full_name, email, date_of_birth } = req.body;
    const errors = [];

    if (!full_name || full_name.trim().length < 2) {
        errors.push('Full name is required and must be at least 2 characters');
    }

    if (!email || !email.match(/^[^\s@]+@[^\s@]+\.[^\s@]+$/)) {
        errors.push('Valid email is required');
    }

    if (date_of_birth && !date_of_birth.match(/^\d{4}-\d{2}-\d{2}$/)) {
        errors.push('Date of birth must be in YYYY-MM-DD format');
    }

    if (errors.length > 0) {
        return res.status(400).json({ errors });
    }

    next();
};

const validatePayment = (req, res, next) => {
    const { member_id, amount } = req.body;
    const errors = [];

    if (!member_id) {
        errors.push('Member ID is required');
    }

    if (!amount || amount < 0.01) {
        errors.push('Valid amount is required (minimum $0.01)');
    }

    if (errors.length > 0) {
        return res.status(400).json({ errors });
    }

    next();
};

const validateLogin = (req, res, next) => {
    const { email, password } = req.body;
    const errors = [];

    if (!email || !email.match(/^[^\s@]+@[^\s@]+\.[^\s@]+$/)) {
        errors.push('Valid email is required');
    }

    if (!password || password.length < 6) {
        errors.push('Password must be at least 6 characters');
    }

    if (errors.length > 0) {
        return res.status(400).json({ errors });
    }

    next();
};

module.exports = {
    validateMember,
    validatePayment,
    validateLogin
};