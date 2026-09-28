"""Rebuild original-derived section assets from visually audited boundaries."""

from pathlib import Path
import csv
import json

from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
CATEGORIES = [
    "01-hero", "02-product", "03-scenarios", "04-in-the-box",
    "05-purchase", "06-benefits", "07-footer",
]

# Audited against the original long pages. Each tuple is [top, bottom).
RANGES = {
    1:  [0, 568, 832, 1135, 1438, 1751, 1920, 2032],
    2:  [0, 532, 860, 1137, 1460, 1723, 1814, 1931],
    3:  [0, 554, 853, 1136, 1431, 1776, 1922, 1983],
    4:  [0, 500, 822, 1108, 1333, 1636, 1728, 1815],
    5:  [0, 575, 905, 1166, 1383, 1693, 1833, 1913],
    6:  [0, 568, 967, 1326, 1599, 1863, 1930, 2108],
    7:  [0, 675, 965, 1238, 1474, 1753, 1819, 1875],
    8:  [0, 576, 867, 1150, 1461, 1778, 1965, 2167],
    12: [0, 509, 695, 876, 1064, 1306, 1453, 1536],
    13: [0, 511, 776, 986, 1155, 1340, 1425, 1536],
    14: [0, 608, 914, 1175, 1491, 1779, 1967, 2027],
    15: [0, 438, 660, 1376, 1612, 1810, 1966, 2036],
    16: [0, 459, 899, 1119, 1364, 1608, 1816, 1896],
}

# These versions contain independent replacement modules, so their remaining
# original-derived slices are audited independently instead of forced contiguous.
SPECIAL = {
    9: {
        "01-hero": (0, 407), "02-product": (407, 699),
        "03-scenarios": (699, 1031), "05-purchase": (1580, 1818),
        "06-benefits": (1818, 2028), "07-footer": (2028, 2103),
    },
    10: {
        "01-hero": (0, 515), "02-product": (515, 1004),
        "03-scenarios": (1004, 1209), "05-purchase": (1260, 1445),
        "07-footer": (1498, 1536),
    },
    11: {
        "01-hero": (0, 484), "02-product": (484, 692),
        "03-scenarios": (692, 927), "05-purchase": (1250, 1545),
        "06-benefits": (1545, 1857), "07-footer": (1857, 2048),
    },
}


def range_for(version, category):
    if version in SPECIAL:
        return SPECIAL[version].get(category)
    bounds = RANGES.get(version)
    if not bounds:
        return None
    index = CATEGORIES.index(category)
    return bounds[index], bounds[index + 1]


def write_app_data(rows):
    names = {row["category"]: row["category_name"] for row in rows}
    payload = json.dumps(rows, ensure_ascii=False, separators=(",", ":"))
    order = json.dumps(CATEGORIES, ensure_ascii=False)
    category_names = json.dumps(names, ensure_ascii=False)
    content = (
        "(function (root) {\n"
        f"const all={payload};\n"
        f"const categoryOrder={order};\n"
        f"const categoryNames={category_names};\n"
        "root.LUNEX_DATA = { all, categoryOrder, categoryNames };\n"
        "})(globalThis);\n"
    )
    (ROOT / "app-data.js").write_text(content, encoding="utf-8")


def main():
    manifest = ROOT / "manifest.csv"
    with manifest.open(encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle)
        fieldnames = reader.fieldnames
        rows = [
            row for row in reader
            if not (row["version"] == "6" and row["category"] == "06-benefits")
        ]

    changed = 0
    for row in rows:
        if not row["original"].startswith("originals/"):
            continue
        crop_range = range_for(int(row["version"]), row["category"])
        if crop_range is None:
            continue
        top, bottom = crop_range
        source = Image.open(ROOT / row["original"]).convert("RGB")
        crop = source.crop((0, top, source.width, bottom))
        crop.save(ROOT / row["file"], optimize=True)
        row.update({
            "width": str(crop.width), "height": str(crop.height),
            "source_top": str(top), "source_bottom": str(bottom),
        })
        changed += 1

    with manifest.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames, lineterminator="\n")
        writer.writeheader()
        writer.writerows(rows)
    write_app_data(rows)
    print(f"Rebuilt {changed} original-derived section assets.")


if __name__ == "__main__":
    main()
