# App icon

Three layers, each a 1024×1024 PNG with a transparent background, composed by `scripts/build-icon.py`
(Pillow) into `build/icon.png`, `build/icon.ico` and `build/icons/<size>x<size>.png`, which electron-builder
and the Linux window use.

| Layer | File | What |
|---|---|---|
| background | `layers/background.png` | Rounded-square tile with a warehouse backdrop; outside the tile transparent (it also clips the other layers) |
| forklift | `layers/forklift.png` | The forklift, strict side view facing right, forks empty |
| load | `layers/git.png` | The git badge that sits on the forks |

`compose.json` places them, first at the bottom: `scale` (around the layer's top-left corner), `x`, `y`;
`solidify` makes the nearly opaque inside of generated pictures fully opaque and drops faint halos; `shadow`
adds a soft contact shadow under the layer.

## Changing a layer

1. Replace the file (same size, transparent background).
2. Adjust its entry in `compose.json`. For a new forklift, measure where its forks are and put the load on them:
   in the current one the fork tops are at y = 460, x ≈ 715–915 of the layer; the load's lowest point
   lands at (`load.y` + 870 × `load.scale`), which should equal (`forklift.y` + 460 × `forklift.scale`).
3. `python3 scripts/build-icon.py`, then look at `build/icon.png` and the small sizes in `build/icons/`.

## How the layers were made

Generated with Codex (`codex exec`, its built-in image generation), 2026-10-23. The prompts, for redrawing
one layer in the same style (pass the other layers with `-i … --` as a style reference):

- **forklift** — "a warehouse forklift truck seen strictly from the SIDE (orthographic side profile, no
  perspective tilt), facing RIGHT; mast at the right end, two fork tines horizontally to the right, raised to
  about the middle height, empty space above the forks; chunky body, counterweight at the left, overhead guard
  cage with a seat (no driver), big front and smaller rear wheel, mast with chain. Modern flat vector app-icon
  style, bold clean shapes, subtle gradients and soft highlights, readable at 32px. Warm safety yellow/amber body,
  dark charcoal (#2b2f36) mast, tires and guard, small orange accents. 1024×1024, fully transparent background,
  no floor or shadow, no text. Fills ~80% of the width, wheels at y≈880."
- **load** — "a git symbol badge as a solid block that sits on the forks: a square rotated 45° standing on its
  bottom corner, slightly rounded corners, git orange-red (#F05133), subtle 3D thickness on its lower edges,
  soft highlight upper-left; on its face in white a git branch glyph (a vertical line with nodes at both ends
  and a branch to a third node upper right), thick strokes, no text. Same style as the forklift layer,
  transparent background, ~70% of the canvas height."
- **background** — "an app-icon tile: a macOS-style squircle (corner radius ~22%) inset 50px from each edge,
  outside fully transparent; deep blue-slate gradient (#2E3A55 → #1B2232), soft radial glow behind the upper
  middle, a subtle warehouse floor band across the lower quarter, very subtle low-contrast shelves in the back.
  No forklift, no git symbol, no text."

The git badge follows the Git logo by Jason Long, which is licensed under
[CC BY 3.0](https://creativecommons.org/licenses/by/3.0/) (see https://git-scm.com/downloads/logos).
