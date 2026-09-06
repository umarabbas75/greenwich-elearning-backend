import { rgb, RGB } from '@cantoo/pdf-lib';

/** Text placement on the designed template (1123 × 794 pt, origin bottom-left). */
export interface CertificateFieldLayout {
  /** Vertical position as a fraction of page height (0 = bottom, 1 = top). */
  yRatio: number;
  fontSize: number;
  maxWidth?: number;
  color: RGB;
  bold?: boolean;
  /** Horizontal position as pt from left edge; omit to center. */
  x?: number;
  /** Horizontal alignment when x is set. */
  align?: 'left' | 'center' | 'right';
}

/** QR sits to the right of CERTIFICATE ID; the verify URL is printed under it. */
export interface CertificateQrLayout {
  size: number;
  /** Left edge of the QR square. */
  x: number;
  /** Bottom edge of the QR square. */
  y: number;
  urlFontSize: number;
  urlGap: number;
  urlMaxWidth: number;
  urlColor: RGB;
}

/** Positions derived from Figma frame "Certificate of Completion" (1123×794). */
export const CERTIFICATE_LAYOUT = {
  learnerName: {
    yRatio: 0.577,
    fontSize: 34,
    maxWidth: 760,
    color: rgb(0.09, 0.16, 0.32),
    bold: true,
  },
  courseTitle: {
    yRatio: 0.448,
    fontSize: 20,
    maxWidth: 820,
    color: rgb(0.09, 0.16, 0.32),
    bold: true,
  },
  issuedDate: {
    yRatio: 0.291,
    fontSize: 13,
    x: 448,
    align: 'center' as const,
    color: rgb(0.25, 0.28, 0.32),
  },
  certificateId: {
    yRatio: 0.291,
    fontSize: 13,
    x: 659,
    maxWidth: 147,
    align: 'center' as const,
    color: rgb(0.25, 0.28, 0.32),
  },
  qr: {
    size: 68,
    x: 800,
    y: 198,
    urlFontSize: 7,
    urlGap: 7,
    urlMaxWidth: 275,
    urlColor: rgb(0.28, 0.32, 0.36),
  } satisfies CertificateQrLayout,
} satisfies Record<string, CertificateFieldLayout | CertificateQrLayout>;
