"""noodle slugs and draft tokens never reach uvicorn's access log
(api/log_masking.py): a poll's link IS its key."""
import logging
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "api"))
import log_masking  # noqa: E402

SLUG = "AbCdEfGhIjKl-_OpQrStUv"


def test_slugs_and_tokens_are_masked_and_nothing_else():
    m = log_masking.mask
    assert m(f"/noodle/{SLUG}?t=abc.def") == "/noodle/<slug>?t=<token>"
    assert m(f"/api/noodle/{SLUG}/vote") == "/api/noodle/<slug>/vote"
    assert m(f"/noodle/{SLUG}?x=1&t=tok&y=2") == "/noodle/<slug>?x=1&t=<token>&y=2"
    for keep in ("/noodle", "/api/noodle-polls/new", "/rd", "/api/noodle-polls/created"):
        assert m(keep) == keep


def test_the_filter_rewrites_uvicorns_access_record():
    rec = logging.LogRecord("uvicorn.access", logging.INFO, __file__, 1, '%s - "%s %s HTTP/%s" %d',
                            ("1.2.3.4:5", "GET", f"/noodle/{SLUG}?t=secret", "1.1", 200), None)
    assert log_masking.NoodleMask().filter(rec)
    assert SLUG not in rec.getMessage() and "secret" not in rec.getMessage()
    assert "/noodle/<slug>?t=<token>" in rec.getMessage()
