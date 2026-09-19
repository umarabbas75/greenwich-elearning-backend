"""Render the globe half of the PEOPLE PLANET PROGRESS emblem.

The leaves are drawn as vectors by build-template.ts so they stay crisp; the
globe is rasterised here because it needs radial shading and a feathered limb,
neither of which pdf-lib can express (it has no gradient or soft-mask support).

Together they read as one mark: a shaded planet with a plant growing out of it.
"""
from __future__ import annotations

import os

import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
ART = os.path.join(HERE, 'source')

SIZE_PT = 320        # artboard points
SCALE = 2            # px per point (~344 DPI at the printed size)
N = SIZE_PT * SCALE

# Pale green-greys: the globe sits behind the title, so it stays light.
SHADOW = np.array([176, 198, 183], dtype=float)
LIGHT = np.array([248, 252, 249], dtype=float)
GRID = np.array([120, 158, 132], dtype=float)


def smoothstep(edge0: float, edge1: float, x: np.ndarray) -> np.ndarray:
    t = np.clip((x - edge0) / (edge1 - edge0), 0.0, 1.0)
    return t * t * (3 - 2 * t)


def build() -> Image.Image:
    lin = np.linspace(-1.0, 1.0, N)
    x, y = np.meshgrid(lin, lin)
    r = np.sqrt(x * x + y * y)
    inside = r <= 1.0

    # Sphere normal; z is depth towards the viewer.
    z = np.sqrt(np.clip(1.0 - r * r, 0.0, 1.0))

    # Diffuse shading from an upper-left key light.
    light = np.array([-0.42, -0.52, 0.74])
    light /= np.linalg.norm(light)
    ndotl = np.clip(x * light[0] + y * light[1] + z * light[2], 0.0, 1.0)
    shade = 0.32 + 0.68 * ndotl

    rgb = SHADOW[None, None, :] + (LIGHT - SHADOW)[None, None, :] * shade[:, :, None]

    # Lat/long wireframe, thinned towards the limb so it doesn't moire.
    with np.errstate(invalid='ignore'):
        lat = np.degrees(np.arcsin(np.clip(y, -1.0, 1.0)))
        lon = np.degrees(np.arctan2(x, np.where(z > 1e-6, z, 1e-6)))

    def lines(angle: np.ndarray, step: float, width: float) -> np.ndarray:
        d = np.abs(((angle + step / 2) % step) - step / 2)
        return 1.0 - smoothstep(width * 0.45, width, d)

    grid = np.maximum(lines(lat, 15.0, 1.1), lines(lon, 20.0, 1.1))
    grid *= z ** 0.75                      # fade where the surface turns away
    grid = np.clip(grid, 0.0, 1.0) * 0.55

    rgb = rgb * (1 - grid[:, :, None]) + GRID[None, None, :] * grid[:, :, None]

    # Specular bloom, so the sphere reads as glass rather than a flat disc.
    spec = np.exp(-(((x + 0.40) ** 2 + (y + 0.46) ** 2) / 0.052))
    rgb = np.clip(rgb + spec[:, :, None] * 46.0, 0, 255)

    # Feather the limb and keep the whole thing translucent.
    alpha = (1.0 - smoothstep(0.985, 1.0, r)) * inside
    # A touch more presence in the middle than at the edge.
    alpha *= 0.34 + 0.30 * z ** 0.5

    out = np.concatenate([rgb, (alpha * 255)[:, :, None]], axis=2)
    return Image.fromarray(out.astype(np.uint8), 'RGBA')


if __name__ == '__main__':
    img = build()
    path = os.path.join(ART, 'emblem-globe.png')
    img.save(path, optimize=True)
    print(f'emblem-globe.png {img.size[0]}x{img.size[1]} '
          f'{os.path.getsize(path) // 1024} KB')

    preview = os.environ.get('SCRATCH')
    if preview:
        bg = Image.new('RGB', img.size, (255, 255, 255))
        bg.paste(img, (0, 0), img)
        bg.resize((400, 400), Image.LANCZOS).save(
            os.path.join(preview, 'peek-globe.png'))
