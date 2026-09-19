import { PDFDocument } from '@cantoo/pdf-lib';
import {
  embedCertificateFonts,
  fitSize,
  measure,
  wrap,
} from './certificate-draw';

jest.setTimeout(30_000);

describe('certificate-draw', () => {
  let font: Awaited<ReturnType<typeof embedCertificateFonts>>['serifBold'];

  beforeAll(async () => {
    const doc = await PDFDocument.create();
    const fonts = await embedCertificateFonts(doc, ['serifBold'] as const);
    font = fonts.serifBold;
  });

  describe('measure', () => {
    it('adds the advance that letter spacing introduces', () => {
      const plain = measure('CERTIFICATE', font, 40);
      const tracked = measure('CERTIFICATE', font, 40, 0.05);
      expect(tracked).toBeCloseTo(plain + 0.05 * 40 * 'CERTIFICATE'.length, 3);
    });

    it('is unchanged for empty text', () => {
      expect(measure('', font, 40, 0.1)).toBe(0);
    });
  });

  describe('fitSize', () => {
    it('leaves the size alone when the text already fits', () => {
      expect(fitSize('Short', font, 40, 10_000)).toBe(40);
    });

    it('returns the size unchanged when no width constraint is given', () => {
      expect(fitSize('A very long course title indeed', font, 40)).toBe(40);
    });

    it('shrinks until the text fits the width', () => {
      const text = 'International Fire Safety Principles';
      const size = fitSize(text, font, 40, 300);
      expect(size).toBeLessThan(40);
      expect(measure(text, font, size)).toBeLessThanOrEqual(300);
    });

    it('never shrinks below the floor', () => {
      const size = fitSize('x'.repeat(400), font, 40, 50, 0, 12);
      expect(size).toBe(12);
    });
  });

  describe('wrap', () => {
    it('returns a single line when the text fits', () => {
      expect(wrap('NEBOSH IGC', font, 40, 10_000)).toEqual(['NEBOSH IGC']);
    });

    it('splits a long title across two lines', () => {
      const text =
        'International Fire Safety Principles Prevention Protection and Emergency Response';
      const lines = wrap(text, font, 40, 600);
      expect(lines).toHaveLength(2);
      expect(lines.join(' ')).toBe(text);
    });

    it('never exceeds the requested line count', () => {
      const text = Array.from({ length: 40 }, (_, i) => `word${i}`).join(' ');
      expect(wrap(text, font, 40, 200, 0, 2).length).toBeLessThanOrEqual(2);
    });

    it('keeps a single unbreakable word on one line', () => {
      const lines = wrap('Supercalifragilisticexpialidocious', font, 40, 100);
      expect(lines).toEqual(['Supercalifragilisticexpialidocious']);
    });
  });
});
