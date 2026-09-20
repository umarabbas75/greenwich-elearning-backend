"""Turn the client's print-ready PDF into a fillable certificate template.

The file the client supplied is a single flattened 3508x2480 raster at 300 DPI
— there is no live text and no form fields, so every placeholder
("[ LEARNER NAME ]", "[ COURSE TITLE ]", "[ CERTIFICATE NO. ]",
"[ DD MONTH YYYY ]") and the dummy QR square are baked into the image.

To make it fillable we erase exactly those regions and nothing else, then hand
the cleaned raster to build-client-template.ts, which wraps it back into an A4
PDF. Erase boxes are deliberately tight: a gold rule sits only 8px below the
learner-name placeholder, and the gold field labels sit directly above the
certificate-number and date placeholders. All of those must survive.

Backgrounds behind the placeholders measured flat (#FDFDFD-#FEFEFE, sd < 3),
so each region is filled with the median colour sampled from its sides —
invisible against the surrounding paper.

The artwork is read straight out of the client's PDF, filters decoded, so the
pixels are theirs byte for byte. Rasterising the PDF instead (e.g. via sips)
resamples the image and costs ~40% of the edge sharpness on the baked-in
text, which is very visible on the small captions.

Run: yarn script:certificate:client-art
"""
from __future__ import annotations

import os

import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
ART = os.path.join(HERE, 'source')
REPO = os.path.abspath(os.path.join(HERE, '..', '..'))
SOURCE_PDF = os.path.join(
    REPO, 'docs', 'certificate-previews', 'final-variant',
    'Greenwich_Certificate_Print_Ready_A4.pdf')
OUT = os.path.join(ART, 'client-certificate-clean.jpg')

# Regions to erase, in source-raster pixels: (left, top, right, bottom).
# Measured from the supplied artwork; margins stay clear of adjacent rules.
ERASE = {
    'learner name': (1700, 522, 2806, 640),
    'course title': (1788, 822, 2718, 922),
    'certificate no': (1490, 1510, 1810, 1556),
    'date of issue': (1490, 1640, 1810, 1688),
    # The whole dummy QR square, border included. The real code has to be
    # larger than the client's 42pt frame to be scannable (see CLIENT_QR), so
    # the decorative border would not line up and is removed.
    'qr placeholder': (1218, 1442, 1437, 1662),
}


def background_for(a: np.ndarray, box: tuple[int, int, int, int]) -> np.ndarray:
    """Median paper colour taken from the sides of the region, same rows.

    Sampling above/below is unsafe here: a gold rule sits 6px under the
    learner-name box and the gold field labels sit directly over the
    certificate-number and date boxes, so a vertical sample picks up gold and
    tints the fill. The paper to the left and right of each region is the same
    flat white and has nothing on it.
    """
    l, t, r, b = box
    left = a[t:b, max(0, l - 110):max(1, l - 10)].reshape(-1, 3)
    right = a[t:b, r + 10:r + 110].reshape(-1, 3)
    sample = np.vstack([s for s in (left, right) if len(s)])
    # Keep the lighter half: guards against clipping a glyph edge.
    lum = sample.sum(axis=1)
    return np.median(sample[lum >= np.percentile(lum, 50)], axis=0)


def load_client_artwork() -> Image.Image:
    """The client's artwork, straight from their PDF with filters decoded.

    Their file is a single full-page image XObject; pdfplumber hands back the
    decoded bytes, so this is the original raster rather than a re-render.
    """
    import pdfplumber

    with pdfplumber.open(SOURCE_PDF) as pdf:
        page = pdf.pages[0]
        if len(page.images) != 1:
            raise SystemExit(
                f'Expected one full-page image, found {len(page.images)}. '
                'The client artwork changed shape — re-check the erase boxes.')
        entry = page.images[0]
        w, h = int(entry['srcsize'][0]), int(entry['srcsize'][1])
        data = entry['stream'].get_data()
        expected = w * h * 3
        if len(data) < expected:
            raise SystemExit(
                f'Image stream is {len(data)} bytes, expected at least '
                f'{expected} for {w}x{h} RGB.')
        return Image.frombytes('RGB', (w, h), data[:expected])


def build() -> Image.Image:
    if not os.path.exists(SOURCE_PDF):
        raise SystemExit(f'Missing client artwork: {SOURCE_PDF}')

    im = load_client_artwork()
    a = np.asarray(im).astype(float).copy()

    for label, box in ERASE.items():
        l, t, r, b = box
        if label == 'qr placeholder':
            # Surrounded by its own dark border, so sample the box's own paper.
            inner = a[t:b, l:r].reshape(-1, 3)
            lum = inner.sum(axis=1)
            fill = np.median(inner[lum >= np.percentile(lum, 70)], axis=0)
        else:
            fill = background_for(a, box)
        a[t:b, l:r] = fill
        print(f'  erased {label:<16} {r - l:4}x{b - t:<4}px')

    return Image.fromarray(a.astype(np.uint8), 'RGB')


if __name__ == '__main__':
    img = build()
    # 4:4:4 (no chroma subsampling) at q95: max per-pixel error of 21/255 on
    # this artwork, invisible at 300 DPI, for a third of the lossless size.
    # Chroma subsampling would smear the gold rules, so it stays off.
    img.save(OUT, 'JPEG', quality=95, subsampling=0, optimize=True)
    print(f'{os.path.basename(OUT)} {img.size[0]}x{img.size[1]} '
          f'{os.path.getsize(OUT) // 1024} KB')

    preview = os.environ.get('SCRATCH')
    if preview:
        img.resize((1400, int(1400 * img.height / img.width)), Image.LANCZOS).save(
            os.path.join(preview, 'peek-client-clean.png'))
