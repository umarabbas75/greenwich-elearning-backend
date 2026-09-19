"""Variant B left panel: the client's layered-ribbon composition.

Variant A dissolves one photograph into a green field. This one matches the
inspiration artwork instead — a framed photo block above a dark green field,
with a foliage band and stepped green/gold ribbons fanning out to the right.

The trap here is mud: translucent ribbons stacked over a photograph grey each
other out. Every band below is drawn opaque against the base, and the
photograph keeps a crisp edge, which is what makes the original read cleanly.

Run: yarn script:certificate:panel-ribbons
"""
from __future__ import annotations

import os

import numpy as np
from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
ART = os.path.join(HERE, 'source')

SCALE = 2
PANEL_W, PANEL_H = 700, 1098
SLOPE = 0.22
DX = SLOPE * PANEL_H
W, H = PANEL_W * SCALE, PANEL_H * SCALE

PHOTO_BOTTOM = 472.0     # hard edge, as in the reference
PHOTO_RIGHT_TOP = 436.0


def s(v: float) -> int:
    return int(round(v * SCALE))


def band_poly(x_top: float, width: float) -> list[tuple[int, int]]:
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
    ys = np.linspace(0.0, 1.0, H)
    pos = np.array([p for p, _ in stops])
    out = np.zeros((H, 3))
    for ch in range(3):
        out[:, ch] = np.interp(ys, pos, [c[ch] for _, c in stops])
    return Image.fromarray(
        np.repeat(out[:, None, :], W, axis=1).astype(np.uint8), 'RGB')


def cover(path: str, box_w: int, box_h: int, anchor: float = 0.5) -> Image.Image:
    im = Image.open(path).convert('RGB')
    scale = max(box_w / im.width, box_h / im.height)
    im = im.resize((max(1, int(im.width * scale)), max(1, int(im.height * scale))),
                   Image.LANCZOS)
    left = (im.width - box_w) // 2
    top = int((im.height - box_h) * anchor)
    return im.crop((left, top, left + box_w, top + box_h))


def tint(im: Image.Image, rgb: tuple[int, int, int], amount: float) -> Image.Image:
    layer = Image.new('RGB', im.size, rgb)
    return Image.blend(im, layer, amount)


def build() -> Image.Image:
    canvas = Image.new('RGB', (W, H), (255, 255, 255))

    # 1. Dark green field, bounded right by the outermost diagonal.
    base = vertical_gradient([
        (0.00, (30, 70, 46)),
        (0.55, (19, 48, 31)),
        (1.00, (10, 28, 18)),
    ])
    canvas.paste(base, (0, 0), mask_from(
        [(0, 0), (s(660), 0), (s(660 - DX), H), (0, H)]))

    # 2. Foliage band — opaque, so it stays a band and not a smear.
    foliage = cover(os.path.join(ART, 'foliage.png'), W, H, 0.45)
    foliage = tint(foliage, (18, 52, 32), 0.22)
    canvas.paste(foliage, (0, 0), mask_from(band_poly(436, 136)))

    # 3. Stepped green ribbons and the gold stripe.
    for x_top, width, stops in (
        (572, 34, [(0.0, (74, 132, 90)), (1.0, (36, 84, 54))]),
        (620, 40, [(0.0, (120, 172, 132)), (1.0, (62, 118, 78))]),
    ):
        canvas.paste(vertical_gradient(stops), (0, 0), mask_from(band_poly(x_top, width)))

    gold = vertical_gradient([
        (0.00, (150, 116, 40)),
        (0.30, (240, 218, 144)),
        (0.65, (198, 152, 62)),
        (1.00, (146, 110, 38)),
    ])
    canvas.paste(gold, (0, 0), mask_from(band_poly(606, 14)))

    # 4. Photo block, crisp edged, sitting on top of the field.
    photo_poly = [
        (0, 0),
        (s(PHOTO_RIGHT_TOP), 0),
        (s(PHOTO_RIGHT_TOP - SLOPE * PHOTO_BOTTOM), s(PHOTO_BOTTOM)),
        (0, s(PHOTO_BOTTOM)),
    ]
    # Cover the photo BLOCK, not the whole panel — the block's 0.92 aspect is
    # almost exactly the source's, so the full scene survives with no crop.
    photo = cover(os.path.join(ART, 'construction.png'),
                  s(PHOTO_RIGHT_TOP), s(PHOTO_BOTTOM), 0.5)
    layer = Image.new('RGB', (W, H), (255, 255, 255))
    layer.paste(photo, (0, 0))
    canvas.paste(layer, (0, 0), mask_from(photo_poly))

    # 5. Pale keyline just inside the photo, as in the reference.
    draw = ImageDraw.Draw(canvas)
    inset = s(11)
    frame = [
        (inset, inset),
        (s(PHOTO_RIGHT_TOP) - inset, inset),
        (s(PHOTO_RIGHT_TOP - SLOPE * PHOTO_BOTTOM) - inset, s(PHOTO_BOTTOM) - inset),
        (inset, s(PHOTO_BOTTOM) - inset),
    ]
    draw.line(frame + [frame[0]], fill=(236, 240, 232), width=s(1.6))

    # 6. Gold hairline down the photo's diagonal edge.
    draw.line(
        [(s(PHOTO_RIGHT_TOP), 0),
         (s(PHOTO_RIGHT_TOP - SLOPE * PHOTO_BOTTOM), s(PHOTO_BOTTOM))],
        fill=(214, 184, 108), width=s(2.2),
    )

    return canvas


if __name__ == '__main__':
    img = build()
    out = os.path.join(ART, 'panel-ribbons.jpg')
    img.save(out, 'JPEG', quality=88, subsampling=1, optimize=True)
    print(f'panel-ribbons.jpg {img.size[0]}x{img.size[1]} '
          f'{os.path.getsize(out) // 1024} KB')

    preview = os.environ.get('SCRATCH')
    if preview:
        img.resize((PANEL_W // 2, PANEL_H // 2), Image.LANCZOS).save(
            os.path.join(preview, 'peek-panel-ribbons.png'))
