"""Cut 卯死 augment icon webps from black-background 5x4 source sheets.

Expected source files are the five sheets shown by the user, in order:

  scripts/augment_sources/maosi_1.png
  scripts/augment_sources/maosi_2.png
  scripts/augment_sources/maosi_3.png
  scripts/augment_sources/maosi_4.png
  scripts/augment_sources/maosi_5.png

You can also pass the five source paths explicitly:

  python scripts/cut_augment_icons_high.py path/to/1.png ... path/to/5.png

The exporter matches the existing augment icon convention: tight transparent
cutout, longest side <= 240px, WEBP quality 80.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

from PIL import Image


OUT = Path("apps/web/public/images/augments")
MAX_DIM = 240
BLACK_TRIM = 12
ALPHA_TRIM = 20
PAD = 12
WEBP_QUALITY = 80

DEFAULT_SOURCES = [
    Path("scripts/augment_sources/maosi_1.png"),
    Path("scripts/augment_sources/maosi_2.png"),
    Path("scripts/augment_sources/maosi_3.png"),
    Path("scripts/augment_sources/maosi_4.png"),
    Path("scripts/augment_sources/maosi_5.png"),
]

# (sheet, row, col) 0-indexed -> augment image filename (id lowercased).
# The positions are chosen from the user's 卯死 icon sheets by semantic fit.
MAP = {
    (3, 0, 2): "amp_island_dawn",              # torch       -> 島嶼天光
    (4, 0, 2): "amp_default_settlement",       # gavel       -> 違約交割
    (0, 0, 3): "amp_jackpot",                  # chest       -> 發票中頭獎
    (0, 2, 1): "amp_vendor_kickback",          # handshake   -> 廠商回扣
    (2, 0, 4): "amp_illegal_migrant_workers",  # lock        -> 非法移工
    (4, 3, 3): "amp_pudu",                     # candelabra  -> 普渡
    (0, 0, 2): "amp_tw_40000",                 # coin stacks -> 台股四萬點
    (2, 3, 4): "amp_fire_sale",                # market      -> 跳樓大拍賣
    (0, 1, 1): "amp_one_party_dominance",      # crown       -> 一黨獨大
    (2, 0, 2): "amp_taiji_electric_offer",     # crystals    -> 台雞電OFFER
    (0, 1, 0): "amp_1992_consensus",           # scales      -> 九二共識
    (0, 1, 3): "amp_garbage_no_blue_green",    # swords      -> 垃圾不分藍綠
}


def black_to_alpha(im: Image.Image) -> Image.Image:
    rgba = im.convert("RGBA")
    pixels = rgba.load()
    for y in range(rgba.height):
        for x in range(rgba.width):
            r, g, b, a = pixels[x, y]
            strength = max(r, g, b)
            if a <= ALPHA_TRIM or strength <= BLACK_TRIM:
                pixels[x, y] = (r, g, b, 0)
            elif strength < 42:
                alpha = round(a * ((strength - BLACK_TRIM) / (42 - BLACK_TRIM)))
                pixels[x, y] = (r, g, b, alpha)
    return rgba


def tight_crop(cell: Image.Image) -> Image.Image:
    prepared = black_to_alpha(cell)
    alpha = prepared.split()[3]
    mask = alpha.point(lambda p: 255 if p > ALPHA_TRIM else 0)
    bbox = mask.getbbox()
    if bbox is None:
        raise ValueError("cell has no visible icon")

    x0, y0, x1, y1 = bbox
    x0 = max(0, x0 - PAD)
    y0 = max(0, y0 - PAD)
    x1 = min(prepared.width, x1 + PAD)
    y1 = min(prepared.height, y1 + PAD)
    icon = prepared.crop((x0, y0, x1, y1))

    w, h = icon.size
    scale = MAX_DIM / max(w, h)
    if scale < 1:
        icon = icon.resize((round(w * scale), round(h * scale)), Image.LANCZOS)
    return icon


def cut_cell(sheet: Image.Image, row: int, col: int) -> Image.Image:
    width, height = sheet.size
    left = round(width * col / 5)
    right = round(width * (col + 1) / 5)
    top = round(height * row / 4)
    bottom = round(height * (row + 1) / 4)
    return tight_crop(sheet.crop((left, top, right, bottom)))


def montage(names: list[str]) -> None:
    cell = MAX_DIM + 24
    cols = 4
    rows = (len(names) + cols - 1) // cols
    mont = Image.new("RGBA", (cols * cell, rows * cell), (40, 30, 20, 255))
    for i, name in enumerate(names):
        icon = Image.open(OUT / f"{name}.webp").convert("RGBA")
        gx = (i % cols) * cell
        gy = (i // cols) * cell
        mont.alpha_composite(icon, (gx + (cell - icon.width) // 2, gy + (cell - icon.height) // 2))
    mont.convert("RGB").save("scripts/_augment_montage_high.png")


def main() -> int:
    sources = [Path(arg) for arg in sys.argv[1:]] or DEFAULT_SOURCES
    missing = [str(path) for path in sources if not path.exists()]
    if missing:
        print("Missing source image(s):", file=sys.stderr)
        for path in missing:
            print(f"  {path}", file=sys.stderr)
        return 1
    if len(sources) != 5:
        print("Expected exactly 5 source sheets.", file=sys.stderr)
        return 1

    sheets = [Image.open(path).convert("RGBA") for path in sources]
    OUT.mkdir(parents=True, exist_ok=True)

    names: list[str] = []
    for (sheet_index, row, col), name in MAP.items():
        icon = cut_cell(sheets[sheet_index], row, col)
        path = OUT / f"{name}.webp"
        icon.save(path, "WEBP", quality=WEBP_QUALITY, method=6)
        names.append(name)
        print(f"{name}.webp\t{icon.size[0]}x{icon.size[1]}\t{os.path.getsize(path)} bytes")

    montage(names)
    print("montage -> scripts/_augment_montage_high.png")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
