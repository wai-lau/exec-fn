## 21. noodle — moved to its own repo

`wai-lau/noodle`, submodule `apps/noodle` (since 2026-10-14). Its `ARCHITECTURE.md` (§21a–m) is the design doc, with its own `ARCHAEOLOGY.md` and `CLAUDE.md`; a `§21x` reference means that file. Parent-side integration only: `routers.py` mounts its three routers and injects owner detection (`noodle_pages.set_owner`; no nav since 2026-11-10), the guest set (§20a), `log_masking.py` + the nginx log mask (§1d), the CSP harness in `conftest.py`. How the parent serves it: §1e.

