#!/bin/bash
OUT=/exec-fn/web/mtg-cards
LOG=/exec-fn/download_mtg_images.log
BULK_URL="https://data.scryfall.io/unique-artwork/unique-artwork-20260429090335.json"

mkdir -p "$OUT"
echo "[$(date)] Starting download" > "$LOG"

echo "[$(date)] Fetching bulk JSON..." >> "$LOG"
curl -s "$BULK_URL" -o /tmp/unique-artwork.json
echo "[$(date)] Bulk JSON downloaded, parsing..." >> "$LOG"

python3 - <<'EOF' >> "$LOG" 2>&1
import json, os, urllib.request, time

OUT = "/exec-fn/web/mtg-cards"
data = json.load(open("/tmp/unique-artwork.json"))
total = len(data)
done = skipped = failed = 0

for i, card in enumerate(data):
    oracle_id = card.get("oracle_id")
    if not oracle_id:
        continue
    img_uri = (card.get("image_uris") or {}).get("normal")
    if not img_uri and card.get("card_faces"):
        img_uri = (card["card_faces"][0].get("image_uris") or {}).get("normal")
    if not img_uri:
        continue
    dest = os.path.join(OUT, oracle_id + ".jpg")
    if os.path.exists(dest):
        skipped += 1
        continue
    try:
        urllib.request.urlretrieve(img_uri, dest)
        done += 1
    except Exception as ex:
        failed += 1
        print(f"FAIL {card.get('name')}: {ex}")
    if (i + 1) % 500 == 0:
        print(f"Progress: {i+1}/{total} — done={done} skipped={skipped} failed={failed}")

print(f"Done. total={total} done={done} skipped={skipped} failed={failed}")
EOF

echo "[$(date)] Finished" >> "$LOG"
