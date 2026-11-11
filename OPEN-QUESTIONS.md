# Open questions for Wai

Questions a session could not settle on its own. Answer inline (or in chat);
the session that acts on an answer deletes its entry.

## 1. The 500-line cap: exempt the vendored MTG rules? (2026-11-10)

The cap now covers every tracked text file in exec-fn, docs included. One
tracked file over 500 lines is not ours to split:

| File | Lines | What it is |
|---|---|---|
| `mtg/data/mtg_rules.txt` | 9,323 | Wizards of the Coast's Comprehensive Rules, copied verbatim. `api/mtg/lookup.py` (`RULES_PATH`) reads it whole and searches it. |

**Options:**

- **Exempt it** (recommended): add `mtg/data/mtg_rules.txt` to `LINE_CAP_ALLOW`
  in `scripts/pre-commit`, beside the spire changelog. It is upstream text,
  replaced wholesale when WotC publishes a new edition, never edited by hand.
- **Change its source**: split it per rules chapter (`mtg/data/rules/1xx.txt`
  …) and make `lookup.py` read the directory. Every future rules update then
  needs the same split.

The cap only bites when the file is staged, so today nothing is blocked either
way; the question is what happens on the next rules update.
