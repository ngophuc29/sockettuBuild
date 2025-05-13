const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
    name: { type: String, required: true },       
    message: { type: String, default: "" },      
    room: { type: String, required: true },
    createdAt: { type: Date, default: Date.now },
    replyTo: {
        id: mongoose.Schema.Types.Mixed,  // Can be ObjectId or plain string/number
        name: String,
        message: String,
        fileUrl: String,       // Thêm trường này
        fileName: String,      // Thêm trường này
        fileType: String       // Thêm trường này
    },

    // Additional fields for file uploads
    fileUrl: { type: String },
    fileType: {
        type: String,
        enum: ['image', 'video', 'pdf', 'word', 'excel', 'powerpoint', 'other']
    },
    fileName: { type: String },
    fileSize: { type: Number },
    filePublicId: { type: String },
    fileResourceType: {
        type: String,
        enum: ['image', 'video', 'raw'],
        default: 'image'
    }
});

// Ensure we always populate these fields
messageSchema.pre('find', function () {
    this.select('name message room createdAt replyTo fileUrl fileType fileName fileSize');
});

messageSchema.pre('findOne', function () {
    this.select('name message room createdAt replyTo fileUrl fileType fileName fileSize');
});

module.exports = mongoose.model('Message', messageSchema);