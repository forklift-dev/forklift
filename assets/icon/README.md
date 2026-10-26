# App icon

The icon is composed by `scripts/build-icon.py` (Pillow) into `build/icon.png`, `build/icon.ico`,
`build/icons/<size>x<size>.png` (electron-builder) and `build/window.png` (the Linux window).

Two variants (`compose.json` → `variants`) use the owner's `layers/forklift_alt.png`: **large** (128 px and
up) places it on the blue-slate tile; **small** (64 px and below, and the window icon) uses the same artwork
without the tile, enlarged and symmetrically cropped at the sides so the wide silhouette remains readable and
fills the taskbar height. The `.ico` takes each size from the right variant. The alternative artwork is a
256×256 PNG; the older source layers are 1024×1024.

| Layer | File | What |
|---|---|---|
| background | `layers/background.png` | Plain rounded-square tile, blue-slate gradient (drawn with Pillow, no details: they made the icon unreadable when small); outside it transparent; `clip` keeps the other layers inside it |
| logo | `layers/forklift_alt.png` | The current complete logo: a forklift in 3/4 view holding a glowing Git badge |

Each variant places its layers, first at the bottom: `scale` (around the layer's top-left corner), `x`, `y`;
`solidify` makes the nearly opaque inside of generated pictures fully opaque and drops faint halos; `shadow`
adds a soft contact shadow under the layer; `clip` cuts everything to that layer's shape.

## Previous artwork

- `layers/forklift.png` and `layers/git.png` — the previous large icon, split into forklift and load layers.
- `layers/small.png` — the previous compact icon.

## Changing a layer

1. Replace the file (same size, transparent background).
2. Adjust its entries in both variants of `compose.json`. The 256×256 source is scaled up independently for
   the tiled large icon and the transparent small/window icon.
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
- **small** — "a SMALL-SIZE version of the icon as one picture: the same forklift from the side facing right,
  forks RAISED HIGH carrying the git diamond badge, compact roughly square silhouette filling ~92% of the canvas;
  chunky shapes, thick dark parts, no chain or thin bars, big wheels; transparent background, no text."
- **background** (the first version; replaced by a plain tile, see above — it is in git history) — "an app-icon tile: a macOS-style squircle (corner radius ~22%) inset 50px from each edge,
  outside fully transparent; deep blue-slate gradient (#2E3A55 → #1B2232), soft radial glow behind the upper
  middle, a subtle warehouse floor band across the lower quarter, very subtle low-contrast shelves in the back.
  No forklift, no git symbol, no text."

The git badge follows the Git logo by Jason Long, which is licensed under
[CC BY 3.0](https://creativecommons.org/licenses/by/3.0/) (see https://git-scm.com/downloads/logos).
