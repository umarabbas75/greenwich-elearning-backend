import { rgb, RGB } from 'pdf-lib';

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
} satisfies Record<string, CertificateFieldLayout>;
