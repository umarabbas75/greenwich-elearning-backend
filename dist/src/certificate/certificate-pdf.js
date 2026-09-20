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
function drawVerifyQr(page, verifyUrl) {
    const qr = QRCode.create(verifyUrl, { errorCorrectionLevel: 'M' });
    const modules = qr.modules;
    const count = modules.size;
    const QUIET = 0;
    const unit = certificate_layout_1.CLIENT_QR.size / (count + QUIET * 2);
    const originX = certificate_layout_1.CLIENT_QR.x;
    const originTop = certificate_layout_1.CLIENT_QR.y;
    page.drawRectangle({
        x: originX,
        y: certificate_layout_1.CLIENT_PAGE.height - originTop - certificate_layout_1.CLIENT_QR.size,
        width: certificate_layout_1.CLIENT_QR.size,
        height: certificate_layout_1.CLIENT_QR.size,
        color: (0, pdf_lib_1.rgb)(1, 1, 1),
    });
    for (let row = 0; row < count; row++) {
        for (let col = 0; col < count; col++) {
            if (!modules.get(row, col))
                continue;
            const x = originX + (col + QUIET) * unit;
            const top = originTop + (row + QUIET) * unit;
            page.drawRectangle({
                x,
                y: certificate_layout_1.CLIENT_PAGE.height - top - unit,
                width: unit + 0.03,
                height: unit + 0.03,
                color: (0, pdf_lib_1.rgb)(0.102, 0.227, 0.141),
            });
        }
    }
    return {
        x: originX,
        y: certificate_layout_1.CLIENT_PAGE.height - originTop - certificate_layout_1.CLIENT_QR.size,
        width: certificate_layout_1.CLIENT_QR.size,
        height: certificate_layout_1.CLIENT_QR.size,
    };
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
        'serifRegular',
        'serifBoldAlt',
        'sansRegular',
    ]);
    const pageHeight = page.getSize().height;
    (0, certificate_draw_1.drawField)(page, (0, certificate_text_1.formatCertificateTitle)(data.learnerName) || 'Learner', certificate_layout_1.CLIENT_FIELDS.learnerName, fonts.serifRegular, pageHeight);
    (0, certificate_draw_1.drawField)(page, (0, certificate_text_1.formatCertificateTitle)(data.courseTitle) || 'Course', certificate_layout_1.CLIENT_FIELDS.courseTitle, fonts.serifBoldAlt, pageHeight);
    (0, certificate_draw_1.drawField)(page, data.certificateId, certificate_layout_1.CLIENT_FIELDS.certificateId, fonts.sansRegular, pageHeight);
    (0, certificate_draw_1.drawField)(page, data.issuedAt.toLocaleDateString('en-GB', {
        day: '2-digit',
        month: 'long',
        year: 'numeric',
    }), certificate_layout_1.CLIENT_FIELDS.issuedDate, fonts.sansRegular, pageHeight);
    const qrRect = drawVerifyQr(page, data.verifyUrl);
    addUriLink(page, data.verifyUrl, qrRect);
    applyMetadata(stamped, data);
    return stamped.save();
}
exports.renderCertificatePdf = renderCertificatePdf;
//# sourceMappingURL=certificate-pdf.js.map