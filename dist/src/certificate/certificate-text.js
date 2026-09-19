"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.formatCertificateTitle = void 0;
const MINOR_WORDS = new Set([
    'a',
    'an',
    'and',
    'as',
    'at',
    'but',
    'by',
    'for',
    'from',
    'in',
    'into',
    'nor',
    'of',
    'on',
    'onto',
    'or',
    'over',
    'the',
    'to',
    'up',
    'via',
    'with',
]);
function formatCertificateTitle(value) {
    const words = value.trim().split(/\s+/).filter(Boolean);
    if (words.length === 0)
        return '';
    return words
        .map((word, index) => {
        const cased = word
            .split(/(-)/)
            .map((part) => titleCasePart(part))
            .join('');
        const isEdge = index === 0 || index === words.length - 1;
        if (!isEdge && MINOR_WORDS.has(word.toLowerCase())) {
            return word.toLowerCase();
        }
        return cased;
    })
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