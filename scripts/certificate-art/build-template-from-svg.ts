/**
 * Builds the certificate template from the Figma master.
 *
 * The master is `Greenwich_Certificate_Editable_Figma_Master.svg` — the same
 * artwork that was imported to produce the Figma file, so Figma and this PDF
 * stay in step. Re-export the SVG from Figma after any design change and
 * re-run this; nothing here is measured off a raster any more.
 *
 * Everything is emitted as vectors and live text, so the result is crisp at any
 * zoom — the previous template was a flattened 300 DPI image and could never be.
 *
 * The four value placeholders and the dummy QR are skipped: those are stamped
 * per learner by certificate-pdf.ts. Their geometry is printed at the end so
 * the layout module can be kept honest against the master.
 *
 * Run: yarn script:certificate:template-from-svg
 */
import { PDFDocument, PDFFont, PDFPage, rgb, setCharacterSpacing } from '@cantoo/pdf-lib';
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { CLIENT_PAGE } from '../../src/certificate/certificate-layout';
import { embedCertificateFonts } from '../../src/certificate/certificate-draw';

const ASSETS = join(__dirname, '..', '..', 'src', 'certificate', 'assets');
const MASTER = join(
  __dirname, '..', '..', 'docs', 'certificate-previews',
  'Greenwich_Certificate_Editable_Figma_Master.svg',
);

/** Text the backend fills in — drawn per learner, never baked in. */
const PLACEHOLDERS = [
  '[ LEARNER NAME ]',
  '[ COURSE TITLE ]',
  '[ CERTIFICATE NO. ]',
  '[ DD MONTH YYYY ]',
];

interface Attrs {
  [k: string]: string;
}

function attrs(tag: string): Attrs {
  const out: Attrs = {};
  for (const m of tag.matchAll(/([\w:-]+)\s*=\s*"([^"]*)"/g)) out[m[1]] = m[2];
  return out;
}

const num = (v: string | undefined, fallback = 0) =>
  v === undefined ? fallback : parseFloat(v);

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function hex(color: string | undefined) {
  if (!color || color === 'none') return undefined;
  const m = /^#?([0-9a-f]{6})$/i.exec(color.trim());
  if (!m) return undefined;
  const n = parseInt(m[1], 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

async function main(): Promise<void> {
  const svg = readFileSync(MASTER, 'utf8');
  const root = attrs(/<svg[^>]*>/.exec(svg)![0]);
  const [, , vbW, vbH] = (root.viewBox ?? `0 0 ${root.width} ${root.height}`)
    .split(/\s+/)
    .map(Number);

  // Fit the master to A4 landscape, preserving its aspect and centring any
  // slack (the master is 1491x1055, which is A4 to within 0.07%).
  const S = Math.min(CLIENT_PAGE.width / vbW, CLIENT_PAGE.height / vbH);
  const offX = (CLIENT_PAGE.width - vbW * S) / 2;
  const offY = (CLIENT_PAGE.height - vbH * S) / 2;

  const doc = await PDFDocument.create();
  const page = doc.addPage([CLIENT_PAGE.width, CLIENT_PAGE.height]);
  const fonts = await embedCertificateFonts(doc, [
    'sansRegular', 'sansBoldAlt', 'serifRegular', 'serifBoldAlt',
  ] as const);

  // SVG y grows downwards; PDF upwards.
  const X = (x: number) => offX + x * S;
  const Y = (y: number) => CLIENT_PAGE.height - offY - y * S;

  const pickFont = (family: string, weight: string): PDFFont => {
    const bold = Number(weight || '400') >= 600;
    const serif = /lora|georgia|serif/i.test(family);
    if (serif) return bold ? fonts.serifBoldAlt : fonts.serifRegular;
    return bold ? fonts.sansBoldAlt : fonts.sansRegular;
  };

  const fieldGeometry: Record<string, unknown>[] = [];
  let skippedQr = false;
  let inQrGroup = false;

  const tokens = svg.match(/<[^>]+>[^<]*/g) ?? [];
  for (const token of tokens) {
    const tag = /<[^>]+>/.exec(token)![0];
    const name = /<\/?([\w:-]+)/.exec(tag)?.[1];
    const a = attrs(tag);

    if (name === 'g') {
      inQrGroup = a.id === 'Verification QR';
      if (inQrGroup) skippedQr = true;
      continue;
    }
    if (name === 'svg' || name === 'defs' || name === 'clipPath') continue;
    // The dummy QR is replaced at stamp time by a real, scannable code, so its
    // frame, finder squares and "QR" glyph are dropped. The VERIFY caption
    // beside it is real artwork and stays.
    if (inQrGroup) {
      if (name !== 'text') continue;
      const label = decodeEntities(token.slice(tag.length)).trim();
      if (label !== 'VERIFY') continue;
    }

    if (name === 'rect') {
      const fill = hex(a.fill);
      const stroke = hex(a.stroke);
      if (!fill && !stroke) continue;
      const w = num(a.width) * S;
      const h = num(a.height) * S;
      const rx = num(a.rx) * S;
      const weight = stroke ? Math.max(0.4, num(a['stroke-width'], 1) * S) : undefined;

      if (rx > 0.5) {
        // pdf-lib has no rounded rectangle. Build the path in SVG user space
        // and hand it to drawSvgPath with the same anchor/scale as <path>,
        // so its own y-flip is applied once and only once.
        const sx = num(a.x);
        const sy = num(a.y);
        const sw = num(a.width);
        const sh = num(a.height);
        const r = Math.min(num(a.rx), sw / 2, sh / 2);
        const d =
          `M ${sx + r} ${sy} H ${sx + sw - r} A ${r} ${r} 0 0 1 ${sx + sw} ${sy + r} ` +
          `V ${sy + sh - r} A ${r} ${r} 0 0 1 ${sx + sw - r} ${sy + sh} ` +
          `H ${sx + r} A ${r} ${r} 0 0 1 ${sx} ${sy + sh - r} ` +
          `V ${sy + r} A ${r} ${r} 0 0 1 ${sx + r} ${sy} Z`;
        page.drawSvgPath(d, {
          x: offX,
          y: CLIENT_PAGE.height - offY,
          scale: S,
          color: fill,
          borderColor: stroke,
          borderWidth: weight,
        });
      } else {
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
    } else if (name === 'line') {
      const stroke = hex(a.stroke);
      if (!stroke) continue;
      page.drawLine({
        start: { x: X(num(a.x1)), y: Y(num(a.y1)) },
        end: { x: X(num(a.x2)), y: Y(num(a.y2)) },
        color: stroke,
        thickness: Math.max(0.3, num(a['stroke-width'], 1) * S),
      });
    } else if (name === 'path') {
      const fill = hex(a.fill);
      if (!fill || !a.d) continue;
      // Paths are authored in SVG user units from the top-left.
      page.drawSvgPath(a.d, {
        x: offX,
        y: CLIENT_PAGE.height - offY,
        scale: S,
        color: fill,
      });
    } else if (name === 'image') {
      const href = a['xlink:href'] ?? a.href;
      if (!href?.startsWith('data:image/png;base64,')) continue;
      const img = await doc.embedPng(
        Buffer.from(href.slice('data:image/png;base64,'.length), 'base64'),
      );
      page.drawImage(img, {
        x: X(num(a.x)),
        y: Y(num(a.y) + num(a.height)),
        width: num(a.width) * S,
        height: num(a.height) * S,
      });
    } else if (name === 'text') {
      const raw = token.slice(tag.length);
      const text = decodeEntities(raw).trim();
      if (!text) continue;

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
        continue; // stamped per learner
      }

      const width =
        font.widthOfTextAtSize(text, size) + (tracking ? tracking * text.length : 0);
      const x = anchor === 'middle' ? X(num(a.x)) - width / 2 : X(num(a.x));

      if (tracking) page.pushOperators(setCharacterSpacing(tracking));
      page.drawText(text, {
        x,
        y: Y(num(a.y)),
        size,
        font,
        color: hex(a.fill) ?? rgb(0, 0, 0),
      });
      if (tracking) page.pushOperators(setCharacterSpacing(0));
    }
  }

  doc.setTitle('Certificate of Completion');
  doc.setAuthor('Greenwich Training & Consulting');
  doc.setCreator('Greenwich eLearning');
  doc.setProducer('Greenwich Training & Consulting');

  const bytes = await doc.save();
  const out = join(ASSETS, 'certificate-of-completion.pdf');
  writeFileSync(out, bytes);
  console.log(`template ${out} ${Math.round(bytes.length / 1024)} KB`);
  console.log(`scale ${S.toFixed(5)}  offset ${offX.toFixed(2)}, ${offY.toFixed(2)}`);
  console.log(`dummy QR skipped: ${skippedQr}`);
  console.log('\nplaceholder geometry (for CLIENT_FIELDS):');
  for (const f of fieldGeometry) console.log(' ', JSON.stringify(f));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
