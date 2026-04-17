"""Compare PDF content positions vs stroke y positions to find correct scale."""
import zipfile, json, glob
import rmscene.scene_stream as ss
import fitz
from reportlab.lib.units import mm
from reportlab.lib.pagesizes import A5

DATA_DIR = "/app/data"
W, H = A5  # 419.53 x 595.28 pt
MARGIN = 14 * mm
LH   = 5.0 * mm
SH   = 4.2 * mm
SECH = 5.5 * mm
GAP  = 1.2 * mm
TGAP = 0.8 * mm
RM_W, RM_H = 1404, 1872

# ── compute reportlab y positions (from bottom) ───────────────────────────────
positions = {}
y = H - MARGIN
positions["title"] = y
y -= LH
positions["date"] = y
y -= SECH
# sec_header EASY
y -= LH * 0.35; y -= LH * 0.65
positions["easy1"] = y; y -= SH
positions["easy2_TextMatthew"] = y; y -= SH
positions["easy3"] = y; y -= SH
y -= GAP
# sec_header MEDIUM
y -= LH * 0.35; y -= LH * 0.65
positions["medium1_title"] = y; y -= SH
y -= SH; y -= SH  # 2 steps
y -= TGAP
positions["medium2_title"] = y; y -= SH
y -= SH; y -= SH
y -= TGAP
positions["medium3_SSK_title"] = y; y -= SH
positions["medium3_SSK_step1_PullMaterials"] = y; y -= SH
positions["medium3_SSK_step2_CompleteSeam"] = y; y -= SH
y -= TGAP
y -= GAP
# sec_header HARD
y -= LH * 0.35; y -= LH * 0.65
positions["hard_title"] = y; y -= SH
y -= SH; y -= SH; y -= SH; y -= SH
y -= GAP
# sec_header OMENS
y -= LH * 0.35; y -= LH * 0.65
positions["omen1_DadBirthday"] = y; y -= LH
positions["omen2_Eunice"] = y; y -= LH
positions["omen3_MatthewBirthday"] = y; y -= LH

# ── two candidate scales ──────────────────────────────────────────────────────
scale_w = RM_W / W            # width-fit: 3.347
scale_h = RM_H / H            # height-fit: 3.143

def to_px(rl_y, scale):
    return (H - rl_y) * scale

print(f"scale_w={scale_w:.4f}  PDF_h={H*scale_w:.0f}px")
print(f"scale_h={scale_h:.4f}  PDF_w={W*scale_h:.0f}px\n")

print(f"{'item':<40} {'width-fit px':>12} {'height-fit px':>13}")
print("-" * 67)
for name, rl_y in positions.items():
    pw = to_px(rl_y, scale_w)
    ph = to_px(rl_y, scale_h)
    print(f"{name:<40} {pw:>12.1f} {ph:>13.1f}")

# ── strokes ───────────────────────────────────────────────────────────────────
rmdocs = sorted(glob.glob(f"{DATA_DIR}/EXEC_*.rmdoc"))
path = rmdocs[-1]
with zipfile.ZipFile(path) as z:
    names = z.namelist()
    uid = [f for f in names if f.endswith(".content")][0].replace(".content", "")
    content = json.loads(z.read(f"{uid}.content"))
    if "cPages" in content:
        pages = content["cPages"]["pages"]
    else:
        raw = content.get("pages", [])
        pages = [{"id": p} for p in raw] if raw and isinstance(raw[0], str) else raw
    page_id = pages[0]["id"] if isinstance(pages[0], dict) else pages[0]
    with z.open(f"{uid}/{page_id}.rm") as f:
        blocks = list(ss.read_blocks(f))

strokes = []
for b in blocks:
    if isinstance(b, ss.SceneLineItemBlock):
        item = b.item.value
        if item and hasattr(item, "points") and item.points:
            strokes.append([(p.x, p.y) for p in item.points])

all_ys = sorted(set(round(p[1]) for s in strokes for p in s))
# cluster by gaps > 30px
clusters = []
cur = [all_ys[0]]
for y_val in all_ys[1:]:
    if y_val - cur[-1] > 30:
        clusters.append((min(cur), max(cur)))
        cur = [y_val]
    else:
        cur.append(y_val)
clusters.append((min(cur), max(cur)))

print(f"\nStroke y clusters ({len(clusters)}):")
for lo, hi in clusters:
    mid = (lo + hi) / 2
    print(f"  y [{lo:6.0f} – {hi:6.0f}]  mid={mid:.0f}")
