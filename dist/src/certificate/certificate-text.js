"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.formatCertificateTitle = void 0;
function formatCertificateTitle(value) {
    const words = value.trim().split(/\s+/).filter(Boolean);
    if (words.length === 0)
        return '';
    return words
        .map((word) => word
        .split(/(-)/)
        .map((part) => titleCasePart(part))
        .join(''))
        .join(' ');
}
exports.formatCertificateTitle = formatCertificateTitle;
function titleCasePart(part) {
    if (!part || part === '-' || part === '&')
        return part;
    if (/^\d/.test(part))
        return part;
    if (/^[A-Z0-9]{2,6}$/.test(part))
        return part;
    if (part.includes("'") && part.length > 2) {
        return part
            .split("'")
            .map((piece) => piece
            ? piece.charAt(0).toUpperCase() + piece.slice(1).toLowerCase()
            : piece)
            .join("'");
    }
    return part.charAt(0).toUpperCase() + part.slice(1).toLowerCase();
}
//# sourceMappingURL=certificate-text.js.map