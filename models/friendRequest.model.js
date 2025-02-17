const mongoose = require('mongoose');

const friendRequestSchema = new mongoose.Schema({
    from: { type: String, required: true },
    to: { type: String, required: true },
    status: { type: String, enum: ['pending', 'accepted', 'rejected'], default: 'pending' },
    createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('FriendRequest', friendRequestSchema);
