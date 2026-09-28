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


# The LINK PREVIEW (Open Graph; what Messenger, iMessage, Discord, Slack draw
# under a pasted link): the poll's title, its note (or a default), and one
# fixed dark card -- the site icon it fell back to is white on transparent,
# which a light preview draws white on white. Scrapers cache it for weeks.
def _og(title: str, desc: str, path: str) -> str:
    tags = [("og:title", title), ("og:description", desc or config.OG_DESC),
            ("og:image", config.ORIGIN + config.OG_IMAGE), ("og:image:width", "1200"),
            ("og:image:height", "630"), ("og:url", config.ORIGIN + path),
            ("og:type", "website"), ("og:site_name", "noodle")]
    out = [f'<meta property="{k}" content="{html.escape(v, quote=True)}">' for k, v in tags]
    return "\n".join(out + ['<meta name="twitter:card" content="summary_large_image">'])


def _page(title: str, body: str, og: str = "") -> str:
    return _fill(_tmpl("noodle-shell.html"), TITLE=html.escape(title), OG=og, BODY=body)


def _kdf_attrs() -> str:
    kdf = {"m": config.KDF_M_KIB, "t": config.KDF_T, "p": config.KDF_P,
           "len": config.KDF_LEN, "debounce": config.KDF_DEBOUNCE_MS}
    return html.escape(json.dumps(kdf), quote=True)


def vote_page(poll: dict, draft: str = "") -> str:
    body = _fill(
        _tmpl("noodle-vote.html"),
        SLUG=html.escape(poll["slug"], quote=True),
        DRAFT=html.escape(draft, quote=True),
        TITLE=html.escape(poll["title"]),
        NOTE=html.escape(poll.get("note", "")),
        KDF=_kdf_attrs(),
        ASK_MAX=str(config.ASK_MAX_CHARS),
    )
    og = _og(poll["title"], poll.get("note", ""), "/noodle/" + poll["slug"])
    return _page(f"noodle: {poll['title']}", body, og)


# The site's nav bar, HANDED IN by the app (routers.py set_nav): noodle
# imports no app module, so it cannot build the nav itself -- the composition
# root gives it a function (request -> markup) instead. Unset, no nav.
_nav = None


def set_nav(fn) -> None:
    global _nav
    _nav = fn


# Whether a request is the OWNER's, handed in the same way (request -> bool).
# Unset, nobody is.
_is_owner = None


def set_owner(fn) -> None:
    global _is_owner
    _is_owner = fn


# The demo video, for everyone BUT the owner (who has the poll list there
# instead). web/noodle-demo.mp4 is gitignored: the server holds the only copy.
# It has no sound (the file carries no audio track), so it AUTOPLAYS, muted and
# looping, inline -- browsers allow that without a tap. No controls inline: a
# tap opens it fullscreen (noodle-admin.js ndmDemo).
_DEMO = ('<video class="nd-demo" src="/noodle-demo.mp4?v=4" autoplay muted loop playsinline '
         'aria-label="noodle demo, tap for fullscreen"></video>')


def admin_page(request=None) -> str:
    owner = bool(_is_owner and request is not None and _is_owner(request))
    body = _fill(_tmpl("noodle-admin.html"), DEMO="" if owner else _DEMO)
    page = _page("noodle", body, _og("noodle", "", "/noodle"))
    if _nav and request is not None:
        page = page.replace('<body class="noodle">', '<body class="noodle with-nav">', 1)
        page = page.replace("</body>", _nav(request) + "</body>", 1)
    return page


def public_poll(poll: dict) -> dict:
    """What anyone holding the link may see: window, and each voter's name,
    public key and slots. Never a budget counter, never anything secret (the
    server holds no secret -- the passphrase never arrives)."""
    # The name shown is the voter's KEY (the normalized name), not whatever
    # casing a vote stored before names were lowercased -- one identity, one
    # spelling.
    voters = sorted(poll["voters"].items(), key=lambda kv: kv[1]["order"])
    return {
        "slug": poll["slug"], "title": poll["title"], "note": poll.get("note", ""),
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
