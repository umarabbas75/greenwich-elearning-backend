"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CERTIFICATE_LAYOUT = void 0;
const pdf_lib_1 = require("@cantoo/pdf-lib");
const NAVY = (0, pdf_lib_1.rgb)(0.09, 0.141, 0.282);
const INK = (0, pdf_lib_1.rgb)(0.106, 0.141, 0.125);
exports.CERTIFICATE_LAYOUT = {
    learnerName: {
        yRatio: 0.524,
        fontSize: 42,
        maxWidth: 920,
        color: NAVY,
        bold: true,
    },
    courseTitle: {
        yRatio: 0.408,
        fontSize: 28,
        maxWidth: 1000,
        color: INK,
        bold: true,
    },
    issuedDate: {
        yRatio: 0.151,
        fontSize: 18,
        x: 108,
        align: 'left',
        color: INK,
    },
    certificateId: {
        yRatio: 0.105,
        fontSize: 15,
        x: 1432,
        maxWidth: 160,
        align: 'left',
        color: INK,
    },
    qr: {
        size: 124,
        x: 1290,
        y: 86,
    },
};
//# sourceMappingURL=certificate-layout.js.map