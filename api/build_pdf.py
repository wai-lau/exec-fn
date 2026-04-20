import json
from datetime import date
from reportlab.lib.pagesizes import A5
from reportlab.lib.units import mm
from reportlab.lib import colors
from reportlab.pdfgen import canvas

OUT_PDF = "/app/data/WAI.pdf"
W, H = A5

MARGIN    = 14 * mm
LINE_H    = 9  * mm
SECTION_H = 12 * mm
GAP       = 5  * mm
BOX_SIZE  = 3.5 * mm

FONT_TITLE   = "Helvetica-Bold"
FONT_SECTION = "Helvetica-Bold"
FONT_ITEM    = "Helvetica"
SIZE_TITLE   = 11
SIZE_SECTION = 9
SIZE_ITEM    = 8


def _wrap(text, font, size, max_w):
    from reportlab.pdfbase.pdfmetrics import stringWidth
    words = text.split()
    lines, cur = [], ""
    for w in words:
        test = (cur + " " + w).strip()
        if stringWidth(test, font, size) <= max_w:
            cur = test
        else:
            if cur:
                lines.append(cur)
            cur = w
    if cur:
        lines.append(cur)
    return lines or [""]


def draw_directives_page(c, directives, events):
    LH   = 5.0 * mm
    SH   = 4.2 * mm
    SECH = 5.5 * mm
    GAP  = 1.2 * mm
    IND  = 4   * mm
    CW   = W - 2 * MARGIN

    def sec_header(y, label):
        c.setFont(FONT_SECTION, SIZE_SECTION - 1)
        c.setFillColor(colors.HexColor("#222222"))
        c.drawString(MARGIN, y, label)
        y -= LH * 0.35
        c.setStrokeColor(colors.HexColor("#cccccc"))
        c.setLineWidth(0.4)
        c.line(MARGIN, y, W - MARGIN, y)
        return y - LH * 0.65

    def draw_flat_list(y, items):
        for item in items:
            title = item["title"] if isinstance(item, dict) else item
            if y < MARGIN + SH:
                break
            c.setFont(FONT_ITEM, SIZE_ITEM - 1)
            c.setFillColor(colors.HexColor("#444444"))
            for ln in _wrap(title, FONT_ITEM, SIZE_ITEM - 1, CW - IND):
                if y < MARGIN + SH:
                    break
                c.drawString(MARGIN + IND, y, ln)
                y -= SH
        return y

    def draw_task_list(y, items):
        for item in items:
            if y < MARGIN + LH * 2:
                break
            title = item["title"] if isinstance(item, dict) else item
            steps = item.get("steps", []) if isinstance(item, dict) else []
            c.setFont(FONT_SECTION, SIZE_ITEM)
            c.setFillColor(colors.black)
            title_lines = _wrap(title, FONT_SECTION, SIZE_ITEM, CW)
            for i, ln in enumerate(title_lines):
                if y < MARGIN + LH:
                    break
                c.drawString(MARGIN, y, ln)
                y -= LH * 0.85 if i < len(title_lines) - 1 else SH
            for step in steps:
                if y < MARGIN + SH:
                    break
                c.setFont(FONT_ITEM, SIZE_ITEM - 1)
                c.setFillColor(colors.HexColor("#444444"))
                for ln in _wrap(step, FONT_ITEM, SIZE_ITEM - 1, CW - IND):
                    if y < MARGIN + SH:
                        break
                    c.drawString(MARGIN + IND, y, ln)
                    y -= SH
            y -= 0.8 * mm
        return y

    y = H - MARGIN
    c.setFont(FONT_TITLE, SIZE_TITLE + 2)
    c.setFillColor(colors.black)
    c.drawString(MARGIN, y, "DIRECTIVES FROM YOUR AI OVERLORD")
    y -= LH
    c.setFont(FONT_ITEM, SIZE_ITEM)
    c.setFillColor(colors.HexColor("#666666"))
    c.drawString(MARGIN, y, date.today().strftime("%A, %B %-d, %Y"))
    y -= SECH

    y = sec_header(y, "SEEK")
    y = draw_flat_list(y, directives.get("seek") or [])
    y -= GAP

    y = sec_header(y, "HACK")
    y = draw_flat_list(y, directives.get("hack") or [])
    y -= GAP

    y = sec_header(y, "DIVE")
    y = draw_task_list(y, directives.get("dive") or [])
    y -= GAP

    if events and y > MARGIN + LH * 2:
        y = sec_header(y, "OMENS")
        for e in events[:4]:
            if y < MARGIN + LH:
                break
            text = f"{e.get('title', '')} — {e.get('date', '')}"
            c.setFont(FONT_ITEM, SIZE_ITEM)
            c.setFillColor(colors.black)
            for ln in _wrap(text, FONT_ITEM, SIZE_ITEM, W - 2 * MARGIN):
                if y < MARGIN + LH:
                    break
                c.drawString(MARGIN, y, ln)
                y -= LH

    return y


def draw_encouragement(c, delta: dict, message: str, y: float):
    CW = W - 2 * MARGIN
    LH = 4.5 * mm
    SH = 3.8 * mm
    FOOTER_Y = MARGIN

    delta_text = " ".join(filter(None, [delta.get("wai_notes", ""), delta.get("adjustments", "")])).strip()
    if not delta_text and not message:
        return
    if y < FOOTER_Y + LH * 4:
        return

    y -= 4 * mm
    c.setStrokeColor(colors.HexColor("#cccccc"))
    c.setLineWidth(0.3)
    c.line(MARGIN, y, W - MARGIN, y)
    y -= 3 * mm

    if delta_text:
        c.setFont(FONT_SECTION, SIZE_ITEM - 1)
        c.setFillColor(colors.HexColor("#555555"))
        c.drawString(MARGIN, y, "YESTERDAY")
        y -= LH
        c.setFont(FONT_ITEM, SIZE_ITEM - 1)
        c.setFillColor(colors.HexColor("#444444"))
        for ln in _wrap(delta_text, FONT_ITEM, SIZE_ITEM - 1, CW):
            if y < FOOTER_Y:
                break
            c.drawString(MARGIN, y, ln)
            y -= SH
        y -= 2 * mm

    if message and y > FOOTER_Y + LH * 2:
        c.setFont(FONT_SECTION, SIZE_ITEM - 1)
        c.setFillColor(colors.HexColor("#555555"))
        c.drawString(MARGIN, y, "ENCOURAGEMENT")
        y -= LH
        c.setFont(FONT_ITEM, SIZE_ITEM - 1)
        c.setFillColor(colors.HexColor("#444444"))
        for ln in _wrap(message, FONT_ITEM, SIZE_ITEM - 1, CW):
            if y < FOOTER_Y:
                break
            c.drawString(MARGIN, y, ln)
            y -= SH


def build(out_path=None):
    out = out_path or OUT_PDF
    try:
        with open("/app/data/directives.json") as f:
            directives = json.load(f)
    except FileNotFoundError:
        directives = {}
    try:
        with open("/app/data/omens.json") as f:
            omens = json.load(f)
    except FileNotFoundError:
        omens = {"events": []}
    try:
        with open("/app/data/delta.json") as f:
            delta = json.load(f)
    except FileNotFoundError:
        delta = {}

    c = canvas.Canvas(out, pagesize=A5)
    y = draw_directives_page(c, directives, omens.get("events", []))
    draw_encouragement(c, delta, directives.get("encouraging_message", ""), y)
    c.showPage()
    c.save()
    print(f"Wrote {out}")


if __name__ == "__main__":
    build()
