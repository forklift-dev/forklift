#!/usr/bin/env python3
"""Builds the app icon from its layers (assets/icon/compose.json) into build/icon.png and build/icons/*.png.

Each layer is a 1024x1024 RGBA picture with a transparent background. compose.json has variants (the
"small" one, up to its `maxSize`, is for taskbars and small icons; "large" for the rest); each places its
layers in order (first at the bottom): `scale` around the layer's top-left corner, `x`/`y` move it; `solidify`
makes nearly opaque pixels fully opaque (generated pictures are often 95% opaque inside) and drops a faint
halo; `shadow` puts a soft contact shadow under the layer; `clip` keeps everything inside that layer's shape.
Replace a layer's file and run this again.

Needs Pillow: python3 -m pip install pillow
"""
import json
import sys
from pathlib import Path

from PIL import Image, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
ICON = ROOT / 'assets' / 'icon'
SIZES = [16, 24, 32, 48, 64, 128, 256, 512, 1024]


def solidify(layer: Image.Image) -> Image.Image:
    r, g, b, a = layer.split()
    a = a.point(lambda v: 0 if v < 24 else 255 if v >= 200 else int((v - 24) * 255 / 176))
    return Image.merge('RGBA', (r, g, b, a))


def contact_shadow(layer: Image.Image) -> Image.Image:
    """A soft dark ellipse under the lowest opaque row of the layer."""
    box = layer.getchannel('A').point(lambda v: 255 if v > 200 else 0).getbbox()
    shadow = Image.new('RGBA', layer.size, (0, 0, 0, 0))
    if not box:
        return shadow
    left, _, right, bottom = box
    width = right - left
    ellipse = Image.new('L', layer.size, 0)
    from PIL import ImageDraw

    ImageDraw.Draw(ellipse).ellipse((left + width * 0.04, bottom - 22, right - width * 0.04, bottom + 22), fill=150)
    ellipse = ellipse.filter(ImageFilter.GaussianBlur(14))
    shadow.putalpha(ellipse)
    return shadow


def compose(size: int, layers: list) -> Image.Image:
    canvas = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    clip = None
    for spec in layers:
        layer = Image.open(ICON / spec['file']).convert('RGBA')
        if spec.get('solidify'):
            layer = solidify(layer)
        scale = spec.get('scale', 1)
        if scale != 1:
            layer = layer.resize((round(layer.width * scale), round(layer.height * scale)), Image.LANCZOS)
        placed = Image.new('RGBA', (size, size), (0, 0, 0, 0))
        placed.paste(layer, (spec.get('x', 0), spec.get('y', 0)), layer)
        if spec.get('clip'):
            clip = placed.getchannel('A')
        if spec.get('shadow'):
            canvas = Image.alpha_composite(canvas, contact_shadow(placed))
        canvas = Image.alpha_composite(canvas, placed)
    if clip is not None:
        canvas.putalpha(Image.composite(canvas.getchannel('A'), Image.new('L', (size, size), 0), clip))
    return canvas


def main() -> None:
    config = json.loads((ICON / 'compose.json').read_text())
    size = config['size']
    large = compose(size, config['variants']['large']['layers'])
    small = compose(size, config['variants']['small']['layers'])
    small_max = config['variants']['small'].get('maxSize', 64)
    pick = lambda s: (small if s <= small_max else large).resize((s, s), Image.LANCZOS)
    out = ROOT / 'build'
    (out / 'icons').mkdir(parents=True, exist_ok=True)
    large.save(out / 'icon.png')
    for s in SIZES:
        pick(s).save(out / 'icons' / f'{s}x{s}.png')
    # The Linux window icon: taskbars draw it small.
    small.resize((256, 256), Image.LANCZOS).save(out / 'window.png')
    # Windows takes each size from the .ico: small ones without the tile.
    sizes = (16, 24, 32, 48, 64, 128, 256)
    frames = [pick(s) for s in sizes]
    frames[-1].save(out / 'icon.ico', sizes=[(s, s) for s in sizes], append_images=frames[:-1])
    print(f'wrote {out / "icon.png"}, {out / "icon.ico"}, {out / "window.png"} and {len(SIZES)} sizes in {out / "icons"}', file=sys.stderr)


if __name__ == '__main__':
    main()
