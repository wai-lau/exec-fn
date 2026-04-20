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
SIZE_TITLE   = 14
SIZE_SECTION = 12
SIZE_ITEM    = 10

TYPE_COLORS = {
    "seek":  "#888888",
    "hack":  "#444444",
    "dive":  "#111111",
    "break": "#aaaaaa",
}


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


def draw_schedule_page(c, plan, events):
    LH   = 6.5 * mm
    SH   = 5.5 * mm
    SECH = 7.2 * mm
    GAP  = 1.6 * mm
    TIME_W = 18 * mm
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

    y = H - MARGIN
    c.setFont(FONT_TITLE, SIZE_TITLE + 2)
    c.setFillColor(colors.black)
    c.drawString(MARGIN, y, "DIRECTIVES FROM YOUR AI OVERLORD")
    y -= LH
    c.setFont(FONT_ITEM, SIZE_ITEM)
    c.setFillColor(colors.HexColor("#666666"))
    c.drawString(MARGIN, y, date.today().strftime("%A, %B %-d, %Y"))
    y -= SECH

    schedule = plan.get("schedule") or []
    if schedule:
        y = sec_header(y, "SCHEDULE")
        task_w = CW - TIME_W - 2 * mm
        for entry in schedule:
            if y < MARGIN + SH:
                break
            t = entry.get("time", "")
            task = entry.get("task", "")
            typ = entry.get("type", "seek")
            col = TYPE_COLORS.get(typ, "#444444")
            font = FONT_SECTION if typ == "dive" else FONT_ITEM

            task_lines = _wrap(task, font, SIZE_ITEM, task_w)
            block_h = len(task_lines) * SH

            if y - block_h < MARGIN:
                break

            c.setFont(FONT_ITEM, SIZE_ITEM - 1)
            c.setFillColor(colors.HexColor("#888888"))
            c.drawString(MARGIN, y, t)

            c.setFont(font, SIZE_ITEM)
            c.setFillColor(colors.HexColor(col))
            for i, ln in enumerate(task_lines):
                c.drawString(MARGIN + TIME_W, y - i * SH, ln)

            y -= block_h
        y -= GAP

    if events and y > MARGIN + LH * 2:
        y = sec_header(y, "OMENS")
        for e in events[:4]:
            if y < MARGIN + LH:
                break
            text = f"{e.get('title', '')} — {e.get('date', '')}"
            c.setFont(FONT_ITEM, SIZE_ITEM)
            c.setFillColor(colors.black)
            for ln in _wrap(text, FONT_ITEM, SIZE_ITEM, CW):
                if y < MARGIN + LH:
                    break
                c.drawString(MARGIN, y, ln)
                y -= LH

    return y


def draw_encouragement(c, message: str, y: float):
    CW = W - 2 * MARGIN
    LH = 5.9 * mm
    SH = 4.9 * mm
    FOOTER_Y = MARGIN

    if not message:
        return
    if y < FOOTER_Y + LH * 4:
        return

    y -= 4 * mm
    c.setStrokeColor(colors.HexColor("#cccccc"))
    c.setLineWidth(0.3)
    c.line(MARGIN, y, W - MARGIN, y)
    y -= 3 * mm

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
    plan = {}
    for src in ("/app/data/plan.json", "/app/data/directives.json"):
        try:
            with open(src) as f:
                plan = json.load(f)
            break
        except FileNotFoundError:
            pass
    events = plan.get("omens", None)
    if events is None:
        try:
            with open("/app/data/omens.json") as f:
                events = json.load(f).get("events", [])
        except FileNotFoundError:
            events = []
    c = canvas.Canvas(out, pagesize=A5)
    y = draw_schedule_page(c, plan, events)
    draw_encouragement(c, plan.get("encouraging_message", ""), y)
    c.showPage()
    c.save()
    print(f"Wrote {out}")


if __name__ == "__main__":
    build()
