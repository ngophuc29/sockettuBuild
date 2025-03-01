const express = require("express");
const router = express.Router();
const cloudinary = require("../cloudinary/cloudinary"); // Đường dẫn tới file cấu hình Cloudinary của bạn
const multer = require("multer");

// Sử dụng bộ nhớ tạm thời để lưu file trong RAM
const storage = multer.memoryStorage();
const upload = multer({ storage });

router.post("/upload", upload.single("file"), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: "No file uploaded" });
    }

    // Sử dụng upload_stream của Cloudinary để upload file từ buffer
    let stream = cloudinary.uploader.upload_stream(
        { resource_type: "auto" },
        (error, result) => {
            if (error) return res.status(500).json({ error: "Upload error", details: error });
            res.status(200).json({ fileUrl: result.secure_url });
        }
    );

    stream.end(req.file.buffer);
});

module.exports = router;
