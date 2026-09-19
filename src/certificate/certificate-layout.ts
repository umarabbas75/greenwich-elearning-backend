import { rgb, RGB } from '@cantoo/pdf-lib';

/**
 * Single source of truth for the certificate design.
 *
 * The artboard is 1684 x 1190 pt — A4 landscape at 2x — and every coordinate
 * below is expressed **top-left origin, y growing downwards**, matching the
 * Figma frame the design came from. `toPdfY` converts to PDF's bottom-left
 * origin at draw time, so nothing here has to think in flipped coordinates.
 *
 * Both the static template builder (scripts/certificate-art/build-template.ts)
 * and the runtime field stamper (certificate-pdf.ts) read from this file, so
 * the artwork and the stamped values can never drift apart.
 */

/**
 * Authoring space. Everything in this file is expressed on this artboard; the
 * finished PDF is scaled down to {@link OUTPUT_PAGE} as the last step of
 * stamping, which keeps the coordinates here as round numbers and gives the
 * embedded raster art 2x the pixel density of the printed page.
 */
export const PAGE = { width: 1684, height: 1190 } as const;

/**
 * A4 landscape — the standard certificate size in the UK, and what this
 * renders to. 842x595pt is 297.2 x 209.9mm, within 0.2mm of exact A4.
 */
export const OUTPUT_PAGE = { width: 842, height: 595 } as const;

/** Factor applied to the artboard to reach the output page. */
export const OUTPUT_SCALE = OUTPUT_PAGE.width / PAGE.width;

/** Convert an artboard (top-down) y to a PDF (bottom-up) y. */
export function toPdfY(y: number): number {
  return PAGE.height - y;
}

// ── Palette ────────────────────────────────────────────────────────────────
// Sampled from the reference artwork.
export const COLORS = {
  /** Deep forest green — headings and course title. */
  green: rgb(0.078, 0.169, 0.102),
  /** Navy — body copy and field labels. */
  navy: rgb(0.114, 0.153, 0.224),
  /** Brand gold — rules, ornaments, seal. */
  gold: rgb(0.776, 0.588, 0.243),
  goldLight: rgb(0.949, 0.867, 0.573),
  goldDark: rgb(0.541, 0.416, 0.133),
  /** Muted green used for the globe wireframe. */
  line: rgb(0.267, 0.475, 0.333),
  white: rgb(1, 1, 1),
} satisfies Record<string, RGB>;

// ── Structure ──────────────────────────────────────────────────────────────
export const BORDER = {
  outer: { x: 30, y: 30, width: 1624, height: 1130, weight: 3 },
  inner: { x: 46, y: 46, width: 1592, height: 1098, weight: 1.25 },
  /** Gold corner brackets: arm length and inset from the outer border. */
  corner: { arm: 74, inset: 8, weight: 2 },
} as const;

/** Pre-composited ribbon artwork (scripts/certificate-art/build-panel.py). */
export const PANEL = { x: 46, y: 46, width: 700, height: 1098 } as const;

/** Centre column that every stamped field is centred on. */
export const COLUMN = { center: 1080, width: 780 } as const;

export type FontKey = 'script' | 'serifBold' | 'serif' | 'sans' | 'sansBold';

export interface TextBlock {
  /** Baseline-independent: y is the TOP of the text box, as in Figma. */
  y: number;
  size: number;
  font: FontKey;
  color: RGB;
  /** Letter spacing as a fraction of the font size. */
  tracking?: number;
  /** Horizontal centre; defaults to the column centre. */
  center?: number;
  /** Max width before the text shrinks or wraps. */
  maxWidth?: number;
  /** Leading for wrapped lines, as a multiple of font size. */
  leading?: number;
}

/**
 * Fields stamped at runtime. Everything else is baked into the template.
 */
export const FIELDS = {
  learnerName: {
    // Sits clear of "This is to certify that": the script face has a tall
    // ascender, so its box starts lower than a comparable serif would.
    y: 502,
    size: 68,
    font: 'script',
    color: COLORS.navy,
    maxWidth: 700,
  },
  courseTitle: {
    y: 662,
    size: 40,
    font: 'serifBold',
    color: COLORS.green,
    tracking: 0.01,
    maxWidth: 760,
    leading: 1.2,
  },
  issuedDate: {
    y: 908,
    size: 26,
    font: 'serif',
    color: COLORS.navy,
    tracking: 0.02,
    center: 1290,
    maxWidth: 300,
  },
  certificateId: {
    y: 1054,
    size: 20,
    font: 'sans',
    color: COLORS.navy,
    tracking: 0.03,
    maxWidth: 520,
  },
} satisfies Record<string, TextBlock>;

/** Verification QR, drawn into the slot the template outlines. */
export const QR = { x: 1470, y: 856, size: 104 } as const;

/** Prefix rendered in front of the public verification code. */
export const CERTIFICATE_ID_PREFIX = 'Certificate No: ';

// ── Static copy baked into the template ────────────────────────────────────
export const STATIC_TEXT = {
  wordmarkTop: {
    x: 944,
    y: 70,
    text: 'GREENWICH',
    size: 54,
    font: 'sansBold' as FontKey,
    color: COLORS.green,
    tracking: 0.005,
  },
  wordmarkBottom: {
    x: 944,
    y: 132,
    text: 'TRAINING & CONSULTING',
    size: 25,
    font: 'sansBold' as FontKey,
    color: COLORS.navy,
    tracking: 0.025,
  },
  title: {
    y: 196,
    text: 'CERTIFICATE',
    size: 76,
    font: 'serifBold' as FontKey,
    color: COLORS.green,
    tracking: 0.05,
  },
  subtitle: {
    y: 318,
    text: 'OF COMPLETION',
    size: 34,
    font: 'serif' as FontKey,
    color: COLORS.navy,
    tracking: 0.26,
  },
  certify: {
    y: 424,
    text: 'This is to certify that',
    size: 31,
    font: 'serif' as FontKey,
    color: COLORS.navy,
    tracking: 0.02,
  },
  completed: {
    y: 596,
    text: 'has successfully completed the training programme in',
    size: 29,
    font: 'serif' as FontKey,
    color: COLORS.navy,
    tracking: 0.02,
  },
  citation: {
    y: 772,
    text: 'and demonstrated a commitment to professional development and excellence.',
    size: 27,
    font: 'serif' as FontKey,
    color: COLORS.navy,
    tracking: 0.02,
    maxWidth: 700,
    leading: 1.35,
  },
  signatureRole: {
    y: 964,
    text: 'Director Learning',
    size: 20,
    font: 'sansBold' as FontKey,
    color: COLORS.navy,
    tracking: 0.02,
    center: 870,
  },
  signatureOrg: {
    y: 1004,
    text: 'Greenwich Training & Consulting',
    size: 21,
    font: 'serif' as FontKey,
    color: COLORS.navy,
    tracking: 0.02,
    center: 870,
  },
  dateLabel: {
    y: 976,
    text: 'Date of Issue',
    size: 20,
    font: 'sansBold' as FontKey,
    color: COLORS.navy,
    tracking: 0.02,
    center: 1290,
  },
  qrLabel: {
    y: 972,
    text: 'SCAN TO VERIFY',
    size: 14,
    font: 'sans' as FontKey,
    color: COLORS.navy,
    tracking: 0.08,
    center: 1522,
  },
  tagline: {
    x: 110,
    y: 662,
    size: 36,
    font: 'serif' as FontKey,
    color: COLORS.white,
    tracking: 0.06,
    leading: 1.5,
    maxWidth: 300,
  },
} as const;

export const TAGLINE_LINES = [
  'KNOWLEDGE',
  'FOR A SAFER,',
  'HEALTHIER',
  'AND MORE',
  'SUSTAINABLE',
  'TOMORROW',
] as const;

/** Decorative rules and marks baked into the template. */
export const ORNAMENTS = {
  nameRule: { x: 760, y: 572, width: 640, height: 1.6 },
  signatureRule: { x: 740, y: 950, width: 260, height: 1.4 },
  dateRule: { x: 1160, y: 950, width: 260, height: 1.4 },
  taglineRule: { x: 110, y: 1020, width: 110, height: 2 },
  emblemRule: { x: 1470, y: 660, width: 74, height: 2 },
  divider: { center: 1080, y: 394, armLength: 274, gap: 66 },
  seal: { center: 1080, y: 940, radius: 76 },
  /**
   * PEOPLE PLANET PROGRESS emblem — one mark, not two. The shaded globe is a
   * raster (build-emblem.py); the leaf cluster is drawn as vectors rising from
   * `leafBase`, which sits inside the globe's lower half so the plant reads as
   * growing out of the planet rather than floating beside it.
   */
  globe: { x: 1326, y: 150, size: 308 },
  leafBase: { x: 1480, y: 424, height: 210 },
  logoMark: { x: 836, y: 74, width: 92, height: 76 },
  /** Sized from the signature artwork's own 3.13 aspect so it isn't squashed. */
  signature: { x: 762, y: 875, width: 216, height: 69 },
  emblemWords: { x: 1470, y: 512, size: 26, lineGap: 38 },
} as const;
