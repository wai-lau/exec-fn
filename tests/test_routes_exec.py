"""The sidecar's route into Exec's card tools (api/routes_exec.py).

These two routes sit on the PUBLIC router with an in-handler check, so what
keeps them closed is that check alone. Pinned against the live app: the ONLY
credential that opens them is the sidecar token — not nothing, not a wrong
token, not a guest cookie, and not the admin credentials either (the route has
no business accepting them, and doing so would widen what a stolen admin cookie
reaches for no reason). With the token, the schemas come back and a call
reaches the tool dispatcher.
"""
import pytest

from conftest import _key

TOKEN = _key("CC_SIDECAR_TOKEN")


def _tok() -> dict:
    if not TOKEN:
        pytest.skip("CC_SIDECAR_TOKEN not set (env or .env)")
    return {"x-cc-token": TOKEN}


@pytest.mark.parametrize("path,method", [
    ("/api/exec/tools", "GET"),
    ("/api/exec/tool/update_card", "POST"),
])
def test_closed_without_the_token(client, path, method, admin_headers, admin_cookie, guest_cookie):
    for headers in ({}, {"x-cc-token": "wrong"}, admin_headers, admin_cookie, guest_cookie):
        r = client.request(method, path, headers=headers, json={})
        assert r.status_code == 401, (headers.keys(), r.status_code)


def test_schemas_are_the_chat_tools(client):
    r = client.get("/api/exec/tools", headers=_tok())
    assert r.status_code == 200
    names = {t["name"] for t in r.json()["tools"]}
    assert {"create_card", "archive_card", "schedule_card", "decompose_task"} <= names
    for t in r.json()["tools"]:
        assert t["input_schema"]["type"] == "object"


def test_call_reaches_the_dispatcher_without_mutating(client):
    # A card id that cannot exist: the handler runs and refuses, nothing is written.
    r = client.post("/api/exec/tool/update_card", headers=_tok(),
                    json={"id": "card-does-not-exist", "title": "x"})
    assert r.status_code == 200
    assert "not found" in r.json()["result"]["error"].lower()


def test_unknown_tool_and_bad_bodies(client):
    r = client.post("/api/exec/tool/rm_rf", headers=_tok(), json={})
    assert r.json()["result"]["error"].startswith("Unknown tool")
    r = client.post("/api/exec/tool/update_card", headers={**_tok(), "content-type": "application/json"},
                    content=b"{not json")
    assert r.status_code == 400
    r = client.post("/api/exec/tool/update_card", headers=_tok(), json=["a", "list"])
    assert r.status_code == 400
