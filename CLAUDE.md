# exec-fn

Personal automation system designed to support executive function (ADHD scaffolding).

## Architecture

- **Droplet**: DigitalOcean NYC1, reserved IP 168.144.13.51, domain wai-lau.net
- **nginx**: bare-metal, handles SSL termination, proxies to Docker on port 8080
- **FastAPI**: serves static files and will handle pipeline API endpoints
- **Docker**: single container locally and on Droplet, same compose file

## Stack

- Python / FastAPI
- Docker / docker-compose
- nginx (bare-metal on Droplet only)

## Project structure

exec-fn/
  web/         # static frontend
  api/         # FastAPI backend
  CLAUDE.md

## Local dev

docker compose up --build
Hit localhost:8080

## Deploy

SSH into root@wai-lau.net
cd /exec-fn
git pull
docker compose up -d --build

## Roadmap

### Phase 1 - reMarkable pipeline
- Poll reMarkable cloud via rmapi for new documents in a specific folder
- When detected, pull PDF, send to Claude API for task extraction and prioritization
- Generate a task breakdown PDF, push back to reMarkable

### Phase 2 - Voice conversation
- When prioritization is complex, user opens voice conversation with Claude
- Summary gets committed to server when user is happy
- Server generates task breakdown and pushes to reMarkable

## Notes

- User is on WSL, paths like /mnt/c/Users/wailu/
- Anthropic API key will be in .env

## reMarkable Integration

### Tools
- **ddvk/rmapi v0.0.32** — the only working CLI tool as of Apr 2026. `juruen/rmapi` is dead (410 Gone). Installed in Docker container via tar.gz from GitHub releases (`rmapi-linux-amd64.tar.gz`).
- rmapi talks to reMarkable cloud over HTTPS — works anywhere, not just local network.
- Auth stored in Docker named volume `rmapi-auth` at `/root/.config/rmapi`. Re-auth required on Droplet separately.
- No locking — "last write wins". Don't upload while the notebook is open on the device.

### Uploading back to reMarkable
- `rmapi put <file>.rmdoc` — creates new document
- `rmapi put --force <file>.rmdoc` — replaces existing document with same name
- Cannot update an existing document by UUID — must use a new UUID and new `visibleName`, or `--force` on same name
- Set `metadata["new"] = True` when packaging a new rmdoc for upload

### .rmdoc format
- ZIP archive containing: `{uid}.content`, `{uid}.metadata`, `{uid}/{page_id}.rm`
- `.rm` files are reMarkable v6 binary format, parsed/written with `rmscene`
- `write_blocks(file_obj, blocks)` — note arg order (file first)

### rmscene imports
- `ParagraphStyle`, `Text` (the class used as RootTextBlock.value) → `from rmscene.scene_items import ParagraphStyle, Text`
- `TextDocument`, `Paragraph`, `CrdtStr` are a newer higher-level API in `rmscene.text` — not used for raw block construction
- Do NOT import from `rmscene.text` for block writing — use `scene_items` and `crdt_sequence` directly

### rmscene (Python)
- Use `git+https://github.com/ricklupton/rmscene.git` (v0.8.1.dev0) — PyPI 0.8.0 has same limitations
- "Some data has not been read" warning = PathItemBlock (ITEM_TYPE 0x04) not yet supported — newer stroke format
- `read_blocks(f)` → list of blocks
- `RootTextBlock` — contains typed text. Has `.value` (Text object) with `.items` (CrdtSequence), `.styles`, `.pos_x`, `.pos_y`, `.width`
- `CrdtSequence._items` — internal dict, directly mutable for filtering/rebuilding
- `CrdtSequence.values()` — yields text values in order (ints 1/2 for heading markers, strings for text)
- `CrdtSequence.sequence_items()` — yields `CrdtSequenceItem` objects in order
- `SceneLineItemBlock` — handwritten strokes. `.item.value.points` = list of Points with `.x`, `.y`
- `TreeNodeBlock` — layer definitions. `.group.label.value` = layer name (e.g. "Ink", "AI", "Wai")

### ParagraphStyle enum
- BASIC=0, PLAIN=1, HEADING=2, BOLD=3, BULLET=4, BULLET2=5, CHECKBOX=6, CHECKBOX_CHECKED=7
- Styles dict maps `predecessor_CrdtId → LwwValue(timestamp, ParagraphStyle)`
- `CrdtId(0,0)` as key = style for the first paragraph

### Coordinate system
- reMarkable page: 1404 × 1872 px
- **Stroke coords**: x=0 is LEFT edge (0–1404) in some notebooks, x=0 is PAGE CENTER (-702 to +702) in others (e.g. EXEC template). Check stroke x range to determine.
- **RootTextBlock pos_x**: offset from page center. `pos_x=-468, width=936` = full page width
- **RootTextBlock pos_y**: from top of page (absolute)
- Stroke y coords in typed notebooks are relative to the text block's `pos_y` (not absolute page coords)
- `verticalScroll` in cPages.pages is NOT needed for stroke positioning — strokes relative to text origin

### rmscene firmware compatibility
- Newer reMarkable firmware uses non-zero `block_id` in `RootTextBlock`. The assertion `assert block_id == CrdtId(0, 0)` in `rmscene/scene_stream.py` will crash on these files.
- Fix: after `pip install`, patch it out via sed in Dockerfile:
  ```dockerfile
  RUN pip install -r requirements.txt && \
      sed -i 's/        assert block_id == CrdtId(0, 0)/        # assert block_id == CrdtId(0, 0)  # relaxed: firmware changed this/' \
      /usr/local/lib/python3.12/site-packages/rmscene/scene_stream.py
  ```
- After the fix, blocks that were `UnreadableBlock` become parseable `RootTextBlock` objects.
- "Unrecognised text format code 8" warning = newer firmware data format, not fixable, reading still works.

### Writing text to reMarkable via rmscene — DOES NOT WORK RELIABLY
- Writing custom `RootTextBlock` via rmscene produces truncated text and wrong paragraph styles in the reMarkable desktop app and device. The round-trip in rmscene itself looks fine.
- Root cause: unclear, likely CRDT merge behavior when multiple RootTextBlocks are present is incompatible with rmscene's output.
- **Do not attempt this approach.** Use PDF instead.

### PDF approach (working solution)
- Generate an A5 PDF using `reportlab`, upload with `rmapi put --force WAI.pdf`.
- reMarkable renders PDFs natively and perfectly.
- `build_pdf.py` generates a 2-page A5 PDF:
  - Page 1: daily tasks + reminders from `data/daily.json`
  - Page 2: future projects in 2-column layout from `data/future_projects.json`
- `daily.json` sections support: `hide_title: true` (omit section heading), `bullets: true` (bullet points instead of checkboxes)
- Text wrapping in columns uses `reportlab.pdfbase.pdfmetrics.stringWidth`
- Run: `docker compose exec api python3 build_pdf.py` then `docker compose exec api rmapi put --force /app/data/WAI.pdf`

### EXEC notebook structure (as of Apr 2026)
- Page 0: 4 layers: Ink, AI, Wai (plus unnamed base). Left column = active quests (y=109–1293) + reminders (y=1344–1812). Center-origin coords.
- Page 1: 3 layers: AI, Wai (plus unnamed base). FUTURE PROJECTS content page, full width, blank.
- AI layer approach abandoned — rmscene text writing unreliable (see above).
- **WAI.pdf** is the primary AI-generated document. Uploaded separately via `rmapi put --force`.
- "EXEC (AI)" rmdoc approach is no longer used.

### Rendering .rmdoc to PNG
- `rm_to_pdf.py` in `/app` — renders strokes + text to PNG using Pillow
- Stroke y offset = text block's `pos_y` (add to raw stroke y to get page coords)
- Center-origin stroke coords need `x + 702` offset if rendering to a left-origin canvas

## Droplet Setup

OS: Ubuntu 24.04, DigitalOcean NYC1, reserved IP 168.144.13.51

### Installed packages
- nginx (bare-metal, handles SSL termination and proxies to Docker on 8080)
- certbot + python3-certbot-nginx (SSL certs for wai-lau.net, auto-renews)
- fail2ban (brute force protection)
- docker.io + docker-compose-plugin (from Docker's official apt repo)

### Docker apt repo
Added to /etc/apt/sources.list.d/docker.list via Docker's official GPG key

### nginx config
- HTTP (80) redirects to HTTPS
- HTTPS (443) proxies to localhost:8080
- Certs at /etc/letsencrypt/live/wai-lau.net/

### Security
- PasswordAuthentication disabled in /etc/ssh/sshd_config
- fail2ban active

### Services that start on boot
- nginx
- fail2ban
- docker
