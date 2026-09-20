"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const pdf_lib_1 = require("@cantoo/pdf-lib");
const fs_1 = require("fs");
const path_1 = require("path");
const certificate_layout_1 = require("../../src/certificate/certificate-layout");
const certificate_draw_1 = require("../../src/certificate/certificate-draw");
const ASSETS = (0, path_1.join)(__dirname, '..', '..', 'src', 'certificate', 'assets');
const MASTER = (0, path_1.join)(__dirname, '..', '..', 'docs', 'certificate-previews', 'Greenwich_Certificate_Editable_Figma_Master.svg');
const PLACEHOLDERS = [
    '[ LEARNER NAME ]',
    '[ COURSE TITLE ]',
    '[ CERTIFICATE NO. ]',
    '[ DD MONTH YYYY ]',
];
function attrs(tag) {
    const out = {};
    for (const m of tag.matchAll(/([\w:-]+)\s*=\s*"([^"]*)"/g))
        out[m[1]] = m[2];
    return out;
}
const num = (v, fallback = 0) => v === undefined ? fallback : parseFloat(v);
function decodeEntities(s) {
    return s
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'");
}
function hex(color) {
    if (!color || color === 'none')
        return undefined;
    const m = /^#?([0-9a-f]{6})$/i.exec(color.trim());
    if (!m)
        return undefined;
    const n = parseInt(m[1], 16);
    return (0, pdf_lib_1.rgb)(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}
async function main() {
    const svg = (0, fs_1.readFileSync)(MASTER, 'utf8');
    const root = attrs(/<svg[^>]*>/.exec(svg)[0]);
    const [, , vbW, vbH] = (root.viewBox ?? `0 0 ${root.width} ${root.height}`)
        .split(/\s+/)
        .map(Number);
    const S = Math.min(certificate_layout_1.CLIENT_PAGE.width / vbW, certificate_layout_1.CLIENT_PAGE.height / vbH);
    const offX = (certificate_layout_1.CLIENT_PAGE.width - vbW * S) / 2;
    const offY = (certificate_layout_1.CLIENT_PAGE.height - vbH * S) / 2;
    const doc = await pdf_lib_1.PDFDocument.create();
    const page = doc.addPage([certificate_layout_1.CLIENT_PAGE.width, certificate_layout_1.CLIENT_PAGE.height]);
    const fonts = await (0, certificate_draw_1.embedCertificateFonts)(doc, [
        'sansRegular', 'sansBoldAlt', 'serifRegular', 'serifBoldAlt',
    ]);
    const X = (x) => offX + x * S;
    const Y = (y) => certificate_layout_1.CLIENT_PAGE.height - offY - y * S;
    const pickFont = (family, weight) => {
        const bold = Number(weight || '400') >= 600;
        const serif = /lora|georgia|serif/i.test(family);
        if (serif)
            return bold ? fonts.serifBoldAlt : fonts.serifRegular;
        return bold ? fonts.sansBoldAlt : fonts.sansRegular;
    };
    const fieldGeometry = [];
    let skippedQr = false;
    let inQrGroup = false;
    const tokens = svg.match(/<[^>]+>[^<]*/g) ?? [];
    for (const token of tokens) {
        const tag = /<[^>]+>/.exec(token)[0];
        const name = /<\/?([\w:-]+)/.exec(tag)?.[1];
        const a = attrs(tag);
        if (name === 'g') {
            inQrGroup = a.id === 'Verification QR';
            if (inQrGroup)
                skippedQr = true;
            continue;
        }
        if (name === 'svg' || name === 'defs' || name === 'clipPath')
            continue;
        if (inQrGroup) {
            if (name !== 'text')
                continue;
            const label = decodeEntities(token.slice(tag.length)).trim();
            if (label !== 'VERIFY')
                continue;
        }
        if (name === 'rect') {
            const fill = hex(a.fill);
            const stroke = hex(a.stroke);
            if (!fill && !stroke)
                continue;
            const w = num(a.width) * S;
            const h = num(a.height) * S;
            const rx = num(a.rx) * S;
            const weight = stroke ? Math.max(0.4, num(a['stroke-width'], 1) * S) : undefined;
            if (rx > 0.5) {
                const sx = num(a.x);
                const sy = num(a.y);
                const sw = num(a.width);
                const sh = num(a.height);
                const r = Math.min(num(a.rx), sw / 2, sh / 2);
                const d = `M ${sx + r} ${sy} H ${sx + sw - r} A ${r} ${r} 0 0 1 ${sx + sw} ${sy + r} ` +
                    `V ${sy + sh - r} A ${r} ${r} 0 0 1 ${sx + sw - r} ${sy + sh} ` +
                    `H ${sx + r} A ${r} ${r} 0 0 1 ${sx} ${sy + sh - r} ` +
                    `V ${sy + r} A ${r} ${r} 0 0 1 ${sx + r} ${sy} Z`;
                page.drawSvgPath(d, {
                    x: offX,
                    y: certificate_layout_1.CLIENT_PAGE.height - offY,
                    scale: S,
                    color: fill,
                    borderColor: stroke,
                    borderWidth: weight,
                });
            }
            else {
                page.drawRectangle({
                    x: X(num(a.x)),
                    y: Y(num(a.y) + num(a.height)),
                    width: w,
                    height: h,
                    color: fill,
                    borderColor: stroke,
                    borderWidth: weight,
                });
            }
        }
        else if (name === 'line') {
            const stroke = hex(a.stroke);
            if (!stroke)
                continue;
            page.drawLine({
                start: { x: X(num(a.x1)), y: Y(num(a.y1)) },
                end: { x: X(num(a.x2)), y: Y(num(a.y2)) },
                color: stroke,
                thickness: Math.max(0.3, num(a['stroke-width'], 1) * S),
            });
        }
        else if (name === 'path') {
            const fill = hex(a.fill);
            if (!fill || !a.d)
                continue;
            page.drawSvgPath(a.d, {
                x: offX,
                y: certificate_layout_1.CLIENT_PAGE.height - offY,
                scale: S,
                color: fill,
            });
        }
        else if (name === 'image') {
            const href = a['xlink:href'] ?? a.href;
            if (!href?.startsWith('data:image/png;base64,'))
                continue;
            const img = await doc.embedPng(Buffer.from(href.slice('data:image/png;base64,'.length), 'base64'));
            page.drawImage(img, {
                x: X(num(a.x)),
                y: Y(num(a.y) + num(a.height)),
                width: num(a.width) * S,
                height: num(a.height) * S,
            });
        }
        else if (name === 'text') {
            const raw = token.slice(tag.length);
            const text = decodeEntities(raw).trim();
            if (!text)
                continue;
            const size = num(a['font-size'], 12) * S;
            const tracking = num(a['letter-spacing'], 0) * S;
            const font = pickFont(a['font-family'] ?? '', a['font-weight'] ?? '400');
            const anchor = a['text-anchor'] ?? 'start';
            if (PLACEHOLDERS.includes(text)) {
                fieldGeometry.push({
                    placeholder: text,
                    baselineFromTop: +(offY / S + num(a.y)).toFixed(0) && +(offY + num(a.y) * S).toFixed(2),
                    x: +X(num(a.x)).toFixed(2),
                    align: anchor === 'middle' ? 'center' : 'left',
                    size: +size.toFixed(2),
                    tracking: +(tracking / size).toFixed(4),
                    fill: a.fill,
                    family: a['font-family'],
                    weight: a['font-weight'] ?? '400',
                });
                continue;
            }
            const width = font.widthOfTextAtSize(text, size) + (tracking ? tracking * text.length : 0);
            const x = anchor === 'middle' ? X(num(a.x)) - width / 2 : X(num(a.x));
            if (tracking)
                page.pushOperators((0, pdf_lib_1.setCharacterSpacing)(tracking));
            page.drawText(text, {
                x,
                y: Y(num(a.y)),
                size,
                font,
                color: hex(a.fill) ?? (0, pdf_lib_1.rgb)(0, 0, 0),
            });
            if (tracking)
                page.pushOperators((0, pdf_lib_1.setCharacterSpacing)(0));
        }
    }
    doc.setTitle('Certificate of Completion');
    doc.setAuthor('Greenwich Training & Consulting');
    doc.setCreator('Greenwich eLearning');
    doc.setProducer('Greenwich Training & Consulting');
    const bytes = await doc.save();
    const out = (0, path_1.join)(ASSETS, 'certificate-of-completion.pdf');
    (0, fs_1.writeFileSync)(out, bytes);
    console.log(`template ${out} ${Math.round(bytes.length / 1024)} KB`);
    console.log(`scale ${S.toFixed(5)}  offset ${offX.toFixed(2)}, ${offY.toFixed(2)}`);
    console.log(`dummy QR skipped: ${skippedQr}`);
    console.log('\nplaceholder geometry (for CLIENT_FIELDS):');
    for (const f of fieldGeometry)
        console.log(' ', JSON.stringify(f));
}
main().catch((err) => {
    console.error(err);
    process.exit(1);
});
//# sourceMappingURL=build-template-from-svg.js.map