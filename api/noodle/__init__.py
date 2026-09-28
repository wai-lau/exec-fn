"""noodle -- a public scheduling poll (Doodle-style), fully standalone.

Imports nothing from the rest of the app: stdlib, fastapi, pydantic, anthropic
and cryptography only, pinned by tests/test_noodle_isolation.py. State lives in
its own directory (config.DATA_DIR) and nowhere else. The owner-only routes are
put behind the site's admin auth by the composition root (routers.py), so
noodle never has to import auth to get it. See ARCHITECTURE.md section 20.
"""
