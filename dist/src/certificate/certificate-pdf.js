"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.renderCertificatePdf = void 0;
const pdf_lib_1 = require("pdf-lib");
const certificate_layout_1 = require("./certificate-layout");
const certificate_template_1 = require("./certificate-template");
function fitFontSize(text, font, startSize, maxWidth) {
    let size = startSize;
    while (size > 10 && font.widthOfTextAtSize(text, size) > maxWidth) {
        size -= 1;
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
async function renderCertificatePdf(data) {
    const templateBytes = (0, certificate_template_1.loadCertificateTemplateBytes)();
    const templateDoc = await pdf_lib_1.PDFDocument.load(templateBytes);
    const [templatePage] = templateDoc.getPages();
    const { width: pageWidth, height: pageHeight } = templatePage.getSize();
    const doc = await pdf_lib_1.PDFDocument.create();
    const [embeddedPage] = await doc.embedPdf(templateDoc, [0]);
    const page = doc.addPage([pageWidth, pageHeight]);
    page.drawPage(embeddedPage);
    const helvetica = await doc.embedFont(pdf_lib_1.StandardFonts.Helvetica);
    const helveticaBold = await doc.embedFont(pdf_lib_1.StandardFonts.HelveticaBold);
    const learnerName = data.learnerName.trim() || 'Learner';
    drawField(page, learnerName, pageWidth, pageHeight, certificate_layout_1.CERTIFICATE_LAYOUT.learnerName, helvetica, helveticaBold);
    const courseTitle = data.courseTitle.trim() || 'Course';
    drawField(page, courseTitle, pageWidth, pageHeight, certificate_layout_1.CERTIFICATE_LAYOUT.courseTitle, helvetica, helveticaBold);
    const dateStr = data.issuedAt.toLocaleDateString('en-GB', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
    });
    drawField(page, dateStr, pageWidth, pageHeight, certificate_layout_1.CERTIFICATE_LAYOUT.issuedDate, helvetica, helveticaBold);
    drawField(page, data.certificateId, pageWidth, pageHeight, certificate_layout_1.CERTIFICATE_LAYOUT.certificateId, helvetica, helveticaBold);
    return doc.save();
}
exports.renderCertificatePdf = renderCertificatePdf;
//# sourceMappingURL=certificate-pdf.js.map