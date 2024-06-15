"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.uploadToGoogleDrive = exports.upload = void 0;
const multer = require("multer");
const google_config_1 = require("./google.config");
const storage = multer.memoryStorage();
exports.upload = multer({
    storage,
    limits: {
        fileSize: 10 * 1024 * 1024,
    },
}).single('file');
async function uploadToGoogleDrive(file) {
    const { originalname, buffer } = file;
    const response = await google_config_1.drive.files.create({
        requestBody: {
            name: originalname,
            mimeType: file.mimetype,
        },
        media: {
            mimeType: file.mimetype,
            body: Buffer.from(buffer),
        },
    });
    return response.data;
}
exports.uploadToGoogleDrive = uploadToGoogleDrive;
//# sourceMappingURL=multer-google-drive.js.map