const mongoose = require('mongoose');

const reactionSchema = new mongoose.Schema({
    messageId: { type: String, required: true }, // ID của tin nhắn được reaction
    room: { type: String, required: true },      // Room của tin nhắn
    user: { type: String, required: true },
    emotion: { type: Number, required: true },   // ví dụ: 1 đến 5
    createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Reaction', reactionSchema);
