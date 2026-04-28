# CLAUDE.md

Guidance for Claude Code (claude.ai/code) in this repo.

## What This Repo Is

Tooling to compress MTG Comprehensive Rules into caveman format → fits efficiently in system prompt for MTG rules assistant. Output (`rules.txt`) = artifact bot loads.

## Files

| File | Role |
|------|------|
| `MagicCompRules 20260417.original.txt` | Uncompressed source (~961KB) — do not edit |
| `MagicCompRules 20260417.txt` | Compressed output (~340KB, 65% reduction) |
| `rules.txt` | Copy of compressed output — bot reads this |
| `mtg_sections/` | Per-section intermediates (`*.original.txt` + `*.txt` compressed) |
| `mtg_compress.py` | Compression pipeline script |

## Running the Compressor

```bash
python mtg_compress.py
```

Requires caveman compress plugin at `/home/wai/.claude/plugins/cache/caveman/caveman/84cc3c14fa1e/skills/compress/scripts/`.

Script:
1. Backs up original rules file (skips if backup exists)
2. Splits into 10 sections (glossary first for context, output last)
3. Compresses each section via Claude with cumulative prior-section context
4. Validates each section; retries up to 2× with fix prompt on failure
5. Reassembles header + sections in canonical order → overwrites `MagicCompRules 20260417.txt`

After run, manually copy result to `rules.txt` if bot reads that file.

## Section Order

Compression order: glossary (00) first → sections 01–09. Output order: 01–09, then 00 (glossary last). Each section gets glossary abbreviation context; canonical TOC order preserved in final file.

## Updating for a New Rules Release

1. Replace `MagicCompRules 20260417.txt` with new release file (update filename in `RULES_FILE` / `BACKUP_FILE` constants in `mtg_compress.py`)
2. Delete old `.original.txt` backup → fresh one created
3. Update `SECTIONS` line ranges if new release shifted section boundaries
4. Run `python mtg_compress.py`