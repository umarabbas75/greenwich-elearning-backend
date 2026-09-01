"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.uploadCertificatePdf = exports.configureCloudinary = void 0;
const cloudinary_1 = require("cloudinary");
function configureCloudinary(config) {
    cloudinary_1.v2.config({
        cloud_name: config.cloudName,
        api_key: config.apiKey,
        api_secret: config.apiSecret,
        secure: true,
    });
}
exports.configureCloudinary = configureCloudinary;
function uploadCertificatePdf(buffer, publicId) {
    return new Promise((resolve, reject) => {
        const stream = cloudinary_1.v2.uploader.upload_stream({
            resource_type: 'raw',
            folder: 'certificates',
            public_id: publicId,
            format: 'pdf',
            overwrite: true,
        }, (error, result) => {
            if (error || !result?.secure_url) {
                reject(error ?? new Error('Cloudinary upload returned no URL'));
                return;
            }
            resolve(result.secure_url);
        });
        stream.end(buffer);
    });
}
exports.uploadCertificatePdf = uploadCertificatePdf;
//# sourceMappingURL=certificate-cloudinary.js.map