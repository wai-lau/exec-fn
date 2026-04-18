import json, re, shutil, subprocess, base64
from datetime import datetime, date, timedelta
from pathlib import Path

DATA_DIR = Path("/app/data")


def _ts() -> str:
    return datetime.now().strftime("%Y%m%d_%H%M%S")


def _today() -> str:
    return date.today().strftime("%Y%m%d")


# ── pull ──────────────────────────────────────────────────────────────────────

def pull_exec() -> str:
    ls = subprocess.run(["rmapi", "ls"], cwd=str(DATA_DIR), capture_output=True, text=True)
    if ls.returncode != 0:
        raise RuntimeError(f"rmapi ls failed: {(ls.stderr or ls.stdout).strip()}")

    wai_docs = []
    for line in ls.stdout.splitlines():
        parts = line.strip().split()
        if parts and parts[0] == "[f]" and parts[-1].startswith("WAI_"):
            wai_docs.append(parts[-1])

    if not wai_docs:
        raise RuntimeError("No WAI_* document found on reMarkable")

    latest = sorted(wai_docs)[-1]

    result = subprocess.run(
        ["rmapi", "get", f"/{latest}"],
        cwd=str(DATA_DIR),
        capture_output=True, text=True,
    )
    if result.returncode != 0:
        raise RuntimeError(f"rmapi get failed: {(result.stderr or result.stdout).strip()}")

    src = DATA_DIR / f"{latest}.rmdoc"
    if not src.exists():
        raise RuntimeError(f"rmapi get succeeded but {latest}.rmdoc not found in data dir")

    dest = DATA_DIR / f"EXEC_{_ts()}.rmdoc"
    shutil.move(str(src), str(dest))
    return str(dest)


def push_pdf() -> str:
    from build_pdf import build as pdf_build

    ts = _ts()
    pdf_path = DATA_DIR / f"WAI_{ts}.pdf"
    pdf_build(str(pdf_path))

    result = subprocess.run(
        ["rmapi", "put", "--force", str(pdf_path)],
        capture_output=True, text=True,
    )
    if result.returncode != 0:
        raise RuntimeError(f"rmapi put failed: {result.stderr.strip()}")

    return pdf_path.name


def build_morning() -> dict:
    pdf_name = push_pdf()
    return {"pdf": pdf_name}


# ── archive ───────────────────────────────────────────────────────────────────

def list_archive() -> list:
    files = sorted(DATA_DIR.glob("EXEC_*.rmdoc"), reverse=True)
    result = []
    for f in files:
        parts = f.stem.split("_")  # EXEC_YYYYMMDD_HHMMSS
        if len(parts) >= 3:
            d, t = parts[1], parts[2]
            label = f"{d[:4]}-{d[4:6]}-{d[6:]} {t[:2]}:{t[2:4]}"
        else:
            label = f.stem
        result.append({"filename": f.name, "label": label})
    return result


# ── delta ─────────────────────────────────────────────────────────────────────

def _delta_prompt() -> str:
    p = DATA_DIR / "directives.json"
    if p.exists():
        d = json.loads(p.read_text())
        easy = d.get("easy", [])
        medium = d.get("medium", [])
        hard = d.get("hard", {})
        lines = ["TODAY'S DIRECTIVES (printed on the page):"]
        lines += [f"EASY: {t}" for t in easy]
        for t in medium:
            lines.append(f"MEDIUM: {t.get('title', t) if isinstance(t, dict) else t}")
        if isinstance(hard, dict) and hard.get("title"):
            lines.append(f"HARD: {hard['title']}")
        directives_text = "\n".join(lines)
    else:
        directives_text = "No directives on record."

    return (
        f"{directives_text}\n\n"
        "The image shows Wai's reMarkable page. The printed text above was already there. "
        "Any handwritten marks/strokes are Wai's annotations added during the day.\n\n"
        "1. Describe the handwritten annotations (if any visible).\n"
        "2. Based on those, how should tomorrow's directives change?\n"
        "3. Extract any facts about Wai that should be remembered long-term "
        "(preferences, relationships, constraints, recurring patterns). "
        "Short declarative sentences only. Empty list if nothing new.\n\n"
        'JSON only: {"wai_notes": "...", "adjustments": "...", "context_updates": ["..."]}'
    )


def analyze_delta() -> dict:
    import anthropic
    from rm_to_pdf import rmdoc_to_image

    latest_path = pull_exec()

    png_bytes = rmdoc_to_image(latest_path, page_index=0)
    (DATA_DIR / "delta_preview.png").write_bytes(png_bytes)
    png_b64 = base64.standard_b64encode(png_bytes).decode()

    client = anthropic.Anthropic()
    msg = client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=1024,
        messages=[{
            "role": "user",
            "content": [
                {
                    "type": "image",
                    "source": {"type": "base64", "media_type": "image/png", "data": png_b64},
                },
                {
                    "type": "text",
                    "text": _delta_prompt(),
                },
            ],
        }],
    )

    text = msg.content[0].text
    m = re.search(r'\{[\s\S]*\}', text)
    parsed = json.loads(m.group()) if m else {"wai_notes": text, "adjustments": ""}

    delta = {
        "analyzed_at": datetime.now().isoformat(),
        "source_file": Path(latest_path).name,
        "wai_notes": parsed.get("wai_notes", ""),
        "adjustments": parsed.get("adjustments", ""),
    }
    (DATA_DIR / "delta.json").write_text(json.dumps(delta, indent=2))

    updates = [u for u in parsed.get("context_updates", []) if isinstance(u, str) and u.strip()]
    if updates:
        ctx_path = DATA_DIR / "context.json"
        ctx = json.loads(ctx_path.read_text()) if ctx_path.exists() else {"notes": []}
        today = date.today().isoformat()
        for note in updates:
            ctx["notes"].append({"date": today, "note": note.strip()})
        ctx_path.write_text(json.dumps(ctx, indent=2))

    return delta


# ── directives ────────────────────────────────────────────────────────────────

def generate_directives(feedback: str = "") -> dict:
    import anthropic

    def _load(name):
        p = DATA_DIR / f"{name}.json"
        if not p.exists():
            return {}
        data = json.loads(p.read_text())
        return data if isinstance(data, dict) else {}

    rd = _load("rd")
    omens = _load("omens")
    delta = _load("delta")
    prefs = _load("preferences")
    ctx = _load("context")

    rd_text = "\n".join(
        f"{s['title']}: {', '.join(s['items'][:5])}"
        for s in rd.get("sections", [])
    ) or "No R&D projects."

    omens_text = "\n".join(
        f"- {e['title']} ({e.get('date', '?')}): {e.get('prep_notes', '')}"
        for e in omens.get("events", [])
    ) or "No upcoming events."

    delta_text = delta.get("adjustments", "No delta adjustments.")
    prefs_context = prefs.get(
        "context",
        "ADHD scaffolding. Short, specific, actionable.",
    )
    ctx_notes = ctx.get("notes", [])
    ctx_text = "\n".join(f"- [{n['date']}] {n['note']}" for n in ctx_notes[-30:]) or "No context notes yet."
    feedback_section = f"\nWAI'S FEEDBACK:\n{feedback}\n" if feedback.strip() else ""

    prompt = (
        f"Generate today's directives for Wai (ADHD executive function tool).\n\n"
        f"CONTEXT:\n{prefs_context}\n\n"
        f"KNOWN FACTS ABOUT WAI (accumulated from past days):\n{ctx_text}\n\n"
        f"UPCOMING EVENTS (omens):\n{omens_text}\n\n"
        f"DELTA — what happened yesterday, what to carry forward:\n{delta_text}\n\n"
        f"R&D (background only):\n{rd_text}\n"
        f"{feedback_section}\n"
        f"Rules:\n"
        f"- 7 total: EASY (3), MEDIUM (3), HARD (1).\n"
        f"- Caveman phrasing. Verb first. Max 8 words per item or step.\n"
        f"- Delta: carry unfinished items forward with adjusted approach. Skip done ones.\n"
        f"- Omens needing action this week → pull into directives instead. Do NOT show in both places.\n"
        f"- List any omen titles pulled into directives in incorporated_omens.\n"
        f"- Equal word count across columns.\n\n"
        'JSON only: {"easy": ["...", "...", "..."], '
        '"medium": [{"title": "...", "steps": ["...", "..."]}, {"title": "...", "steps": ["...", "..."]}, {"title": "...", "steps": ["...", "..."]}], '
        '"hard": {"title": "...", "steps": ["...", "...", "..."]}, '
        '"incorporated_omens": []}'
    )

    client = anthropic.Anthropic()
    msg = client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=1024,
        messages=[{"role": "user", "content": prompt}],
    )

    text = msg.content[0].text
    m = re.search(r'\{[\s\S]*\}', text)
    parsed = json.loads(m.group()) if m else {"easy": [], "medium": [], "hard": {}}

    directives = {
        "generated_at": datetime.now().isoformat(),
        "easy": parsed.get("easy", []),
        "medium": parsed.get("medium", []),
        "hard": parsed.get("hard", {}),
    }
    (DATA_DIR / "directives.json").write_text(json.dumps(directives, indent=2))

    incorporated = parsed.get("incorporated_omens", [])
    if incorporated:
        omens_data = _load("omens")
        filtered = [e for e in omens_data.get("events", []) if e.get("title") not in incorporated]
        if len(filtered) != len(omens_data.get("events", [])):
            omens_data["events"] = filtered
            (DATA_DIR / "omens.json").write_text(json.dumps(omens_data, indent=2))

    return directives


# ── omens ─────────────────────────────────────────────────────────────────────

def _gcal_creds():
    from google.oauth2.credentials import Credentials
    from google.auth.transport.requests import Request

    token_path = Path("/root/.config/gcal/token.json")
    if not token_path.exists():
        raise RuntimeError(
            "Google Calendar not authenticated. "
            "Run: docker compose exec -it api python3 gcal_auth.py"
        )
    creds = Credentials.from_authorized_user_file(str(token_path))
    if creds.expired and creds.refresh_token:
        creds.refresh(Request())
        token_path.write_text(creds.to_json())
    return creds


def fetch_calendar_events(days_ahead: int = 14) -> list:
    from googleapiclient.discovery import build as gcal_build

    creds = _gcal_creds()
    service = gcal_build("calendar", "v3", credentials=creds)

    now = datetime.utcnow().isoformat() + "Z"
    end = (datetime.utcnow() + timedelta(days=days_ahead)).isoformat() + "Z"
    result = service.events().list(
        calendarId="primary",
        timeMin=now,
        timeMax=end,
        singleEvents=True,
        orderBy="startTime",
        maxResults=20,
    ).execute()

    return [
        {
            "summary": item.get("summary", "Untitled"),
            "start": item["start"].get("dateTime", item["start"].get("date", "")),
            "description": item.get("description", ""),
        }
        for item in result.get("items", [])
    ]


def analyze_omens() -> dict:
    import anthropic

    events = fetch_calendar_events()

    if not events:
        omens = {"checked_at": datetime.now().isoformat(), "events": []}
        (DATA_DIR / "omens.json").write_text(json.dumps(omens, indent=2))
        return omens

    events_text = "\n".join(f"- {e['summary']} on {e['start']}" for e in events)

    client = anthropic.Anthropic()
    msg = client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=512,
        messages=[{
            "role": "user",
            "content": (
                f"Wai's upcoming calendar events (next 14 days):\n{events_text}\n\n"
                "Flag any events requiring preparation or attention. "
                "Focus on social events, deadlines, appointments, or anything needing >1 day prep. "
                "Skip routine recurring events unless notably important. "
                'Return as JSON only: {"events": [{"title": "...", "date": "...", "prep_notes": "..."}]}'
            ),
        }],
    )

    text = msg.content[0].text
    m = re.search(r'\{[\s\S]*\}', text)
    parsed = json.loads(m.group()) if m else {"events": []}

    omens = {
        "checked_at": datetime.now().isoformat(),
        "events": parsed.get("events", []),
    }
    (DATA_DIR / "omens.json").write_text(json.dumps(omens, indent=2))
    return omens
