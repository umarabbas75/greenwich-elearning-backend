"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.clearCertificateTemplateCache = exports.loadCertificateTemplateBytes = void 0;
const fs_1 = require("fs");
const path_1 = require("path");
let cachedTemplateBytes = null;
function loadCertificateTemplateBytes() {
    if (cachedTemplateBytes)
        return cachedTemplateBytes;
    const candidates = [
        (0, path_1.join)(__dirname, 'assets', 'certificate-of-completion.pdf'),
        (0, path_1.join)(process.cwd(), 'dist', 'src', 'certificate', 'assets', 'certificate-of-completion.pdf'),
        (0, path_1.join)(process.cwd(), 'src', 'certificate', 'assets', 'certificate-of-completion.pdf'),
        (0, path_1.join)(process.cwd(), 'docs', 'certificate-of-completion-updated.pdf'),
        (0, path_1.join)(process.cwd(), 'docs', 'certificate-of-completion.pdf'),
    ];
    for (const path of candidates) {
        if ((0, fs_1.existsSync)(path)) {
            cachedTemplateBytes = (0, fs_1.readFileSync)(path);
            return cachedTemplateBytes;
        }
    }
    throw new Error('Certificate template PDF not found. Expected src/certificate/assets/certificate-of-completion.pdf');
}
exports.loadCertificateTemplateBytes = loadCertificateTemplateBytes;
function clearCertificateTemplateCache() {
    cachedTemplateBytes = null;
}
exports.clearCertificateTemplateCache = clearCertificateTemplateCache;
//# sourceMappingURL=certificate-template.js.map