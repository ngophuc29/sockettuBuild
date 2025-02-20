const mongoose = require('mongoose');

const groupChatSchema = new mongoose.Schema({
    groupName: { type: String, required: true },
    roomId: { type: String, required: true, unique: true },
    // Lưu danh sách username của các thành viên trong nhóm
    members: { type: [String], default: [] },
    createdAt: { type: Date, default: Date.now }
}, {
    versionKey: false
});

module.exports = mongoose.model('GroupChat', groupChatSchema);
