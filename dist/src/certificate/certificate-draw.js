"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.drawField = exports.drawBlock = exports.drawLine = exports.wrap = exports.fitSize = exports.measure = exports.embedCertificateFonts = void 0;
const pdf_lib_1 = require("@cantoo/pdf-lib");
const fs_1 = require("fs");
const path_1 = require("path");
const certificate_layout_1 = require("./certificate-layout");
const fontkit = require("@pdf-lib/fontkit");
const FONT_FILES = {
    script: 'PinyonScript-Regular.ttf',
    serifBold: 'PlayfairDisplay-Bold.ttf',
    serif: 'CormorantGaramond-Medium.ttf',
    sans: 'Montserrat-Medium.ttf',
    sansBold: 'Montserrat-SemiBold.ttf',
    sansHeavy: 'Montserrat-Bold.ttf',
};
function fontDir() {
    const candidates = [
        (0, path_1.join)(__dirname, 'assets', 'fonts'),
        (0, path_1.join)(process.cwd(), 'dist', 'src', 'certificate', 'assets', 'fonts'),
        (0, path_1.join)(process.cwd(), 'src', 'certificate', 'assets', 'fonts'),
    ];
    for (const dir of candidates) {
        if ((0, fs_1.existsSync)((0, path_1.join)(dir, FONT_FILES.serifBold)))
            return dir;
    }
    throw new Error('Certificate fonts not found. Expected src/certificate/assets/fonts/*.ttf');
}
async function embedCertificateFonts(doc, keys) {
    doc.registerFontkit(fontkit);
    const dir = fontDir();
    const wanted = (keys ?? Object.keys(FONT_FILES));
    const entries = await Promise.all(wanted.map(async (key) => {
        const bytes = (0, fs_1.readFileSync)((0, path_1.join)(dir, FONT_FILES[key]));
        const font = await doc.embedFont(bytes, { subset: false });
        return [key, font];
    }));
    return Object.fromEntries(entries);
}
exports.embedCertificateFonts = embedCertificateFonts;
function measure(text, font, size, tracking = 0) {
    const base = font.widthOfTextAtSize(text, size);
    if (!tracking || text.length === 0)
        return base;
    return base + tracking * size * text.length;
}
exports.measure = measure;
function fitSize(text, font, size, maxWidth, tracking = 0, floor = 12) {
    if (!maxWidth)
        return size;
    let current = size;
    while (current > floor && measure(text, font, current, tracking) > maxWidth) {
        current -= 0.5;
    }
    return current;
}
exports.fitSize = fitSize;
function wrap(text, font, size, maxWidth, tracking = 0, maxLines = 2) {
    if (measure(text, font, size, tracking) <= maxWidth)
        return [text];
    const words = text.split(/\s+/).filter(Boolean);
    const lines = [];
    let line = '';
    for (const word of words) {
        const next = line ? `${line} ${word}` : word;
        if (measure(next, font, size, tracking) <= maxWidth || !line) {
            line = next;
        }
        else {
            lines.push(line);
            line = word;
            if (lines.length === maxLines - 1)
                break;
        }
    }
    const used = lines.join(' ');
    const rest = text.slice(used.length).trim();
    if (rest)
        lines.push(rest);
    else if (line)
        lines.push(line);
    return lines.slice(0, maxLines);
}
exports.wrap = wrap;
function drawLine(page, opts) {
    const { text, font, size, color, tracking = 0, y } = opts;
    if (!text)
        return;
    const width = measure(text, font, size, tracking);
    const x = opts.center != null ? opts.center - width / 2 : opts.left ?? 0;
    const ascent = opts.anchor === 'baseline'
        ? 0
        : font.heightAtSize(size, { descender: false });
    if (tracking)
        page.pushOperators((0, pdf_lib_1.setCharacterSpacing)(tracking * size));
    page.drawText(text, {
        x,
        y: (0, certificate_layout_1.toPdfY)(y + ascent),
        size,
        font,
        color,
    });
    if (tracking)
        page.pushOperators((0, pdf_lib_1.setCharacterSpacing)(0));
}
exports.drawLine = drawLine;
function drawBlock(page, text, block, font, fallbackCenter, maxLines = 1) {
    const tracking = block.tracking ?? 0;
    const center = block.center ?? fallbackCenter;
    let size = block.size;
    let lines = [text];
    if (block.maxWidth) {
        if (maxLines > 1) {
            lines = wrap(text, font, size, block.maxWidth, tracking, maxLines);
            const longest = lines.reduce((w, l) => Math.max(w, measure(l, font, size, tracking)), 0);
            if (longest > block.maxWidth) {
                size = fitSize(lines.reduce((a, b) => (a.length > b.length ? a : b), ''), font, size, block.maxWidth, tracking);
            }
        }
        else {
            size = fitSize(text, font, size, block.maxWidth, tracking);
        }
    }
    const leading = (block.leading ?? 1.2) * size;
    const startY = block.y - ((lines.length - 1) * leading) / 2;
    lines.forEach((line, i) => {
        drawLine(page, {
            text: line,
            font,
            size,
            color: block.color,
            tracking,
            center,
            y: startY + i * leading,
        });
    });
}
exports.drawBlock = drawBlock;
function drawField(page, text, spec, font, pageHeight) {
    if (!text)
        return;
    const tracking = spec.tracking ?? 0;
    const maxLines = spec.maxLines ?? 1;
    const floor = spec.minSize ?? 8;
    let size = spec.size;
    let lines = [text];
    const fitsOnOneLine = measure(text, font, size, tracking) <= spec.maxWidth;
    if (!fitsOnOneLine && maxLines > 1) {
        size = spec.sizeWhenWrapped ?? size;
        lines = wrap(text, font, size, spec.maxWidth, tracking, maxLines);
        const longest = lines.reduce((w, l) => Math.max(w, measure(l, font, size, tracking)), 0);
        if (longest > spec.maxWidth) {
            const widest = lines.reduce((a, b) => (a.length > b.length ? a : b), '');
            size = fitSize(widest, font, size, spec.maxWidth, tracking, floor);
        }
    }
    else if (!fitsOnOneLine) {
        size = fitSize(text, font, size, spec.maxWidth, tracking, floor);
    }
    const leading = (spec.leading ?? 1.15) * size;
    const anchor = lines.length > 1
        ? spec.baselineWhenWrapped ?? spec.baseline
        : spec.baseline;
    const startBaseline = anchor - ((lines.length - 1) * leading) / 2;
    lines.forEach((line, i) => {
        const baseline = startBaseline + i * leading;
        const width = measure(line, font, size, tracking);
        const x = spec.align === 'center' ? spec.x - width / 2 : spec.x;
        if (tracking)
            page.pushOperators((0, pdf_lib_1.setCharacterSpacing)(tracking * size));
        page.drawText(line, {
            x,
            y: pageHeight - baseline,
            size,
            font,
            color: spec.color,
        });
        if (tracking)
            page.pushOperators((0, pdf_lib_1.setCharacterSpacing)(0));
    });
}
exports.drawField = drawField;
//# sourceMappingURL=certificate-draw.js.map