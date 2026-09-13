"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.renderCertificatePdf = void 0;
const pdf_lib_1 = require("@cantoo/pdf-lib");
const QRCode = require("qrcode");
const certificate_layout_1 = require("./certificate-layout");
const certificate_template_1 = require("./certificate-template");
const certificate_text_1 = require("./certificate-text");
function fitFontSize(text, font, startSize, maxWidth) {
    let size = startSize;
    while (size > 7 && font.widthOfTextAtSize(text, size) > maxWidth) {
        size -= 0.5;
    }
    return size;
}
function drawField(page, text, pageWidth, pageHeight, layout, font, boldFont) {
    const activeFont = layout.bold ? boldFont : font;
    const maxWidth = layout.maxWidth ?? pageWidth * 0.75;
    const fontSize = fitFontSize(text, activeFont, layout.fontSize, maxWidth);
    const textWidth = activeFont.widthOfTextAtSize(text, fontSize);
    const y = pageHeight * layout.yRatio;
    let x;
    if (layout.x != null) {
        if (layout.align === 'right') {
            x = layout.x - textWidth;
        }
        else if (layout.align === 'center') {
            x = layout.x - textWidth / 2;
        }
        else {
            x = layout.x;
        }
    }
    else {
        x = (pageWidth - textWidth) / 2;
    }
    page.drawText(text, {
        x,
        y,
        size: fontSize,
        font: activeFont,
        color: layout.color,
    });
}
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
        margin: 1,
        errorCorrectionLevel: 'M',
        color: { dark: '#1B2420', light: '#FFFFFF' },
    });
    const qrImage = await doc.embedPng(png);
    const { size, x, y } = certificate_layout_1.CERTIFICATE_LAYOUT.qr;
    page.drawImage(qrImage, { x, y, width: size, height: size });
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
    const { width: pageWidth, height: pageHeight } = page.getSize();
    const helvetica = await stamped.embedFont(pdf_lib_1.StandardFonts.Helvetica);
    const helveticaBold = await stamped.embedFont(pdf_lib_1.StandardFonts.HelveticaBold);
    const learnerName = (0, certificate_text_1.formatCertificateTitle)(data.learnerName) || 'Learner';
    drawField(page, learnerName, pageWidth, pageHeight, certificate_layout_1.CERTIFICATE_LAYOUT.learnerName, helvetica, helveticaBold);
    const courseTitle = (0, certificate_text_1.formatCertificateTitle)(data.courseTitle) || 'Course';
    drawField(page, courseTitle, pageWidth, pageHeight, certificate_layout_1.CERTIFICATE_LAYOUT.courseTitle, helvetica, helveticaBold);
    const dateStr = data.issuedAt.toLocaleDateString('en-GB', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
    });
    drawField(page, dateStr, pageWidth, pageHeight, certificate_layout_1.CERTIFICATE_LAYOUT.issuedDate, helvetica, helveticaBold);
    drawField(page, data.certificateId, pageWidth, pageHeight, certificate_layout_1.CERTIFICATE_LAYOUT.certificateId, helvetica, helveticaBold);
    const qrRect = await drawVerifyQr(stamped, page, data.verifyUrl);
    addUriLink(page, data.verifyUrl, qrRect);
    applyMetadata(stamped, data);
    return stamped.save();
}
exports.renderCertificatePdf = renderCertificatePdf;
//# sourceMappingURL=certificate-pdf.js.map