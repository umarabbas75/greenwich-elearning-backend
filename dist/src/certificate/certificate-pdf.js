"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.renderCertificatePdf = void 0;
const pdf_lib_1 = require("@cantoo/pdf-lib");
const QRCode = require("qrcode");
const certificate_layout_1 = require("./certificate-layout");
const certificate_template_1 = require("./certificate-template");
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
function wrapVerifyUrl(url, font, size, maxWidth) {
    if (font.widthOfTextAtSize(url, size) <= maxWidth)
        return [url];
    try {
        const parsed = new URL(url);
        const origin = parsed.origin;
        const rest = url.slice(origin.length);
        if (rest &&
            font.widthOfTextAtSize(origin, size) <= maxWidth &&
            font.widthOfTextAtSize(rest, size) <= maxWidth) {
            return [origin, rest];
        }
    }
    catch {
    }
    return wrapToWidth(url, font, size, maxWidth);
}
function wrapToWidth(text, font, size, maxWidth) {
    const lines = [];
    let remaining = text;
    while (remaining.length > 0) {
        let take = remaining.length;
        while (take > 1 &&
            font.widthOfTextAtSize(remaining.slice(0, take), size) > maxWidth) {
            take -= 1;
        }
        lines.push(remaining.slice(0, take));
        remaining = remaining.slice(take);
    }
    return lines;
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
async function drawVerifyQrAndUrl(doc, page, verifyUrl, font) {
    const png = await QRCode.toBuffer(verifyUrl, {
        type: 'png',
        width: 256,
        margin: 1,
        errorCorrectionLevel: 'M',
        color: { dark: '#172852', light: '#FFFFFF' },
    });
    const qrImage = await doc.embedPng(png);
    const { size, x, y, urlFontSize, urlGap, urlMaxWidth, urlColor } = certificate_layout_1.CERTIFICATE_LAYOUT.qr;
    page.drawImage(qrImage, { x, y, width: size, height: size });
    const lines = wrapVerifyUrl(verifyUrl, font, urlFontSize, urlMaxWidth);
    const lineHeight = urlFontSize + 1.5;
    const firstLineY = y - urlGap - urlFontSize;
    let maxLineWidth = 0;
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const width = font.widthOfTextAtSize(line, urlFontSize);
        maxLineWidth = Math.max(maxLineWidth, width);
        page.drawText(line, {
            x,
            y: firstLineY - i * lineHeight,
            size: urlFontSize,
            font,
            color: urlColor,
        });
    }
    const urlHeight = lines.length * lineHeight;
    const urlBottom = firstLineY - (lines.length - 1) * lineHeight;
    return [
        { x, y, width: size, height: size },
        {
            x,
            y: urlBottom,
            width: Math.max(size, maxLineWidth),
            height: urlHeight,
        },
    ];
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
    const linkRects = await drawVerifyQrAndUrl(stamped, page, data.verifyUrl, helvetica);
    for (const rect of linkRects) {
        addUriLink(page, data.verifyUrl, rect);
    }
    applyMetadata(stamped, data);
    return stamped.save();
}
exports.renderCertificatePdf = renderCertificatePdf;
//# sourceMappingURL=certificate-pdf.js.map