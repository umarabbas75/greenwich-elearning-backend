"""Composite the certificate's left graphic panel at print resolution.

The panel is a stack of diagonal ribbons sharing one angle: a graded green
base, a foliage ribbon, a soft mid-green ribbon, a gold foil stripe, a light
green outer ribbon, and the construction photo block on top.

Output is a flat JPEG whose unused right-hand region is pure white so it can be
dropped straight onto the white certificate page with no visible seam (pdf-lib
has no clipping-path API, so the alpha is baked here instead).

Artboard units are points on a 1684x1190 page; SCALE fixes the raster density.
"""
from __future__ import annotations

import os

import numpy as np
from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
ART = os.path.join(HERE, 'source')

SCALE = 3           # px per artboard point
PANEL_W = 700       # panel box in artboard points
PANEL_H = 1098
SLOPE = 0.22        # every diagonal shares this angle
DX = SLOPE * PANEL_H

W, H = PANEL_W * SCALE, PANEL_H * SCALE


def s(v: float) -> int:
    return int(round(v * SCALE))


def band_poly(x_top: float, width: float) -> list[tuple[int, int]]:
    """Parallelogram running the full panel height at the shared angle."""
    return [
        (s(x_top), 0),
        (s(x_top + width), 0),
        (s(x_top + width - DX), H),
        (s(x_top - DX), H),
    ]


def mask_from(points: list[tuple[int, int]]) -> Image.Image:
    m = Image.new('L', (W, H), 0)
    ImageDraw.Draw(m).polygon(points, fill=255)
    return m


def vertical_gradient(stops: list[tuple[float, tuple[int, int, int]]]) -> Image.Image:
    """Top-to-bottom gradient from (position, rgb) stops."""
    ys = np.linspace(0.0, 1.0, H)
    pos = np.array([p for p, _ in stops])
    out = np.zeros((H, 3))
    for ch in range(3):
        out[:, ch] = np.interp(ys, pos, [c[ch] for _, c in stops])
    col = np.repeat(out[:, None, :], W, axis=1).astype(np.uint8)
    return Image.fromarray(col, 'RGB')


def diagonal_gradient(stops: list[tuple[float, tuple[int, int, int]]]) -> Image.Image:
    """Gradient running perpendicular to the ribbon angle, for the foil stripe."""
    xx, yy = np.meshgrid(np.arange(W), np.arange(H))
    t = (xx + yy * SLOPE) / (W + H * SLOPE)
    pos = np.array([p for p, _ in stops])
    out = np.zeros((H, W, 3))
    for ch in range(3):
        out[:, :, ch] = np.interp(t, pos, [c[ch] for _, c in stops])
    return Image.fromarray(out.astype(np.uint8), 'RGB')


def cover(path: str, box_w: int, box_h: int) -> Image.Image:
    """Scale an image to cover the box, centre-cropped."""
    im = Image.open(path).convert('RGB')
    scale = max(box_w / im.width, box_h / im.height)
    im = im.resize((max(1, int(im.width * scale)), max(1, int(im.height * scale))), Image.LANCZOS)
    left = (im.width - box_w) // 2
    top = (im.height - box_h) // 2
    return im.crop((left, top, left + box_w, top + box_h))


def tint(im: Image.Image, rgb: tuple[int, int, int], amount: float) -> Image.Image:
    layer = Image.new('RGB', im.size, rgb)
    return Image.blend(im, Image.composite(layer, im, Image.new('L', im.size, 255)), amount)


def build() -> Image.Image:
    canvas = Image.new('RGB', (W, H), (255, 255, 255))

    # 1. Graded green base, bounded on the right by the outermost diagonal
    base_poly = [(0, 0), (s(614), 0), (s(614 - DX), H), (0, H)]
    base = vertical_gradient([
        (0.00, (35, 76, 53)),
        (0.55, (22, 52, 35)),
        (1.00, (12, 32, 20)),
    ])
    canvas.paste(base, (0, 0), mask_from(base_poly))

    # 2. Foliage ribbon
    foliage = cover(os.path.join(ART, 'foliage.png'), W, H)
    foliage = tint(foliage, (15, 47, 28), 0.26)
    canvas.paste(foliage, (0, 0), mask_from(band_poly(392, 176)))

    # 3. Soft mid-green ribbon for depth
    mid = Image.new('RGB', (W, H), (46, 102, 66))
    mid_mask = mask_from(band_poly(296, 104)).point(lambda v: int(v * 0.5))
    canvas.paste(mid, (0, 0), mid_mask)

    # 4. Gold foil stripe
    foil = diagonal_gradient([
        (0.00, (138, 106, 34)),
        (0.32, (242, 221, 146)),
        (0.62, (198, 150, 62)),
        (1.00, (152, 113, 40)),
    ])
    canvas.paste(foil, (0, 0), mask_from(band_poly(574, 22)))

    # 5. Light green outer ribbon
    light = vertical_gradient([
        (0.0, (77, 139, 93)),
        (1.0, (47, 102, 66)),
    ])
    canvas.paste(light, (0, 0), mask_from(band_poly(600, 64)))

    # 6. Construction photo block, diagonal right edge. The photo is scaled to
    #    cover its own block, not the whole panel, so the framing stays wide.
    photo_h = s(518)
    photo_poly = [(0, 0), (s(470), 0), (s(356), photo_h), (0, photo_h)]
    photo = cover(os.path.join(ART, 'construction.png'), s(470), photo_h)

    # Fade the bottom edge into the green so the block doesn't cut abruptly
    fade_px = s(70)
    fade = np.ones((photo_h, 1))
    fade[photo_h - fade_px:, 0] = np.linspace(1.0, 0.0, fade_px)
    photo_arr = np.asarray(photo).astype(float)
    green = np.array([22, 52, 35], dtype=float)
    blended = photo_arr * fade[:, :, None] + green[None, None, :] * (1 - fade[:, :, None])
    photo = Image.fromarray(blended.astype(np.uint8), 'RGB')

    photo_layer = Image.new('RGB', (W, H), (255, 255, 255))
    photo_layer.paste(photo, (0, 0))
    canvas.paste(photo_layer, (0, 0), mask_from(photo_poly))

    # 7. Gold hairline along the photo's diagonal edge, plus an inner keyline
    draw = ImageDraw.Draw(canvas)
    draw.line([(s(470), 0), (s(356), photo_h)], fill=(226, 200, 121), width=s(2))
    inset = s(16)
    draw.line([(inset, inset), (s(470) - inset - s(6), inset)], fill=(226, 200, 121), width=s(1))
    draw.line([(inset, inset), (inset, s(300))], fill=(226, 200, 121), width=s(1))

    return canvas


def build_gold_mark() -> Image.Image:
    """Recolour the hands mark to struck gold for the centre of the seal."""
    im = Image.open(os.path.join(ART, 'logo-mark.png')).convert('RGBA')
    a = np.asarray(im).astype(float)
    rgb, alpha = a[:, :, :3], a[:, :, 3:]
    lum = (rgb[:, :, 0] * 0.299 + rgb[:, :, 1] * 0.587 + rgb[:, :, 2] * 0.114) / 255.0
    lum = np.clip((lum - 0.15) / 0.7, 0, 1)[:, :, None]
    dark = np.array([104, 74, 18], dtype=float)
    light = np.array([250, 231, 168], dtype=float)
    gold = dark + (light - dark) * lum
    return Image.fromarray(
        np.concatenate([gold, alpha], axis=2).astype(np.uint8), 'RGBA')


if __name__ == '__main__':
    img = build()
    out = os.path.join(ART, 'panel.jpg')
    img.save(out, 'JPEG', quality=88, subsampling=1, optimize=True)
    print(f'panel.jpg {img.size[0]}x{img.size[1]} {os.path.getsize(out) // 1024} KB')

    mark = build_gold_mark()
    mark_out = os.path.join(ART, 'logo-mark-gold.png')
    mark.save(mark_out, optimize=True)
    print(f'logo-mark-gold.png {mark.size[0]}x{mark.size[1]} '
          f'{os.path.getsize(mark_out) // 1024} KB')

    preview = os.environ.get('SCRATCH')
    if preview:
        img.resize((PANEL_W // 2, PANEL_H // 2), Image.LANCZOS).save(
            os.path.join(preview, 'peek-panel.png'))
