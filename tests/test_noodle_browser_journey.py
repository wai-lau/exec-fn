"""noodle END TO END, the way people use it (WebKit = iOS): real polls made
through the live app, a host and three guests each in their OWN browser
(context), real votes -- and then the data is checked from every side:

- a fresh visitor with the link sees every vote exactly as cast
- the host's later edit reaches everyone
- a voter on a NEW device gets their own vote back with their passphrase
- on an end-to-end poll the server holds nothing readable, and a link
  without its key opens nothing

One plain poll (the owner API, the only way a plain poll is made now) and one
end-to-end poll (made from /noodle, as every guest-made poll is)."""
import hashlib

import httpx
import pytest

pytestmark = pytest.mark.browser

GUESTS = (("journey ada", "ada pass"), ("journey bo", "bo pass"), ("journey cy", "cy pass"))
WAIT = 20000


def _device(browser, base_url, guest_cookie=None):
    ctx = browser.new_context(viewport={"width": 430, "height": 932})
    if guest_cookie:
        ctx.add_cookies([{**guest_cookie, "url": base_url}])
    return ctx, ctx.new_page()


def _sign_in(page, name, pw):
    page.wait_for_function("NDV.keysLoaded", timeout=WAIT)
    page.evaluate("NDV.step === 'pick' && ndvStep('you')")
    page.fill("#nd-name", name)
    page.fill("#nd-pass", pw)
    page.wait_for_function("NDV.kdf.ready()", timeout=WAIT)
    page.evaluate("ndvCanNext() && ndvStep('pick')")
    page.wait_for_function("!document.getElementById('nd-cal').classList.contains('nd-readonly')", timeout=WAIT)


def _vote(page, slots):
    page.evaluate(f"NDV.cal.setSel(new Set({sorted(slots)!r})); ndvSaveDraft()")
    page.wait_for_function("!document.querySelector('#nd-submit').disabled", timeout=WAIT)
    page.evaluate("NDV.committed = 0")
    page.click("#nd-submit")
    page.wait_for_function("NDV.committed > 0", timeout=WAIT)


def _seen(page, n):
    """The poll as this page opened it, once all `n` voters are named."""
    page.wait_for_function(f"NDV.poll && NDV.poll.voters.length === {n} && NDV.poll.voters.every(v => v.name)",
                           timeout=WAIT)
    return page.evaluate("({title: NDV.poll.title, note: NDV.poll.note,"
                         " voters: NDV.poll.voters.map(v => [v.name, [...v.slots].sort()])})")


def _journey(browser, base_url, link, host, cookie=None):
    """The host offers four times, three guests each vote a different part of
    the offer, everyone in their own browser. -> (offer, {name: slots})."""
    offer = host.evaluate("[...NDV.cal.openSlots('0', '9')].slice(0, 4).sort()")
    _vote(host, offer)
    picks = {"journey host": offer}
    for (name, pw), part in zip(GUESTS, (offer[0:2], offer[1:3], offer[3:4])):
        ctx, page = _device(browser, base_url, cookie)
        try:
            page.goto(link)
            _sign_in(page, name, pw)
            _vote(page, part)
            picks[name] = part
        finally:
            ctx.close()
    return offer, picks


def _everyone_sees(browser, base_url, link, picks, title):
    ctx, page = _device(browser, base_url)   # a visitor: no name, nothing remembered
    try:
        page.goto(link)
        view = _seen(page, len(picks))
        assert view["title"] == title
        assert {n: s for n, s in view["voters"]} == {n: sorted(s) for n, s in picks.items()}
        assert view["voters"][0][0] == "journey host", "the host's seat comes first"
    finally:
        ctx.close()


def _back_on_a_new_device(browser, base_url, link, name, pw, picks):
    ctx, page = _device(browser, base_url)
    try:
        page.goto(link)
        _sign_in(page, name, pw)
        page.wait_for_function("NDV.mine", timeout=WAIT)
        assert sorted(page.evaluate("[...NDV.cal.getSel()]")) == sorted(picks), "their own vote comes back"
    finally:
        ctx.close()


def test_a_plain_poll_end_to_end(browser, base_url, admin_headers):
    auth = {"Authorization": admin_headers["Authorization"]}
    title = "journey plain"
    slug = httpx.post(f"{base_url}/api/noodle-polls", headers=auth, json={"title": title}).json()["slug"]
    link = f"{base_url}/noodle/{slug}"
    hctx, host = _device(browser, base_url)
    try:
        host.goto(link)
        _sign_in(host, "journey host", "host pass")
        offer, picks = _journey(browser, base_url, link, host)
        _everyone_sees(browser, base_url, link, picks, title)
        # the server's JSON says the same (a plain poll is readable by design)
        api = httpx.get(f"{base_url}/api/noodle/{slug}").json()
        assert {v["name"]: sorted(v["slots"]) for v in api["voters"]} == {n: sorted(s) for n, s in picks.items()}
        _back_on_a_new_device(browser, base_url, link, "journey bo", "bo pass", picks["journey bo"])
    finally:
        hctx.close()
        httpx.delete(f"{base_url}/api/noodle-polls/{slug}", headers=auth)


def test_an_end_to_end_poll_end_to_end(browser, base_url, admin_headers):
    from conftest import TURNSTILE_SECRET
    if not TURNSTILE_SECRET:
        pytest.skip("TURNSTILE_SECRET not set")
    cookie = {"name": "guest_session", "value": hashlib.sha256(f"guest:{TURNSTILE_SECRET}".encode()).hexdigest()}
    auth = {"Authorization": admin_headers["Authorization"]}
    title, note = "journey sealed", "bring snacks"
    hctx, host = _device(browser, base_url, cookie)
    slug = None
    try:
        host.goto(f"{base_url}/noodle")
        host.click("#nd-create button")
        host.wait_for_function("window.NDV && NDV.keyStr", timeout=WAIT)
        slug, key = host.evaluate("[NDV.slug, NDV.keyStr]")
        link = f"{base_url}/noodle/{slug}#k={key}"
        _sign_in(host, "journey host", "host pass")
        host.evaluate(f"NDV.pendingTitle = {title!r}; NDV.pendingNote = {note!r}")
        offer, picks = _journey(browser, base_url, link, host, cookie)
        _everyone_sees(browser, base_url, link, picks, title)

        # the server holds sealed blobs only: no name, title, note or slot
        raw = httpx.get(f"{base_url}/api/noodle/{slug}").text + httpx.get(f"{base_url}/noodle/{slug}").text
        for secret in (title, note, *picks, *offer):
            assert secret not in raw, f"the server served {secret!r}"
        # and the link without its key opens nothing
        ctx, bare = _device(browser, base_url)
        try:
            bare.goto(f"{base_url}/noodle/{slug}")
            bare.wait_for_selector("#nd-banner:not([hidden])", timeout=WAIT)
            assert "missing its key" in bare.inner_text("#nd-banner")
        finally:
            ctx.close()

        # the host edits the note later: everyone sees the new one
        host.reload()
        host.wait_for_function("NDV.poll && NDV.mine", timeout=WAIT)
        host.evaluate("NDV.pendingNote = 'bring more snacks'")
        _vote(host, offer)
        ctx, page = _device(browser, base_url)
        try:
            page.goto(link)
            _seen(page, len(picks))
            assert page.evaluate("NDV.poll.note") == "bring more snacks"
        finally:
            ctx.close()

        _back_on_a_new_device(browser, base_url, link, "journey cy", "cy pass", picks["journey cy"])
    finally:
        hctx.close()
        if slug:
            httpx.delete(f"{base_url}/api/noodle-polls/{slug}", headers=auth)
