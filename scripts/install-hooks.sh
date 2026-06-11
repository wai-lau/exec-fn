#!/usr/bin/env bash
# Install version-controlled git hooks (from scripts/) into .git/hooks.
# Symlinks so edits to scripts/pre-commit take effect immediately.
set -e

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$repo_root"

ln -sf ../../scripts/pre-commit .git/hooks/pre-commit
chmod +x scripts/pre-commit

echo "installed: .git/hooks/pre-commit -> scripts/pre-commit"
