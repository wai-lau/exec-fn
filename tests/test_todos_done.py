"""Exec scratch notes: the checkbox marks a note done, the morning run removes it.

Wai, 2026-11-18: "when I checkbox something, don't remove it immediately, only
remove during the rollover". The checkbox used to DELETE the note on the spot.
"""
import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "api"))
for _k in ("API_KEY", "TURNSTILE_SITE_KEY", "TURNSTILE_SECRET"):
    os.environ.setdefault(_k, "test")

import morning  # noqa: E402


def test_morning_drops_only_the_done_notes(tmp_path):
    path = tmp_path / "exec_todos.json"
    path.write_text(json.dumps({"items": [
        {"id": "a", "text": "keep"},
        {"id": "b", "text": "gone", "done": True},
        {"id": "c", "text": "also keep"},
    ]}))
    morning._purge_done_todos(path)
    assert [t["id"] for t in json.loads(path.read_text())["items"]] == ["a", "c"]


def test_morning_purge_without_a_file_is_a_no_op(tmp_path):
    morning._purge_done_todos(tmp_path / "exec_todos.json")
    assert not (tmp_path / "exec_todos.json").exists()


def test_checking_a_note_keeps_it_until_the_morning(client, admin_headers):
    item = client.post("/api/todos", json={"text": "zz done probe"}, headers=admin_headers).json()
    try:
        r = client.patch(f"/api/todos/{item['id']}", json={"done": True}, headers=admin_headers)
        assert r.status_code == 200 and r.json()["done"] is True
        listed = {t["id"]: t for t in client.get("/api/todos", headers=admin_headers).json()["items"]}
        assert listed[item["id"]].get("done") is True        # still there, checked
        r = client.patch(f"/api/todos/{item['id']}", json={"done": False}, headers=admin_headers)
        assert "done" not in r.json()                         # a second tap takes it back
        assert client.patch(f"/api/todos/{item['id']}", json={}, headers=admin_headers).status_code == 400
    finally:
        client.delete(f"/api/todos/{item['id']}", headers=admin_headers)
