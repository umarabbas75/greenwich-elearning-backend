/**
 * Builds the static certificate template PDF.
 *
 * Everything that never changes is drawn here — borders, the ribbon panel,
 * logo, titles, ornaments, seal, globe, leaves and the fixed copy. The four
 * runtime values (name, course, date, certificate id) and the verification QR
 * are stamped later by certificate-pdf.ts, using the same layout module so the
 * two can't drift.
 *
 * Run: yarn script:certificate:template
 */
import { PDFDocument, PDFPage, RGB, rgb } from '@cantoo/pdf-lib';
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import {
  BORDER,
  COLORS,
  COLUMN,
  ORNAMENTS,
  PAGE,
  PANEL,
  QR,
  STATIC_TEXT,
  TAGLINE_LINES,
  toPdfY,
} from '../../src/certificate/certificate-layout';
import {
  CertificateFonts,
  drawLine,
  embedCertificateFonts,
} from '../../src/certificate/certificate-draw';

const ASSETS = join(__dirname, '..', '..', 'src', 'certificate', 'assets');
const ART = join(__dirname, 'source');

/** Filled rectangle in artboard (top-down) coordinates. */
function rect(
  page: PDFPage,
  x: number,
  y: number,
  width: number,
  height: number,
  color: RGB,
  opacity = 1,
): void {
  page.drawRectangle({
    x,
    y: toPdfY(y + height),
    width,
    height,
    color,
    opacity,
  });
}

function strokeRect(
  page: PDFPage,
  x: number,
  y: number,
  width: number,
  height: number,
  color: RGB,
  weight: number,
): void {
  page.drawRectangle({
    x,
    y: toPdfY(y + height),
    width,
    height,
    borderColor: color,
    borderWidth: weight,
  });
}

function drawBorders(page: PDFPage): void {
  const { outer, inner, corner } = BORDER;
  strokeRect(
    page,
    outer.x,
    outer.y,
    outer.width,
    outer.height,
    COLORS.green,
    outer.weight,
  );
  strokeRect(
    page,
    inner.x,
    inner.y,
    inner.width,
    inner.height,
    COLORS.green,
    inner.weight,
  );

  // Gold brackets tucked between the two border lines at each corner.
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
    rect(page, c.hx, c.hy, arm, weight, COLORS.gold);
    rect(page, c.vx, c.vy, weight, arm, COLORS.gold);
  }
}

async function drawPanel(doc: PDFDocument, page: PDFPage): Promise<void> {
  const image = await doc.embedJpg(readFileSync(join(ART, 'panel.jpg')));
  page.drawImage(image, {
    x: PANEL.x,
    y: toPdfY(PANEL.y + PANEL.height),
    width: PANEL.width,
    height: PANEL.height,
  });
}

function drawTagline(page: PDFPage, fonts: CertificateFonts): void {
  const t = STATIC_TEXT.tagline;
  const leading = t.leading * t.size;
  TAGLINE_LINES.forEach((line, i) => {
    drawLine(page, {
      text: line,
      font: fonts[t.font],
      size: t.size,
      color: t.color,
      tracking: t.tracking,
      left: t.x,
      y: t.y + i * leading,
    });
  });
  const r = ORNAMENTS.taglineRule;
  rect(page, r.x, r.y, r.width, r.height, COLORS.gold);
}

async function drawLogo(
  doc: PDFDocument,
  page: PDFPage,
  fonts: CertificateFonts,
): Promise<void> {
  const mark = await doc.embedPng(readFileSync(join(ART, 'logo-mark.png')));
  const m = ORNAMENTS.logoMark;
  page.drawImage(mark, {
    x: m.x,
    y: toPdfY(m.y + m.height),
    width: m.width,
    height: m.height,
  });

  for (const w of [STATIC_TEXT.wordmarkTop, STATIC_TEXT.wordmarkBottom]) {
    drawLine(page, {
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

function drawCentred(
  page: PDFPage,
  fonts: CertificateFonts,
  block: {
    y: number;
    text: string;
    size: number;
    font: keyof CertificateFonts;
    color: RGB;
    tracking?: number;
    center?: number;
  },
): void {
  drawLine(page, {
    text: block.text,
    font: fonts[block.font],
    size: block.size,
    color: block.color,
    tracking: block.tracking,
    center: block.center ?? COLUMN.center,
    y: block.y,
  });
}

/** Two rules tapering into a lozenge, with flanking dots. */
function drawDivider(page: PDFPage): void {
  const d = ORNAMENTS.divider;
  const steps = 48;
  const segment = d.armLength / steps;
  for (let i = 0; i < steps; i++) {
    // Fade in from a visible minimum so the rules read as tapered, not absent.
    const opacity = 0.25 + 0.75 * ((i + 1) / steps);
    const leftX = d.center - d.gap - d.armLength + i * segment;
    const rightX = d.center + d.gap + d.armLength - (i + 1) * segment;
    rect(page, leftX, d.y, segment + 0.4, 1.5, COLORS.gold, opacity);
    rect(page, rightX, d.y, segment + 0.4, 1.5, COLORS.gold, opacity);
  }

  const diamond = (r: number, filled: boolean) => {
    page.drawSvgPath(`M 0 ${-r} L ${r} 0 L 0 ${r} L ${-r} 0 Z`, {
      x: d.center,
      y: toPdfY(d.y + 0.75),
      color: filled ? COLORS.gold : undefined,
      borderColor: filled ? undefined : COLORS.gold,
      borderWidth: filled ? undefined : 1.2,
    });
  };
  diamond(18, false);
  diamond(8.5, true);

  for (const offset of [-d.gap + 22, d.gap - 22]) {
    page.drawEllipse({
      x: d.center + offset,
      y: toPdfY(d.y + 0.75),
      xScale: 3.2,
      yScale: 3.2,
      color: COLORS.gold,
    });
  }
}

/**
 * Halftone dot-sphere watermark.
 *
 * Dots sit on a lat/long grid projected orthographically; only the front
 * hemisphere is drawn, with size and opacity falling off towards the limb so
 * the sphere reads without needing an outline. Reads far more modern than a
 * wireframe and holds up when printed at low contrast.
 */
function drawGlobe(page: PDFPage): void {
  const g = ORNAMENTS.globe;
  const r = g.size / 2;
  const cx = g.x + r;
  const cy = g.y + r;
  const rad = (deg: number) => (deg * Math.PI) / 180;

  for (let lat = -78; lat <= 78; lat += 9) {
    const ring = Math.cos(rad(lat));
    // Fewer dots near the poles keeps spacing even across the surface.
    const count = Math.max(6, Math.round(40 * ring));
    for (let i = 0; i < count; i++) {
      const lon = (360 / count) * i;
      const depth = ring * Math.cos(rad(lon));
      if (depth <= 0.02) continue; // back hemisphere

      page.drawEllipse({
        x: cx + r * ring * Math.sin(rad(lon)),
        y: toPdfY(cy - r * Math.sin(rad(lat))),
        xScale: 0.85 + 1.45 * depth,
        yScale: 0.85 + 1.45 * depth,
        color: COLORS.line,
        opacity: g.opacity * (0.3 + 0.7 * depth),
      });
    }
  }
}

/**
 * Brand emblem for PEOPLE PLANET PROGRESS: a monoline planet ring with orbit
 * lines, a growth leaf breaking out past the ring at the top right, and a gold
 * progress arc sweeping beneath. Replaces the generic botanical sprig with a
 * mark that says what the company actually does.
 *
 * Paths are written in emblem-local coordinates and anchored at the emblem's
 * origin, so the composition can be read straight off the numbers.
 */
function drawEmblem(page: PDFPage): void {
  const e = ORNAMENTS.emblem;
  const origin = { x: e.x, y: toPdfY(e.y) };
  const c = e.size / 2; // 75
  const ring = 58;

  const centre = { x: e.x + c, y: toPdfY(e.y + c) };

  // Planet ring plus two orbit lines
  page.drawEllipse({
    ...centre,
    xScale: ring,
    yScale: ring,
    borderColor: COLORS.line,
    borderWidth: 2.2,
  });
  page.drawEllipse({
    ...centre,
    xScale: 23,
    yScale: ring,
    borderColor: COLORS.line,
    borderWidth: 1,
    borderOpacity: 0.55,
  });
  page.drawEllipse({
    ...centre,
    xScale: ring,
    yScale: 18,
    borderColor: COLORS.line,
    borderWidth: 1,
    borderOpacity: 0.55,
  });

  // Growth leaf: base inside the ring, tip breaking past its upper-right edge
  page.drawSvgPath('M 62 100 C 58 66 78 34 128 28 C 132 68 106 96 62 100 Z', {
    ...origin,
    color: rgb(0.176, 0.396, 0.239),
  });
  page.drawSvgPath('M 66 96 C 82 72 102 48 124 32', {
    ...origin,
    borderColor: COLORS.white,
    borderWidth: 1.6,
    opacity: 0.9,
  });

  // Gold progress arc sweeping clear of the planet's underside
  page.drawSvgPath('M 24 120 C 48 166 104 166 128 120', {
    ...origin,
    borderColor: COLORS.gold,
    borderWidth: 3,
  });
}

/** Gold seal: scalloped edge, graded rings and the embossed mark. */
async function drawSeal(doc: PDFDocument, page: PDFPage): Promise<void> {
  const s = ORNAMENTS.seal;
  const cx = s.center;
  const cy = toPdfY(s.y);

  // Scalloped rim, drawn as one path so the edge stays crisp.
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
  page.drawSvgPath(path, { x: cx, y: cy, color: COLORS.gold });

  // Graded rings: concentric circles stepping between two golds stand in for
  // a radial gradient, which pdf-lib cannot express.
  const steps = 26;
  for (let i = 0; i < steps; i++) {
    const t = i / (steps - 1);
    const radius = s.radius * (0.9 - 0.32 * t);
    page.drawEllipse({
      x: cx,
      y: cy,
      xScale: radius,
      yScale: radius,
      color: rgb(
        0.949 - (0.949 - 0.573) * t,
        0.867 - (0.867 - 0.412) * t,
        0.573 - (0.573 - 0.141) * t,
      ),
    });
  }

  const mark = await doc.embedPng(
    readFileSync(join(ART, 'logo-mark-gold.png')),
  );
  page.drawImage(mark, { x: cx - 33, y: cy - 29, width: 66, height: 58 });
}

async function drawSignature(doc: PDFDocument, page: PDFPage): Promise<void> {
  const image = await doc.embedPng(readFileSync(join(ART, 'signature.png')));
  const s = ORNAMENTS.signature;
  page.drawImage(image, {
    x: s.x,
    y: toPdfY(s.y + s.height),
    width: s.width,
    height: s.height,
  });
}

function drawEmblemWords(page: PDFPage, fonts: CertificateFonts): void {
  const e = ORNAMENTS.emblemWords;
  ['PEOPLE', 'PLANET', 'PROGRESS'].forEach((word, i) => {
    drawLine(page, {
      text: word,
      font: fonts.serif,
      size: e.size,
      color: COLORS.green,
      tracking: 0.04,
      left: e.x,
      y: e.y + i * e.lineGap,
    });
  });
  const r = ORNAMENTS.emblemRule;
  rect(page, r.x, r.y, r.width, r.height, COLORS.gold);
}

function drawQrSlot(page: PDFPage, fonts: CertificateFonts): void {
  page.drawRectangle({
    x: QR.x,
    y: toPdfY(QR.y + QR.size),
    width: QR.size,
    height: QR.size,
    color: COLORS.white,
    borderColor: COLORS.gold,
    borderWidth: 1,
  });
  drawCentred(page, fonts, { ...STATIC_TEXT.qrLabel, font: 'sans' });
}

export async function buildTemplate(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([PAGE.width, PAGE.height]);
  const fonts = await embedCertificateFonts(doc);

  page.drawRectangle({
    x: 0,
    y: 0,
    width: PAGE.width,
    height: PAGE.height,
    color: COLORS.white,
  });

  await drawPanel(doc, page);
  drawBorders(page);
  drawGlobe(page);
  await drawLogo(doc, page, fonts);

  drawCentred(page, fonts, STATIC_TEXT.title);
  drawCentred(page, fonts, STATIC_TEXT.subtitle);
  drawDivider(page);
  drawCentred(page, fonts, STATIC_TEXT.certify);
  drawCentred(page, fonts, STATIC_TEXT.completed);

  // Citation wraps to two lines at the column width.
  const c = STATIC_TEXT.citation;
  const words = c.text.split(' ');
  const mid = Math.ceil(words.length / 2);
  [words.slice(0, mid).join(' '), words.slice(mid).join(' ')].forEach(
    (line, i) => {
      drawLine(page, {
        text: line,
        font: fonts[c.font],
        size: c.size,
        color: c.color,
        tracking: c.tracking,
        center: COLUMN.center,
        y: c.y + i * c.leading * c.size,
      });
    },
  );

  const nr = ORNAMENTS.nameRule;
  rect(page, nr.x, nr.y, nr.width, nr.height, COLORS.gold);
  const sr = ORNAMENTS.signatureRule;
  rect(page, sr.x, sr.y, sr.width, sr.height, COLORS.navy);
  const dr = ORNAMENTS.dateRule;
  rect(page, dr.x, dr.y, dr.width, dr.height, COLORS.navy);

  await drawSignature(doc, page);
  drawCentred(page, fonts, STATIC_TEXT.signatureRole);
  drawCentred(page, fonts, STATIC_TEXT.signatureOrg);
  drawCentred(page, fonts, STATIC_TEXT.dateLabel);
  await drawSeal(doc, page);

  drawEmblem(page);
  drawEmblemWords(page, fonts);
  drawQrSlot(page, fonts);
  drawTagline(page, fonts);

  doc.setTitle('Certificate of Completion');
  doc.setAuthor('Greenwich Training & Consulting');
  doc.setCreator('Greenwich eLearning');
  doc.setProducer('Greenwich Training & Consulting');

  return doc.save();
}

if (require.main === module) {
  buildTemplate()
    .then((bytes) => {
      const out = join(ASSETS, 'certificate-of-completion.pdf');
      writeFileSync(out, bytes);
      console.log(`template ${out} ${Math.round(bytes.length / 1024)} KB`);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
