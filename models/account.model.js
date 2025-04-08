const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
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
        unique: true,
        // match: /^[0-9]{10,15}$/
    },
    email: {
        type: String,
        unique: true,
        required: true,
        // match: /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    },
    birthday: { type: Date, default: null }, 
    friends: {
        type: [String],
        default: []
    },
    image: { type: String, default: null },
    lastRead: {
        type: Map,
        of: Date,
        default: {}
    }
}, {
    versionKey: false,
    timestamps: true
});

accountSchema.pre('save', async function (next) {
    if (!this.isModified('password')) return next();
    this.password = await bcrypt.hash(this.password, 10);
    next();
});

accountSchema.methods.matchPassword = async function (enteredPassword) {
    return await bcrypt.compare(enteredPassword, this.password);
};

module.exports = mongoose.model('account', accountSchema);
