"""Variant C left panel: the restrained treatment classic certificates use.

Variants A and B both cut the panel with a diagonal and layer photography,
foliage and ribbons — banner language, not certificate language. Traditional
certificates instead rely on a straight-edged field, a framed window, fine
metallic keylines and generous space. That is what this builds:

  * a straight vertical green field with a faint engine-turned texture,
    the low-contrast line work used on security paper
  * the cap photograph in a framed window with a gold double keyline
  * the tagline over flat colour, so the type is never fighting an image
  * a double rule down the inner edge, the standard device for separating a
    certificate's side band from its body

Run: yarn script:certificate:panel-classic
"""
from __future__ import annotations

import os

import numpy as np
from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
ART = os.path.join(HERE, 'source')

SCALE = 2
PANEL_W, PANEL_H = 560, 1098
W, H = PANEL_W * SCALE, PANEL_H * SCALE

GOLD = (198, 162, 88)
GOLD_BRIGHT = (232, 205, 140)

# Photo window, in panel-local points.
WIN = (40, 54, 520, 500)       # left, top, right, bottom


def s(v: float) -> int:
    return int(round(v * SCALE))


def vertical_gradient(stops: list[tuple[float, tuple[int, int, int]]]) -> np.ndarray:
    ys = np.linspace(0.0, 1.0, H)
    pos = np.array([p for p, _ in stops])
    out = np.zeros((H, 3))
    for ch in range(3):
        out[:, ch] = np.interp(ys, pos, [c[ch] for _, c in stops])
    return np.repeat(out[:, None, :], W, axis=1)


def cover(path: str, box_w: int, box_h: int, anchor: float = 0.5) -> Image.Image:
    im = Image.open(path).convert('RGB')
    scale = max(box_w / im.width, box_h / im.height)
    im = im.resize((max(1, int(im.width * scale)), max(1, int(im.height * scale))),
                   Image.LANCZOS)
    left = (im.width - box_w) // 2
    top = int((im.height - box_h) * anchor)
    return im.crop((left, top, left + box_w, top + box_h))


def build() -> Image.Image:
    # 1. Deep green field.
    field = vertical_gradient([
        (0.00, (32, 74, 49)),
        (0.55, (20, 50, 33)),
        (1.00, (11, 30, 20)),
    ])

    # 2. Engine-turned texture: two sets of fine diagonals at a whisper of
    #    contrast. Close up it is line work; at arm's length it just reads as
    #    depth, which is exactly the effect security printing goes for.
    yy, xx = np.mgrid[0:H, 0:W]
    guilloche = (
        np.sin((xx + yy * 0.6) / (7.0 * SCALE)) +
        np.sin((xx - yy * 0.9) / (11.0 * SCALE))
    )
    field += guilloche[:, :, None] * 1.5

    canvas = Image.fromarray(np.clip(field, 0, 255).astype(np.uint8), 'RGB')

    # 3. Photo window.
    wl, wt, wr, wb = WIN
    photo = cover(os.path.join(ART, 'construction.png'),
                  s(wr - wl), s(wb - wt), 0.42)
    # A light green wash keeps the photograph inside the brand palette without
    # dulling the helmet, which is the one bright anchor on the whole page.
    arr = np.asarray(photo).astype(float)
    arr = arr * 0.93 + np.array([18, 50, 32], dtype=float) * 0.07
    canvas.paste(Image.fromarray(arr.astype(np.uint8), 'RGB'), (s(wl), s(wt)))

    draw = ImageDraw.Draw(canvas)

    # 4. Gold double keyline around the window.
    draw.rectangle([s(wl), s(wt), s(wr), s(wb)], outline=GOLD, width=s(2.2))
    draw.rectangle([s(wl + 7), s(wt + 7), s(wr - 7), s(wb - 7)],
                   outline=GOLD_BRIGHT, width=s(0.8))

    # 5. Corner ticks — a small classical flourish on the window frame.
    tick = s(16)
    for cx, cy, dx, dy in (
        (s(wl), s(wt), 1, 1), (s(wr), s(wt), -1, 1),
        (s(wl), s(wb), 1, -1), (s(wr), s(wb), -1, -1),
    ):
        draw.line([(cx + dx * s(3), cy + dy * s(3)),
                   (cx + dx * tick, cy + dy * s(3))], fill=GOLD_BRIGHT, width=s(1.4))
        draw.line([(cx + dx * s(3), cy + dy * s(3)),
                   (cx + dx * s(3), cy + dy * tick)], fill=GOLD_BRIGHT, width=s(1.4))

    # 6. Short rule under the window, setting up the tagline below it.
    draw.line([(s(64), s(560)), (s(184), s(560))], fill=GOLD, width=s(2))

    # 7. Double rule down the inner edge — the classic band/body separator.
    draw.line([(W - s(6), 0), (W - s(6), H)], fill=GOLD, width=s(3))
    draw.line([(W - s(18), 0), (W - s(18), H)], fill=GOLD_BRIGHT, width=s(1))

    # 8. Closing diamond, centred under the tagline block.
    cx, cy, r = s(122), s(1046), s(9)
    draw.polygon([(cx, cy - r), (cx + r, cy), (cx, cy + r), (cx - r, cy)],
                 outline=GOLD, width=s(1.4))
    draw.polygon([(cx, cy - r * 0.45), (cx + r * 0.45, cy),
                  (cx, cy + r * 0.45), (cx - r * 0.45, cy)], fill=GOLD)

    return canvas


if __name__ == '__main__':
    img = build()
    out = os.path.join(ART, 'panel-classic.jpg')
    img.save(out, 'JPEG', quality=90, subsampling=1, optimize=True)
    print(f'panel-classic.jpg {img.size[0]}x{img.size[1]} '
          f'{os.path.getsize(out) // 1024} KB')

    preview = os.environ.get('SCRATCH')
    if preview:
        img.resize((PANEL_W // 2, PANEL_H // 2), Image.LANCZOS).save(
            os.path.join(preview, 'peek-panel-classic.png'))
