import zipfile, json, io
import rmscene.scene_stream as ss
from PIL import Image, ImageDraw, ImageFont

RM_W, RM_H = 1404, 1872
FONT_REGULAR = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
FONT_BOLD    = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
FONT_SIZE_HEADING = 48
FONT_SIZE_BODY    = 36
LINE_HEIGHT_HEADING = 72
LINE_HEIGHT_BODY    = 52


def _extract_text_lines(root_text_block) -> list[tuple[str, bool]]:
    """Return [(text, is_heading), ...] from a RootTextBlock."""
    result = []
    in_heading = False
    current_line = ""

    for v in root_text_block.value.items.values():
        if v == 1:
            in_heading = True
        elif v == 2:
            in_heading = False
        elif isinstance(v, str):
            parts = v.split("\n")
            for i, part in enumerate(parts):
                current_line += part
                if i < len(parts) - 1:
                    result.append((current_line, in_heading))
                    current_line = ""
                    in_heading = False

    if current_line:
        result.append((current_line, in_heading))
    return result


def _read_rm_blocks(z: zipfile.ZipFile, uid: str, page_id: str) -> list:
    rm_path = f"{uid}/{page_id}.rm"
    if rm_path not in z.namelist():
        return []
    with z.open(rm_path) as f:
        return list(ss.read_blocks(f))


def _render_pdf_background(z: zipfile.ZipFile, page_index: int) -> Image.Image | None:
    pdf_files = [f for f in z.namelist() if f.lower().endswith(".pdf")]
    if not pdf_files:
        return None
    try:
        import fitz
        pdf_bytes = z.read(pdf_files[0])
        doc = fitz.open(stream=pdf_bytes, filetype="pdf")
        pg = doc[min(page_index, len(doc) - 1)]
        scale = min(RM_W / pg.rect.width, RM_H / pg.rect.height)
        pix = pg.get_pixmap(matrix=fitz.Matrix(scale, scale))
        bg_img = Image.frombytes("RGB", [pix.width, pix.height], pix.samples)
        x_start = (RM_W - bg_img.width) // 2
        canvas = Image.new("RGB", (RM_W, max(bg_img.height, RM_H)), "white")
        canvas.paste(bg_img, (x_start, 0))
        return canvas
    except Exception:
        return None


def _render_text_background(blocks: list) -> Image.Image:
    bg = Image.new("RGB", (RM_W, RM_H), "white")
    draw = ImageDraw.Draw(bg)
    font_heading = ImageFont.truetype(FONT_BOLD, FONT_SIZE_HEADING)
    font_body    = ImageFont.truetype(FONT_REGULAR, FONT_SIZE_BODY)

    for block in blocks:
        if not isinstance(block, ss.RootTextBlock):
            continue
        pos_x = getattr(block.value, "pos_x", 0) or 0
        pos_y = getattr(block.value, "pos_y", 0) or 0
        x, y = int(RM_W / 2 + pos_x), int(pos_y)
        for text, is_heading in _extract_text_lines(block):
            if not text.strip():
                y += 20
                continue
            if is_heading:
                draw.text((x, y), text, fill="black", font=font_heading)
                y += LINE_HEIGHT_HEADING
            else:
                draw.text((x + 30, y), f"• {text}", fill="#333333", font=font_body)
                y += LINE_HEIGHT_BODY

    return bg


def rasterize(rmdoc_path: str, page_index: int = 0) -> bytes:
    with zipfile.ZipFile(rmdoc_path) as z:
        uid = [f for f in z.namelist() if f.endswith(".content")][0].replace(".content", "")
        content = json.loads(z.read(f"{uid}.content"))

        if "cPages" in content:
            pages = content["cPages"].get("pages") or []
        else:
            raw = content.get("pages") or []
            pages = [{"id": p} for p in raw] if raw and isinstance(raw[0], str) else raw

        if not pages:
            buf = io.BytesIO()
            Image.new("RGB", (RM_W // 2, RM_H // 2), "white").save(buf, format="PNG")
            return buf.getvalue()

        page = pages[min(page_index, len(pages) - 1)]
        page_id = page["id"] if isinstance(page, dict) else page

        # Single pass over the .rm file — collect text blocks and strokes together
        blocks = _read_rm_blocks(z, uid, page_id)

        strokes = [
            [(p.x, p.y) for p in b.item.value.points]
            for b in blocks
            if isinstance(b, ss.SceneLineItemBlock)
            and b.item.value and hasattr(b.item.value, "points") and b.item.value.points
        ]

        bg = _render_pdf_background(z, page_index) or _render_text_background(blocks)

    # Detect center-origin (x around 0) vs left-origin (x >= 0) coordinate system
    all_pts = [p for s in strokes for p in s]
    x_offset = RM_W // 2 if all_pts and min(p[0] for p in all_pts) < -10 else 0

    draw = ImageDraw.Draw(bg)
    for pts in strokes:
        if len(pts) >= 2:
            draw.line([(p[0] + x_offset, p[1]) for p in pts], fill="black", width=4)

    img = bg.resize((RM_W // 2, bg.height // 2), Image.LANCZOS)
    buf = io.BytesIO()
    img.save(buf, format="PNG", optimize=True)
    return buf.getvalue()


if __name__ == "__main__":
    import sys
    if len(sys.argv) < 3:
        print("usage: rm_to_pdf.py <input.rmdoc> <output.png>")
        sys.exit(1)
    data = rasterize(sys.argv[1])
    with open(sys.argv[2], "wb") as f:
        f.write(data)
    print(f"wrote {len(data)} bytes to {sys.argv[2]}")
