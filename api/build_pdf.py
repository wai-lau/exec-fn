import json
from datetime import date
from reportlab.lib.pagesizes import A5
from reportlab.lib.units import mm
from reportlab.lib import colors
from reportlab.pdfgen import canvas

OUT_PDF = "/app/data/WAI.pdf"
W, H = A5  # 148 x 210 mm

MARGIN     = 14 * mm
LINE_H     = 9  * mm
SECTION_H  = 12 * mm
GAP        = 5  * mm
BOX_SIZE   = 3.5 * mm

FONT_TITLE   = "Helvetica-Bold"
FONT_SECTION = "Helvetica-Bold"
FONT_ITEM    = "Helvetica"
SIZE_TITLE   = 11
SIZE_SECTION = 9
SIZE_ITEM    = 8

with open("/app/data/daily.json") as f:
    DAILY = json.load(f)
with open("/app/data/future_projects.json") as f:
    PROJECTS = json.load(f)


def draw_checkbox(c, x, y):
    c.setStrokeColor(colors.black)
    c.setLineWidth(0.6)
    c.rect(x, y - BOX_SIZE * 0.15, BOX_SIZE, BOX_SIZE, fill=0)


def draw_page(c, title, sections):
    y = H - MARGIN

    # page title
    c.setFont(FONT_TITLE, SIZE_TITLE + 2)
    c.setFillColor(colors.black)
    c.drawString(MARGIN, y, title)
    y -= LINE_H
    # date subheading
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


def draw_projects_page(c, sections):
    from reportlab.pdfbase.pdfmetrics import stringWidth
    P_LINE_H = 7.5 * mm
    P_GAP    = 3   * mm

    y = H - MARGIN

    c.setFont(FONT_TITLE, SIZE_TITLE + 2)
    c.setFillColor(colors.black)
    c.drawString(MARGIN, y, "FUTURE TRIBUTES TO THE ARCHITECT")
    y -= P_LINE_H

    col_w = (W - 2 * MARGIN - 6 * mm) / 2
    cols = [MARGIN, MARGIN + col_w + 6 * mm]

    # split sections: left=[RENOS, ORGANIZATION, READING LIST], right=[CRAFT]
    left_sections  = [s for s in sections if s["title"] != "CRAFT"]
    right_sections = [s for s in sections if s["title"] == "CRAFT"]

    for col_idx, col_sections in enumerate([left_sections, right_sections]):
        x = cols[col_idx]
        cy = y
        for section in col_sections:
            c.setFont(FONT_SECTION, SIZE_SECTION)
            c.setFillColor(colors.HexColor("#222222"))
            c.drawString(x, cy, section["title"])
            cy -= P_LINE_H * 0.3
            c.setStrokeColor(colors.HexColor("#cccccc"))
            c.setLineWidth(0.4)
            c.line(x, cy, x + col_w, cy)
            cy -= P_LINE_H * 0.8

            for item in section["items"]:
                if cy < MARGIN + P_LINE_H:
                    break
                max_w = col_w - BOX_SIZE - 2 * mm
                words = item.split()
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
                for i, line in enumerate(lines):
                    c.drawString(text_x if i == 0 else x + BOX_SIZE + 2 * mm, cy, line)
                    cy -= P_LINE_H

            cy -= P_GAP


c = canvas.Canvas(OUT_PDF, pagesize=A5)

draw_page(c, "DIRECTIVES FROM YOUR AI OVERLORD", DAILY["sections"])
c.showPage()

draw_projects_page(c, PROJECTS["sections"])
c.showPage()

c.save()
print(f"Wrote {OUT_PDF}")
