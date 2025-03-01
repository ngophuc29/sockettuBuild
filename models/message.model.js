// const mongoose = require('mongoose');

// const messageSchema = new mongoose.Schema({
//     name: { type: String, required: true },
//     message: { type: String, required: true },
//     room: { type: String, required: true },
//     createdAt: { type: Date, default: Date.now }
// });

// module.exports = mongoose.model('Message', messageSchema);
const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
    name: { type: String, required: true },
    message: { type: String, default: "" }, // Có thể để trống nếu có file
    room: { type: String, required: true },
    fileUrl: { type: String }, // Thêm trường này để lưu URL file hoặc hình ảnh
    createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Message', messageSchema);
