"""Shared noodle test helpers."""

def make_poll(store, title, start, end, halves=True):
    """A poll with its dates already set, as a host would have left it."""
    slug = store.create(title, "2026-09-27T00:00:00")["slug"]
    with store.edit(slug) as poll:
        poll.update(start=start, end=end, halves=halves)
    return slug


# ── browser helpers (playwright pages) ──────────────────────────────────────
def offer_one(page):
    """A host must offer something to commit; on a shared poll that may have
    been recreated empty, the test voter can be the host."""
    page.evaluate("ndxIsHost() && !NDV.cal.getSel().size && "
                  "(NDV.cal.setSel(new Set([...NDV.cal.openSlots('0', '9')].slice(0, 1))), ndvSaveDraft())")


def can_commit(page):
    """Wait until the calendar takes taps, offer something if hosting, and
    wait for Commit to be pressable."""
    page.wait_for_function("(NDV.step !== 'pick' && ndvCanNext() && ndvStep('pick'), !document.getElementById('nd-cal').classList.contains('nd-readonly'))", timeout=20000)
    offer_one(page)
    page.wait_for_function("!document.querySelector('#nd-submit').disabled", timeout=20000)
