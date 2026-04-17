"""Print stroke + text block coordinate ranges from the latest EXEC_*.rmdoc."""
import zipfile, json, glob, os
import rmscene.scene_stream as ss

DATA_DIR = "/app/data"

rmdocs = sorted(glob.glob(f"{DATA_DIR}/EXEC_*.rmdoc"))
if not rmdocs:
    print("No EXEC_*.rmdoc found")
    exit(1)

path = rmdocs[-1]
print(f"File: {path}\n")

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
    rm_path = f"{uid}/{page_id}.rm"

    print(f"Page ID: {page_id}")
    print(f"RM path in zip: {rm_path}\n")

    if rm_path not in names:
        print("RM file not found in zip")
        exit(1)

    with z.open(rm_path) as f:
        blocks = list(ss.read_blocks(f))

    strokes = []
    text_blocks = []

    for b in blocks:
        if isinstance(b, ss.SceneLineItemBlock):
            item = b.item.value
            if item and hasattr(item, "points") and item.points:
                pts = [(p.x, p.y) for p in item.points]
                strokes.append(pts)
        elif isinstance(b, ss.RootTextBlock):
            pos_x = getattr(b.value, "pos_x", 0) or 0
            pos_y = getattr(b.value, "pos_y", 0) or 0
            width = getattr(b.value, "width", 0) or 0
            text_blocks.append({"pos_x": pos_x, "pos_y": pos_y, "width": width})

    print(f"Text blocks ({len(text_blocks)}):")
    for tb in text_blocks:
        print(f"  pos_x={tb['pos_x']:.1f}  pos_y={tb['pos_y']:.1f}  width={tb['width']:.1f}")

    print(f"\nStrokes: {len(strokes)}")
    if strokes:
        all_pts = [p for s in strokes for p in s]
        xs = [p[0] for p in all_pts]
        ys = [p[1] for p in all_pts]
        print(f"  x range: {min(xs):.1f} → {max(xs):.1f}")
        print(f"  y range: {min(ys):.1f} → {max(ys):.1f}")

        # per-stroke summary
        for i, pts in enumerate(strokes[:20]):
            xs2 = [p[0] for p in pts]
            ys2 = [p[1] for p in pts]
            print(f"  stroke {i:2d}: x[{min(xs2):.0f},{max(xs2):.0f}]  y[{min(ys2):.0f},{max(ys2):.0f}]  pts={len(pts)}")
