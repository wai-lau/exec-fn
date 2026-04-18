from rm_to_pdf import rasterize
import glob

rmdocs = sorted(glob.glob("/app/data/EXEC_*.rmdoc"))
path = rmdocs[-1]
print(f"Using: {path}")
data = rasterize(path, page_index=0)
with open("/app/data/delta_preview.png", "wb") as f:
    f.write(data)
print(f"Wrote {len(data)} bytes → delta_preview.png")
