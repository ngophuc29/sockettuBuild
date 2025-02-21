const mongoose = require('mongoose');

const accountSchema = mongoose.Schema({
    username: {
        type: String,
        required: true,
        unique: true
    },
    password: {
        type: String,
        required: true
    },
    fullname: {
        type: String,
        required: true
    },
    // Lưu danh sách bạn bè
    friends: {
        type: [String],
        default: []
    },
    // Lưu trạng thái tin nhắn đã đọc theo room (key: roomId, value: timestamp)
    lastRead: {
        type: Map,
        of: Date,
        default: {}
    }
},
    {
        versionKey: false,
        timestamps: true
    });

module.exports = mongoose.model('account', accountSchema);
