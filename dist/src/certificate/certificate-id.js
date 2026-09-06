"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeCertificateId = void 0;
const CERTIFICATE_ID_PATTERN = /^GTC-[A-F0-9]{8,16}$/;
function normalizeCertificateId(raw) {
    const normalized = raw.trim().toUpperCase();
    if (!CERTIFICATE_ID_PATTERN.test(normalized))
        return null;
    return normalized;
}
exports.normalizeCertificateId = normalizeCertificateId;
//# sourceMappingURL=certificate-id.js.map