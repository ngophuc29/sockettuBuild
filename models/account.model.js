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
    // Thêm trường lưu danh sách friend
    friends: {
        type: [String],
        default: []
    }
},
    {
        versionKey: false,
        timestamps: true
    });

module.exports = mongoose.model('account', accountSchema);