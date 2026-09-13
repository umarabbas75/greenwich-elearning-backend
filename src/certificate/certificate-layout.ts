import { rgb, RGB } from '@cantoo/pdf-lib';

/** Text placement on the designed template (1684 × 1190 pt, origin bottom-left). */
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

/** QR sits inside the verification card, grouped with the certificate ID. */
export interface CertificateQrLayout {
  size: number;
  /** Left edge of the QR square. */
  x: number;
  /** Bottom edge of the QR square. */
  y: number;
}

const NAVY = rgb(0.09, 0.141, 0.282);
const INK = rgb(0.106, 0.141, 0.125);

/**
 * Positions from Figma frame "Certificate of Completion" (1684×1190).
 * Static template already includes Managing Director "Tayyab Shah".
 */
export const CERTIFICATE_LAYOUT = {
  learnerName: {
    yRatio: 0.524,
    fontSize: 42,
    maxWidth: 920,
    color: NAVY,
    bold: true,
  },
  courseTitle: {
    yRatio: 0.408,
    fontSize: 28,
    maxWidth: 1000,
    color: INK,
    bold: true,
  },
  issuedDate: {
    yRatio: 0.151,
    fontSize: 18,
    x: 108,
    align: 'left' as const,
    color: INK,
  },
  certificateId: {
    yRatio: 0.105,
    fontSize: 15,
    x: 1432,
    maxWidth: 160,
    align: 'left' as const,
    color: INK,
  },
  qr: {
    size: 124,
    x: 1290,
    y: 86,
  } satisfies CertificateQrLayout,
} satisfies Record<string, CertificateFieldLayout | CertificateQrLayout>;
