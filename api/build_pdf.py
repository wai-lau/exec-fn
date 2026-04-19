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


def draw_checkbox(c, x, y):
    c.setStrokeColor(colors.black)
    c.setLineWidth(0.6)
    c.rect(x, y - BOX_SIZE * 0.15, BOX_SIZE, BOX_SIZE, fill=0)


def draw_page(c, title, sections):
    y = H - MARGIN
    c.setFont(FONT_TITLE, SIZE_TITLE + 2)
    c.setFillColor(colors.black)
    c.drawString(MARGIN, y, title)
    y -= LINE_H
    c.setFont(FONT_ITEM, SIZE_ITEM + 1)
    c.setFillColor(colors.HexColor("#666666"))
    c.drawString(MARGIN, y, date.today().strftime("%A, %B %-d, %Y"))
    y -= SECTION_H * 0.9

    for section in sections:
        if not section.get("hide_title"):
            c.setFont(FONT_SECTION, SIZE_SECTION)
            c.setFillColor(colors.HexColor("#222222"))
            c.drawString(MARGIN, y, section["title"])
            y -= LINE_H * 0.3
            c.setStrokeColor(colors.HexColor("#cccccc"))
            c.setLineWidth(0.4)
            c.line(MARGIN, y, W - MARGIN, y)
            y -= LINE_H * 0.8

        bullets = section.get("bullets", False)
        for item in section["items"]:
            if y < MARGIN + LINE_H:
                break
            c.setFont(FONT_ITEM, SIZE_ITEM)
            c.setFillColor(colors.black)
            if bullets:
                c.drawString(MARGIN, y, f"• {item}")
            else:
                draw_checkbox(c, MARGIN, y)
                c.drawString(MARGIN + BOX_SIZE + 2 * mm, y, item)
            y -= LINE_H
        y -= GAP


def draw_directives_page(c, directives, events, encouragement=""):
    from reportlab.pdfbase.pdfmetrics import stringWidth

    LH   = 5.0 * mm
    SH   = 4.2 * mm
    SECH = 5.5 * mm
    GAP  = 1.2 * mm
    TGAP = 0.8 * mm
    IND  = 4   * mm
    CW   = W - 2 * MARGIN

    def wrap(text, font, size, max_w):
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

    # EASY — same style as steps
    y = sec_header(y, "EASY")
    for task in (directives.get("easy") or []):
        if y < MARGIN + SH:
            break
        c.setFont(FONT_ITEM, SIZE_ITEM - 1)
        c.setFillColor(colors.HexColor("#444444"))
        for ln in wrap(task, FONT_ITEM, SIZE_ITEM - 1, CW - IND):
            if y < MARGIN + SH:
                break
            c.drawString(MARGIN + IND, y, ln)
            y -= SH
    y -= GAP

    # MEDIUM — title (no checkbox) + indented steps (no bullet)
    y = sec_header(y, "MEDIUM")
    for task in (directives.get("medium") or []):
        if y < MARGIN + LH * 2:
            break
        title = task.get("title", task) if isinstance(task, dict) else task
        steps = task.get("steps", []) if isinstance(task, dict) else []
        c.setFont(FONT_SECTION, SIZE_ITEM)
        c.setFillColor(colors.black)
        for i, ln in enumerate(wrap(title, FONT_SECTION, SIZE_ITEM, CW)):
            if y < MARGIN + LH:
                break
            c.drawString(MARGIN, y, ln)
            y -= LH * 0.85 if i < len(wrap(title, FONT_SECTION, SIZE_ITEM, CW)) - 1 else SH
        for step in steps:
            if y < MARGIN + SH:
                break
            c.setFont(FONT_ITEM, SIZE_ITEM - 1)
            c.setFillColor(colors.HexColor("#444444"))
            for i, ln in enumerate(wrap(step, FONT_ITEM, SIZE_ITEM - 1, CW - IND)):
                if y < MARGIN + SH:
                    break
                c.drawString(MARGIN + IND, y, ln)
                y -= SH
        y -= TGAP
    y -= GAP

    # HARD — title (no checkbox) + indented steps (no bullet)
    y = sec_header(y, "HARD")
    hard = directives.get("hard") or {}
    if isinstance(hard, dict) and hard.get("title"):
        c.setFont(FONT_SECTION, SIZE_ITEM)
        c.setFillColor(colors.black)
        title_lines = wrap(hard["title"], FONT_SECTION, SIZE_ITEM, CW)
        for i, ln in enumerate(title_lines):
            if y < MARGIN + LH:
                break
            c.drawString(MARGIN, y, ln)
            y -= LH * 0.85 if i < len(title_lines) - 1 else SH
        for step in (hard.get("steps") or []):
            if y < MARGIN + SH:
                break
            c.setFont(FONT_ITEM, SIZE_ITEM - 1)
            c.setFillColor(colors.HexColor("#444444"))
            for ln in wrap(step, FONT_ITEM, SIZE_ITEM - 1, CW - IND):
                if y < MARGIN + SH:
                    break
                c.drawString(MARGIN + IND, y, ln)
                y -= SH
    y -= GAP

    # OMENS
    if events and y > MARGIN + LH * 2:
        y = sec_header(y, "OMENS")
        for e in events[:4]:
            if y < MARGIN + LH:
                break
            c.setFont(FONT_ITEM, SIZE_ITEM)
            c.setFillColor(colors.black)
            text = f"{e.get('title', '')} — {e.get('date', '')}"
            for ln in wrap(text, FONT_ITEM, SIZE_ITEM, CW):
                if y < MARGIN + LH:
                    break
                c.drawString(MARGIN, y, ln)
                y -= LH
    return y


def draw_encouragement(c, message: str, y: float):
    from reportlab.pdfbase.pdfmetrics import stringWidth
    CW = W - 2 * MARGIN
    LH = 4.5 * mm
    SH = 3.8 * mm
    FOOTER_Y = MARGIN

    if not message or y < FOOTER_Y + LH * 4:
        return

    # divider
    y -= 4 * mm
    c.setStrokeColor(colors.HexColor("#cccccc"))
    c.setLineWidth(0.3)
    c.line(MARGIN, y, W - MARGIN, y)
    y -= 3 * mm

    c.setFont(FONT_SECTION, SIZE_ITEM - 1)
    c.setFillColor(colors.HexColor("#555555"))
    c.drawString(MARGIN, y, "ENCOURAGEMENT")
    y -= LH

    words = message.split()
    lines, cur = [], ""
    for w in words:
        test = (cur + " " + w).strip()
        if stringWidth(test, FONT_ITEM, SIZE_ITEM - 1) <= CW:
            cur = test
        else:
            if cur:
                lines.append(cur)
            cur = w
    if cur:
        lines.append(cur)

    c.setFont(FONT_ITEM, SIZE_ITEM - 1)
    c.setFillColor(colors.HexColor("#444444"))
    for ln in lines:
        if y < FOOTER_Y:
            break
        c.drawString(MARGIN, y, ln)
        y -= SH


def draw_projects_page(c, cards):
    from reportlab.pdfbase.pdfmetrics import stringWidth
    P_LINE_H = 7.5 * mm
    P_GAP    = 3   * mm

    doing = sorted([card for card in cards if card.get("column") == "selected"], key=lambda x: x.get("order", 0))

    y = H - MARGIN
    c.setFont(FONT_TITLE, SIZE_TITLE + 2)
    c.setFillColor(colors.black)
    c.drawString(MARGIN, y, "FUTURE TRIBUTES TO THE ARCHITECT")
    y -= P_LINE_H

    col_w = (W - 2 * MARGIN - 6 * mm) / 2

    by_category = {}
    for card in doing:
        by_category.setdefault(card.get("category", "OTHER"), []).append(card)

    x = MARGIN
    cy = y
    for cat, cat_cards in by_category.items():
        c.setFont(FONT_SECTION, SIZE_SECTION)
        c.setFillColor(colors.HexColor("#222222"))
        c.drawString(x, cy, cat)
        cy -= P_LINE_H * 0.3
        c.setStrokeColor(colors.HexColor("#cccccc"))
        c.setLineWidth(0.4)
        c.line(x, cy, W - MARGIN, cy)
        cy -= P_LINE_H * 0.8

        for card in cat_cards:
            if cy < MARGIN + P_LINE_H:
                break
            title = card["title"]
            max_w = W - 2 * MARGIN - BOX_SIZE - 2 * mm
            words = title.split()
            lines, current = [], ""
            for word in words:
                test = (current + " " + word).strip()
                if stringWidth(test, FONT_ITEM, SIZE_ITEM) <= max_w:
                    current = test
                else:
                    if current:
                        lines.append(current)
                    current = word
            if current:
                lines.append(current)

            draw_checkbox(c, x, cy)
            text_x = x + BOX_SIZE + 2 * mm
            c.setFont(FONT_ITEM, SIZE_ITEM)
            c.setFillColor(colors.black)
            for line in lines:
                c.drawString(text_x, cy, line)
                cy -= P_LINE_H
        cy -= P_GAP


def build(out_path=None):
    out = out_path or OUT_PDF
    with open("/app/data/rd.json") as f:
        rd = json.load(f)
    try:
        with open("/app/data/omens.json") as f:
            omens = json.load(f)
    except FileNotFoundError:
        omens = {"events": []}
    try:
        with open("/app/data/directives.json") as f:
            directives_meta = json.load(f)
        encouraging_message = directives_meta.get("encouraging_message", "")
    except FileNotFoundError:
        encouraging_message = ""

    selected = sorted(
        [c for c in rd.get("cards", []) if c.get("column") == "selected"],
        key=lambda c: c.get("order", 0),
    )

    def _steps(c):
        return [s.strip() for s in c.get("description", "").split(".") if s.strip()]

    easy = [c["title"] for c in selected if c.get("size") in ("chore", "task")]
    medium = [{"title": c["title"], "steps": _steps(c)} for c in selected if c.get("size") in ("book", "project")]
    hard_cards = [c for c in selected if c.get("size") == "titan"]
    hard = {"title": hard_cards[0]["title"], "steps": _steps(hard_cards[0])} if hard_cards else {}

    directives = {"easy": easy, "medium": medium, "hard": hard}

    c = canvas.Canvas(out, pagesize=A5)
    y = draw_directives_page(c, directives, omens.get("events", []))
    if encouraging_message:
        draw_encouragement(c, encouraging_message, y)
    c.showPage()
    c.save()
    print(f"Wrote {out}")


if __name__ == "__main__":
    build()
