"""Cut clean icon-only webp cutouts from R:/BUFF2-Photoroom.png for the 增幅 (augment) UI.

Companion to cut_augment_icons.py — BUFF2 is the same 5x4 grid layout / dimensions
as BUFF, so we reuse the alpha-band spans and only change the cell -> augment map.
Grid positions below are given by the design note as col-row (1-indexed); we store
them here as 0-indexed (row, col) to match `cut`.
"""
from PIL import Image
import numpy as np
import os

SRC = "R:/BUFF2-Photoroom.png"
OUT = "apps/web/public/images/augments"
MAX_DIM = 240          # longest side of exported icon
ALPHA_TRIM = 20        # alpha threshold for tight crop
PAD = 6                # transparent breathing room (px, pre-resize)

# Content spans derived from alpha gap analysis (col_start,col_end),(row...)
COLS = [(87, 260), (350, 544), (614, 833), (889, 1083), (1144, 1376)]
ROWS = [(64, 299), (330, 548), (587, 773), (797, 1006)]

# (row, col) 0-indexed -> augment image filename ( = id lowercased )
MAP = {
    (3, 2): "amp_voucher_3600",            # money bag      -> 消費券3600   (col3,row4)
    (0, 1): "amp_0050",                    # star card      -> 蹲得越低     (col2,row1)
    (3, 4): "amp_go_for_broke",            # ballot box     -> 要拚         (col5,row4)
    (2, 2): "amp_flee_abroad",             # hooded figure  -> 潛逃國外     (col3,row3)
    (2, 0): "amp_typhoon_day",             # wax seal       -> 颱風假       (col1,row3)
    (3, 0): "amp_village_lunchbox",        # round table    -> 里長的愛心便當 (col1,row4)
    (2, 1): "amp_blood_donation_voucher",  # handshake      -> 捐血送禮券   (col2,row3)
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
cols = 4
rows = (len(order) + cols - 1) // cols
mont = Image.new("RGBA", (cellw * cols, cellw * rows), (40, 30, 20, 255))
for i, name in enumerate(order):
    ic = Image.open(os.path.join(OUT, f"{name}.webp"))
    gx, gy = (i % cols) * cellw, (i // cols) * cellw
    mont.alpha_composite(ic, (gx + (cellw - ic.width) // 2, gy + (cellw - ic.height) // 2))
mont.convert("RGB").save("scripts/_augment_montage2.png")
print("montage -> scripts/_augment_montage2.png")
