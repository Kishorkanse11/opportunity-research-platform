# HELP Gateway Models

This directory contains all database models for the HELP Gateway backend.

## Model Overview

| Model | Description | Primary Methods |
|-------|-------------|-----------------|
| Member | Member management | `create()`, `findById()`, `findAll()`, `update()`, `getDueForRenewal()` |
| Payment | Payment processing | `create()`, `findById()`, `findAll()`, `updateStatus()`, `refund()` |
| Submission | EOI submissions | `create()`, `findById()`, `findAll()`, `review()` |
| Renewal | Renewal tracking | `create()`, `getUpcoming()`, `getDueForNotice()`, `markNoticeSent()` |
| Log | System logging | `create()`, `findAll()`, `info()`, `warn()`, `error()` |
| Setting | Configuration | `get()`, `set()`, `getAll()`, `getMembershipFee()` |
| Admin | Admin users | `create()`, `authenticate()`, `changePassword()` |

## Usage Example

```javascript
const { Member, Payment, Log } = require('./models');

// Create a new member
const member = await Member.create({
    full_name: 'John Smith',
    email: 'john@example.com',
    date_of_birth: '1975-03-15'
});

// Find member by email
const found = await Member.findByEmail('john@example.com');

// Get all active members
const activeMembers = await Member.findAll({ status: 'active' });

// Create a payment
const payment = await Payment.create({
    member_id: member.id,
    amount: 299,
    status: 'completed'
});

// Log the action
await Log.info('MEMBER_CREATED', `New member: ${member.email}`, req.ip);