"""Render the variant emblem globe: a glassy sphere carrying real continents.

Variant B matches the client's inspiration artwork, where the globe shows
landmasses rather than a bare graticule and bleeds past the certificate border.
Land outlines come from Natural Earth 110m (public domain), vendored beside
this script so the build needs no network.

Run: yarn script:certificate:globe-world
"""
from __future__ import annotations

import json
import os

import numpy as np
from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
ART = os.path.join(HERE, 'source')

SIZE_PT = 460        # artboard points — large, and it runs off the page edge
SCALE = 2
N = SIZE_PT * SCALE

LON0 = 12.0          # centre longitude: Europe / Africa face the viewer
MAP_W, MAP_H = 2880, 1440

OCEAN = np.array([238, 245, 240], dtype=float)
LAND = np.array([176, 200, 182], dtype=float)
GRID = np.array([150, 180, 158], dtype=float)


def smoothstep(edge0: float, edge1: float, x: np.ndarray) -> np.ndarray:
    t = np.clip((x - edge0) / (edge1 - edge0), 0.0, 1.0)
    return t * t * (3 - 2 * t)


def land_mask() -> np.ndarray:
    """Equirectangular land/sea mask from the vendored Natural Earth data."""
    with open(os.path.join(ART, 'ne_110m_land.geojson')) as fh:
        data = json.load(fh)

    img = Image.new('L', (MAP_W, MAP_H), 0)
    draw = ImageDraw.Draw(img)
    for feature in data['features']:
        rings = feature['geometry']['coordinates']
        for ring in rings:
            pts = [
                ((lon + 180.0) / 360.0 * MAP_W, (90.0 - lat) / 180.0 * MAP_H)
                for lon, lat in ring
            ]
            if len(pts) > 2:
                draw.polygon(pts, fill=255)
    return np.asarray(img).astype(float) / 255.0


def build() -> Image.Image:
    mask = land_mask()

    lin = np.linspace(-1.0, 1.0, N)
    x, y = np.meshgrid(lin, lin)
    r = np.sqrt(x * x + y * y)
    inside = r <= 1.0
    z = np.sqrt(np.clip(1.0 - r * r, 0.0, 1.0))

    # Screen y grows downwards, so negate it: row 0 is the North Pole.
    lat = np.degrees(np.arcsin(np.clip(-y, -1.0, 1.0)))
    lon = np.degrees(np.arctan2(x, np.where(z > 1e-6, z, 1e-6))) + LON0
    lon = ((lon + 180.0) % 360.0) - 180.0

    # Sample the land mask, softening the lookup so coastlines don't alias.
    u = np.clip(((lon + 180.0) / 360.0 * MAP_W).astype(int), 0, MAP_W - 1)
    v = np.clip(((90.0 - lat) / 180.0 * MAP_H).astype(int), 0, MAP_H - 1)
    land = mask[v, u]
    land = (land + np.roll(land, 1, axis=0) + np.roll(land, 1, axis=1)) / 3.0

    rgb = OCEAN[None, None, :] + (LAND - OCEAN)[None, None, :] * land[:, :, None]

    # Graticule, thinned towards the limb.
    def lines(angle: np.ndarray, step: float, width: float) -> np.ndarray:
        d = np.abs(((angle + step / 2) % step) - step / 2)
        return 1.0 - smoothstep(width * 0.4, width, d)

    grid = np.maximum(lines(lat, 15.0, 0.9), lines(lon, 15.0, 0.9))
    grid *= z ** 0.8
    grid = np.clip(grid, 0.0, 1.0) * 0.40
    rgb = rgb * (1 - grid[:, :, None]) + GRID[None, None, :] * grid[:, :, None]

    # Glass shading: diffuse falloff plus a specular bloom top-left.
    light = np.array([-0.40, -0.54, 0.74])
    light /= np.linalg.norm(light)
    ndotl = np.clip(x * light[0] + y * light[1] + z * light[2], 0.0, 1.0)
    rgb *= (0.80 + 0.30 * ndotl)[:, :, None]
    spec = np.exp(-(((x + 0.42) ** 2 + (y + 0.48) ** 2) / 0.045))
    rgb = np.clip(rgb + spec[:, :, None] * 40.0, 0, 255)

    # Feathered limb, and an overall translucency so it reads as a watermark.
    alpha = (1.0 - smoothstep(0.988, 1.0, r)) * inside
    alpha *= 0.40 + 0.34 * z ** 0.5

    out = np.concatenate([rgb, (alpha * 255)[:, :, None]], axis=2)
    return Image.fromarray(out.astype(np.uint8), 'RGBA')


if __name__ == '__main__':
    img = build()
    path = os.path.join(ART, 'emblem-globe-world.png')
    img.save(path, optimize=True)
    print(f'emblem-globe-world.png {img.size[0]}x{img.size[1]} '
          f'{os.path.getsize(path) // 1024} KB')

    preview = os.environ.get('SCRATCH')
    if preview:
        bg = Image.new('RGB', img.size, (255, 255, 255))
        bg.paste(img, (0, 0), img)
        bg.resize((460, 460), Image.LANCZOS).save(
            os.path.join(preview, 'peek-globe-world.png'))
