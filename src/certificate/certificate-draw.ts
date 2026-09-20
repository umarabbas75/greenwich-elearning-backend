import {
  PDFDocument,
  PDFFont,
  PDFPage,
  RGB,
  setCharacterSpacing,
} from '@cantoo/pdf-lib';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { FieldSpec, FontKey, TextBlock, toPdfY } from './certificate-layout';
import fontkit = require('@pdf-lib/fontkit');

export type CertificateFonts = Record<FontKey, PDFFont>;

const FONT_FILES: Record<FontKey, string> = {
  script: 'PinyonScript-Regular.ttf',
  serifBold: 'PlayfairDisplay-Bold.ttf',
  serif: 'CormorantGaramond-Medium.ttf',
  sans: 'Montserrat-Medium.ttf',
  sansBold: 'Montserrat-SemiBold.ttf',
  sansHeavy: 'Montserrat-Bold.ttf',
};

/** Resolves the vendored font directory in both src and dist layouts. */
function fontDir(): string {
  const candidates = [
    join(__dirname, 'assets', 'fonts'),
    join(process.cwd(), 'dist', 'src', 'certificate', 'assets', 'fonts'),
    join(process.cwd(), 'src', 'certificate', 'assets', 'fonts'),
  ];
  for (const dir of candidates) {
    if (existsSync(join(dir, FONT_FILES.serifBold))) return dir;
  }
  throw new Error(
    'Certificate fonts not found. Expected src/certificate/assets/fonts/*.ttf',
  );
}

/**
 * Registers fontkit and embeds every face the design uses.
 *
 * The vendored TTFs are already subset to Latin by the font build step, so they
 * are embedded whole (~267KB for all five). Embed-time subsetting is avoided
 * deliberately: fontkit's subsetter crashes on these instanced faces.
 */
export async function embedCertificateFonts<K extends FontKey = FontKey>(
  doc: PDFDocument,
  keys?: readonly K[],
): Promise<Record<K, PDFFont>> {
  doc.registerFontkit(fontkit);
  const dir = fontDir();
  const wanted = (keys ?? (Object.keys(FONT_FILES) as K[])) as readonly K[];
  const entries = await Promise.all(
    wanted.map(async (key) => {
      const bytes = readFileSync(join(dir, FONT_FILES[key]));
      const font = await doc.embedFont(bytes, { subset: false });
      return [key, font] as const;
    }),
  );
  return Object.fromEntries(entries) as Record<K, PDFFont>;
}

/** Width of `text` including the extra advance that letter spacing adds. */
export function measure(
  text: string,
  font: PDFFont,
  size: number,
  tracking = 0,
): number {
  const base = font.widthOfTextAtSize(text, size);
  if (!tracking || text.length === 0) return base;
  return base + tracking * size * text.length;
}

/**
 * Shrinks `size` until the text fits `maxWidth`, down to a readable floor.
 * Returns the original size when no constraint applies.
 */
export function fitSize(
  text: string,
  font: PDFFont,
  size: number,
  maxWidth?: number,
  tracking = 0,
  floor = 12,
): number {
  if (!maxWidth) return size;
  let current = size;
  while (current > floor && measure(text, font, current, tracking) > maxWidth) {
    current -= 0.5;
  }
  return current;
}

/**
 * Greedy word wrap. Returns a single line when the text already fits, so
 * short values keep their intended size instead of being broken up.
 */
export function wrap(
  text: string,
  font: PDFFont,
  size: number,
  maxWidth: number,
  tracking = 0,
  maxLines = 2,
): string[] {
  if (measure(text, font, size, tracking) <= maxWidth) return [text];

  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (measure(next, font, size, tracking) <= maxWidth || !line) {
      line = next;
    } else {
      lines.push(line);
      line = word;
      if (lines.length === maxLines - 1) break;
    }
  }
  const used = lines.join(' ');
  const rest = text.slice(used.length).trim();
  if (rest) lines.push(rest);
  else if (line) lines.push(line);
  return lines.slice(0, maxLines);
}

interface DrawOptions {
  /** When set, `y` is the text baseline rather than the top of the box. */
  anchor?: 'top' | 'baseline';
  text: string;
  font: PDFFont;
  size: number;
  color: RGB;
  tracking?: number;
  /** Artboard x of the text's horizontal centre. */
  center?: number;
  /** Artboard x of the text's left edge; ignored when `center` is set. */
  left?: number;
  /** Artboard y of the TOP of the line box. */
  y: number;
}

/**
 * Draws one line positioned by its box top, matching how Figma reports text
 * position. The baseline is derived from the font's own ascender so different
 * faces line up on the same y.
 */
export function drawLine(page: PDFPage, opts: DrawOptions): void {
  const { text, font, size, color, tracking = 0, y } = opts;
  if (!text) return;

  const width = measure(text, font, size, tracking);
  const x = opts.center != null ? opts.center - width / 2 : opts.left ?? 0;

  // heightAtSize(size, { descender: false }) is the ascent above the baseline.
  const ascent =
    opts.anchor === 'baseline'
      ? 0
      : font.heightAtSize(size, { descender: false });

  if (tracking) page.pushOperators(setCharacterSpacing(tracking * size));
  page.drawText(text, {
    x,
    y: toPdfY(y + ascent),
    size,
    font,
    color,
  });
  if (tracking) page.pushOperators(setCharacterSpacing(0));
}

/**
 * Draws a text block: fits the size to the block's width, wraps to at most
 * `maxLines`, and centres the stack on the block's y.
 */
export function drawBlock(
  page: PDFPage,
  text: string,
  block: TextBlock & { center?: number },
  font: PDFFont,
  fallbackCenter: number,
  maxLines = 1,
): void {
  const tracking = block.tracking ?? 0;
  const center = block.center ?? fallbackCenter;

  let size = block.size;
  let lines = [text];
  if (block.maxWidth) {
    if (maxLines > 1) {
      lines = wrap(text, font, size, block.maxWidth, tracking, maxLines);
      // A wrapped line can still overflow (one very long word) — shrink then.
      const longest = lines.reduce(
        (w, l) => Math.max(w, measure(l, font, size, tracking)),
        0,
      );
      if (longest > block.maxWidth) {
        size = fitSize(
          lines.reduce((a, b) => (a.length > b.length ? a : b), ''),
          font,
          size,
          block.maxWidth,
          tracking,
        );
      }
    } else {
      size = fitSize(text, font, size, block.maxWidth, tracking);
    }
  }

  const leading = (block.leading ?? 1.2) * size;
  // Keep a multi-line block visually centred on the single-line position.
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

/**
 * Draws a baseline-anchored field onto a template whose geometry was measured
 * rather than authored — the client artwork, where every placeholder position
 * came off the supplied raster.
 *
 * Wraps to `maxLines` before shrinking, and centres a wrapped block on the
 * single-line baseline so short and long values sit in the same optical place.
 */
export function drawField(
  page: PDFPage,
  text: string,
  spec: FieldSpec,
  font: PDFFont,
  pageHeight: number,
): void {
  if (!text) return;

  const tracking = spec.tracking ?? 0;
  const maxLines = spec.maxLines ?? 1;
  const floor = spec.minSize ?? 8;

  let size = spec.size;
  let lines = [text];

  const fitsOnOneLine = measure(text, font, size, tracking) <= spec.maxWidth;
  if (!fitsOnOneLine && maxLines > 1) {
    // Wrapping costs vertical room, so drop to the size the slot can take.
    size = spec.sizeWhenWrapped ?? size;
    lines = wrap(text, font, size, spec.maxWidth, tracking, maxLines);
    const longest = lines.reduce(
      (w, l) => Math.max(w, measure(l, font, size, tracking)),
      0,
    );
    if (longest > spec.maxWidth) {
      const widest = lines.reduce((a, b) => (a.length > b.length ? a : b), '');
      size = fitSize(widest, font, size, spec.maxWidth, tracking, floor);
    }
  } else if (!fitsOnOneLine) {
    size = fitSize(text, font, size, spec.maxWidth, tracking, floor);
  }

  const leading = (spec.leading ?? 1.15) * size;
  const anchor =
    lines.length > 1
      ? spec.baselineWhenWrapped ?? spec.baseline
      : spec.baseline;
  const startBaseline = anchor - ((lines.length - 1) * leading) / 2;

  lines.forEach((line, i) => {
    const baseline = startBaseline + i * leading;
    const width = measure(line, font, size, tracking);
    const x = spec.align === 'center' ? spec.x - width / 2 : spec.x;

    if (tracking) page.pushOperators(setCharacterSpacing(tracking * size));
    page.drawText(line, {
      x,
      y: pageHeight - baseline,
      size,
      font,
      color: spec.color,
    });
    if (tracking) page.pushOperators(setCharacterSpacing(0));
  });
}
