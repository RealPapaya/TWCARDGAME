"""Cut all augment icon webps from tiered 5x4 source sheets.

The source sheets live under scripts/augment_sources and are grouped by color:
Bronze = 加減賺, Silver = 穩穩仔賺, Gold/maosi = 卯死.

The output convention matches the client loader:
  apps/web/public/images/augments/<augment id lowercased>.webp
"""

from __future__ import annotations

import os
from pathlib import Path

import numpy as np
from PIL import Image


SRC = Path("scripts/augment_sources")
OUT = Path("apps/web/public/images/augments")
MAX_DIM = 240
ALPHA_TRIM = 20
VISIBILITY_TRIM = 16
PAD = 14
WEBP_QUALITY = 84

COLS = [(87, 260), (350, 544), (614, 833), (889, 1083), (1144, 1376)]
ROWS = [(64, 299), (330, 548), (587, 773), (797, 1006)]

SHEETS = {
    "bronze1": SRC / "BUFF-BRONZE-Photoroom.png",
    "bronze2": SRC / "BUFF-BRONZE2-Photoroom.png",
    "silver1": SRC / "BUFF-SILVER-Photoroom.png",
    "silver2": SRC / "BUFF-SILVER2-Photoroom.png",
    "silver3": SRC / "BUFF-SILVER3-Photoroom.png",
    "silver4": SRC / "BUFF-SILVER4-Photoroom.png",
    "gold1": SRC / "maosi_1.png",
    "gold2": SRC / "maosi_2.png",
    "gold3": SRC / "maosi_3.png",
    "gold4": SRC / "maosi_4.png",
    "gold5": SRC / "maosi_5.png",
}

# sheet, row, col are 0-indexed.
AUGMENTS: list[tuple[str, str, int, int]] = [
    # 加減賺
    ("amp_invoice_200", "bronze1", 0, 0),
    ("amp_voucher_3600", "bronze2", 3, 2),
    ("amp_shareholder_gift", "bronze1", 0, 1),
    ("amp_0050", "bronze2", 0, 1),
    ("amp_go_for_broke", "bronze2", 3, 4),
    ("amp_three_way_race", "bronze1", 3, 0),
    ("amp_min_wage", "bronze1", 0, 4),
    ("amp_fries_bogo", "bronze1", 0, 2),
    ("amp_flee_abroad", "bronze2", 2, 2),
    ("amp_typhoon_day", "bronze2", 2, 0),
    ("amp_energy_transition", "bronze1", 3, 3),
    ("amp_life_insurance", "bronze1", 2, 1),
    ("amp_village_lunchbox", "bronze2", 3, 0),
    ("amp_blood_donation_voucher", "bronze2", 2, 1),
    ("amp_banquet", "bronze1", 2, 3),

    # 穩穩仔賺
    ("amp_dividend", "silver1", 0, 2),
    ("amp_invoice_1000", "silver1", 0, 1),
    ("amp_tax_cut", "silver1", 1, 0),
    ("amp_childcare", "silver1", 3, 0),
    ("amp_free_speech", "silver2", 3, 3),
    ("amp_new_housing", "silver2", 0, 1),
    ("amp_betel_nut_500", "silver1", 3, 2),
    ("amp_beggar_hero", "silver1", 2, 2),
    ("amp_dca", "silver2", 0, 4),
    ("amp_party_asset_supplement", "silver1", 0, 3),
    ("amp_national_holiday", "silver1", 3, 3),
    ("amp_nuclear_free_homeland", "silver3", 0, 3),
    ("amp_restart_nuclear_four", "silver4", 1, 4),
    ("amp_return_country_to_you", "silver2", 1, 4),

    # 卯死
    ("amp_island_dawn", "gold4", 0, 2),
    ("amp_default_settlement", "gold5", 0, 2),
    ("amp_jackpot", "gold1", 0, 3),
    ("amp_vendor_kickback", "gold1", 2, 1),
    ("amp_illegal_migrant_workers", "gold3", 0, 4),
    ("amp_pudu", "gold5", 3, 3),
    ("amp_tw_40000", "gold1", 0, 2),
    ("amp_fire_sale", "gold3", 3, 4),
    ("amp_one_party_dominance", "gold1", 1, 1),
    ("amp_taiji_electric_offer", "gold3", 0, 2),
    ("amp_1992_consensus", "gold1", 1, 0),
    ("amp_garbage_no_blue_green", "gold1", 1, 3),
]


def clean_mask(im: Image.Image) -> Image.Image:
    rgba = im.convert("RGBA")
    arr = np.array(rgba)
    alpha = arr[:, :, 3]
    max_rgb = arr[:, :, :3].max(axis=2)
    mask = (alpha > ALPHA_TRIM) & (max_rgb > VISIBILITY_TRIM)

    height, width = mask.shape
    seen = np.zeros_like(mask, dtype=bool)
    components: list[list[tuple[int, int]]] = []
    for y in range(height):
        for x in range(width):
            if not mask[y, x] or seen[y, x]:
                continue
            stack = [(x, y)]
            seen[y, x] = True
            comp: list[tuple[int, int]] = []
            while stack:
                cx, cy = stack.pop()
                comp.append((cx, cy))
                for nx, ny in ((cx + 1, cy), (cx - 1, cy), (cx, cy + 1), (cx, cy - 1)):
                    if 0 <= nx < width and 0 <= ny < height and mask[ny, nx] and not seen[ny, nx]:
                        seen[ny, nx] = True
                        stack.append((nx, ny))
            components.append(comp)

    if not components:
        return Image.new("L", rgba.size, 0)

    largest = max(len(comp) for comp in components)
    min_area = max(80, round(largest * 0.01))
    cleaned = np.zeros_like(mask, dtype=np.uint8)
    for comp in components:
        if len(comp) >= min_area:
            for x, y in comp:
                cleaned[y, x] = 255
    return Image.fromarray(cleaned, "L")


def trim_icon(cell: Image.Image) -> Image.Image:
    rgba = cell.convert("RGBA")
    mask = clean_mask(rgba)
    bbox = mask.getbbox()
    if bbox is None:
        raise ValueError("empty source cell")

    alpha = rgba.getchannel("A")
    rgba.putalpha(Image.composite(alpha, Image.new("L", rgba.size, 0), mask))

    x0, y0, x1, y1 = bbox
    x0 = max(0, x0 - PAD)
    y0 = max(0, y0 - PAD)
    x1 = min(rgba.width, x1 + PAD)
    y1 = min(rgba.height, y1 + PAD)
    icon = rgba.crop((x0, y0, x1, y1))

    w, h = icon.size
    scale = MAX_DIM / max(w, h)
    if scale < 1:
        icon = icon.resize((round(w * scale), round(h * scale)), Image.LANCZOS)
    return icon


def cut_cell(sheet: Image.Image, row: int, col: int) -> Image.Image:
    if sheet.size == (1448, 1086):
        left, right = COLS[col]
        top, bottom = ROWS[row]
    else:
        w, h = sheet.size
        left = round(w * col / 5)
        right = round(w * (col + 1) / 5)
        top = round(h * row / 4)
        bottom = round(h * (row + 1) / 4)
    return trim_icon(sheet.crop((left, top, right, bottom)))


def write_montage(names: list[str]) -> None:
    cell = MAX_DIM + 32
    cols = 8
    rows = (len(names) + cols - 1) // cols
    mont = Image.new("RGBA", (cols * cell, rows * cell), (38, 31, 24, 255))
    for i, name in enumerate(names):
        icon = Image.open(OUT / f"{name}.webp").convert("RGBA")
        x = (i % cols) * cell
        y = (i // cols) * cell
        mont.alpha_composite(icon, (x + (cell - icon.width) // 2, y + (cell - icon.height) // 2))
    mont.convert("RGB").save("scripts/_augment_montage_all.png")


def main() -> int:
    missing = [path for path in SHEETS.values() if not path.exists()]
    if missing:
        for path in missing:
            print(f"missing: {path}")
        return 1

    sheets = {key: Image.open(path).convert("RGBA") for key, path in SHEETS.items()}
    OUT.mkdir(parents=True, exist_ok=True)

    names: list[str] = []
    for name, sheet_key, row, col in AUGMENTS:
        icon = cut_cell(sheets[sheet_key], row, col)
        path = OUT / f"{name}.webp"
        icon.save(path, "WEBP", quality=WEBP_QUALITY, method=6)
        names.append(name)
        print(f"{name}.webp\t{icon.width}x{icon.height}\t{os.path.getsize(path)} bytes")

    write_montage(names)
    print("montage -> scripts/_augment_montage_all.png")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
