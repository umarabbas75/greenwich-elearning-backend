"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.assertNoInlineBase64 = void 0;
const common_1 = require("@nestjs/common");
const DATA_URI = /data:image\/[a-zA-Z0-9.+-]+;base64,/;
const MAX_HTML_BYTES = 512 * 1024;
function assertNoInlineBase64(value, field = 'description') {
    if (!value)
        return;
    if (DATA_URI.test(value)) {
        throw new common_1.BadRequestException(`${field} contains an inline base64 image. Upload the image and reference it by URL instead — ` +
            `embedding it inflates every response for this section.`);
    }
    const bytes = Buffer.byteLength(value, 'utf8');
    if (bytes > MAX_HTML_BYTES) {
        throw new common_1.BadRequestException(`${field} is ${(bytes / 1024).toFixed(0)}kB, above the ${MAX_HTML_BYTES / 1024}kB limit. ` +
            `Move large embedded assets to file uploads.`);
    }
}
exports.assertNoInlineBase64 = assertNoInlineBase64;
//# sourceMappingURL=reject-inline-base64.js.map