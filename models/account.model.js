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
    phone: {                   // <-- Trường phone đã được thêm
        type: String,
        required: true,
        unique: true
    },
    friends: {
        type: [String],
        default: []
    },
    lastRead: {
        type: Map,
        of: Date,
        default: {}
    }
}, {
    versionKey: false,
    timestamps: true
});

module.exports = mongoose.model('account', accountSchema);
