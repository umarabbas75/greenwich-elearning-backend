"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CLIENT_QR = exports.CLIENT_FIELDS = exports.CLIENT_PAGE = exports.ORNAMENTS = exports.TAGLINE_LINES = exports.STATIC_TEXT = exports.CERTIFICATE_ID_PREFIX = exports.QR = exports.FIELDS = exports.COLUMN = exports.PANEL = exports.BORDER = exports.COLORS = exports.toPdfY = exports.OUTPUT_SCALE = exports.OUTPUT_PAGE = exports.PAGE = void 0;
const pdf_lib_1 = require("@cantoo/pdf-lib");
exports.PAGE = { width: 1684, height: 1190 };
exports.OUTPUT_PAGE = { width: 842, height: 595 };
exports.OUTPUT_SCALE = exports.OUTPUT_PAGE.width / exports.PAGE.width;
function toPdfY(y) {
    return exports.PAGE.height - y;
}
exports.toPdfY = toPdfY;
exports.COLORS = {
    green: (0, pdf_lib_1.rgb)(0.078, 0.169, 0.102),
    navy: (0, pdf_lib_1.rgb)(0.114, 0.153, 0.224),
    gold: (0, pdf_lib_1.rgb)(0.776, 0.588, 0.243),
    goldLight: (0, pdf_lib_1.rgb)(0.949, 0.867, 0.573),
    goldDark: (0, pdf_lib_1.rgb)(0.541, 0.416, 0.133),
    line: (0, pdf_lib_1.rgb)(0.267, 0.475, 0.333),
    white: (0, pdf_lib_1.rgb)(1, 1, 1),
};
exports.BORDER = {
    outer: { x: 30, y: 30, width: 1624, height: 1130, weight: 3 },
    inner: { x: 46, y: 46, width: 1592, height: 1098, weight: 1.25 },
    corner: { arm: 74, inset: 8, weight: 2 },
};
exports.PANEL = { x: 46, y: 46, width: 700, height: 1098 };
exports.COLUMN = { center: 1080, width: 780 };
exports.FIELDS = {
    learnerName: {
        y: 502,
        size: 68,
        font: 'script',
        color: exports.COLORS.navy,
        maxWidth: 700,
    },
    courseTitle: {
        y: 662,
        size: 40,
        font: 'serifBold',
        color: exports.COLORS.green,
        tracking: 0.01,
        maxWidth: 760,
        leading: 1.2,
    },
    issuedDate: {
        y: 908,
        size: 26,
        font: 'serif',
        color: exports.COLORS.navy,
        tracking: 0.02,
        center: 1290,
        maxWidth: 300,
    },
    certificateId: {
        y: 1054,
        size: 20,
        font: 'sans',
        color: exports.COLORS.navy,
        tracking: 0.03,
        maxWidth: 520,
    },
};
exports.QR = { x: 1470, y: 856, size: 104 };
exports.CERTIFICATE_ID_PREFIX = 'Certificate No: ';
exports.STATIC_TEXT = {
    wordmarkTop: {
        x: 944,
        y: 70,
        text: 'GREENWICH',
        size: 54,
        font: 'sansBold',
        color: exports.COLORS.green,
        tracking: 0.005,
    },
    wordmarkBottom: {
        x: 944,
        y: 132,
        text: 'TRAINING & CONSULTING',
        size: 25,
        font: 'sansBold',
        color: exports.COLORS.navy,
        tracking: 0.025,
    },
    title: {
        y: 196,
        text: 'CERTIFICATE',
        size: 76,
        font: 'serifBold',
        color: exports.COLORS.green,
        tracking: 0.05,
    },
    subtitle: {
        y: 318,
        text: 'OF COMPLETION',
        size: 34,
        font: 'serif',
        color: exports.COLORS.navy,
        tracking: 0.26,
    },
    certify: {
        y: 424,
        text: 'This is to certify that',
        size: 31,
        font: 'serif',
        color: exports.COLORS.navy,
        tracking: 0.02,
    },
    completed: {
        y: 596,
        text: 'has successfully completed the training programme in',
        size: 29,
        font: 'serif',
        color: exports.COLORS.navy,
        tracking: 0.02,
    },
    citation: {
        y: 772,
        text: 'and demonstrated a commitment to professional development and excellence.',
        size: 27,
        font: 'serif',
        color: exports.COLORS.navy,
        tracking: 0.02,
        maxWidth: 700,
        leading: 1.35,
    },
    signatureRole: {
        y: 964,
        text: 'Director Learning',
        size: 20,
        font: 'sansBold',
        color: exports.COLORS.navy,
        tracking: 0.02,
        center: 870,
    },
    signatureOrg: {
        y: 1004,
        text: 'Greenwich Training & Consulting',
        size: 21,
        font: 'serif',
        color: exports.COLORS.navy,
        tracking: 0.02,
        center: 870,
    },
    dateLabel: {
        y: 976,
        text: 'Date of Issue',
        size: 20,
        font: 'sansBold',
        color: exports.COLORS.navy,
        tracking: 0.02,
        center: 1290,
    },
    qrLabel: {
        y: 972,
        text: 'SCAN TO VERIFY',
        size: 14,
        font: 'sans',
        color: exports.COLORS.navy,
        tracking: 0.08,
        center: 1522,
    },
    tagline: {
        x: 110,
        y: 662,
        size: 36,
        font: 'serif',
        color: exports.COLORS.white,
        tracking: 0.06,
        leading: 1.5,
        maxWidth: 300,
    },
};
exports.TAGLINE_LINES = [
    'KNOWLEDGE',
    'FOR A SAFER,',
    'HEALTHIER',
    'AND MORE',
    'SUSTAINABLE',
    'TOMORROW',
];
exports.ORNAMENTS = {
    nameRule: { x: 760, y: 572, width: 640, height: 1.6 },
    signatureRule: { x: 740, y: 950, width: 260, height: 1.4 },
    dateRule: { x: 1160, y: 950, width: 260, height: 1.4 },
    taglineRule: { x: 110, y: 1020, width: 110, height: 2 },
    emblemRule: { x: 1466, y: 596, width: 74, height: 2 },
    divider: { center: 1080, y: 394, armLength: 274, gap: 66 },
    seal: { center: 1080, y: 940, radius: 76 },
    globe: { x: 1364, y: 116, size: 268 },
    leafBase: { x: 1498, y: 372, height: 210 },
    logoMark: { x: 840, y: 70, width: 88, height: 86 },
    signature: { x: 762, y: 875, width: 216, height: 69 },
    emblemWords: { x: 1466, y: 458, size: 26, lineGap: 38 },
};
exports.CLIENT_PAGE = { width: 841.89, height: 595.28 };
exports.CLIENT_FIELDS = {
    learnerName: {
        baseline: 147.83,
        size: 27.08,
        font: 'serifRegular',
        color: (0, pdf_lib_1.rgb)(0, 0.29, 0.208),
        tracking: 0.0417,
        x: 540.85,
        align: 'center',
        maxWidth: 428,
        minSize: 13,
    },
    courseTitle: {
        baseline: 217.8,
        size: 23.7,
        font: 'serifBoldAlt',
        color: (0, pdf_lib_1.rgb)(0, 0.29, 0.208),
        tracking: 0.0333,
        x: 540.85,
        align: 'center',
        maxWidth: 428,
        maxLines: 2,
        baselineWhenWrapped: 207,
        sizeWhenWrapped: 19,
        leading: 1.06,
        minSize: 11,
    },
    certificateId: {
        baseline: 370.71,
        size: 7.34,
        font: 'sansRegular',
        color: (0, pdf_lib_1.rgb)(0.129, 0.145, 0.161),
        x: 359.72,
        align: 'left',
        maxWidth: 150,
        minSize: 6,
    },
    issuedDate: {
        baseline: 402.31,
        size: 7.34,
        font: 'sansRegular',
        color: (0, pdf_lib_1.rgb)(0.129, 0.145, 0.161),
        x: 359.72,
        align: 'left',
        maxWidth: 150,
        minSize: 6,
    },
};
exports.CLIENT_QR = { x: 292.5, y: 347, size: 52 };
//# sourceMappingURL=certificate-layout.js.map