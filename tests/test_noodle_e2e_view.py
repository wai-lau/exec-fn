"""web/noodle-e2e.js, run in node: sealing round-trips, and ndeView applies
the rules the server can no longer read -- exactly as the plain path does."""
import json
import subprocess
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "api"))
from noodle import sig, slots  # noqa: E402

WEB = Path(__file__).resolve().parent.parent / "web"
SLUG = "AbCdEfGhIjKlMnOpQrStUv"

_HARNESS = """
const fs = require('fs'), vm = require('vm');
globalThis.window = globalThis;
vm.runInThisContext(fs.readFileSync(%(kdf)s, 'utf8'));
vm.runInThisContext(fs.readFileSync(%(e2e)s, 'utf8'));
globalThis.NDV = { slug: %(slug)s, keyStr: 'k' };
const newKey = () => crypto.subtle.importKey('raw', crypto.getRandomValues(new Uint8Array(32)),
  'AES-GCM', false, ['encrypt', 'decrypt']);
NDV.key = newKey();
(async () => {
  const out = {};
%(body)s
  console.log(JSON.stringify(out));
})().catch(e => { console.error(e.stack); process.exit(1); });
"""


def run(body: str) -> dict:
    js = _HARNESS % {"kdf": json.dumps(str(WEB / "noodle-kdf.js")), "e2e": json.dumps(str(WEB / "noodle-e2e.js")),
                     "slug": json.dumps(SLUG), "body": body}
    try:
        p = subprocess.run(["node", "-e", js], capture_output=True, text=True, timeout=30)
    except FileNotFoundError:
        pytest.skip("node not installed")
    assert p.returncode == 0, p.stderr
    return json.loads(p.stdout)


def test_view_applies_split_crop_offer_and_one_seat_per_name():
    out = run("""
  const seal = (pub, o) => ndeSeal('vote', pub, o);
  const raw = { slug: NDV.slug,
    head: { ct: await ndeSeal('head', '', { title: 'board games', note: 'snacks', halves: false,
                                             from: '2026-11-01', to: '2026-11-30' }) },
    voters: [
      { pub: 'G', order: 1, ct: await seal('G', { name: 'gus', slots: ['2026-11-02:d', '2026-11-04:d'] }) },
      { pub: 'H', order: 0, ct: await seal('H', { name: 'Host', slots: ['2026-11-02:m', '2026-11-02:n',
                                                                       '2026-11-03:m', '2026-12-05:d'] }) },
      { pub: 'X', order: 2, ct: await seal('X', { name: 'HOST', slots: ['2026-11-02:d'] }) },
      { pub: 'M', order: 3, ct: await seal('G', { name: 'mover', slots: ['2026-11-02:d'] }) },
      { pub: 'Z', order: 4, ct: 'AAAA' },
    ] };
  out.view = await ndeView(raw);
""")
    v = out["view"]
    assert (v["title"], v["note"], v["halves"]) == ("board games", "snacks", False)
    assert v["crop"] == {"from": "2026-11-01", "to": "2026-11-30"}
    # host: m+n -> a whole day; a lone midday is not a whole day; 12-05 is outside the crop
    assert [(x["name"], x["pub"], x["slots"]) for x in v["voters"]] == [
        ("host", "H", ["2026-11-02:d"]),
        ("gus", "G", ["2026-11-02:d"]),   # 11-04 was never offered
    ]   # "HOST" is the same name (first key keeps it); "mover" was sealed for another key; Z is junk
    assert v["host"] == "host" and v["sealed"] == 6 and v["opened"] == 4


def test_split_conversion_matches_the_server():
    picks = ["2026-11-02:m", "2026-11-02:n", "2026-11-03:m", "2026-11-04:d"]
    out = run(f"""
  out.split = ndeConvert({json.dumps(picks)}, true);
  out.join = ndeConvert({json.dumps(picks)}, false);
""")
    assert out["split"] == slots.convert(picks, True)
    assert out["join"] == slots.convert(picks, False)


def test_another_key_opens_nothing():
    out = run("""
  const ct = await ndeSeal('head', '', { title: 't', halves: true });
  NDV.key = newKey();
  out.view = await ndeView({ slug: NDV.slug, head: { ct }, voters: [] });
""")
    assert out["view"]["opened"] == 0 and out["view"]["title"] == "title"


def test_signed_bytes_match_the_server():
    out = run("""
  out.canon = ndeCanon({ ts: 5, poll: NDV.slug, kind: 'e2e-vote', ct: 'YWJj+/==' });
""")
    assert out["canon"] == sig.canonical_action(kind="e2e-vote", poll=SLUG, ts=5, ct="YWJj+/==").decode()


def test_settings_are_checked_before_sealing():
    out = run("""
  out.long = await ndeSealHead({ title: 'x'.repeat(81) });
  out.empty = await ndeSealHead({ title: '   ' });
  out.ok = !!(await ndeSealHead({ title: ' a   b ', note: '', halves: true })).ct;
""")
    assert "title must be" in out["long"]["error"] and "title must be" in out["empty"]["error"]
    assert out["ok"] is True
