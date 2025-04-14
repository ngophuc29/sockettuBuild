const express = require("express");
const router = express.Router();
const cloudinary = require("../cloudinary/cloudinary");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const util = require("util");
const stream = require("stream");
const sharp = require("sharp");
const ffmpeg = require("fluent-ffmpeg");
const { PDFDocument } = require("pdf-lib");

// Cấu hình FFmpeg
ffmpeg.setFfmpegPath(require("ffmpeg-static"));

const pipeline = util.promisify(stream.pipeline);

// Cấu hình multer
const storage = multer.memoryStorage();
const upload = multer({
    storage,
    limits: { fileSize: 20 * 1024 * 1024 }, // Giới hạn 20MB (phù hợp với Cloudinary free)
    fileFilter: (req, file, cb) => {
        const allowedTypes = [
            'image/jpeg', 'image/png', 'image/gif', 'image/webp',
            'video/mp4', 'video/quicktime', 'video/x-msvideo',
            'application/pdf',
            'application/msword',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'application/vnd.ms-excel',
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'application/vnd.ms-powerpoint',
            'application/vnd.openxmlformats-officedocument.presentationml.presentation'
        ];

        if (allowedTypes.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error('Loại file không được hỗ trợ. Chỉ chấp nhận: ảnh, video, PDF, Word, Excel, PowerPoint'), false);
        }
    }
});

// Hàm nén ảnh tối ưu
async function compressImage(buffer) {
    try {
        return await sharp(buffer)
            .resize({
                width: 1024,
                height: 1024,
                fit: 'inside',
                withoutEnlargement: true
            })
            .webp({
                quality: 75,  // Giảm chất lượng để tiết kiệm dung lượng
                alphaQuality: 70,
                lossless: false
            })
            .toBuffer();
    } catch (error) {
        console.error("Lỗi nén ảnh, sử dụng ảnh gốc:", error);
        return buffer;
    }
}

// Hàm nén video tối ưu
async function compressVideo(inputBuffer) {
    return new Promise((resolve, reject) => {
        const tempInput = path.join(__dirname, `temp_${Date.now()}_input.mp4`);
        const tempOutput = path.join(__dirname, `temp_${Date.now()}_output.mp4`);

        fs.writeFileSync(tempInput, inputBuffer);

        ffmpeg(tempInput)
            .videoCodec('libx264') // Codec hiệu quả
            .audioCodec('aac')
            .outputOptions([
                '-crf 32',          // Tăng CRF để nén mạnh hơn (23-28 là chất lượng tốt, 32 tiết kiệm hơn)
                '-preset fast',     // Cân bằng giữa tốc độ và chất lượng
                '-movflags faststart',
                '-vf scale=640:-2', // Giảm kích thước video
                '-threads 2'        // Giới hạn thread để tiết kiệm tài nguyên
            ])
            .on('end', () => {
                const outputBuffer = fs.readFileSync(tempOutput);
                // Xóa file tạm
                fs.unlinkSync(tempInput);
                fs.unlinkSync(tempOutput);
                resolve(outputBuffer);
            })
            .on('error', (err) => {
                // Xóa file tạm nếu có lỗi
                if (fs.existsSync(tempInput)) fs.unlinkSync(tempInput);
                if (fs.existsSync(tempOutput)) fs.unlinkSync(tempOutput);
                reject(err);
            })
            .save(tempOutput);
    });
}

// Hàm xử lý upload tối ưu
router.post("/upload", upload.single("file"), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: "Vui lòng chọn file" });
        }

        let fileBuffer = req.file.buffer;
        let resourceType = "auto";
        let folder = "chat-app";
        let originalName = path.parse(req.file.originalname).name.replace(/[^\w\-]/g, '');
        let publicId = `${folder}/${Date.now()}-${originalName}`;
        let fileType = "document";
        let uploadOptions = {
            resource_type: resourceType,
            public_id: publicId,
            folder: folder,
            quality: "auto:low", // Tối ưu chất lượng thấp để tiết kiệm
            format: "webp"       // Mặc định cho ảnh
        };

        // Xác định loại file và nén tối ưu
        if (req.file.mimetype.startsWith("image/")) {
            fileType = "image";
            resourceType = "image";
            folder += "/images";
            fileBuffer = await compressImage(fileBuffer);
            uploadOptions.format = "webp";
        }
        else if (req.file.mimetype.startsWith("video/")) {
            fileType = "video";
            resourceType = "video";
            folder += "/videos";
            try {
                fileBuffer = await compressVideo(fileBuffer);
                uploadOptions.eager = [
                    { width: 480, height: 270, crop: "scale", format: "mp4" } // Thumbnail chất lượng thấp
                ];
                uploadOptions.eager_async = true;
            } catch (error) {
                console.error("Lỗi nén video, upload bản gốc:", error);
            }
        }
        else if (req.file.mimetype === "application/pdf") {
            fileType = "pdf";
            resourceType = "raw";
            folder += "/documents";
            // Không nén PDF để tránh lỗi nội dung
        }
        else if (req.file.mimetype.includes("word")) {
            fileType = "word";
            resourceType = "raw";
            folder += "/documents";
        }
        else if (req.file.mimetype.includes("spreadsheet")) {
            fileType = "excel";
            resourceType = "raw";
            folder += "/documents";
        }
        else if (req.file.mimetype.includes("presentation")) {
            fileType = "powerpoint";
            resourceType = "raw";
            folder += "/documents";
        }

        // Cập nhật options upload
        uploadOptions.resource_type = resourceType;
        uploadOptions.public_id = publicId;
        uploadOptions.folder = folder;

        // Upload lên Cloudinary với chất lượng tối ưu
        const result = await new Promise((resolve, reject) => {
            const uploadStream = cloudinary.uploader.upload_stream(
                uploadOptions,
                (error, result) => {
                    if (error) reject(error);
                    else resolve(result);
                }
            );
            uploadStream.end(fileBuffer);
        });

        // Trả về kết quả tối ưu
        res.status(200).json({
            success: true,
            fileUrl: result.secure_url,
            fileType: fileType,
            fileName: req.file.originalname,
            fileSize: result.bytes,
            publicId: result.public_id,
            resourceType: result.resource_type,
            ...(result.eager && result.eager[0] && { thumbnailUrl: result.eager[0].secure_url })
        });

    } catch (error) {
        console.error("Upload error:", error);
        res.status(500).json({
            success: false,
            error: "Lỗi khi upload file",
            details: process.env.NODE_ENV === 'development' ? error.message : null
        });
    }
});

module.exports = router;