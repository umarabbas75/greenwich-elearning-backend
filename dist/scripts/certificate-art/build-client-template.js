"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildClientTemplate = void 0;
const pdf_lib_1 = require("@cantoo/pdf-lib");
const fs_1 = require("fs");
const path_1 = require("path");
const certificate_layout_1 = require("../../src/certificate/certificate-layout");
const ASSETS = (0, path_1.join)(__dirname, '..', '..', 'src', 'certificate', 'assets');
const ART = (0, path_1.join)(__dirname, 'source');
const OUTPUT = 'certificate-of-completion.pdf';
async function buildClientTemplate() {
    const doc = await pdf_lib_1.PDFDocument.create();
    const page = doc.addPage([certificate_layout_1.CLIENT_PAGE.width, certificate_layout_1.CLIENT_PAGE.height]);
    const art = await doc.embedJpg((0, fs_1.readFileSync)((0, path_1.join)(ART, 'client-certificate-clean.jpg')));
    page.drawImage(art, {
        x: 0,
        y: 0,
        width: certificate_layout_1.CLIENT_PAGE.width,
        height: certificate_layout_1.CLIENT_PAGE.height,
    });
    doc.setTitle('Certificate of Completion');
    doc.setAuthor('Greenwich Training & Consulting');
    doc.setCreator('Greenwich eLearning');
    doc.setProducer('Greenwich Training & Consulting');
    return doc.save();
}
exports.buildClientTemplate = buildClientTemplate;
if (require.main === module) {
    buildClientTemplate()
        .then((bytes) => {
        const out = (0, path_1.join)(ASSETS, OUTPUT);
        (0, fs_1.writeFileSync)(out, bytes);
        console.log(`template ${out} ${Math.round(bytes.length / 1024)} KB`);
    })
        .catch((err) => {
        console.error(err);
        process.exit(1);
    });
}
//# sourceMappingURL=build-client-template.js.map