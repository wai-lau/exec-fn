"""noodle keeps a voter's KEY on this device, never the passphrase (WebKit =
iOS; web/noodle-keystore.js, since the 2026-10-14 security audit).

- a committed (or seat-matching) key is kept in IndexedDB, non-extractable,
  and signs on the next visit with an empty passphrase field
- the passphrase is never written to localStorage or a cookie
- a plain-text passphrase an older page left for this poll still unlocks the
  seat once, and is then converted to a kept key and deleted; every
  cross-poll `noodle.lastpass.*` entry is deleted outright
- renaming over a kept key asks for the passphrase again (the page never
  knew it) and keeps the key under the new name only
- changing the passphrase over a kept key signs the change with that key"""
import pytest

from noodle_helpers import offer_one

pytestmark = pytest.mark.browser

KEPT = ("new Promise(r => { const q = indexedDB.open('noodle'); q.onsuccess = () => { const db = q.result;"
        " if (!db.objectStoreNames.contains('keys')) { db.close(); return r([]); }"
        " const out = [], c = db.transaction('keys').objectStore('keys').openCursor();"
        " c.onsuccess = () => { const x = c.result; if (!x) { db.close(); return r(out); }"
        " out.push([x.key, x.value.key.extractable, x.value.key.algorithm.name]); x.continue(); }; }; })")


def _poll(base_url):
    import httpx
    from conftest import API_KEY
    if not API_KEY:
        pytest.skip("API_KEY not set")
    auth = {"Authorization": f"Bearer {API_KEY}"}
    return auth, httpx.post(f"{base_url}/api/noodle-polls", headers=auth, json={"title": "__smoke_keys__"}).json()["slug"]


def _sign_in(page, name, pw):
    page.wait_for_function("NDV.keysLoaded", timeout=10000)
    page.evaluate("NDV.step === 'pick' && ndvStep('you')")
    page.fill("#nd-name", name)
    page.fill("#nd-pass", pw)
    page.wait_for_function("NDV.kdf.ready()", timeout=20000)


def _commit(page):
    page.evaluate("NDV.step !== 'pick' && ndvCanNext() && ndvStep('pick')")
    offer_one(page)
    page.wait_for_function("!document.querySelector('#nd-submit').disabled", timeout=20000)
    page.evaluate("NDV.committed = 0")
    page.click("#nd-submit")
    page.wait_for_function("NDV.committed > 0", timeout=20000)


def _kept_names(page, slug):
    return sorted(k.split("\u0000", 1)[1] for k, _, _ in page.evaluate(KEPT) if k.startswith(slug + "\u0000"))


def test_the_key_is_kept_never_the_passphrase(browser, base_url):
    import httpx
    auth, slug = _poll(base_url)
    ctx = browser.new_context(viewport={"width": 430, "height": 932})
    try:
        page = ctx.new_page()
        page.goto(f"{base_url}/noodle/{slug}")
        _sign_in(page, "keeper", "keep me safe")
        _commit(page)
        kept = page.evaluate(KEPT)
        assert [(k.split("\u0000")[1], ext, alg) for k, ext, alg in kept] == [("keeper", False, "Ed25519")]
        assert "keep me safe" not in page.evaluate("JSON.stringify(localStorage)")
        assert all("keep me safe" not in c["value"] for c in ctx.cookies())

        page.reload()   # back: no passphrase typed, the kept key signs
        page.wait_for_function("NDV.mine && NDV.usingKept", timeout=10000)
        assert page.input_value("#nd-pass") == "" and not page.is_visible("#nd-warn")
        page.evaluate("ndvStep('you')")
        page.fill("#nd-name", "someone else")   # another name: nothing kept for it
        page.wait_for_function("!NDV.usingKept", timeout=10000)
        page.fill("#nd-name", "keeper")          # back: the kept key again
        page.wait_for_function("NDV.mine && NDV.usingKept", timeout=10000)
        _commit(page)                            # and it still signs
    finally:
        ctx.close()
        httpx.delete(f"{base_url}/api/noodle-polls/{slug}", headers=auth)


def test_an_old_plain_text_passphrase_converts_once_and_is_deleted(browser, base_url):
    import httpx
    auth, slug = _poll(base_url)
    try:
        ctx = browser.new_context(viewport={"width": 430, "height": 932})
        page = ctx.new_page()
        page.goto(f"{base_url}/noodle/{slug}")
        _sign_in(page, "legacy", "the old way")
        _commit(page)
        ctx.close()
        # a browser an OLDER page wrote to: the passphrase in plain text, per poll
        # and cross-poll, and no kept key
        ctx = browser.new_context(viewport={"width": 430, "height": 932})
        page = ctx.new_page()
        page.goto(f"{base_url}/noodle/{slug}")
        page.evaluate("localStorage.setItem('noodle.identity', JSON.stringify({name: 'legacy'}));"
                      f"localStorage.setItem('noodle.pass.{slug}.legacy', 'the old way');"
                      "localStorage.setItem('noodle.lastpass.legacy', 'the old way')")
        page.reload()
        page.wait_for_function("NDV.mine", timeout=20000)   # it still unlocks the seat
        page.wait_for_function(f"localStorage.getItem('noodle.pass.{slug}.legacy') === null", timeout=10000)
        assert page.evaluate("localStorage.getItem('noodle.lastpass.legacy')") is None
        assert _kept_names(page, slug) == ["legacy"]
        assert "the old way" not in page.evaluate("JSON.stringify(localStorage)")
        ctx.close()
    finally:
        httpx.delete(f"{base_url}/api/noodle-polls/{slug}", headers=auth)


def test_rename_and_rekey_over_a_kept_key(browser, base_url):
    import httpx
    auth, slug = _poll(base_url)
    ctx = browser.new_context(viewport={"width": 430, "height": 932})
    try:
        page = ctx.new_page()
        page.goto(f"{base_url}/noodle/{slug}")
        _sign_in(page, "renamer", "pass one")
        _commit(page)
        page.reload()
        page.wait_for_function("NDV.mine && NDV.usingKept", timeout=10000)
        # a rename over a kept key opens the passphrase too: the page never knew it
        page.evaluate("ndvStep('you')")
        page.click("#nd-rename")
        assert not page.is_disabled("#nd-pass")
        assert page.get_attribute("#nd-pass", "placeholder") == "your passphrase (same or new)"
        page.fill("#nd-name", "renamed")
        page.fill("#nd-pass", "pass one")
        _commit(page)
        assert page.evaluate("NDV.poll.voters.map(v => v.name)") == ["renamed"]
        page.wait_for_function("Object.keys(NDV.keptKeys).join() === 'renamed'", timeout=10000)
        assert _kept_names(page, slug) == ["renamed"], "the old name keeps nothing"
        # a passphrase change over a kept key: the kept key signs the hand-over
        page.reload()
        page.wait_for_function("NDV.mine && NDV.usingKept", timeout=10000)
        page.evaluate("ndvStep('you')")
        page.click("#nd-rekey")
        page.fill("#nd-pass", "pass two")
        _commit(page)
        page.reload()
        page.wait_for_function("NDV.mine && NDV.usingKept", timeout=10000)
        assert page.evaluate("NDV.poll.voters.map(v => v.name)") == ["renamed"]
    finally:
        ctx.close()
        httpx.delete(f"{base_url}/api/noodle-polls/{slug}", headers=auth)
