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


def rmdoc_to_image(rmdoc_path: str, page_index: int = None) -> bytes:
    with zipfile.ZipFile(rmdoc_path) as z:
        uid = [f for f in z.namelist() if f.endswith(".content")][0].replace(".content", "")
        content = json.loads(z.read(f"{uid}.content"))
        pages = content["cPages"]["pages"]
        if page_index is not None:
            pages = [pages[page_index]]

        all_text_lines = []
        all_strokes = []
        text_start_y = None
        raw_strokes = []

        for page in pages:
            page_id = page["id"]
            rm_path = f"{uid}/{page_id}.rm"
            if rm_path not in z.namelist():
                continue
            with z.open(rm_path) as f:
                blocks = list(ss.read_blocks(f))
            for b in blocks:
                if isinstance(b, ss.RootTextBlock):
                    pos_y = getattr(b.value, "pos_y", 0) or 0
                    pos_x = getattr(b.value, "pos_x", 0) or 0
                    if text_start_y is None:
                        text_start_y = pos_y
                    text_x = int((RM_W / 2) + pos_x)
                    all_text_lines.append((text_x, pos_y, extract_text_lines(b)))
                elif isinstance(b, ss.SceneLineItemBlock):
                    item = b.item.value
                    if item and hasattr(item, "points") and item.points:
                        raw_strokes.append([(p.x, p.y) for p in item.points])

        y_offset = text_start_y if text_start_y is not None else 0
        all_strokes = [[(x, y + y_offset) for x, y in pts] for pts in raw_strokes]

    # figure out total canvas height needed
    total_text_height = 0
    for _, start_y, lines in all_text_lines:
        h = int(start_y)
        for _, is_heading in lines:
            h += LINE_HEIGHT_HEADING if is_heading else LINE_HEIGHT_BODY
        total_text_height = max(total_text_height, h)

    stroke_max_y = max((max(p[1] for p in s) for s in all_strokes), default=0)
    canvas_h = int(max(total_text_height, stroke_max_y) + 100)

    img = Image.new("RGB", (RM_W, canvas_h), "white")
    draw = ImageDraw.Draw(img)
    font_heading = ImageFont.truetype(FONT_BOLD, FONT_SIZE_HEADING)
    font_body = ImageFont.truetype(FONT_REGULAR, FONT_SIZE_BODY)

    # draw text
    for text_x, start_y, lines in all_text_lines:
        y = int(start_y)
        for text, is_heading in lines:
            if not text.strip():
                y += 20
                continue
            if is_heading:
                draw.text((text_x, y), text, fill="black", font=font_heading)
                y += LINE_HEIGHT_HEADING
            else:
                draw.text((text_x + 30, y), f"• {text}", fill="#333333", font=font_body)
                y += LINE_HEIGHT_BODY

    # draw strokes
    for pts in all_strokes:
        if len(pts) < 2:
            continue
        coords = [(p[0], p[1]) for p in pts]
        draw.line(coords, fill="black", width=3)

    # scale down 50% for reasonable file size
    out_w, out_h = RM_W // 2, canvas_h // 2
    img = img.resize((out_w, out_h), Image.LANCZOS)

    buf = io.BytesIO()
    img.save(buf, format="PNG", optimize=True)
    return buf.getvalue()


if __name__ == "__main__":
    import sys
    rmdoc = sys.argv[1] if len(sys.argv) > 1 else "/tmp/executive_wai.rmdoc"
    out = sys.argv[2] if len(sys.argv) > 2 else "/tmp/executive_wai.png"
    data = rmdoc_to_image(rmdoc)
    with open(out, "wb") as f:
        f.write(data)
    print(f"wrote {len(data)} bytes to {out}")
