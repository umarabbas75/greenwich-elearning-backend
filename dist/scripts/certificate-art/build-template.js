"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildTemplate = void 0;
const pdf_lib_1 = require("@cantoo/pdf-lib");
const fs_1 = require("fs");
const path_1 = require("path");
const certificate_layout_1 = require("../../src/certificate/certificate-layout");
const certificate_draw_1 = require("../../src/certificate/certificate-draw");
const ASSETS = (0, path_1.join)(__dirname, '..', '..', 'src', 'certificate', 'assets');
const ART = (0, path_1.join)(__dirname, 'source');
const VARIANTS = {
    a: {
        panel: 'panel.jpg',
        globeArt: 'emblem-globe.png',
        globe: certificate_layout_1.ORNAMENTS.globe,
        leafBase: { x: certificate_layout_1.ORNAMENTS.leafBase.x, y: certificate_layout_1.ORNAMENTS.leafBase.y },
        leafScale: 1,
        globeUnderBorder: false,
        emblemWords: certificate_layout_1.ORNAMENTS.emblemWords,
        emblemRule: certificate_layout_1.ORNAMENTS.emblemRule,
        output: 'certificate-of-completion.pdf',
    },
    b: {
        panel: 'panel-ribbons.jpg',
        globeArt: 'emblem-globe-world.png',
        globe: { x: 1292, y: 118, size: 384 },
        leafBase: { x: 1480, y: 455 },
        leafScale: 1.2,
        globeUnderBorder: true,
        emblemWords: { x: 1466, y: 560, size: 26, lineGap: 38 },
        emblemRule: { x: 1466, y: 690 },
        output: 'certificate-of-completion-variant-b.pdf',
    },
};
function selectedVariant() {
    const i = process.argv.indexOf('--variant');
    const key = i >= 0 ? process.argv[i + 1] : 'a';
    const variant = VARIANTS[key];
    if (!variant) {
        throw new Error(`Unknown variant "${key}". Expected one of: ${Object.keys(VARIANTS).join(', ')}`);
    }
    return variant;
}
function rect(page, x, y, width, height, color, opacity = 1) {
    page.drawRectangle({
        x,
        y: (0, certificate_layout_1.toPdfY)(y + height),
        width,
        height,
        color,
        opacity,
    });
}
function strokeRect(page, x, y, width, height, color, weight) {
    page.drawRectangle({
        x,
        y: (0, certificate_layout_1.toPdfY)(y + height),
        width,
        height,
        borderColor: color,
        borderWidth: weight,
    });
}
function drawBorders(page) {
    const { outer, inner, corner } = certificate_layout_1.BORDER;
    strokeRect(page, outer.x, outer.y, outer.width, outer.height, certificate_layout_1.COLORS.green, outer.weight);
    strokeRect(page, inner.x, inner.y, inner.width, inner.height, certificate_layout_1.COLORS.green, inner.weight);
    const { arm, inset, weight } = corner;
    const left = outer.x;
    const right = outer.x + outer.width;
    const top = outer.y;
    const bottom = outer.y + outer.height;
    const corners = [
        { hx: left + inset, hy: top + inset, vx: left + inset, vy: top + inset },
        {
            hx: right - inset - arm,
            hy: top + inset,
            vx: right - inset - weight,
            vy: top + inset,
        },
        {
            hx: left + inset,
            hy: bottom - inset - weight,
            vx: left + inset,
            vy: bottom - inset - arm,
        },
        {
            hx: right - inset - arm,
            hy: bottom - inset - weight,
            vx: right - inset - weight,
            vy: bottom - inset - arm,
        },
    ];
    for (const c of corners) {
        rect(page, c.hx, c.hy, arm, weight, certificate_layout_1.COLORS.gold);
        rect(page, c.vx, c.vy, weight, arm, certificate_layout_1.COLORS.gold);
    }
}
async function drawPanel(doc, page, art) {
    const image = await doc.embedJpg((0, fs_1.readFileSync)((0, path_1.join)(ART, art)));
    page.drawImage(image, {
        x: certificate_layout_1.PANEL.x,
        y: (0, certificate_layout_1.toPdfY)(certificate_layout_1.PANEL.y + certificate_layout_1.PANEL.height),
        width: certificate_layout_1.PANEL.width,
        height: certificate_layout_1.PANEL.height,
    });
}
function drawTagline(page, fonts) {
    const t = certificate_layout_1.STATIC_TEXT.tagline;
    const leading = t.leading * t.size;
    certificate_layout_1.TAGLINE_LINES.forEach((line, i) => {
        (0, certificate_draw_1.drawLine)(page, {
            text: line,
            font: fonts[t.font],
            size: t.size,
            color: t.color,
            tracking: t.tracking,
            left: t.x,
            y: t.y + i * leading,
        });
    });
    const r = certificate_layout_1.ORNAMENTS.taglineRule;
    rect(page, r.x, r.y, r.width, r.height, certificate_layout_1.COLORS.gold);
}
async function drawLogo(doc, page, fonts) {
    const mark = await doc.embedPng((0, fs_1.readFileSync)((0, path_1.join)(ART, 'logo-mark.png')));
    const m = certificate_layout_1.ORNAMENTS.logoMark;
    page.drawImage(mark, {
        x: m.x,
        y: (0, certificate_layout_1.toPdfY)(m.y + m.height),
        width: m.width,
        height: m.height,
    });
    for (const w of [certificate_layout_1.STATIC_TEXT.wordmarkTop, certificate_layout_1.STATIC_TEXT.wordmarkBottom]) {
        (0, certificate_draw_1.drawLine)(page, {
            text: w.text,
            font: fonts[w.font],
            size: w.size,
            color: w.color,
            tracking: w.tracking,
            left: w.x,
            y: w.y,
        });
    }
}
function drawCentred(page, fonts, block) {
    (0, certificate_draw_1.drawLine)(page, {
        text: block.text,
        font: fonts[block.font],
        size: block.size,
        color: block.color,
        tracking: block.tracking,
        center: block.center ?? certificate_layout_1.COLUMN.center,
        y: block.y,
    });
}
function drawDivider(page) {
    const d = certificate_layout_1.ORNAMENTS.divider;
    const steps = 48;
    const segment = d.armLength / steps;
    for (let i = 0; i < steps; i++) {
        const opacity = 0.25 + 0.75 * ((i + 1) / steps);
        const leftX = d.center - d.gap - d.armLength + i * segment;
        const rightX = d.center + d.gap + d.armLength - (i + 1) * segment;
        rect(page, leftX, d.y, segment + 0.4, 1.5, certificate_layout_1.COLORS.gold, opacity);
        rect(page, rightX, d.y, segment + 0.4, 1.5, certificate_layout_1.COLORS.gold, opacity);
    }
    const diamond = (r, filled) => {
        page.drawSvgPath(`M 0 ${-r} L ${r} 0 L 0 ${r} L ${-r} 0 Z`, {
            x: d.center,
            y: (0, certificate_layout_1.toPdfY)(d.y + 0.75),
            color: filled ? certificate_layout_1.COLORS.gold : undefined,
            borderColor: filled ? undefined : certificate_layout_1.COLORS.gold,
            borderWidth: filled ? undefined : 1.2,
        });
    };
    diamond(18, false);
    diamond(8.5, true);
    for (const offset of [-d.gap + 22, d.gap - 22]) {
        page.drawEllipse({
            x: d.center + offset,
            y: (0, certificate_layout_1.toPdfY)(d.y + 0.75),
            xScale: 3.2,
            yScale: 3.2,
            color: certificate_layout_1.COLORS.gold,
        });
    }
}
async function drawEmblemGlobe(doc, page, v) {
    const globe = await doc.embedPng((0, fs_1.readFileSync)((0, path_1.join)(ART, v.globeArt)));
    page.drawImage(globe, {
        x: v.globe.x,
        y: (0, certificate_layout_1.toPdfY)(v.globe.y + v.globe.size),
        width: v.globe.size,
        height: v.globe.size,
    });
}
function drawEmblemLeaves(page, v) {
    const anchor = { x: v.leafBase.x, y: (0, certificate_layout_1.toPdfY)(v.leafBase.y) };
    const LEAF_R = 'M 0 0 C 36 -48 50 -118 17 -194 C -19 -126 -37 -52 0 0 Z';
    const LEAF_L = 'M 0 0 C -36 -48 -50 -118 -17 -194 C 19 -126 37 -52 0 0 Z';
    const VEIN_R = 'M 0 -16 C 13 -64 19 -122 10 -176';
    const VEIN_L = 'M 0 -16 C -13 -64 -19 -122 -10 -176';
    const fan = [
        {
            d: LEAF_L,
            v: VEIN_L,
            rot: -40,
            scale: 0.62,
            color: (0, pdf_lib_1.rgb)(0.435, 0.655, 0.471),
        },
        {
            d: LEAF_R,
            v: VEIN_R,
            rot: 40,
            scale: 0.62,
            color: (0, pdf_lib_1.rgb)(0.435, 0.655, 0.471),
        },
        {
            d: LEAF_L,
            v: VEIN_L,
            rot: -20,
            scale: 0.83,
            color: (0, pdf_lib_1.rgb)(0.286, 0.529, 0.345),
        },
        {
            d: LEAF_R,
            v: VEIN_R,
            rot: 20,
            scale: 0.83,
            color: (0, pdf_lib_1.rgb)(0.286, 0.529, 0.345),
        },
        {
            d: LEAF_L,
            v: VEIN_L,
            rot: -5,
            scale: 0.96,
            color: (0, pdf_lib_1.rgb)(0.196, 0.424, 0.259),
        },
        {
            d: LEAF_R,
            v: VEIN_R,
            rot: 7,
            scale: 1.0,
            color: (0, pdf_lib_1.rgb)(0.161, 0.376, 0.227),
        },
    ];
    for (const leaf of fan) {
        page.drawSvgPath(leaf.d, {
            ...anchor,
            scale: leaf.scale * v.leafScale,
            rotate: (0, pdf_lib_1.degrees)(leaf.rot),
            color: leaf.color,
        });
        page.drawSvgPath(leaf.v, {
            ...anchor,
            scale: leaf.scale * v.leafScale,
            rotate: (0, pdf_lib_1.degrees)(leaf.rot),
            borderColor: certificate_layout_1.COLORS.white,
            borderWidth: 1.3,
            opacity: 0.34,
        });
    }
    page.drawSvgPath('M 0 0 C -2 -14 -2 -26 0 -38', {
        ...anchor,
        scale: v.leafScale,
        borderColor: (0, pdf_lib_1.rgb)(0.161, 0.376, 0.216),
        borderWidth: 3,
    });
}
async function drawSeal(doc, page) {
    const s = certificate_layout_1.ORNAMENTS.seal;
    const cx = s.center;
    const cy = (0, certificate_layout_1.toPdfY)(s.y);
    const teeth = 52;
    const outer = s.radius;
    const inner = s.radius * 0.94;
    let path = '';
    for (let i = 0; i < teeth * 2; i++) {
        const angle = (Math.PI * i) / teeth;
        const r = i % 2 === 0 ? outer : inner;
        const px = Math.cos(angle) * r;
        const py = Math.sin(angle) * r;
        path += `${i === 0 ? 'M' : 'L'} ${px.toFixed(2)} ${py.toFixed(2)} `;
    }
    path += 'Z';
    page.drawSvgPath(path, { x: cx, y: cy, color: certificate_layout_1.COLORS.gold });
    const steps = 26;
    for (let i = 0; i < steps; i++) {
        const t = i / (steps - 1);
        const radius = s.radius * (0.9 - 0.32 * t);
        page.drawEllipse({
            x: cx,
            y: cy,
            xScale: radius,
            yScale: radius,
            color: (0, pdf_lib_1.rgb)(0.949 - (0.949 - 0.573) * t, 0.867 - (0.867 - 0.412) * t, 0.573 - (0.573 - 0.141) * t),
        });
    }
    const mark = await doc.embedPng((0, fs_1.readFileSync)((0, path_1.join)(ART, 'logo-mark-gold.png')));
    page.drawImage(mark, { x: cx - 33, y: cy - 29, width: 66, height: 58 });
}
async function drawSignature(doc, page) {
    const image = await doc.embedPng((0, fs_1.readFileSync)((0, path_1.join)(ART, 'signature.png')));
    const s = certificate_layout_1.ORNAMENTS.signature;
    page.drawImage(image, {
        x: s.x,
        y: (0, certificate_layout_1.toPdfY)(s.y + s.height),
        width: s.width,
        height: s.height,
    });
}
function drawEmblemWords(page, fonts, v) {
    const e = v.emblemWords;
    ['PEOPLE', 'PLANET', 'PROGRESS'].forEach((word, i) => {
        (0, certificate_draw_1.drawLine)(page, {
            text: word,
            font: fonts.serif,
            size: e.size,
            color: certificate_layout_1.COLORS.green,
            tracking: 0.04,
            left: e.x,
            y: e.y + i * e.lineGap,
        });
    });
    const r = certificate_layout_1.ORNAMENTS.emblemRule;
    rect(page, v.emblemRule.x, v.emblemRule.y, r.width, r.height, certificate_layout_1.COLORS.gold);
}
function drawQrSlot(page, fonts) {
    page.drawRectangle({
        x: certificate_layout_1.QR.x,
        y: (0, certificate_layout_1.toPdfY)(certificate_layout_1.QR.y + certificate_layout_1.QR.size),
        width: certificate_layout_1.QR.size,
        height: certificate_layout_1.QR.size,
        color: certificate_layout_1.COLORS.white,
        borderColor: certificate_layout_1.COLORS.gold,
        borderWidth: 1,
    });
    drawCentred(page, fonts, { ...certificate_layout_1.STATIC_TEXT.qrLabel, font: 'sans' });
}
async function buildTemplate(v) {
    const doc = await pdf_lib_1.PDFDocument.create();
    const page = doc.addPage([certificate_layout_1.PAGE.width, certificate_layout_1.PAGE.height]);
    const fonts = await (0, certificate_draw_1.embedCertificateFonts)(doc);
    page.drawRectangle({
        x: 0,
        y: 0,
        width: certificate_layout_1.PAGE.width,
        height: certificate_layout_1.PAGE.height,
        color: certificate_layout_1.COLORS.white,
    });
    await drawPanel(doc, page, v.panel);
    if (v.globeUnderBorder)
        await drawEmblemGlobe(doc, page, v);
    drawBorders(page);
    if (!v.globeUnderBorder)
        await drawEmblemGlobe(doc, page, v);
    await drawLogo(doc, page, fonts);
    drawCentred(page, fonts, certificate_layout_1.STATIC_TEXT.title);
    drawCentred(page, fonts, certificate_layout_1.STATIC_TEXT.subtitle);
    drawDivider(page);
    drawCentred(page, fonts, certificate_layout_1.STATIC_TEXT.certify);
    drawCentred(page, fonts, certificate_layout_1.STATIC_TEXT.completed);
    const c = certificate_layout_1.STATIC_TEXT.citation;
    const words = c.text.split(' ');
    const mid = Math.ceil(words.length / 2);
    [words.slice(0, mid).join(' '), words.slice(mid).join(' ')].forEach((line, i) => {
        (0, certificate_draw_1.drawLine)(page, {
            text: line,
            font: fonts[c.font],
            size: c.size,
            color: c.color,
            tracking: c.tracking,
            center: certificate_layout_1.COLUMN.center,
            y: c.y + i * c.leading * c.size,
        });
    });
    const nr = certificate_layout_1.ORNAMENTS.nameRule;
    rect(page, nr.x, nr.y, nr.width, nr.height, certificate_layout_1.COLORS.gold);
    const sr = certificate_layout_1.ORNAMENTS.signatureRule;
    rect(page, sr.x, sr.y, sr.width, sr.height, certificate_layout_1.COLORS.navy);
    const dr = certificate_layout_1.ORNAMENTS.dateRule;
    rect(page, dr.x, dr.y, dr.width, dr.height, certificate_layout_1.COLORS.navy);
    await drawSignature(doc, page);
    drawCentred(page, fonts, certificate_layout_1.STATIC_TEXT.signatureRole);
    drawCentred(page, fonts, certificate_layout_1.STATIC_TEXT.signatureOrg);
    drawCentred(page, fonts, certificate_layout_1.STATIC_TEXT.dateLabel);
    await drawSeal(doc, page);
    drawEmblemLeaves(page, v);
    drawEmblemWords(page, fonts, v);
    drawQrSlot(page, fonts);
    drawTagline(page, fonts);
    doc.setTitle('Certificate of Completion');
    doc.setAuthor('Greenwich Training & Consulting');
    doc.setCreator('Greenwich eLearning');
    doc.setProducer('Greenwich Training & Consulting');
    return doc.save();
}
exports.buildTemplate = buildTemplate;
if (require.main === module) {
    const variant = selectedVariant();
    buildTemplate(variant)
        .then((bytes) => {
        const out = (0, path_1.join)(ASSETS, variant.output);
        (0, fs_1.writeFileSync)(out, bytes);
        console.log(`template ${out} ${Math.round(bytes.length / 1024)} KB`);
    })
        .catch((err) => {
        console.error(err);
        process.exit(1);
    });
}
//# sourceMappingURL=build-template.js.map