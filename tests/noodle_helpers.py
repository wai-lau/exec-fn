"""Shared noodle test helpers."""

def make_poll(store, title, start, end, halves=True):
    """A poll with its dates already set, as a host would have left it."""
    slug = store.create(title, "2026-09-27T00:00:00")["slug"]
    with store.edit(slug) as poll:
        poll.update(start=start, end=end, halves=halves)
    return slug
