import zipfile, json, io
import rmscene.scene_stream as ss
from PIL import Image, ImageDraw, ImageFont

RM_W, RM_H = 1404, 1872
FONT_REGULAR = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
FONT_BOLD = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
LINE_HEIGHT_HEADING = 72
LINE_HEIGHT_BODY = 52
FONT_SIZE_HEADING = 48
FONT_SIZE_BODY = 36


def extract_text_lines(root_text_block):
    items = root_text_block.value.items
    result = []
    in_heading = False
    current_line = ""
    for v in items.values():
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


def rasterize(rmdoc_path: str, page_index: int = 0) -> bytes:
    with zipfile.ZipFile(rmdoc_path) as z:
        names = z.namelist()
        uid = [f for f in names if f.endswith(".content")][0].replace(".content", "")
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

        # try to use embedded PDF as background
        bg = None
        pdf_files = [f for f in names if f.lower().endswith(".pdf")]
        if pdf_files:
            try:
                import fitz
                pdf_bytes = z.read(pdf_files[0])
                doc = fitz.open(stream=pdf_bytes, filetype="pdf")
                pg = doc[min(page_index, len(doc) - 1)]
                # reMarkable fits PDFs to page height, centering horizontally
                scale = min(RM_W / pg.rect.width, RM_H / pg.rect.height)
                pix = pg.get_pixmap(matrix=fitz.Matrix(scale, scale))
                bg_img = Image.frombytes("RGB", [pix.width, pix.height], pix.samples)
                x_start = (RM_W - bg_img.width) // 2
                canvas_h = max(bg_img.height, RM_H)
                bg = Image.new("RGB", (RM_W, canvas_h), "white")
                bg.paste(bg_img, (x_start, 0))
            except Exception:
                bg = None

        # fall back to text rendering for native notebooks
        if bg is None:
            bg = Image.new("RGB", (RM_W, RM_H), "white")
            draw_bg = ImageDraw.Draw(bg)
            font_heading = ImageFont.truetype(FONT_BOLD, FONT_SIZE_HEADING)
            font_body = ImageFont.truetype(FONT_REGULAR, FONT_SIZE_BODY)
            rm_path = f"{uid}/{page_id}.rm"
            if rm_path in names:
                with z.open(rm_path) as f:
                    blocks = list(ss.read_blocks(f))
                text_start_y = None
                for b in blocks:
                    if isinstance(b, ss.RootTextBlock):
                        pos_y = getattr(b.value, "pos_y", 0) or 0
                        pos_x = getattr(b.value, "pos_x", 0) or 0
                        if text_start_y is None:
                            text_start_y = pos_y
                        x = int(RM_W / 2 + pos_x)
                        y = int(pos_y)
                        for text, is_heading in extract_text_lines(b):
                            if not text.strip():
                                y += 20
                                continue
                            if is_heading:
                                draw_bg.text((x, y), text, fill="black", font=font_heading)
                                y += LINE_HEIGHT_HEADING
                            else:
                                draw_bg.text((x + 30, y), f"• {text}", fill="#333333", font=font_body)
                                y += LINE_HEIGHT_BODY

        # collect strokes
        strokes = []
        rm_path = f"{uid}/{page_id}.rm"
        if rm_path in names:
            with z.open(rm_path) as f:
                for b in ss.read_blocks(f):
                    if isinstance(b, ss.SceneLineItemBlock):
                        item = b.item.value
                        if item and hasattr(item, "points") and item.points:
                            strokes.append([(p.x, p.y) for p in item.points])

        # detect center-origin coordinates (x ranges around 0) vs left-origin (x >= 0)
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
    rmdoc = sys.argv[1] if len(sys.argv) > 1 else "/app/data/executive_wai.rmdoc"
    out = sys.argv[2] if len(sys.argv) > 2 else "/app/data/executive_wai.png"
    data = rasterize(rmdoc)
    with open(out, "wb") as f:
        f.write(data)
    print(f"wrote {len(data)} bytes to {out}")
