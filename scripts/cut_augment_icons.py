"""Cut clean icon-only webp cutouts from R:/BUFF-Photoroom.png for the 增幅 (augment) UI.

The source is a 5x4 grid of Photoroom-cut medieval stone icons (transparent bg).
We segment by the empty alpha bands, tight-trim each icon, and export small webp.
"""
from PIL import Image
import numpy as np
import os

SRC = "R:/BUFF-Photoroom.png"
OUT = "apps/web/public/images/augments"
MAX_DIM = 240          # longest side of exported icon
ALPHA_TRIM = 20        # alpha threshold for tight crop
PAD = 6                # transparent breathing room (px, pre-resize)

# Content spans derived from alpha gap analysis (col_start,col_end),(row...)
COLS = [(87, 260), (350, 544), (614, 833), (889, 1083), (1144, 1376)]
ROWS = [(64, 299), (330, 548), (587, 773), (797, 1006)]

# (row, col) -> augment image filename
MAP = {
    (0, 0): "amp_invoice_200",       # gem  -> 發票中200
    (0, 1): "amp_shareholder_gift",  # coins -> 股東紀念品
    (0, 2): "amp_fries_bogo",        # card deck -> 大薯買一送一
    (0, 4): "amp_min_wage",          # scroll w/ ribbon -> 基本工資調漲
    (2, 1): "amp_life_insurance",    # document scroll -> 壽險理賠
    (2, 3): "amp_banquet",           # covered wagon -> 流水席
    (3, 0): "amp_three_way_race",    # compass -> 政壇三腳督
    (3, 3): "amp_energy_transition", # quill+ink -> 能源轉型
}

im = Image.open(SRC).convert("RGBA")


def cut(r, c):
    cs, ce = COLS[c]
    rs, re = ROWS[r]
    cell = im.crop((cs, rs, ce, re))
    alpha = cell.split()[3]
    mask = alpha.point(lambda p: 255 if p > ALPHA_TRIM else 0)
    bb = mask.getbbox()
    if bb is None:
        return None
    x0, y0, x1, y1 = bb
    x0 = max(0, x0 - PAD); y0 = max(0, y0 - PAD)
    x1 = min(cell.width, x1 + PAD); y1 = min(cell.height, y1 + PAD)
    icon = cell.crop((x0, y0, x1, y1))
    w, h = icon.size
    scale = MAX_DIM / max(w, h)
    if scale < 1:
        icon = icon.resize((round(w * scale), round(h * scale)), Image.LANCZOS)
    return icon


os.makedirs(OUT, exist_ok=True)
for (r, c), name in MAP.items():
    icon = cut(r, c)
    path = os.path.join(OUT, f"{name}.webp")
    icon.save(path, "WEBP", quality=80, method=6)
    print(f"{name}.webp  {icon.size}  {os.path.getsize(path)} bytes")

# montage for visual verification
order = list(MAP.values())
cellw = MAX_DIM + 12
mont = Image.new("RGBA", (cellw * 4, cellw * 2), (40, 30, 20, 255))
for i, name in enumerate(order):
    ic = Image.open(os.path.join(OUT, f"{name}.webp"))
    gx, gy = (i % 4) * cellw, (i // 4) * cellw
    mont.alpha_composite(ic, (gx + (cellw - ic.width) // 2, gy + (cellw - ic.height) // 2))
mont.convert("RGB").save("scripts/_augment_montage.png")
print("montage -> scripts/_augment_montage.png")
