import json
import subprocess
import zipfile
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

ET = ZoneInfo("America/New_York")
DATA_DIR = Path("/app/data")
RM_FOLDER = "/EXEC"


def _ts() -> str:
    return datetime.now().strftime("%Y%m%d_%H%M%S")


def _parse_file_ts(stem: str) -> datetime | None:
    try:
        return datetime.strptime(stem, "%Y%m%d_%H%M%S")
    except Exception:
        return None


def _rm_list_wai() -> list[str]:
    ls = subprocess.run(["rmapi", "ls", RM_FOLDER], capture_output=True, text=True, timeout=30)
    if ls.returncode != 0:
        return []
    return sorted([
        line.strip().split()[-1]
        for line in ls.stdout.splitlines()
        if line.strip().startswith("[f]") and line.strip().split()[-1].startswith("WAI_")
    ])


def _rm_stat_modified(name: str) -> datetime | None:
    try:
        stat = subprocess.run(
            ["rmapi", "stat", f"{RM_FOLDER}/{name}"],
            capture_output=True, text=True, timeout=15,
        )
        if stat.returncode != 0:
            return None
        data = json.loads(stat.stdout)
        return datetime.fromisoformat(data["ModifiedClient"].replace("Z", ""))
    except Exception:
        return None


def _rm_latest_wai_modified() -> datetime | None:
    names = _rm_list_wai()
    return _rm_stat_modified(names[-1]) if names else None


def pull_rmdocs() -> str:
    """Pull the latest WAI_* doc, saved locally as <ModifiedClient_ts>.rmdoc.

    Filename = rM modification timestamp. Already exists → skip download.
    """
    wai_names = _rm_list_wai()
    if not wai_names:
        raise RuntimeError("No WAI_* document found in EXEC folder on reMarkable")

    latest = wai_names[-1]
    modified = _rm_stat_modified(latest)

    if modified is not None:
        ts = modified.strftime("%Y%m%d_%H%M%S")
        dest = DATA_DIR / f"{ts}.rmdoc"
        if dest.exists():
            return str(dest)
    else:
        import sys
        print(f"[pull_rmdocs] WARNING: rmapi stat failed for {latest} — downloading without timestamp", file=sys.stderr)
        dest = DATA_DIR / f"{latest}.rmdoc"

    result = subprocess.run(
        ["rmapi", "get", f"{RM_FOLDER}/{latest}"],
        cwd=str(DATA_DIR), capture_output=True, text=True, timeout=60,
    )
    if result.returncode != 0:
        raise RuntimeError(f"rmapi get failed: {(result.stderr or result.stdout).strip()}")

    downloaded = DATA_DIR / f"{latest}.rmdoc"
    if not downloaded.exists():
        raise RuntimeError(f"rmapi get succeeded but {latest}.rmdoc not found in data dir")

    if dest != downloaded:
        downloaded.rename(dest)

    return str(dest)


def push_pdf() -> str:
    from build_pdf import build as pdf_build

    pdf_path = DATA_DIR / f"WAI_{_ts()}.pdf"
    pdf_build(str(pdf_path))

    result = subprocess.run(
        ["rmapi", "put", "--force", str(pdf_path), RM_FOLDER],
        capture_output=True, text=True, timeout=60,
    )
    if result.returncode != 0:
        raise RuntimeError(f"rmapi put failed: {result.stderr.strip()}")

    return pdf_path.name


def list_archive() -> list:
    entries = []

    for f in DATA_DIR.glob("*.rmdoc"):
        mtime = f.stat().st_mtime
        try:
            dt = datetime.strptime(f.stem, "%Y%m%d_%H%M%S")
            label = dt.strftime("%Y-%m-%d %H:%M")
        except ValueError:
            label = datetime.utcfromtimestamp(mtime).strftime("%Y-%m-%d %H:%M")
        try:
            with zipfile.ZipFile(f) as z:
                uid = [n for n in z.namelist() if n.endswith(".content")][0].replace(".content", "")
                content = json.loads(z.read(f"{uid}.content"))
                pages = (content.get("cPages") or {}).get("pages") or content.get("pages") or []
                page_count = len(pages) or 1
        except Exception:
            page_count = 1
        entries.append({"filename": f.name, "label": label, "pages": page_count, "_mtime": mtime})

    for f in DATA_DIR.glob("delta_*.png"):
        mtime = f.stat().st_mtime
        label = "delta " + datetime.utcfromtimestamp(mtime).strftime("%Y-%m-%d %H:%M")
        entries.append({"filename": f.name, "label": label, "pages": 1, "_mtime": mtime})

    entries.sort(key=lambda e: e["_mtime"], reverse=True)
    for e in entries:
        del e["_mtime"]
    return entries
