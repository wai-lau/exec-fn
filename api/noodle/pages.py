"""Noodle's HTML. Its own shell (api/templates/noodle-shell.html), NOT the
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
        START=html.escape(poll["start"], quote=True),
        END=html.escape(poll["end"], quote=True),
        KDF=_kdf_attrs(),
        ASK_MAX=str(config.ASK_MAX_CHARS),
    )
    return _page(f"noodle: {poll['title']}", body)


def admin_page() -> str:
    body = _fill(_tmpl("noodle-admin.html"), MAX_DAYS=str(config.MAX_WINDOW_DAYS))
    return _page("noodle", body)


def public_poll(poll: dict) -> dict:
    """What anyone holding the link may see: window, and each voter's name,
    public key and slots. Never a budget counter, never anything secret (the
    server holds no secret -- the passphrase never arrives)."""
    voters = sorted(poll["voters"].values(), key=lambda v: v["order"])
    return {
        "slug": poll["slug"], "title": poll["title"],
        "start": poll["start"], "end": poll["end"],
        "voters": [{"name": v["name"], "pub": v["pub"], "slots": v["slots"],
                    "order": v["order"]} for v in voters],
    }
