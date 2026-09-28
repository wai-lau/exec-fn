"""noodle's HTML. Its own shell (api/templates/noodle-shell.html), NOT the
site's page composer -- no nav, no Exec bubble, no CRT stack, and no import of
the app's pages module. It links /chrome.css only for the palette + scale
tokens, which are CSS, not code."""
import html
import json
import re
from pathlib import Path

from noodle import config

_TEMPLATES = Path(__file__).resolve().parent.parent / "templates"


def _tmpl(name: str) -> str:
    # read per request, like the rest of the site's templates (live edits)
    return (_TEMPLATES / name).read_text(encoding="utf-8")


def _fill(text: str, **values: str) -> str:
    # ONE pass, so a value (a poll title, say) that itself contains "{{X}}"
    # is never substituted into.
    return re.sub(r"\{\{(\w+)\}\}", lambda m: values.get(m.group(1), m.group(0)), text)


def _page(title: str, body: str) -> str:
    return _fill(_tmpl("noodle-shell.html"), TITLE=html.escape(title), BODY=body)


def _kdf_attrs() -> str:
    kdf = {"m": config.KDF_M_KIB, "t": config.KDF_T, "p": config.KDF_P,
           "len": config.KDF_LEN, "debounce": config.KDF_DEBOUNCE_MS}
    return html.escape(json.dumps(kdf), quote=True)


def vote_page(poll: dict) -> str:
    body = _fill(
        _tmpl("noodle-vote.html"),
        SLUG=html.escape(poll["slug"], quote=True),
        TITLE=html.escape(poll["title"]),
        KDF=_kdf_attrs(),
        ASK_MAX=str(config.ASK_MAX_CHARS),
    )
    return _page(f"noodle: {poll['title']}", body)


def admin_page() -> str:
    body = _tmpl("noodle-admin.html")
    return _page("noodle", body)


def public_poll(poll: dict) -> dict:
    """What anyone holding the link may see: window, and each voter's name,
    public key and slots. Never a budget counter, never anything secret (the
    server holds no secret -- the passphrase never arrives)."""
    # The name shown is the voter's KEY (the normalized name), not whatever
    # casing a vote stored before names were lowercased -- one identity, one
    # spelling.
    voters = sorted(poll["voters"].items(), key=lambda kv: kv[1]["order"])
    return {
        "slug": poll["slug"], "title": poll["title"],
        # split into midday + night, or one slot a day; polls from before the
        # host could choose were all split, so a missing key means split
        "halves": poll.get("halves", True),
        # the host's crop: the first and last day anyone can pick (null: endless)
        "crop": {"from": poll["from"], "to": poll["to"]} if poll.get("from") else None,
        "voters": [{"name": key, "pub": v["pub"], "slots": v["slots"],
                    "order": v["order"]} for key, v in voters],
        # the first to commit hosts: their halves are the only ones on offer
        "host": voters[0][0] if voters else None,
    }
