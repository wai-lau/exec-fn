#!/usr/bin/env python3
"""
MTG Rules compressor: splits by section, compresses with cumulative context.
"""
import sys
import time
from datetime import datetime
from pathlib import Path

sys.path.insert(0, '/home/wai/.claude/plugins/cache/caveman/caveman/84cc3c14fa1e/skills/compress')

from scripts.compress import call_claude, build_fix_prompt
from scripts.validate import validate

RULES_FILE = Path(__file__).parent / "MagicCompRules 20260417.txt"
BACKUP_FILE = Path(__file__).parent / "MagicCompRules 20260417.original.txt"
WORK_DIR = Path(__file__).parent / "mtg_sections"

# (start_line, end_line_inclusive, name, output_order) — 1-indexed
# Glossary compressed first (context for all), but output last
SECTIONS = [
    (7054, 9287, "00_glossary",              9),
    (182,  1271, "01_game_concepts",         0),
    (1272, 1564, "02_parts_of_card",         1),
    (1565, 1926, "03_card_types",            2),
    (1927, 2104, "04_zones",                 3),
    (2105, 2442, "05_turn_structure",        4),
    (2443, 3191, "06_spells_abilities_effects", 5),
    (3192, 6365, "07_additional_rules",      6),
    (6366, 6769, "08_multiplayer_rules",     7),
    (6770, 7053, "09_casual_variants",       8),
]

MAX_RETRIES = 2


def build_prompt(original: str, prior_sections: list[str]) -> str:
    context_block = ""
    if prior_sections:
        joined = "\n\n---\n\n".join(prior_sections)
        context_block = f"""PREVIOUSLY COMPRESSED SECTIONS (reference only — use same abbreviations and style):
<context>
{joined}
</context>

"""
    return f"""{context_block}Compress this MTG rules section into caveman format. Match abbreviations and style from prior sections if provided.

STRICT RULES:
- Do NOT modify anything inside ``` code blocks
- Do NOT modify anything inside inline backticks
- Preserve ALL URLs exactly
- Preserve ALL headings exactly
- Preserve ALL file paths and commands exactly
- Return ONLY the compressed text — no outer fence

Only compress natural language prose.

TEXT:
{original}
"""


def ts():
    return datetime.now().strftime("%H:%M:%S")


def main():
    WORK_DIR.mkdir(exist_ok=True)
    run_start = time.time()

    text = RULES_FILE.read_text(errors="ignore")
    lines = text.splitlines(keepends=True)
    total_bytes = len(text.encode())
    print(f"[{ts()}] Loaded {RULES_FILE.name} — {total_bytes:,} bytes, {len(lines):,} lines")

    # Backup original before any changes
    if not BACKUP_FILE.exists():
        BACKUP_FILE.write_text(text)
        print(f"[{ts()}] Backed up original → {BACKUP_FILE}")
    else:
        print(f"[{ts()}] Backup already exists: {BACKUP_FILE}")

    # Header (intro + TOC): lines 1-181, keep as-is
    header = "".join(lines[:181])

    prior_context = []           # grows in compression order (glossary first)
    output_map = {}              # name → compressed text, for output ordering
    total_orig = 0
    total_comp = 0

    for i, (start, end, name, output_order) in enumerate(SECTIONS):
        section_lines = lines[start - 1 : end] if end else lines[start - 1 :]
        original = "".join(section_lines)
        orig_bytes = len(original.encode())
        total_orig += orig_bytes
        ctx_bytes = sum(len(s.encode()) for s in prior_context)

        print(f"\n[{ts()}] [{i+1}/{len(SECTIONS)}] {name}")
        print(f"          input: {orig_bytes:,} bytes | context: {ctx_bytes:,} bytes ({len(prior_context)} prior sections)")

        orig_path = WORK_DIR / f"{name}.original.txt"
        comp_path = WORK_DIR / f"{name}.txt"
        orig_path.write_text(original)

        t0 = time.time()
        print(f"[{ts()}]   → calling Claude...", flush=True)
        compressed = call_claude(build_prompt(original, prior_sections=prior_context))
        comp_path.write_text(compressed)
        elapsed = time.time() - t0
        comp_bytes = len(compressed.encode())
        ratio = (1 - comp_bytes / orig_bytes) * 100
        print(f"[{ts()}]   ← got {comp_bytes:,} bytes ({ratio:.0f}% reduction) in {elapsed:.1f}s")

        for attempt in range(MAX_RETRIES):
            print(f"[{ts()}]   validating (attempt {attempt+1}/{MAX_RETRIES})...", flush=True)
            result = validate(orig_path, comp_path)
            if result.is_valid:
                print(f"[{ts()}]   ✓ validation passed")
                if result.warnings:
                    for w in result.warnings:
                        print(f"[{ts()}]     warn: {w}")
                break
            print(f"[{ts()}]   ✗ validation failed:")
            for err in result.errors:
                print(f"[{ts()}]     error: {err}")
            if attempt == MAX_RETRIES - 1:
                print(f"[{ts()}]   ! max retries — using last compressed version")
                break
            print(f"[{ts()}]   → fixing with Claude...", flush=True)
            t0 = time.time()
            compressed = call_claude(build_fix_prompt(original, compressed, result.errors))
            comp_path.write_text(compressed)
            elapsed = time.time() - t0
            comp_bytes = len(compressed.encode())
            print(f"[{ts()}]   ← fix done in {elapsed:.1f}s ({comp_bytes:,} bytes)")

        total_comp += len(compressed.encode())
        prior_context.append(compressed)
        output_map[output_order] = compressed

        elapsed_total = time.time() - run_start
        sections_done = i + 1
        eta = (elapsed_total / sections_done) * (len(SECTIONS) - sections_done)
        print(f"[{ts()}]   running total: {total_comp:,}/{total_orig:,} bytes compressed | ETA ~{eta/60:.1f}m")

    ordered = [output_map[k] for k in sorted(output_map)]
    final = header + "".join(ordered)
    RULES_FILE.write_text(final)

    original_size = BACKUP_FILE.stat().st_size
    final_size = RULES_FILE.stat().st_size
    pct = (1 - final_size / original_size) * 100
    total_elapsed = time.time() - run_start
    print(f"\n[{ts()}] ✅ Done! {original_size:,} → {final_size:,} bytes ({pct:.0f}% reduction) in {total_elapsed/60:.1f}m")
    print(f"[{ts()}] Section files in {WORK_DIR}")


if __name__ == "__main__":
    main()
