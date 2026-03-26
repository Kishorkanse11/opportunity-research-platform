// Models index - central export point
const Member = require('./Member');
const Payment = require('./Payment');
const Submission = require('./Submission');
const Renewal = require('./Renewal');
const Log = require('./Log');
const Setting = require('./Setting');
const Admin = require('./Admin');

module.exports = {
    Member,
    Payment,
    Submission,
    Renewal,
    Log,
    Setting,
    Admin
};