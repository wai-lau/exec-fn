"""noodle END-TO-END polls in the real engine (WebKit = iOS): a fresh draft
makes its key in the browser, the host and a guest vote, the host retitles and
removes, a guest changes passphrase -- and at every step the server holds
nothing readable, while a link without the key opens nothing."""
import pytest

pytestmark = pytest.mark.browser

UNLOCK = ("(NDV.step !== 'pick' && ndvCanNext() && ndvStep('pick'),"
          " !document.getElementById('nd-cal').classList.contains('nd-readonly'))")
HOST, GUEST, TITLE, NOTE = "smoke sealed host", "smoke sealed guest", "sealed LAN party", "bring sealed snacks"


def _commit(page):
    page.wait_for_function("!document.querySelector('#nd-submit').disabled", timeout=20000)
    page.evaluate("NDV.committed = 0")
    page.click("#nd-submit")
    page.wait_for_function("NDV.committed > 0", timeout=20000)


def _join(page, link, name, pw):
    page.goto(link)
    page.wait_for_function("NDV.poll", timeout=10000)
    page.fill("#nd-name", name)
    page.fill("#nd-pass", pw)
    page.wait_for_function(UNLOCK, timeout=20000)


def test_an_end_to_end_poll_from_draft_to_rekey(browser, base_url):
    import httpx
    from conftest import API_KEY
    if not API_KEY:
        pytest.skip("API_KEY not set")
    auth = {"Authorization": f"Bearer {API_KEY}"}
    with httpx.Client(base_url=base_url, timeout=15.0) as c:
        d = c.post("/api/noodle-polls/new", headers=auth).json()
        slug = d["slug"]
        assert c.get(f"/api/noodle/{slug}").status_code == 404, "a draft stores nothing"

    def server_view():
        with httpx.Client(base_url=base_url, timeout=15.0) as c:
            api, html = c.get(f"/api/noodle/{slug}"), c.get(f"/noodle/{slug}").text
        for secret in (HOST, GUEST, TITLE, NOTE):
            assert secret not in api.text and secret not in html, f"the server served {secret!r}"
        return api.json()

    ctx = browser.new_context(viewport={"width": 430, "height": 932})
    host = ctx.new_page()
    try:
        # the DRAFT page makes the key, in the browser, into the address
        host.goto(f"{base_url}{d['url']}")
        host.wait_for_function("NDV.keyStr", timeout=10000)
        key = host.evaluate("NDV.keyStr")
        assert host.url.endswith(f"#k={key}") and len(key) == 43
        assert host.inner_text("#nd-title") == "title"
        host.click("#nd-title")
        host.keyboard.type(TITLE)
        host.keyboard.press("Enter")
        host.click("#nd-note")
        host.keyboard.type(NOTE)
        host.keyboard.press("Enter")
        host.fill("#nd-name", HOST)
        host.fill("#nd-pass", "host pass")
        host.wait_for_function(UNLOCK, timeout=20000)
        host.evaluate("NDV.cal.setSel(new Set([...NDV.cal.openSlots('0', '9')].slice(0, 2))); ndvSaveDraft()")
        _commit(host)
        link = f"{base_url}/noodle/{slug}#k={key}"
        assert host.url == link, "the token leaves the address once the poll exists; the key stays"
        assert host.input_value("#nd-url") == link, "the link to share carries the key"
        offer = host.evaluate("NDV.poll.voters[0].slots")
        assert len(offer) == 2

        sealed = server_view()
        assert sealed["e2e"] is True and sealed["head"]["ct"]
        assert [set(v) for v in sealed["voters"]] == [{"pub", "order", "ct"}]

        # a GUEST, in their own browser, with the whole link
        gctx = browser.new_context(viewport={"width": 430, "height": 932})
        guest = gctx.new_page()
        try:
            _join(guest, link, GUEST, "guest pass")
            assert guest.inner_text("#nd-title") == TITLE and guest.inner_text("#nd-note") == NOTE
            assert guest.title() == f"noodle: {TITLE}"
            assert guest.evaluate("NDV.poll.host") == HOST
            guest.evaluate(f"NDV.cal.setSel(new Set({offer[:1]!r})); ndvSaveDraft()")
            _commit(guest)
            assert guest.evaluate("NDV.poll.voters.map(v => v.name)") == [HOST, GUEST]
            old_pub = guest.evaluate("NDV.kdf.pub()")
            # a new passphrase: the old key signs the seat over, re-sealed
            guest.evaluate("ndvStep('you')")
            guest.click("#nd-rekey")
            guest.fill("#nd-pass", "guest pass two")
            guest.click("#nd-next")
            _commit(guest)
            new_pub = guest.evaluate("NDV.kdf.pub()")
            assert new_pub != old_pub
            pubs = [v["pub"] for v in server_view()["voters"]]
            assert pubs[1] == new_pub and old_pub not in pubs, "same seat, new key"
            guest.reload()
            guest.wait_for_function("NDV.mine", timeout=20000)
            assert guest.evaluate("NDV.poll.voters[1].slots") == offer[:1]
        finally:
            gctx.close()

        # without the key the page opens nothing, and says why
        bare = browser.new_page()
        try:
            bare.goto(f"{base_url}/noodle/{slug}")
            bare.wait_for_selector("#nd-banner:not([hidden])", timeout=10000)
            assert "missing its key" in bare.inner_text("#nd-banner")
            assert bare.title() == "noodle"
        finally:
            bare.close()

        # the HOST removes the guest -- by key, since the server has no names
        host.reload()
        host.wait_for_function("NDV.mine && NDV.poll.voters.length === 2", timeout=20000)
        host.on("dialog", lambda dlg: dlg.accept())
        host.click(f".nd-face-rm[data-name='{GUEST}']")
        host.wait_for_function("NDV.poll.voters.length === 1", timeout=10000)
        assert len(server_view()["voters"]) == 1
    finally:
        ctx.close()
        with httpx.Client(base_url=base_url, timeout=15.0) as c:
            c.delete(f"/api/noodle-polls/{slug}", headers=auth)
