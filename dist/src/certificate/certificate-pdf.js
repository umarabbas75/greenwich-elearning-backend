"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.renderCertificatePdf = void 0;
const pdf_lib_1 = require("@cantoo/pdf-lib");
const certificate_layout_1 = require("./certificate-layout");
const certificate_draw_1 = require("./certificate-draw");
const certificate_template_1 = require("./certificate-template");
const certificate_text_1 = require("./certificate-text");
const QRCode = require("qrcode");
function addUriLink(page, uri, rect) {
    const pad = 2;
    const link = page.doc.context.register(page.doc.context.obj({
        Type: 'Annot',
        Subtype: 'Link',
        Rect: [
            rect.x - pad,
            rect.y - pad,
            rect.x + rect.width + pad,
            rect.y + rect.height + pad,
        ],
        Border: [0, 0, 0],
        A: {
            Type: 'Action',
            S: 'URI',
            URI: pdf_lib_1.PDFString.of(uri),
        },
    }));
    page.node.addAnnot(link);
}
async function drawVerifyQr(doc, page, verifyUrl) {
    const png = await QRCode.toBuffer(verifyUrl, {
        type: 'png',
        width: 256,
        margin: 0,
        errorCorrectionLevel: 'M',
        color: { dark: '#1D2739', light: '#FFFFFF' },
    });
    const image = await doc.embedPng(png);
    const pad = 6;
    const size = certificate_layout_1.QR.size - pad * 2;
    const x = certificate_layout_1.QR.x + pad;
    const y = (0, certificate_layout_1.toPdfY)(certificate_layout_1.QR.y + certificate_layout_1.QR.size - pad);
    page.drawImage(image, { x, y, width: size, height: size });
    return { x, y, width: size, height: size };
}
function applyMetadata(doc, data) {
    doc.setTitle(`Certificate of Completion — ${data.certificateId}`);
    doc.setAuthor('Greenwich Training & Consulting');
    doc.setSubject(`Verify at ${data.verifyUrl}`);
    doc.setKeywords([
        data.certificateId,
        'certificate of completion',
        'Greenwich Training & Consulting',
        data.verifyUrl,
    ]);
    doc.setProducer('Greenwich Training & Consulting');
    doc.setCreator('Greenwich eLearning');
    doc.setCreationDate(data.issuedAt);
    doc.setModificationDate(data.issuedAt);
}
function flattenTemplateForm(templateDoc) {
    try {
        const form = templateDoc.getForm();
        if (form.getFields().length > 0) {
            form.flatten();
        }
    }
    catch {
    }
}
async function renderCertificatePdf(data) {
    const templateBytes = (0, certificate_template_1.loadCertificateTemplateBytes)();
    const stamped = await pdf_lib_1.PDFDocument.load(templateBytes);
    flattenTemplateForm(stamped);
    const page = stamped.getPages()[0];
    const fonts = await (0, certificate_draw_1.embedCertificateFonts)(stamped, [
        'script',
        'serifBold',
        'serif',
        'sans',
    ]);
    const learnerName = (0, certificate_text_1.formatCertificateTitle)(data.learnerName) || 'Learner';
    (0, certificate_draw_1.drawBlock)(page, learnerName, certificate_layout_1.FIELDS.learnerName, fonts.script, certificate_layout_1.COLUMN.center);
    const courseTitle = (0, certificate_text_1.formatCertificateTitle)(data.courseTitle) || 'Course';
    (0, certificate_draw_1.drawBlock)(page, courseTitle, certificate_layout_1.FIELDS.courseTitle, fonts.serifBold, certificate_layout_1.COLUMN.center, 2);
    const dateStr = data.issuedAt.toLocaleDateString('en-GB', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
    });
    (0, certificate_draw_1.drawBlock)(page, dateStr, certificate_layout_1.FIELDS.issuedDate, fonts.serif, certificate_layout_1.COLUMN.center);
    (0, certificate_draw_1.drawBlock)(page, `${certificate_layout_1.CERTIFICATE_ID_PREFIX}${data.certificateId}`, certificate_layout_1.FIELDS.certificateId, fonts.sans, certificate_layout_1.COLUMN.center);
    const qrRect = await drawVerifyQr(stamped, page, data.verifyUrl);
    addUriLink(page, data.verifyUrl, qrRect);
    page.scale(certificate_layout_1.OUTPUT_SCALE, certificate_layout_1.OUTPUT_SCALE);
    applyMetadata(stamped, data);
    return stamped.save();
}
exports.renderCertificatePdf = renderCertificatePdf;
//# sourceMappingURL=certificate-pdf.js.map