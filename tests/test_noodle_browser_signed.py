"""On an end-to-end poll the PAGE checks every vote's and the head's signature
(web/noodle-e2e.js ndeTrusted), so a server that also holds the poll key still
cannot re-seal anyone's vote (WebKit = iOS; security audit 2026-10-14).

The poll JSON is tampered with on its way to the page (a route), standing in
for a malicious server: a forged signature is dropped; an unsigned record (a
poll from before signatures were kept) is shown -- until this browser has seen
the poll fully signed, after which it is dropped. And a host's passphrase
change re-signs the settings with the new key in the same Commit."""
import json

import pytest

from noodle_helpers import offer_one

pytestmark = pytest.mark.browser


def _until(page, expr):
    page.wait_for_function(expr, timeout=20000)


def _join(page, name, pw):
    _until(page, "NDV.keysLoaded")
    page.evaluate("NDV.step === 'pick' && ndvStep('you')")
    page.fill("#nd-name", name)
    page.fill("#nd-pass", pw)
    _until(page, "NDV.kdf.ready()")
    page.evaluate("NDV.step !== 'pick' && ndvCanNext() && ndvStep('pick')")


def _commit(page):
    offer_one(page)
    _until(page, "!document.querySelector('#nd-submit').disabled")
    page.evaluate("NDV.committed = 0")
    page.click("#nd-submit")
    _until(page, "NDV.committed > 0")


def test_forged_and_stripped_records_never_show(browser, base_url):
    import hashlib

    import httpx
    from conftest import API_KEY, TURNSTILE_SECRET
    if not API_KEY or not TURNSTILE_SECRET:
        pytest.skip("API_KEY / TURNSTILE_SECRET not set")
    ctx = browser.new_context(viewport={"width": 430, "height": 932})
    ctx.add_cookies([{"name": "guest_session", "url": base_url,
                      "value": hashlib.sha256(f"guest:{TURNSTILE_SECRET}".encode()).hexdigest()}])
    slug = None
    try:
        page = ctx.new_page()
        page.goto(f"{base_url}/noodle")
        page.click("#nd-create button")
        _until(page, "window.NDV && NDV.keyStr")
        slug, key = page.evaluate("[NDV.slug, NDV.keyStr]")
        _join(page, "signed host", "host pass")
        page.evaluate("NDV.pendingTitle = 'signed poll'")
        _commit(page)
        gctx = browser.new_context(viewport={"width": 430, "height": 932})   # the guest's own browser
        guest = gctx.new_page()
        guest.goto(f"{base_url}/noodle/{slug}#k={key}")
        _join(guest, "signed guest", "guest pass")
        _commit(guest)
        gctx.close()

        # an honest load: both voters and the title, all verified -> this
        # browser now holds the poll to signatures (noodle.signed.<slug>)
        page.reload()
        _until(page, "NDV.poll && NDV.poll.voters.length === 2 && NDV.poll.voters.every(v => v.name)")
        assert page.evaluate("NDV.poll.title") == "signed poll"
        assert page.evaluate(f"localStorage.getItem('noodle.signed.{slug}')") == "1"

        def tamper(fn):
            def handler(route):
                resp = route.fetch()
                body = json.loads(resp.text())
                fn(body)
                route.fulfill(response=resp, body=json.dumps(body))
            page.unroute(f"**/api/noodle/{slug}")
            page.route(f"**/api/noodle/{slug}", handler)

        # a forged signature on the guest's vote (the server re-sealed it): dropped
        tamper(lambda b: b["voters"][1].update(sig=b["voters"][0]["sig"]))
        page.reload()
        _until(page, "NDV.poll && NDV.poll.e2e")
        assert page.evaluate("NDV.poll.voters.map(v => v.name)") == ["signed host"]
        # signatures STRIPPED after this browser saw them: dropped too
        tamper(lambda b: [v.pop("sig") for v in b["voters"]])
        page.reload()
        _until(page, "NDV.poll && NDV.poll.e2e")
        assert page.evaluate("NDV.poll.voters.length") == 0
        # ... but a browser that never saw it signed shows an unsigned poll as
        # it always did (polls from before signatures were kept still work)
        page.evaluate(f"localStorage.removeItem('noodle.signed.{slug}')")
        page.reload()
        _until(page, "NDV.poll && NDV.poll.voters.length === 2 && NDV.poll.voters.every(v => v.name)")
        page.unroute(f"**/api/noodle/{slug}")

        # the host changes passphrase: the settings are re-signed by the new key
        page.reload()
        _until(page, "NDV.poll && NDV.mine")
        page.evaluate("ndvStep('you')")
        page.click("#nd-rekey")
        page.fill("#nd-pass", "host pass two")
        _until(page, "NDV.kdf.ready()")
        page.click("#nd-next")
        _commit(page)
        head = httpx.get(f"{base_url}/api/noodle/{slug}").json()["head"]
        assert head["pub"] == page.evaluate("NDV.kdf.pub()"), "the head is signed by the host's NEW key"
        page.reload()
        _until(page, "NDV.poll && NDV.poll.voters.length === 2 && NDV.poll.voters.every(v => v.name)")
        assert page.evaluate("NDV.poll.title") == "signed poll"
    finally:
        ctx.close()
        if slug:
            httpx.delete(f"{base_url}/api/noodle-polls/{slug}", headers={"Authorization": f"Bearer {API_KEY}"})
