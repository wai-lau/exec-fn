import json, re, shutil, subprocess, base64
from datetime import datetime, date, timedelta
from pathlib import Path

DATA_DIR = Path("/app/data")


def _ts() -> str:
    return datetime.now().strftime("%Y%m%d_%H%M%S")


def _today() -> str:
    return date.today().strftime("%Y%m%d")


# ── pull ──────────────────────────────────────────────────────────────────────

RM_FOLDER = "/EXEC"


def pull_exec(baseline: bool = False) -> str:
    ls = subprocess.run(["rmapi", "ls", RM_FOLDER], cwd=str(DATA_DIR), capture_output=True, text=True, timeout=30)
    if ls.returncode != 0:
        raise RuntimeError(f"rmapi ls failed: {(ls.stderr or ls.stdout).strip()}")

    wai_docs = []
    for line in ls.stdout.splitlines():
        parts = line.strip().split()
        if parts and parts[0] == "[f]" and parts[-1].startswith("WAI_"):
            wai_docs.append(parts[-1])

    if not wai_docs:
        raise RuntimeError("No WAI_* document found in EXEC folder on reMarkable")

    latest = sorted(wai_docs)[-1]

    result = subprocess.run(
        ["rmapi", "get", f"{RM_FOLDER}/{latest}"],
        cwd=str(DATA_DIR),
        capture_output=True, text=True, timeout=60,
    )
    if result.returncode != 0:
        raise RuntimeError(f"rmapi get failed: {(result.stderr or result.stdout).strip()}")

    src = DATA_DIR / f"{latest}.rmdoc"
    if not src.exists():
        raise RuntimeError(f"rmapi get succeeded but {latest}.rmdoc not found in data dir")

    dest = DATA_DIR / f"EXEC_{_ts()}.rmdoc"
    shutil.move(str(src), str(dest))

    if baseline:
        baseline_dest = DATA_DIR / f"EXEC_{_today()}_baseline.rmdoc"
        shutil.copy(str(dest), str(baseline_dest))

    return str(dest)


def push_pdf() -> str:
    from build_pdf import build as pdf_build

    ts = _ts()
    pdf_path = DATA_DIR / f"WAI_{ts}.pdf"
    pdf_build(str(pdf_path))

    result = subprocess.run(
        ["rmapi", "put", "--force", str(pdf_path), RM_FOLDER],
        capture_output=True, text=True, timeout=60,
    )
    if result.returncode != 0:
        raise RuntimeError(f"rmapi put failed: {result.stderr.strip()}")

    return pdf_path.name


# ── archive ───────────────────────────────────────────────────────────────────

def list_archive() -> list:
    import zipfile
    files = sorted(DATA_DIR.glob("EXEC_*.rmdoc"), reverse=True)
    result = []
    for f in files:
        parts = f.stem.split("_")  # EXEC_YYYYMMDD_HHMMSS
        if len(parts) >= 3:
            d, t = parts[1], parts[2]
            label = f"{d[:4]}-{d[4:6]}-{d[6:]} {t[:2]}:{t[2:4]}"
        else:
            label = f.stem
        try:
            with zipfile.ZipFile(f) as z:
                uid = [n for n in z.namelist() if n.endswith(".content")][0].replace(".content", "")
                content = json.loads(z.read(f"{uid}.content"))
                if "cPages" in content:
                    pages = content["cPages"]["pages"]
                else:
                    raw = content.get("pages", [])
                    pages = [{"id": p} for p in raw] if raw and isinstance(raw[0], str) else raw
                page_count = len(pages)
        except Exception:
            page_count = 1
        result.append({"filename": f.name, "label": label, "pages": page_count})
    return result


# ── delta ─────────────────────────────────────────────────────────────────────

def _delta_prompt() -> str:
    rd_path = DATA_DIR / "rd.json"
    if rd_path.exists():
        rd = json.loads(rd_path.read_text())
        selected = sorted(
            [c for c in rd.get("cards", []) if c.get("column") == "hq"],
            key=lambda c: c.get("order", 0),
        )
        if selected:
            lines = ["TODAY'S SELECTED TASKS (on the reMarkable):"]
            for c in selected:
                lines.append(f"[{c.get('size','task')}] {c['title']}")
            directives_text = "\n".join(lines)
        else:
            directives_text = "No tasks selected for today."
    else:
        directives_text = "No tasks on record."

    ctx_path = DATA_DIR / "context.json"
    if ctx_path.exists():
        ctx = json.loads(ctx_path.read_text())
        known = "\n".join(f"- {n['note']}" for n in ctx.get("notes", []))
    else:
        known = "None."

    return (
        f"{directives_text}\n\n"
        "The image shows Wai's reMarkable page. The printed text above was already there. "
        "Any handwritten marks/strokes are Wai's annotations added during the day.\n\n"
        "1. Describe the handwritten annotations (if any visible).\n"
        "2. Based on those, how should tomorrow's plan change?\n"
        "3. Extract any facts about Wai that should be remembered long-term "
        "(preferences, relationships, constraints, recurring patterns). "
        "Short declarative sentences only. Empty list if nothing new.\n"
        f"ALREADY KNOWN — do not repeat these:\n{known}\n\n"
        'JSON only: {"wai_notes": "...", "adjustments": "...", "context_updates": ["..."]}'
    )


def analyze_delta(path: str = None) -> dict:
    import anthropic
    from rm_to_pdf import rasterize

    latest_path = path or pull_exec()

    png_bytes = rasterize(latest_path, page_index=0)
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
        existing = {n["note"].strip().lower() for n in ctx.get("notes", [])}
        today = date.today().isoformat()
        for note in updates:
            if note.strip().lower() not in existing:
                ctx["notes"].append({"date": today, "note": note.strip()})
                existing.add(note.strip().lower())
        ctx_path.write_text(json.dumps(ctx, indent=2))

    return delta


# ── update rd from delta ───────────────────────────────────────────────────────

def update_rd_from_delta(delta: dict) -> str:
    import anthropic

    rd_path = DATA_DIR / "rd.json"
    rd = json.loads(rd_path.read_text()) if rd_path.exists() else {"cards": []}
    cards = rd.get("cards", [])

    selected = [c for c in cards if c.get("column") == "hq"]
    if not selected:
        return "No selected cards to update."

    cards_text = "\n".join(
        f"- id:{c['id']} [{c.get('size','task')}] {c['title']}"
        for c in selected
    )
    notes = (delta.get("wai_notes", "") + "\n" + delta.get("adjustments", "")).strip()

    client = anthropic.Anthropic()
    msg = client.messages.create(
        model="claude-haiku-4-5-20251001",
        max_tokens=256,
        messages=[{"role": "user", "content": (
            f"Based on Wai's day notes, which r&d cards should move to 'ashes' (completed or abandoned)?\n\n"
            f"SELECTED CARDS:\n{cards_text}\n\n"
            f"WAI'S NOTES:\n{notes or 'No notes recorded.'}\n\n"
            "Return IDs to archive. If none, return empty list.\n"
            'JSON only: {"move_to_ashes": ["id", ...], "summary": "one sentence"}'
        )}],
    )

    text = msg.content[0].text
    m = re.search(r'\{[\s\S]*\}', text)
    parsed = json.loads(m.group()) if m else {"move_to_ashes": []}

    move_ids = set(parsed.get("move_to_ashes", []))
    for c in cards:
        if c["id"] in move_ids:
            c["column"] = "archives"

    rd["cards"] = cards
    rd_path.write_text(json.dumps(rd, indent=2))

    return parsed.get("summary", "")


# ── morning recap ──────────────────────────────────────────────────────────────


def generate_morning_recap(delta: dict, omens: dict, rd_changes: str) -> dict:
    import anthropic

    ctx_path = DATA_DIR / "context.json"
    ctx = json.loads(ctx_path.read_text()) if ctx_path.exists() else {"notes": []}
    ctx_text = "\n".join(
        f"- [{n.get('date','')}] {n['note']}" for n in ctx.get("notes", [])[-15:]
    ) or "None."

    rd_path = DATA_DIR / "rd.json"
    rd = json.loads(rd_path.read_text()) if rd_path.exists() else {"cards": []}
    cards = rd.get("cards", [])
    selected = sorted([c for c in cards if c.get("column") == "hq"], key=lambda c: c.get("order", 0))
    ideas = sorted([c for c in cards if c.get("column") == "rd"], key=lambda c: c.get("order", 0))

    selected_text = "\n".join(
        f"- [{c.get('size','task')}] {c['title']}" for c in selected
    ) or "None."
    ideas_text = "\n".join(
        f"- [{c.get('size','task')}] {c['title']} ({c.get('category','')})"
        for c in ideas[:15]
    ) or "None."
    events_text = "\n".join(
        f"- {e['title']} ({e.get('date','?')})" for e in omens.get("events", [])
    ) or "None."

    prompt = (
        f"Generate a morning briefing for Wai's planning terminal. Be terse. Use lists. No prose except the final question.\n\n"
        f"YESTERDAY — what Wai wrote/did:\n{delta.get('wai_notes', 'No annotations recorded.')}\n\n"
        f"YESTERDAY — adjustments for today:\n{delta.get('adjustments', 'None.')}\n\n"
        f"R&D CHANGES APPLIED:\n{rd_changes or 'None.'}\n\n"
        f"CURRENTLY SELECTED:\n{selected_text}\n\n"
        f"IDEAS POOL:\n{ideas_text}\n\n"
        f"UPCOMING EVENTS:\n{events_text}\n\n"
        f"KNOWN CONTEXT:\n{ctx_text}\n\n"
        f"Output format (use exactly this structure, plain text):\n\n"
        f"yesterday\n"
        f"- [bullet per notable thing done or noted, use real task names, skip if nothing]\n\n"
        f"carrying forward\n"
        f"- [tasks still selected or recommended from adjustments]\n\n"
        f"omens\n"
        f"- [time-sensitive events only, skip section if none]\n\n"
        f"suggested\n"
        f"- [2-3 specific r&d items from ideas pool that fit context and delta]\n\n"
        f"[one short human question about today's time and energy — the only sentence that sounds like a person]\n\n"
        f"No headers with colons. No markdown. No extra commentary."
    )

    client = anthropic.Anthropic()
    msg = client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=500,
        messages=[{"role": "user", "content": prompt}],
    )

    result = {
        "generated_at": datetime.now().isoformat(),
        "opening_message": msg.content[0].text.strip(),
    }
    (DATA_DIR / "morning.json").write_text(json.dumps(result, indent=2))
    return result


# ── morning pipeline ───────────────────────────────────────────────────────────

def build_morning() -> dict:
    # Clear previous day's chat
    chat_path = DATA_DIR / "chat.json"
    if chat_path.exists():
        chat_path.unlink()

    # Dedupe context notes daily
    ctx_path = DATA_DIR / "context.json"
    if ctx_path.exists():
        ctx = json.loads(ctx_path.read_text())
        if len(ctx.get("notes", [])) > 1:
            ctx["notes"] = _dedupe_context(ctx["notes"])
            ctx_path.write_text(json.dumps(ctx, indent=2))

    latest_path = pull_exec(baseline=True)
    delta = analyze_delta(path=latest_path)
    omens = analyze_omens()
    rd_changes = update_rd_from_delta(delta)
    recap = generate_morning_recap(delta, omens, rd_changes)
    push_pdf()
    return recap


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


CALENDAR_IDS = [
    "wl.wailau@gmail.com",
    "family02183524598292154389@group.calendar.google.com",
    "lk327a43fqki6f02k23hg7uufg5kn5vj@import.calendar.google.com",  # Mindscape Counselling Collective
]


def fetch_calendar_events(days_ahead: int = 14) -> list:
    from googleapiclient.discovery import build as gcal_build

    creds = _gcal_creds()
    service = gcal_build("calendar", "v3", credentials=creds)

    now = datetime.utcnow().isoformat() + "Z"
    end = (datetime.utcnow() + timedelta(days=days_ahead)).isoformat() + "Z"

    events = []
    seen = set()
    for cal_id in CALENDAR_IDS:
        try:
            result = service.events().list(
                calendarId=cal_id,
                timeMin=now,
                timeMax=end,
                singleEvents=True,
                orderBy="startTime",
                maxResults=20,
            ).execute()
            for item in result.get("items", []):
                key = (item.get("summary", ""), item["start"].get("dateTime", item["start"].get("date", "")))
                if key not in seen:
                    seen.add(key)
                    events.append({
                        "summary": item.get("summary", "Untitled"),
                        "start": item["start"].get("dateTime", item["start"].get("date", "")),
                        "description": item.get("description", ""),
                    })
        except Exception:
            pass

    events.sort(key=lambda e: e["start"])
    return events


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
        max_tokens=1024,
        messages=[{
            "role": "user",
            "content": (
                f"Wai's upcoming calendar events (next 14 days):\n{events_text}\n\n"
                "List ALL events in the next 3 days without exception. "
                "For events 4-14 days away, include anything social, medical, or requiring prep — skip only truly trivial recurring events (e.g. daily alarms, auto-generated). "
                'Return as JSON only: {"events": [{"title": "...", "date": "...", "prep_notes": "..."}]}'
            ),
        }],
    )

    text = msg.content[0].text
    m = re.search(r'\{[\s\S]*\}', text)
    try:
        parsed = json.loads(m.group()) if m else {"events": []}
    except json.JSONDecodeError:
        parsed = {"events": []}

    omens = {
        "checked_at": datetime.now().isoformat(),
        "events": parsed.get("events", []),
    }
    (DATA_DIR / "omens.json").write_text(json.dumps(omens, indent=2))
    return omens


# ── chat support ──────────────────────────────────────────────────────────────

def _build_chat_system_prompt(stage: str = "planning") -> str:
    def _load(name):
        p = DATA_DIR / f"{name}.json"
        return json.loads(p.read_text()) if p.exists() else {}

    ctx = _load("context")
    delta = _load("delta")
    omens = _load("omens")
    rd = _load("rd")
    morning = _load("morning")

    ctx_text = "\n".join(
        f"- [{n.get('date','')}] {n['note']}" for n in ctx.get("notes", [])[-15:]
    ) or "None."
    delta_text = (
        f"NOTES: {delta.get('wai_notes', 'None.')}\n"
        f"ADJUSTMENTS: {delta.get('adjustments', 'None.')}"
    )
    events_text = "\n".join(
        f"- {e['title']} ({e.get('date','?')})" for e in omens.get("events", [])
    ) or "None."

    cards = rd.get("cards", [])
    selected = sorted([c for c in cards if c.get("column") == "hq"], key=lambda c: c.get("order", 0))
    ideas = sorted([c for c in cards if c.get("column") == "rd"], key=lambda c: c.get("order", 0))

    selected_text = "\n".join(
        f"- id:{c['id']} [{c.get('size','task')}] {c['title']} ({c.get('category','')}): {c.get('description','')}"
        for c in selected
    ) or "None."
    ideas_text = "\n".join(
        f"- id:{c['id']} [{c.get('size','task')}] {c['title']} ({c.get('category','')}): {c.get('description','')}"
        for c in ideas[:15]
    ) or "None."
    ctx_text = "\n".join(f"- [{n.get('date','')}] {n['note']}" for n in ctx.get("notes", [])) or "None."

    stage_instructions = {
        "planning": (
            "Help Wai select tasks for today from the ideas pool or confirm existing selected tasks. "
            "Consider their available time and energy. Make specific suggestions with card IDs. "
            "Book category cards are for reading only — do NOT select them for directives. "
            "You can manage cards freely: create_card (new idea), move_card (change column), update_card (edit fields), delete_card (permanent removal). "
            "Use move_card to archive completed tasks or exile dropped ones without being asked twice. "
            "When finalizing, categorize each card: SEEK=requires going outdoors, HACK=quick at home (under 1h), DIVE=extended focus/setup/cleanup (over 1h). "
            "When Wai confirms their plan, immediately call finalize_and_push — do NOT ask for a second confirmation. "
            "Keep responses concise — this is a planning terminal, not a chat app."
        ),
        "done": (
            "The plan has been finalized and pushed to reMarkable. Wrap up warmly. No more actions needed."
        ),
    }

    return (
        f"You are Wai's personal AI planning assistant. Wai has ADHD and uses this tool daily for executive function.\n"
        f"FORMATTING: Plain text only. No markdown — no **, no *, no #, no -, no bullet points, no headers.\n"
        f"Never expose raw card IDs or internal formats (e.g. 'id:card-123 [task]') in your responses — refer to tasks by title only.\n"
        f"Never state that a card is selected or on the active board unless it appears under CURRENTLY SELECTED TASKS. Do not invent or assume task status.\n\n"
        f"STAGE: {stage.upper()}\n"
        f"INSTRUCTION: {stage_instructions.get(stage, stage_instructions['planning'])}\n\n"
        f"MORNING BRIEFING CONTEXT:\n{morning.get('opening_message', 'No briefing available.')}\n\n"
        f"YESTERDAY'S DELTA:\n{delta_text}\n\n"
        f"UPCOMING EVENTS:\n{events_text}\n\n"
        f"CURRENTLY SELECTED TASKS:\n{selected_text}\n\n"
        f"IDEAS POOL (top 15):\n{ideas_text}\n\n"
        f"KNOWN CONTEXT:\n{ctx_text}"
    )


def _chat_tools() -> list:
    return [
        {
            "name": "finalize_and_push",
            "description": "Finalize today's plan and push the PDF to reMarkable. Categorize each selected card into SEEK/HACK/DIVE. Call immediately once Wai confirms — no second confirmation needed.",
            "input_schema": {
                "type": "object",
                "properties": {
                    "seek_ids": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "Card IDs requiring going outdoors (errands, outdoor activities, travel).",
                    },
                    "hack_ids": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "Card IDs that can be done quickly at home (under an hour, minimal setup).",
                    },
                    "dive_ids": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "Card IDs requiring setup/cleanup, extended focus, or a complete session (over an hour).",
                    },
                    "encouraging_message": {
                        "type": "string",
                        "description": "Short encouraging message for Wai, printed on the reMarkable.",
                    },
                    "context_note": {
                        "type": "string",
                        "description": "New long-term fact about Wai to remember (optional).",
                    },
                },
                "required": ["seek_ids", "hack_ids", "dive_ids", "encouraging_message"],
            },
        },
        {
            "name": "create_card",
            "description": "Add a new card to the r&d ideas pool. Use when Wai mentions a new project or task idea.",
            "input_schema": {
                "type": "object",
                "properties": {
                    "title": {"type": "string", "description": "Short title for the card."},
                    "category": {
                        "type": "string",
                        "enum": ["Hobby", "Interfacing", "Social", "Self", "Book"],
                        "description": "Interfacing=admin/home/parents/partner/work; Hobby=crafts/art/gaming; Social=events/friends; Self=self-care/wellness/improvement; Book=reading/studying.",
                    },
                    "size": {
                        "type": "string",
                        "enum": ["chore", "task", "project", "titan", "book"],
                        "description": "Size: chore (<1h), task (<4h), project (days), titan (weeks), book (long read).",
                    },
                    "description": {"type": "string", "description": "One-sentence description."},
                },
                "required": ["title", "category", "size"],
            },
        },
        {
            "name": "refresh_omens",
            "description": "Refetch upcoming calendar events from Google Calendar and update omens. Use when Wai asks about upcoming events or wants omens refreshed.",
            "input_schema": {"type": "object", "properties": {}},
        },
        {
            "name": "move_card",
            "description": "Move a card to a different column. Use to archive completed tasks, exile irrelevant ones, or pull ideas into the active pool.",
            "input_schema": {
                "type": "object",
                "properties": {
                    "id": {"type": "string", "description": "Card ID."},
                    "column": {
                        "type": "string",
                        "enum": ["rd", "hq", "archives", "exile"],
                        "description": "rd=ideas pool, hq=today's plan, archives=completed, exile=dropped.",
                    },
                },
                "required": ["id", "column"],
            },
        },
        {
            "name": "update_card",
            "description": "Update fields on an existing card (title, description, category, size, notes). Only include fields that should change.",
            "input_schema": {
                "type": "object",
                "properties": {
                    "id": {"type": "string", "description": "Card ID."},
                    "title": {"type": "string"},
                    "description": {"type": "string"},
                    "category": {"type": "string", "enum": ["Hobby", "Interfacing", "Social", "Self", "Book"]},
                    "size": {"type": "string", "enum": ["chore", "task", "project", "titan", "book"]},
                    "notes": {"type": "string"},
                },
                "required": ["id"],
            },
        },
        {
            "name": "delete_card",
            "description": "Permanently delete a card. Use only when Wai explicitly asks to remove it entirely.",
            "input_schema": {
                "type": "object",
                "properties": {
                    "id": {"type": "string", "description": "Card ID to delete."},
                },
                "required": ["id"],
            },
        },
        {
            "name": "update_preview",
            "description": "Refresh the preview panel in the UI to show the latest directives, cards, and omens. Call after changes that Wai should see reflected immediately. Always include a fresh encouraging_message.",
            "input_schema": {
                "type": "object",
                "properties": {
                    "encouraging_message": {
                        "type": "string",
                        "description": "Fresh encouraging message for Wai, shown in the preview panel.",
                    },
                },
                "required": ["encouraging_message"],
            },
        },
    ]


def _dedupe_context(notes: list) -> list:
    import anthropic
    lines = "\n".join(f"{i}. [{n.get('date','')}] {n['note']}" for i, n in enumerate(notes))
    client = anthropic.Anthropic()
    msg = client.messages.create(
        model="claude-haiku-4-5-20251001",
        max_tokens=512,
        messages=[{"role": "user", "content": (
            f"These are long-term memory notes about a person:\n{lines}\n\n"
            "Remove exact or near-duplicate notes, keeping the most recent or most specific version. "
            "Return only the indices to KEEP as JSON: {\"keep\": [0, 1, ...]}"
        )}],
    )
    try:
        m = re.search(r'\{[\s\S]*\}', msg.content[0].text)
        keep = set(json.loads(m.group()).get("keep", range(len(notes)))) if m else set(range(len(notes)))
    except Exception:
        return notes
    return [n for i, n in enumerate(notes) if i in keep]


def _handle_tool(name: str, input_: dict) -> dict:
    if name == "finalize_and_push":
        seek_ids = list(input_.get("seek_ids", []))
        hack_ids = list(input_.get("hack_ids", []))
        dive_ids = list(input_.get("dive_ids", []))
        selected_ids = set(seek_ids + hack_ids + dive_ids)
        encouraging = input_.get("encouraging_message", "")
        context_note = input_.get("context_note", "")

        rd_path = DATA_DIR / "rd.json"
        rd = json.loads(rd_path.read_text()) if rd_path.exists() else {"cards": []}
        cards_by_id = {c["id"]: c for c in rd.get("cards", [])}
        for c in rd.get("cards", []):
            if c.get("column") in ("hq", "rd"):
                c["column"] = "hq" if c["id"] in selected_ids else "rd"
        rd_path.write_text(json.dumps(rd, indent=2))

        def _card_obj(id_):
            card = cards_by_id.get(id_)
            if not card:
                return None
            steps = [s.strip() for s in card.get("description", "").split(".") if s.strip()]
            return {"id": id_, "title": card["title"], "steps": steps}

        directives = {
            "generated_at": datetime.now().isoformat(),
            "seek": [o for o in (_card_obj(i) for i in seek_ids) if o],
            "hack": [o for o in (_card_obj(i) for i in hack_ids) if o],
            "dive": [o for o in (_card_obj(i) for i in dive_ids) if o],
            "encouraging_message": encouraging,
        }
        (DATA_DIR / "directives.json").write_text(json.dumps(directives, indent=2))

        if context_note and context_note.strip():
            ctx_path = DATA_DIR / "context.json"
            ctx = json.loads(ctx_path.read_text()) if ctx_path.exists() else {"notes": []}
            ctx["notes"].append({"date": date.today().isoformat(), "note": context_note.strip()})
            ctx_path.write_text(json.dumps(ctx, indent=2))

        pdf_name = push_pdf()
        return {"pushed": pdf_name, "selected": len(selected_ids)}

    if name == "create_card":
        import time as _time
        rd_path = DATA_DIR / "rd.json"
        rd = json.loads(rd_path.read_text()) if rd_path.exists() else {"columns": ["rd", "hq", "archives", "exile"], "cards": []}
        new_id = f"card-{int(_time.time() * 1000)}"
        existing = rd.get("cards", [])
        max_order = max((c.get("order", 0) for c in existing if c.get("column") == "rd"), default=-1)
        new_card = {
            "id": new_id,
            "title": input_.get("title", ""),
            "category": input_.get("category", "Self"),
            "size": input_.get("size", "task"),
            "description": input_.get("description", ""),
            "column": "rd",
            "order": max_order + 1,
            "due_date": None,
            "notes": "",
        }
        existing.append(new_card)
        rd["cards"] = existing
        rd_path.write_text(json.dumps(rd, indent=2))
        return {"ok": True, "id": new_id, "title": new_card["title"]}

    if name == "refresh_omens":
        result = analyze_omens()
        events = result.get("events", [])
        summary = ", ".join(e.get("title", "") for e in events) if events else "none"
        return {"ok": True, "event_count": len(events), "events": summary}

    if name == "move_card":
        rd_path = DATA_DIR / "rd.json"
        rd = json.loads(rd_path.read_text()) if rd_path.exists() else {"cards": []}
        card = next((c for c in rd.get("cards", []) if c["id"] == input_.get("id")), None)
        if not card:
            return {"error": f"Card not found: {input_.get('id')}"}
        card["column"] = input_["column"]
        rd_path.write_text(json.dumps(rd, indent=2))
        return {"ok": True, "id": card["id"], "title": card["title"], "column": card["column"]}

    if name == "update_card":
        rd_path = DATA_DIR / "rd.json"
        rd = json.loads(rd_path.read_text()) if rd_path.exists() else {"cards": []}
        card = next((c for c in rd.get("cards", []) if c["id"] == input_.get("id")), None)
        if not card:
            return {"error": f"Card not found: {input_.get('id')}"}
        for field in ("title", "description", "category", "size", "notes"):
            if field in input_:
                card[field] = input_[field]
        rd_path.write_text(json.dumps(rd, indent=2))
        return {"ok": True, "id": card["id"], "title": card["title"]}

    if name == "delete_card":
        rd_path = DATA_DIR / "rd.json"
        rd = json.loads(rd_path.read_text()) if rd_path.exists() else {"cards": []}
        before = len(rd.get("cards", []))
        rd["cards"] = [c for c in rd.get("cards", []) if c["id"] != input_.get("id")]
        if len(rd["cards"]) == before:
            return {"error": f"Card not found: {input_.get('id')}"}
        rd_path.write_text(json.dumps(rd, indent=2))
        return {"ok": True, "deleted": input_.get("id")}

    if name == "update_preview":
        msg = input_.get("encouraging_message", "")
        if msg:
            dir_path = DATA_DIR / "directives.json"
            d = json.loads(dir_path.read_text()) if dir_path.exists() else {}
            d["encouraging_message"] = msg
            dir_path.write_text(json.dumps(d, indent=2))
        return {"ok": True}

    return {"error": f"Unknown tool: {name}"}


def _save_chat(messages: list, stage: str):
    chat = {
        "messages": messages,
        "stage": stage,
        "updated_at": datetime.now().isoformat(),
    }
    (DATA_DIR / "chat.json").write_text(json.dumps(chat, indent=2))


def get_chat() -> dict:
    p = DATA_DIR / "chat.json"
    return json.loads(p.read_text()) if p.exists() else {"messages": [], "stage": "planning"}


# ── card classification ───────────────────────────────────────────────────────

def classify_card(title: str) -> dict:
    import anthropic

    client = anthropic.Anthropic()
    msg = client.messages.create(
        model="claude-haiku-4-5-20251001",
        max_tokens=256,
        messages=[{"role": "user", "content": (
            f'Categorize this personal task for Wai: "{title}"\n\n'
            "Categories (pick one):\n"
            "- Interfacing: personal admin, organization, home improvement, taking care of parents or partner, work, productivity systems, tech tools\n"
            "- Hobby: crafts, creative projects, making things, cosplay, gaming, art\n"
            "- Social: events, social plans, gatherings, helping friends\n"
            "- Self: self-care, self-improvement, personal wellness, mental health\n"
            "- Book: reading, studying, long-form learning, research\n\n"
            "Sizes (pick one):\n"
            "- chore: under 1 hour\n"
            "- task: under 4 hours\n"
            "- book: ongoing read / long-form written work\n"
            "- project: under 2 days\n"
            "- titan: longer — reminder to break it down further\n\n"
            'JSON only: {"category": "...", "size": "...", "description": "one sentence"}'
        )}],
    )
    text = msg.content[0].text
    m = re.search(r'\{[\s\S]*\}', text)
    parsed = json.loads(m.group()) if m else {}
    return {
        "category": parsed.get("category", "Self"),
        "size": parsed.get("size", "task"),
        "description": parsed.get("description", ""),
    }
