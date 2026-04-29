import json
from datetime import datetime, date, timedelta, timezone
from pathlib import Path

DATA_DIR = Path("/app/data")

GCAL_SCOPES = ["https://www.googleapis.com/auth/calendar.events"]
GCAL_CONFIG_DIR = Path("/root/.config/gcal")
GCAL_TOKEN_PATH = GCAL_CONFIG_DIR / "token.json"
GCAL_CREDS_PATH = GCAL_CONFIG_DIR / "credentials.json"
GCAL_REDIRECT_URI = "https://wai-lau.net/api/gcal/callback"
PRIMARY_CALENDAR_ID = "wl.wailau@gmail.com"

CALENDAR_IDS = [
    "wl.wailau@gmail.com",
    "family02183524598292154389@group.calendar.google.com",
    "lk327a43fqki6f02k23hg7uufg5kn5vj@import.calendar.google.com",
]

ICS_FEEDS = [
    "http://mcc.janeapp.com/ical/23xbVylhhdvV0NzKSpbh/appointments.ics",
]

_gcal_pending_state: dict = {}


def _load_json(name: str, default=None):
    p = DATA_DIR / f"{name}.json"
    if p.exists():
        return json.loads(p.read_text())
    return default if default is not None else {}


def gcal_start_auth() -> str:
    from google_auth_oauthlib.flow import Flow

    if not GCAL_CREDS_PATH.exists():
        raise RuntimeError(f"Missing {GCAL_CREDS_PATH} — copy credentials.json there first.")

    flow = Flow.from_client_secrets_file(
        str(GCAL_CREDS_PATH), scopes=GCAL_SCOPES, redirect_uri=GCAL_REDIRECT_URI
    )
    auth_url, state = flow.authorization_url(prompt="consent", access_type="offline")
    _gcal_pending_state["state"] = state
    _gcal_pending_state["flow"] = flow
    return auth_url


def gcal_complete_auth(code: str, state: str) -> None:
    if state != _gcal_pending_state.get("state"):
        raise RuntimeError("OAuth state mismatch — restart auth flow.")
    flow = _gcal_pending_state.get("flow")
    if not flow:
        raise RuntimeError("No pending auth flow — visit /api/gcal/auth first.")
    flow.fetch_token(code=code)
    creds = flow.credentials
    GCAL_CONFIG_DIR.mkdir(parents=True, exist_ok=True)
    GCAL_TOKEN_PATH.write_text(creds.to_json())
    _gcal_pending_state.clear()


def _gcal_creds():
    from google.oauth2.credentials import Credentials
    from google.auth.transport.requests import Request

    if not GCAL_TOKEN_PATH.exists():
        raise RuntimeError(
            "Google Calendar not authenticated. Visit https://wai-lau.net/api/gcal/auth"
        )
    creds = Credentials.from_authorized_user_file(str(GCAL_TOKEN_PATH))
    if creds.expired and creds.refresh_token:
        creds.refresh(Request())
        GCAL_TOKEN_PATH.write_text(creds.to_json())
    return creds


def _fetch_ics_events(url: str, days_ahead: int) -> list:
    import urllib.request
    from icalendar import Calendar

    now_dt = datetime.now(timezone.utc)
    end_dt = now_dt + timedelta(days=days_ahead)

    with urllib.request.urlopen(url, timeout=15) as resp:
        cal = Calendar.from_ical(resp.read())

    events = []
    for component in cal.walk():
        if component.name != "VEVENT":
            continue
        try:
            dtstart = component.get("DTSTART").dt
            if not hasattr(dtstart, "tzinfo"):
                dtstart = datetime(dtstart.year, dtstart.month, dtstart.day, tzinfo=timezone.utc)
            elif dtstart.tzinfo is None:
                dtstart = dtstart.replace(tzinfo=timezone.utc)
            if dtstart < now_dt or dtstart > end_dt:
                continue
            summary = str(component.get("SUMMARY", "Untitled"))
            events.append({
                "id": str(component.get("UID", "")),
                "summary": summary,
                "start": dtstart.isoformat(),
                "description": str(component.get("DESCRIPTION", "")),
            })
        except Exception:
            pass
    return events


def _is_declined(item: dict) -> bool:
    return any(a.get("self") and a.get("responseStatus") == "declined" for a in item.get("attendees", []))


def _dedup_key(summary: str, start: str) -> tuple:
    return (summary.strip().lower(), start[:10])


def fetch_calendar_events(days_ahead: int = 30, days_behind: int = 5) -> list:
    from googleapiclient.discovery import build as gcal_build

    creds = _gcal_creds()
    service = gcal_build("calendar", "v3", credentials=creds)
    start = (datetime.now(timezone.utc) - timedelta(days=days_behind)).isoformat()
    end = (datetime.now(timezone.utc) + timedelta(days=days_ahead)).isoformat()

    events, seen = [], set()
    for cal_id in CALENDAR_IDS:
        try:
            result = service.events().list(
                calendarId=cal_id, timeMin=start, timeMax=end,
                singleEvents=True, orderBy="startTime", maxResults=20,
            ).execute()
            for item in result.get("items", []):
                if _is_declined(item):
                    continue
                start_str = item["start"].get("dateTime", item["start"].get("date", ""))
                key = _dedup_key(item.get("summary", ""), start_str)
                if key not in seen:
                    seen.add(key)
                    events.append({
                        "id": item.get("id", ""),
                        "summary": item.get("summary", "Untitled"),
                        "start": start_str,
                        "description": item.get("description", ""),
                    })
        except Exception:
            pass

    for ics_url in ICS_FEEDS:
        try:
            for ev in _fetch_ics_events(ics_url, days_ahead):
                key = _dedup_key(ev["summary"], ev["start"])
                if key not in seen:
                    seen.add(key)
                    events.append(ev)
        except Exception:
            pass

    events.sort(key=lambda e: e["start"])
    return events


def create_gcal_event(title: str, start: str, end: str | None = None, description: str = "") -> dict:
    from googleapiclient.discovery import build as gcal_build

    creds = _gcal_creds()
    service = gcal_build("calendar", "v3", credentials=creds)

    all_day = "T" not in start
    if all_day:
        start_obj = {"date": start[:10]}
        if end:
            end_obj = {"date": end[:10]}
        else:
            end_date = (date.fromisoformat(start[:10]) + timedelta(days=1)).isoformat()
            end_obj = {"date": end_date}
    else:
        start_obj = {"dateTime": start, "timeZone": "America/New_York"}
        if end:
            end_obj = {"dateTime": end, "timeZone": "America/New_York"}
        else:
            from datetime import datetime as _dt
            start_dt = _dt.fromisoformat(start)
            end_dt = start_dt + timedelta(hours=1)
            end_obj = {"dateTime": end_dt.isoformat(), "timeZone": "America/New_York"}

    body = {"summary": title, "start": start_obj, "end": end_obj}
    if description:
        body["description"] = description

    event = service.events().insert(calendarId=PRIMARY_CALENDAR_ID, body=body).execute()
    return {"ok": True, "event_id": event.get("id"), "link": event.get("htmlLink")}


def _fetch_gcal_raw_full(days_ahead: int = 365) -> list:
    """Fetch all GCal events for next N days, keeping only first occurrence of each recurring series."""
    from googleapiclient.discovery import build as gcal_build

    creds = _gcal_creds()
    service = gcal_build("calendar", "v3", credentials=creds)
    now = datetime.now(timezone.utc)
    end = now + timedelta(days=days_ahead)

    raw, seen_keys, seen_recurring = [], set(), set()

    for cal_id in CALENDAR_IDS:
        try:
            page_token = None
            while True:
                result = service.events().list(
                    calendarId=cal_id,
                    timeMin=now.isoformat(),
                    timeMax=end.isoformat(),
                    singleEvents=True,
                    orderBy="startTime",
                    maxResults=250,
                    pageToken=page_token,
                ).execute()
                for item in result.get("items", []):
                    if _is_declined(item):
                        continue
                    start_str = item["start"].get("dateTime", item["start"].get("date", ""))
                    summary = (item.get("summary") or "Untitled").strip()
                    rec_id = item.get("recurringEventId", "")
                    if rec_id:
                        if rec_id in seen_recurring:
                            continue
                        seen_recurring.add(rec_id)
                    else:
                        key = _dedup_key(summary, start_str)
                        if key in seen_keys:
                            continue
                        seen_keys.add(key)
                    desc = (item.get("description") or "")[:300]
                    raw.append({
                        "id": item.get("id", ""),
                        "recurring_event_id": rec_id,
                        "summary": summary,
                        "start": start_str,
                        "end": item["end"].get("dateTime", item["end"].get("date", "")),
                        "location": item.get("location", ""),
                        "description": desc,
                        "organizer": item.get("organizer", {}).get("email", ""),
                        "calendar_id": cal_id,
                        "is_recurring": bool(rec_id),
                    })
                page_token = result.get("nextPageToken")
                if not page_token:
                    break
        except Exception:
            pass

    raw.sort(key=lambda e: e["start"])
    return raw


def _haiku_classify_batch(client, batch: list) -> None:
    from helpers import _parse_json
    lines = []
    for j, ev in enumerate(batch):
        recur = " [recurring]" if ev.get("is_recurring") else ""
        loc = f" @ {ev['location']}" if ev.get("location") else ""
        lines.append(f"{j}: {ev['summary']}{recur}{loc} ({ev['start'][:10]})")
    try:
        resp = client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=1200,
            messages=[{"role": "user", "content": (
                "Classify these calendar events for Wai (personal productivity app).\n\n"
                + "\n".join(lines) + "\n\n"
                "is_reminder: true = just an FYI (birthday, holiday, anniversary, appointment reminder, "
                "someone else's recurring event); false = Wai needs to actively do something\n"
                "recur_type: week|bi-week|month|holiday|birthday|null\n"
                "category: Interfacing|Social|Self|Hobby|Book\n\n"
                'JSON array only: [{"i":0,"is_reminder":true,"recur_type":null,"category":"Interfacing"},...]'
            )}],
        )
        for item in _parse_json(resp.content[0].text):
            idx = item.get("i")
            if idx is not None and 0 <= idx < len(batch):
                batch[idx].update({
                    "is_reminder": item.get("is_reminder", True),
                    "recur_type": item.get("recur_type") or None,
                    "category": item.get("category", "Interfacing"),
                })
    except Exception:
        pass
    for ev in batch:
        ev.setdefault("is_reminder", True)
        ev.setdefault("recur_type", None)
        ev.setdefault("category", "Interfacing")



def _haiku_classify_events(events: list) -> list:
    import anthropic
    client = anthropic.Anthropic()
    for i in range(0, len(events), 25):
        _haiku_classify_batch(client, events[i:i + 25])
    return events


def import_gcal_cards() -> dict:
    """One-time import: pull 365 days of GCal events → classify with Haiku → rd.json cards."""
    import time as _time
    from helpers import _load_rd, _save_rd, _append_rd_log

    # Fetch full raw data and save
    raw = _fetch_gcal_raw_full(days_ahead=365)
    (DATA_DIR / "gcal_events_raw.json").write_text(json.dumps(raw, indent=2))

    rd = _load_rd()

    # Exact-match dedup (title+date)
    existing_keys = {(c.get("title", "").lower().strip(), (c.get("due_date") or "")[:10]) for c in rd.get("cards", [])}
    to_classify = [ev for ev in raw if (ev["summary"].lower(), ev["start"][:10]) not in existing_keys]

    # Haiku classify
    classified = _haiku_classify_events(to_classify)

    cards = rd.get("cards", [])
    imported = 0
    for ev in classified:
        if ev.get("skip"):
            continue
        notes_parts = []
        if ev.get("description"):
            notes_parts.append(ev["description"])
        if ev.get("location"):
            notes_parts.append(f"location: {ev['location']}")
        card = {
            "id": f"card-{int(_time.time() * 1000) + imported}",
            "title": ev["summary"],
            "category": ev.get("category", "Interfacing"),
            "size": "chore",
            "column": "rd",
            "order": -(imported + 1),
            "due_date": ev["start"][:10] if ev.get("start") else None,
            "start_before": None,
            "estimated_time": 30,
            "is_reminder": ev.get("is_reminder", True),
            "recur_type": ev.get("recur_type") or None,
            "scheduled_day": None,
            "manual_pin": False,
            "notes": "\n".join(notes_parts) or "",
        }
        cards.append(card)
        _append_rd_log("imported", ev["summary"], source="core", due_date=card["due_date"])
        imported += 1

    rd["cards"] = cards
    _save_rd(rd)
    return {"imported": imported, "raw_count": len(raw), "skipped_exact_dupes": len(raw) - len(to_classify)}


def fetch_omens() -> dict:
    def _fmt_date(iso: str) -> str:
        try:
            today = date.today()
            if "T" in iso:
                dt = datetime.fromisoformat(iso)
                d, delta = dt.date(), (dt.date() - today).days
                hour = dt.strftime("%I%p").lstrip("0").replace(":00", "")
                return f"{d.strftime('%A')} {hour}" if delta <= 6 else f"{d.strftime('%B')} {d.day} {hour}"
            else:
                d = date.fromisoformat(iso[:10])
                delta = (d - today).days
                return d.strftime("%A") if delta <= 6 else f"{d.strftime('%B')} {d.day}"
        except Exception:
            return iso

    events = fetch_calendar_events()
    omens = {
        "checked_at": datetime.now(timezone.utc).isoformat(),
        "events": [{"event_id": e.get("id", ""), "title": e["summary"], "date": _fmt_date(e["start"]), "date_iso": e["start"][:10]} for e in events],
    }
    (DATA_DIR / "omens.json").write_text(json.dumps(omens, indent=2))
    return omens
