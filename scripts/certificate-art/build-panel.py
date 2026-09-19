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
from PIL import Image, ImageDraw, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
ART = os.path.join(HERE, 'source')

SCALE = 2           # px per artboard point (~288 DPI on the printed page)
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


def cover_anchored(path: str, box_w: int, box_h: int, anchor: float) -> Image.Image:
    """Cover the box, choosing the vertical crop window with `anchor`.

    0.0 keeps the top of the frame, 1.0 the bottom. The construction shot has
    its subject high in frame, so the panel anchors near the top.
    """
    im = Image.open(path).convert('RGB')
    scale = max(box_w / im.width, box_h / im.height)
    im = im.resize((max(1, int(im.width * scale)), max(1, int(im.height * scale))),
                   Image.LANCZOS)
    left = (im.width - box_w) // 2
    top = int((im.height - box_h) * anchor)
    return im.crop((left, top, left + box_w, top + box_h))


def smoothstep(edge0: float, edge1: float, x: np.ndarray) -> np.ndarray:
    t = np.clip((x - edge0) / (edge1 - edge0), 0.0, 1.0)
    return t * t * (3 - 2 * t)


def build() -> Image.Image:
    """Photograph up top melting into deep green, cut by one clean diagonal.

    The earlier version stacked five translucent ribbons over a hard-edged
    photo block, which muddied both and left a visible cut. This keeps the same
    idea — photograph, green, diagonal, tagline — but resolves it the way a
    hero banner does: a wide image, a gradient that dissolves it into the green
    with no seam, and crisp accent bands kept outside the photograph.
    """
    canvas = Image.new('RGB', (W, H), (255, 255, 255))

    rows = np.arange(H)[:, None, None]
    cols = np.arange(W)[None, :, None]

    # 1. Deep green field across the whole panel.
    base = np.zeros((H, W, 3), dtype=float)
    t = rows / float(H)
    top_green = np.array([30, 70, 46], dtype=float)
    bot_green = np.array([10, 30, 19], dtype=float)
    base[:] = top_green + (bot_green - top_green) * smoothstep(0.30, 1.0, t)

    # 2. Photograph across the top. A short box means a gentle scale factor, so
    #    the frame stays wide instead of zooming into the helmet.
    photo_h = s(660)
    photo = cover_anchored(os.path.join(ART, 'construction.png'), W, photo_h, 0.30)
    photo_arr = np.asarray(photo).astype(float)

    # Green scrim over the photo, deepening as it descends.
    pt = np.arange(photo_h)[:, None, None] / float(photo_h)
    scrim = 0.04 + 0.58 * smoothstep(0.18, 1.0, pt) ** 1.2
    photo_arr = photo_arr * (1 - scrim) + np.array([16, 44, 28], dtype=float) * scrim

    # 3. Dissolve the photo into the green over a long ramp — no visible edge.
    blend = 1.0 - smoothstep(0.62, 1.0, pt)
    base[:photo_h] = base[:photo_h] * (1 - blend) + photo_arr * blend

    # 4. Soft vignette so the artwork settles into the border.
    edge = np.minimum(smoothstep(0, s(40), cols), smoothstep(0, s(32), rows))
    base *= 0.86 + 0.14 * edge

    canvas.paste(Image.fromarray(np.clip(base, 0, 255).astype(np.uint8), 'RGB'), (0, 0))

    # 5. Everything right of the diagonal returns to page white.
    edge_top = 560.0
    white = Image.new('RGB', (W, H), (255, 255, 255))
    canvas.paste(white, (0, 0), mask_from(
        [(s(edge_top), 0), (W, 0), (W, H), (s(edge_top - DX), H)]))

    # 6. Accent band and gold hairlines, clear of the photograph.
    band_w = 52.0
    accent = vertical_gradient([(0.0, (86, 148, 102)), (1.0, (38, 88, 56))])
    canvas.paste(accent, (0, 0), mask_from([
        (s(edge_top + 7), 0), (s(edge_top + 7 + band_w), 0),
        (s(edge_top + 7 + band_w - DX), H), (s(edge_top + 7 - DX), H),
    ]))

    draw = ImageDraw.Draw(canvas)
    for offset, width, colour in (
        (0.0, s(3.0), (216, 187, 112)),
        (band_w + 7.0, s(1.6), (198, 166, 92)),
    ):
        draw.line([(s(edge_top + offset), 0), (s(edge_top + offset - DX), H)],
                  fill=colour, width=width)

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
    mark = Image.fromarray(
        np.concatenate([gold, alpha], axis=2).astype(np.uint8), 'RGBA')
    # Placed at 66x58pt, so anything past ~220px is wasted bytes.
    mark.thumbnail((220, 220), Image.LANCZOS)
    return mark


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
