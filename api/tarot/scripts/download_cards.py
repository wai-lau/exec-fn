"""One-shot card-image downloader.

Populates ``web/tarot/cards/<card_id>.jpg`` (78 files) and ``web/tarot/card_back.jpg``
from a public-domain Rider-Waite-Smith image set hosted on GitHub
(``krates98/tarotcardapi``).

Run once during implementation; commit the resulting JPEGs so deploy doesn't
need network at runtime.

    python -m tarot.scripts.download_cards          # from /app inside the container
    python api/tarot/scripts/download_cards.py      # or from the repo root

Idempotent: skips any card whose target file already exists.
"""
from __future__ import annotations

import subprocess
import sys
import tempfile
from pathlib import Path

from PIL import Image, ImageDraw

REPO_URL = "https://github.com/krates98/tarotcardapi"

SOURCE_NAMES: dict[str, str] = {
    "the_fool": "thefool.jpeg",
    "the_magician": "themagician.jpeg",
    "the_high_priestess": "thehighpriestess.jpeg",
    "the_empress": "theempress.jpeg",
    "the_emperor": "theemperor.jpeg",
    "the_hierophant": "thehierophant.jpeg",
    "the_lovers": "TheLovers.jpg",
    "the_chariot": "thechariot.jpeg",
    "strength": "thestrength.jpeg",
    "the_hermit": "thehermit.jpeg",
    "wheel_of_fortune": "wheeloffortune.jpeg",
    "justice": "justice.jpeg",
    "the_hanged_man": "thehangedman.jpeg",
    "death": "death.jpeg",
    "temperance": "temperance.jpeg",
    "the_devil": "thedevil.jpeg",
    "the_tower": "thetower.jpeg",
    "the_star": "thestar.jpeg",
    "the_moon": "themoon.jpeg",
    "the_sun": "thesun.jpeg",
    "judgement": "judgement.jpeg",
    "the_world": "theworld.jpeg",
}
for suit in ("cups", "wands", "swords", "pentacles"):
    for pip in ("ace", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"):
        SOURCE_NAMES[f"{pip}_of_{suit}"] = f"{pip}of{suit}.jpeg"
    for court in ("page", "knight", "queen", "king"):
        SOURCE_NAMES[f"{court}_of_{suit}"] = f"{court}of{suit}.jpeg"

assert len(SOURCE_NAMES) == 78, f"expected 78 mappings, got {len(SOURCE_NAMES)}"

MAX_WIDTH = 300


def _clone(target: Path) -> Path:
    images = target / "images"
    if images.exists() and any(images.iterdir()):
        return images
    subprocess.run(
        ["git", "clone", "--depth", "1", REPO_URL, str(target)],
        check=True,
    )
    return images


def _convert_one(source: Path, dest: Path) -> None:
    with Image.open(source) as img:
        img = img.convert("RGB")
        if img.width > MAX_WIDTH:
            ratio = MAX_WIDTH / img.width
            img = img.resize((MAX_WIDTH, int(img.height * ratio)), Image.LANCZOS)
        img.save(dest, "JPEG", quality=85, optimize=True, progressive=True)


def _make_card_back(dest: Path) -> None:
    import math
    w, h = 300, 510
    img = Image.new("RGB", (w, h), (24, 36, 58))
    draw = ImageDraw.Draw(img)
    border = (180, 150, 90)
    draw.rectangle([4, 4, w - 5, h - 5], outline=border, width=2)
    draw.rectangle([14, 14, w - 15, h - 15], outline=border, width=1)
    cx, cy = w // 2, h // 2
    for r in (110, 80, 50, 20):
        draw.ellipse([cx - r, cy - r, cx + r, cy + r], outline=border, width=1)
    for i in range(8):
        angle = i * math.pi / 4
        x1 = cx + 20 * math.cos(angle)
        y1 = cy + 20 * math.sin(angle)
        x2 = cx + 110 * math.cos(angle)
        y2 = cy + 110 * math.sin(angle)
        draw.line([(x1, y1), (x2, y2)], fill=border, width=1)
    img.save(dest, "JPEG", quality=88, optimize=True, progressive=True)


def main() -> int:
    repo_root = Path(__file__).resolve().parents[3]
    dest_dir = repo_root / "web" / "tarot" / "cards"
    back_path = repo_root / "web" / "tarot" / "card_back.jpg"
    dest_dir.mkdir(parents=True, exist_ok=True)

    with tempfile.TemporaryDirectory() as tmp:
        images_dir = _clone(Path(tmp))

        missing: list[str] = []
        downloaded = 0
        skipped = 0
        for card_id, src_name in SOURCE_NAMES.items():
            target = dest_dir / f"{card_id}.jpg"
            if target.exists():
                skipped += 1
                continue
            source = images_dir / src_name
            if not source.exists():
                missing.append(f"{card_id} -> {src_name}")
                continue
            _convert_one(source, target)
            downloaded += 1

        if missing:
            print("MISSING source files:")
            for m in missing:
                print(f"  {m}")
            return 1

        if back_path.exists():
            print(f"{downloaded} cards downloaded, {skipped} already present, card_back.jpg already present")
        else:
            _make_card_back(back_path)
            print(f"{downloaded} cards downloaded, {skipped} already present, card_back.jpg generated")

    return 0


if __name__ == "__main__":
    sys.exit(main())
