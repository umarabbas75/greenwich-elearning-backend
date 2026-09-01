"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CERTIFICATE_LAYOUT = void 0;
const pdf_lib_1 = require("pdf-lib");
exports.CERTIFICATE_LAYOUT = {
    learnerName: {
        yRatio: 0.577,
        fontSize: 34,
        maxWidth: 760,
        color: (0, pdf_lib_1.rgb)(0.09, 0.16, 0.32),
        bold: true,
    },
    courseTitle: {
        yRatio: 0.448,
        fontSize: 20,
        maxWidth: 820,
        color: (0, pdf_lib_1.rgb)(0.09, 0.16, 0.32),
        bold: true,
    },
    issuedDate: {
        yRatio: 0.291,
        fontSize: 13,
        x: 448,
        align: 'center',
        color: (0, pdf_lib_1.rgb)(0.25, 0.28, 0.32),
    },
    certificateId: {
        yRatio: 0.291,
        fontSize: 13,
        x: 659,
        maxWidth: 147,
        align: 'center',
        color: (0, pdf_lib_1.rgb)(0.25, 0.28, 0.32),
    },
};
//# sourceMappingURL=certificate-layout.js.map