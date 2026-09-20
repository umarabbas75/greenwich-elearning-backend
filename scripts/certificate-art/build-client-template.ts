/**
 * Wraps the cleaned client artwork back into an A4 landscape PDF.
 *
 * The client supplied a flattened 300 DPI raster; build-client-template.py
 * erases the baked-in placeholders, and this places the result on a page of
 * exactly the same size as the original (841.89 x 595.28pt) so nothing shifts.
 *
 * Run: yarn script:certificate:client-template
 */
import { PDFDocument } from '@cantoo/pdf-lib';
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { CLIENT_PAGE } from '../../src/certificate/certificate-layout';

const ASSETS = join(__dirname, '..', '..', 'src', 'certificate', 'assets');
const ART = join(__dirname, 'source');
const OUTPUT = 'certificate-of-completion.pdf';

export async function buildClientTemplate(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([CLIENT_PAGE.width, CLIENT_PAGE.height]);

  const art = await doc.embedJpg(
    readFileSync(join(ART, 'client-certificate-clean.jpg')),
  );
  // Fill the page exactly; the raster's aspect matches A4 to within a pixel.
  page.drawImage(art, {
    x: 0,
    y: 0,
    width: CLIENT_PAGE.width,
    height: CLIENT_PAGE.height,
  });

  doc.setTitle('Certificate of Completion');
  doc.setAuthor('Greenwich Training & Consulting');
  doc.setCreator('Greenwich eLearning');
  doc.setProducer('Greenwich Training & Consulting');

  return doc.save();
}

if (require.main === module) {
  buildClientTemplate()
    .then((bytes) => {
      const out = join(ASSETS, OUTPUT);
      writeFileSync(out, bytes);
      console.log(`template ${out} ${Math.round(bytes.length / 1024)} KB`);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
