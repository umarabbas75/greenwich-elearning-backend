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
import { PDFDocument, PDFPage, RGB, degrees, rgb } from '@cantoo/pdf-lib';
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

/**
 * Variant A is the shipped design. Variant B matches the client's inspiration
 * artwork on the two graphics they called out: the layered-ribbon left panel,
 * and a continent globe large enough to run under the border — which is what
 * makes it read as embedded rather than pasted on.
 */
interface Variant {
  panel: string;
  globeArt: string;
  globe: { x: number; y: number; size: number };
  leafBase: { x: number; y: number };
  leafScale: number;
  /** Globe drawn before the border, so the border frames over it. */
  globeUnderBorder: boolean;
  emblemWords: { x: number; y: number; size: number; lineGap: number };
  emblemRule: { x: number; y: number };
  output: string;
}

const VARIANTS: Record<string, Variant> = {
  a: {
    panel: 'panel.jpg',
    globeArt: 'emblem-globe.png',
    globe: ORNAMENTS.globe,
    leafBase: { x: ORNAMENTS.leafBase.x, y: ORNAMENTS.leafBase.y },
    leafScale: 1,
    globeUnderBorder: false,
    emblemWords: ORNAMENTS.emblemWords,
    emblemRule: ORNAMENTS.emblemRule,
    output: 'certificate-of-completion.pdf',
  },
  b: {
    panel: 'panel-ribbons.jpg',
    globeArt: 'emblem-globe-world.png',
    globe: { x: 1292, y: 118, size: 384 },
    // Smaller, shifted right onto the globe's centre, and lifted clear of the
    // name band (y 470-597) — the longest names reach x 1433, so the fan sits
    // above them rather than beside them.
    leafBase: { x: 1480, y: 455 },
    leafScale: 1.2,
    globeUnderBorder: true,
    emblemWords: { x: 1466, y: 560, size: 26, lineGap: 38 },
    emblemRule: { x: 1466, y: 690 },
    output: 'certificate-of-completion-variant-b.pdf',
  },
};

function selectedVariant(): Variant {
  const i = process.argv.indexOf('--variant');
  const key = i >= 0 ? process.argv[i + 1] : 'a';
  const variant = VARIANTS[key];
  if (!variant) {
    throw new Error(
      `Unknown variant "${key}". Expected one of: ${Object.keys(VARIANTS).join(
        ', ',
      )}`,
    );
  }
  return variant;
}

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

async function drawPanel(
  doc: PDFDocument,
  page: PDFPage,
  art: string,
): Promise<void> {
  const image = await doc.embedJpg(readFileSync(join(ART, art)));
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
 * PEOPLE PLANET PROGRESS emblem, drawn as one entity.
 *
 * The globe is a pre-shaded raster (radial shading and a feathered limb are
 * beyond pdf-lib), and the plant is vector so it stays crisp. The leaves fan
 * from a base point inside the globe's lower half, so the two read as a single
 * mark — a plant growing out of the planet — rather than two stacked graphics.
 */
async function drawEmblemGlobe(
  doc: PDFDocument,
  page: PDFPage,
  v: Variant,
): Promise<void> {
  const globe = await doc.embedPng(readFileSync(join(ART, v.globeArt)));
  page.drawImage(globe, {
    x: v.globe.x,
    y: toPdfY(v.globe.y + v.globe.size),
    width: v.globe.size,
    height: v.globe.size,
  });
}

function drawEmblemLeaves(page: PDFPage, v: Variant): void {
  const anchor = { x: v.leafBase.x, y: toPdfY(v.leafBase.y) };

  // One leaf, pointing up from the anchor; negative y is up once drawSvgPath
  // flips the path into PDF space.
  // Two mirrored silhouettes with a slight sickle bend. Rotated clones of one
  // straight oval read as clip art; bending them outwards makes the fan sit
  // like a real plant.
  const LEAF_R = 'M 0 0 C 36 -48 50 -118 17 -194 C -19 -126 -37 -52 0 0 Z';
  const LEAF_L = 'M 0 0 C -36 -48 -50 -118 -17 -194 C 19 -126 37 -52 0 0 Z';
  const VEIN_R = 'M 0 -16 C 13 -64 19 -122 10 -176';
  const VEIN_L = 'M 0 -16 C -13 -64 -19 -122 -10 -176';

  // Outer leaves first so the central pair sits on top.
  const fan = [
    {
      d: LEAF_L,
      v: VEIN_L,
      rot: -40,
      scale: 0.62,
      color: rgb(0.435, 0.655, 0.471),
    },
    {
      d: LEAF_R,
      v: VEIN_R,
      rot: 40,
      scale: 0.62,
      color: rgb(0.435, 0.655, 0.471),
    },
    {
      d: LEAF_L,
      v: VEIN_L,
      rot: -20,
      scale: 0.83,
      color: rgb(0.286, 0.529, 0.345),
    },
    {
      d: LEAF_R,
      v: VEIN_R,
      rot: 20,
      scale: 0.83,
      color: rgb(0.286, 0.529, 0.345),
    },
    {
      d: LEAF_L,
      v: VEIN_L,
      rot: -5,
      scale: 0.96,
      color: rgb(0.196, 0.424, 0.259),
    },
    {
      d: LEAF_R,
      v: VEIN_R,
      rot: 7,
      scale: 1.0,
      color: rgb(0.161, 0.376, 0.227),
    },
  ];

  for (const leaf of fan) {
    page.drawSvgPath(leaf.d, {
      ...anchor,
      scale: leaf.scale * v.leafScale,
      rotate: degrees(leaf.rot),
      color: leaf.color,
    });
    page.drawSvgPath(leaf.v, {
      ...anchor,
      scale: leaf.scale * v.leafScale,
      rotate: degrees(leaf.rot),
      borderColor: COLORS.white,
      borderWidth: 1.3,
      opacity: 0.34,
    });
  }

  // Short stem tying the fan into the globe.
  page.drawSvgPath('M 0 0 C -2 -14 -2 -26 0 -38', {
    ...anchor,
    scale: v.leafScale,
    borderColor: rgb(0.161, 0.376, 0.216),
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

function drawEmblemWords(
  page: PDFPage,
  fonts: CertificateFonts,
  v: Variant,
): void {
  const e = v.emblemWords;
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
  rect(page, v.emblemRule.x, v.emblemRule.y, r.width, r.height, COLORS.gold);
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

export async function buildTemplate(v: Variant): Promise<Uint8Array> {
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

  await drawPanel(doc, page, v.panel);
  // Variant B's globe runs under the border, so it is laid down first and the
  // border frames over it; variant A's sits clear and is drawn on top later.
  if (v.globeUnderBorder) await drawEmblemGlobe(doc, page, v);
  drawBorders(page);
  if (!v.globeUnderBorder) await drawEmblemGlobe(doc, page, v);
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

if (require.main === module) {
  const variant = selectedVariant();
  buildTemplate(variant)
    .then((bytes) => {
      const out = join(ASSETS, variant.output);
      writeFileSync(out, bytes);
      console.log(`template ${out} ${Math.round(bytes.length / 1024)} KB`);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
