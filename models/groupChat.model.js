const mongoose = require('mongoose');

const groupChatSchema = new mongoose.Schema({
    groupName: { type: String, required: true },
    roomId: { type: String, required: true, unique: true },
    owner: { type: String, required: true },            // Chủ nhóm
    deputies: { type: [String], default: [] },            // Danh sách phó (được phân quyền)
    members: { type: [String], default: [] },             // Các thành viên
    createdAt: { type: Date, default: Date.now }
}, {
    versionKey: false
});

module.exports = mongoose.model('GroupChat', groupChatSchema);
