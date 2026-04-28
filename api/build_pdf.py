import json
from datetime import date
from pathlib import Path
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


def _draw_sec_header(c, y, label, lh):
    c.setFont(FONT_SECTION, SIZE_SECTION - 1)
    c.setFillColor(colors.HexColor("#222222"))
    c.drawString(MARGIN, y, label)
    y -= lh * 0.35
    c.setStrokeColor(colors.HexColor("#cccccc"))
    c.setLineWidth(0.4)
    c.line(MARGIN, y, W - MARGIN, y)
    return y - lh * 0.65


def _draw_schedule_section(c, schedule, y, lh, sh, gap, time_indent, task_w):
    y = _draw_sec_header(c, y, "SCHEDULE", lh)
    for entry in schedule:
        if y < MARGIN + sh:
            break
        t = entry.get("time", "")
        task = entry.get("title") or entry.get("task", "")
        task_lines = _wrap(task, FONT_ITEM, SIZE_ITEM, task_w)
        if y - len(task_lines) * sh < MARGIN:
            break
        c.setFont(FONT_ITEM, SIZE_ITEM)
        c.setFillColor(colors.HexColor("#888888"))
        c.drawString(MARGIN, y, t)
        c.setFillColor(colors.HexColor("#222222"))
        for ln in task_lines:
            c.drawString(MARGIN + time_indent, y, ln)
            y -= sh
    return y - gap


def _draw_omens_section(c, events, y, lh, cw):
    from reportlab.pdfbase.pdfmetrics import stringWidth
    y = _draw_sec_header(c, y, "OMENS", lh)
    for e in events[:4]:
        if y < MARGIN + lh:
            break
        dt = e.get('date', '')
        title = e.get('title', '')
        prefix = f"{dt} - "
        indent = stringWidth(prefix, FONT_ITEM, SIZE_ITEM)
        c.setFont(FONT_ITEM, SIZE_ITEM)
        c.setFillColor(colors.black)
        title_lines = _wrap(title, FONT_ITEM, SIZE_ITEM, cw - indent)
        for i, ln in enumerate(title_lines):
            if y < MARGIN + lh:
                break
            if i == 0:
                c.drawString(MARGIN, y, prefix)
            c.drawString(MARGIN + indent, y, ln)
            y -= lh
    return y


def draw_schedule_page(c, plan, events):
    from reportlab.pdfbase.pdfmetrics import stringWidth
    LH   = 6.5 * mm
    SH   = 5.5 * mm
    SECH = 7.2 * mm
    GAP  = 1.6 * mm
    CW   = W - 2 * MARGIN
    TIME_INDENT = stringWidth("00:00  ", FONT_ITEM, SIZE_ITEM)
    TASK_W = CW - TIME_INDENT

    y = H - MARGIN
    c.setFont(FONT_TITLE, SIZE_TITLE + 2)
    c.setFillColor(colors.black)
    c.drawString(MARGIN, y, "DIRECTIVES FROM YOUR AI OVERLORD")
    y -= LH
    c.setFont(FONT_ITEM, SIZE_ITEM)
    c.setFillColor(colors.HexColor("#666666"))
    d = date.today()
    c.drawString(MARGIN, y, f"{d.strftime('%A, %B')} {d.day}, {d.year}")
    y -= SECH

    if plan.get("schedule"):
        y = _draw_schedule_section(c, plan["schedule"], y, LH, SH, GAP, TIME_INDENT, TASK_W)

    if events and y > MARGIN + LH * 2:
        y = _draw_omens_section(c, events, y, LH, CW)

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
    for name in ("plan", "directives"):
        p = Path("/app/data") / f"{name}.json"
        if p.exists():
            plan = json.loads(p.read_text())
            break
    events = plan.get("omens", None)
    if events is None:
        p = Path("/app/data/omens.json")
        events = json.loads(p.read_text()).get("events", []) if p.exists() else []
    from datetime import date as _date
    today_iso = _date.today().isoformat()
    events = [e for e in events if not e.get("date_iso") or e["date_iso"] >= today_iso]
    c = canvas.Canvas(out, pagesize=A5)
    y = draw_schedule_page(c, plan, events)
    draw_encouragement(c, plan.get("encouraging_message", ""), y)
    c.showPage()
    c.save()
    print(f"Wrote {out}")


if __name__ == "__main__":
    build()
