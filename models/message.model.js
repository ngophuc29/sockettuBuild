const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
    name: { type: String, required: true },       
    message: { type: String, default: "" },      
    room: { type: String, required: true },      

    // Thêm các trường mới cho file upload
    fileUrl: { type: String },                   // URL file trên Cloudinary
    fileType: {                                  // Loại file
        type: String,
        enum: ['image', 'video', 'pdf', 'word', 'excel', 'powerpoint', 'other']
    },
    fileName: { type: String },                  // Tên file gốc
    fileSize: { type: Number },                  // Kích thước file (bytes)
    filePublicId: { type: String },              // Public ID trên Cloudinary
    fileResourceType: {                          // Loại resource Cloudinary
        type: String,
        enum: ['image', 'video', 'raw'],
        default: 'image'
    },
    thumbnailUrl: { type: String },              // URL thumbnail (cho video)
    fileWidth: { type: Number },                 // Chiều rộng (ảnh/video)
    fileHeight: { type: Number },                // Chiều cao (ảnh/video)
    videoDuration: { type: Number },             // Thời lượng video (giây)

    createdAt: { type: Date, default: Date.now } 
});

// Thêm index mới (không ảnh hưởng đến code hiện có)
messageSchema.index({ room: 1, createdAt: -1 }); // Cho tin nhắn mới nhất trước
messageSchema.index({ fileType: 1 });            // Tìm kiếm theo loại file
 
messageSchema.index({ name: 1 });
module.exports = mongoose.model('Message', messageSchema);