"""Slice individual icon tiles from the two ChatGPT icon-sheet images and
export them as webp for the main-menu entry tiles.

Each source sheet is a 5-column x 4-row grid of parchment tiles on a black
background. We detect the tile bands by content projection (non-black pixels)
rather than hard-slicing, so small framing offsets don't matter.
"""
import numpy as np
from PIL import Image

OUT_DIR = "apps/web/public/images/ui"

SHEET5 = "R:/ChatGPT Image 2026年6月14日 上午12_21_15-Photoroom.png"  # tools (backpack...)
SHEET6 = "R:/ChatGPT Image 2026年6月14日 上午12_04_57-Photoroom.png"  # book...

# (sheet, row, col, output-name)  -- row/col are 1-indexed
TARGETS = [
    (SHEET5, 1, 1, "MenuCollection"),   # backpack
    (SHEET6, 3, 4, "MenuBattle"),       # crossed swords (red shield)
    (SHEET6, 1, 5, "MenuQuest"),        # sword + shield crest
    (SHEET6, 4, 4, "MenuAchievement"),  # trophy
    (SHEET6, 1, 4, "MenuShop"),         # gold bag
]

COLS, ROWS = 5, 4


def find_bands(mask_1d, expected):
    """Given a 1-D boolean projection, return `expected` (start,end) bands."""
    idx = np.where(mask_1d)[0]
    bands = []
    start = idx[0]
    prev = idx[0]
    for i in idx[1:]:
        if i - prev > 5:  # gap -> new band
            bands.append((start, prev))
            start = i
        prev = i
    bands.append((start, prev))
    # keep the `expected` widest bands, then sort by position
    bands.sort(key=lambda b: b[1] - b[0], reverse=True)
    bands = sorted(bands[:expected], key=lambda b: b[0])
    return bands


def grid_for(path):
    img = Image.open(path).convert("RGBA")  # keep transparency
    content = np.asarray(img)[:, :, 3] > 16  # non-transparent
    col_proj = content.sum(axis=0) > (content.shape[0] * 0.04)
    row_proj = content.sum(axis=1) > (content.shape[1] * 0.04)
    col_bands = find_bands(col_proj, COLS)
    row_bands = find_bands(row_proj, ROWS)
    return img, col_bands, row_bands


cache = {}
for path, r, c, name in TARGETS:
    if path not in cache:
        cache[path] = grid_for(path)
    img, col_bands, row_bands = cache[path]
    x0, x1 = col_bands[c - 1]
    y0, y1 = row_bands[r - 1]
    pad = 4
    box = (max(x0 - pad, 0), max(y0 - pad, 0), x1 + pad, y1 + pad)
    tile = img.crop(box)
    # Drop the faint translucent "glass panel" remnants left in the rounded
    # corners (alpha ~30-80). They render as a faint square frame over the map
    # background. The wood frame itself jumps straight to alpha ~190+, so a
    # threshold cleanly removes the glass without eating the frame's edge.
    arr = np.asarray(tile).copy()
    a = arr[:, :, 3]
    arr[:, :, 3] = np.where(a < 130, 0, a)
    tile = Image.fromarray(arr, "RGBA")
    out = f"{OUT_DIR}/{name}.webp"
    tile.save(out, "WEBP", quality=92, method=6)
    print(f"{name}: r{r}c{c} {box} -> {tile.size} {out}")
