"""Discord bridge — reach Wai's phone when away from the computer.

Outbound: subscribes a queue to the exec-bubble fan-out (`monitor_sse`) and
DMs every `{comment}` payload — nudge fires AND monitor comments both push
through that one channel (`nudge_loop._fire_nudge`, `monitor.py`), so a single
drain catches both.

Inbound: a DM from the owner runs the Exec chat model (same system prompt +
tools as the web bubble) and replies in the DM, mirroring the turn into the
shared `chat.json` so the web bubble and the phone stay one conversation.

Disabled (a clean no-op) unless DISCORD_BOT_TOKEN + DISCORD_USER_ID are set,
so dev/tests without the token — and without `discord.py` installed — import
this module fine (the `import discord` lives inside `_run_discord_bot`)."""
import asyncio
import os
import re

_MAX_LEN = 2000  # Discord per-message hard cap.


async def exec_reply(text: str) -> str:
    """Run one Exec turn for an inbound DM and return the reply text.

    Same two-pass turn as the web bubble (chat_passes.run_turn), collected
    rather than streamed: load the shared history, run it, then persist via
    _save_chat so the web bubble sees it. run_turn pushes {cards_changed} itself
    when a tool rewrites rd.json, so an open web board follows the phone."""
    import anthropic
    from chat_passes import run_turn
    from chat_store import _save_chat, get_chat, sanitize_history_for_api
    from nudge import clear_awaiting_focused

    # A DM is a reply to any focused awaiting nudge — pause the stall timer.
    await asyncio.to_thread(clear_awaiting_focused)

    chat = await asyncio.to_thread(get_chat)
    # Flatten history to text-only, role-alternating (drops monitor lines, the
    # server-side ts, and any orphaned prior-turn tool_use/tool_result blocks the
    # API rejects). Append the fresh user turn, then re-flatten so appending it
    # after a dropped tool_result can't leave two adjacent user messages.
    messages = sanitize_history_for_api(
        list(chat.get("messages", [])) + [{"role": "user", "content": text}]
    )
    reply_text = ""
    async for ev in run_turn(anthropic.AsyncAnthropic(), messages, "planning"):
        if ev["type"] == "final":
            reply_text = ev["text"]
            await asyncio.to_thread(_save_chat, ev["messages"], "planning")
    return reply_text or "[no reply]"


# A trailing answer row can carry a `card=<id>` cell: the exec panel parses it
# into that card's done/exile buttons and strips the whole row before rendering
# (web/exec-choices.js). Discord has no buttons, so on the phone the cell is the
# one raw card id Exec is allowed to write, shown to the one person it means
# nothing to. Drop the cell here and keep the answers, which still read as a
# hint at what to reply; a row left holding nothing else goes with it.
_CARD_ROW = re.compile(r"(\n[ \t]*(?:\*\*|__|\*|_)?\[)([^\[\]\n]*)(\](?:\*\*|__|\*|_)?\s*)$")
_CARD_CELL = re.compile(r"^\s*card\s*=\s*\S+\s*$")


def strip_card_cell(text: str) -> str:
    """Remove the `card=<id>` cell from a trailing [a | b] answer row."""
    m = _CARD_ROW.search(text or "")
    if not m:
        return text
    cells = [c for c in m.group(2).split("|") if not _CARD_CELL.match(c)]
    kept = [c.strip() for c in cells if c.strip()]
    if not kept:
        return text[:m.start()].rstrip()
    return text[:m.start(2)] + " | ".join(kept) + text[m.end(2):]


async def _send_chunked(target, text: str) -> None:
    """Send text as one or more messages under Discord's 2000-char cap."""
    text = strip_card_cell(text)
    for i in range(0, len(text) or 1, _MAX_LEN):
        await target.send(text[i:i + _MAX_LEN] or "[empty]")


async def _handle_dm(uid: int, message) -> None:
    """Answer one inbound DM from the owner; ignore everything else."""
    import discord
    # Only the owner, only DMs, never the bot's own echo.
    if message.author.id != uid or message.author.bot:
        return
    if not isinstance(message.channel, discord.DMChannel):
        return
    async with message.channel.typing():
        try:
            reply = await exec_reply(message.content)
        except Exception as e:  # noqa: BLE001 — surface the failure to the phone
            reply = f"[exec error: {e}]"
    await _send_chunked(message.channel, reply)


async def _drain_outbound(client, uid: int, outbound: "asyncio.Queue") -> None:
    """DM every `{comment}` exec-bubble payload (nudges + monitor comments)."""
    await client.wait_until_ready()
    user = await client.fetch_user(uid)
    while True:
        payload = await outbound.get()
        comment = payload.get("comment")  # ignore {thinking: ...} events
        if not comment:
            continue
        try:
            await _send_chunked(user, comment)
        except Exception:  # noqa: BLE001 — a failed DM must not kill the drain
            pass


async def _run_discord_bot() -> None:
    """Lifespan task: connect the gateway, DM outbound comments, answer DMs.

    No-op when the token/user-id env is unset. `import discord` is deferred to
    here so the module stays importable (tests, dev venv) without the lib."""
    token = os.environ.get("DISCORD_BOT_TOKEN")
    uid_raw = os.environ.get("DISCORD_USER_ID")
    if not token or not uid_raw:
        return  # bridge disabled
    uid = int(uid_raw)

    import discord
    from monitor_sse import _monitor_subscribers

    # Outbound: receive every exec-bubble payload via the existing fan-out, the
    # same way an SSE client subscribes — no edits to the nudge/monitor sites.
    outbound: asyncio.Queue = asyncio.Queue()
    _monitor_subscribers.append(outbound)

    intents = discord.Intents.default()
    intents.message_content = True  # read DM text (privileged intent)
    client = discord.Client(intents=intents)

    @client.event
    async def on_message(message):
        await _handle_dm(uid, message)

    drain = asyncio.create_task(_drain_outbound(client, uid, outbound))
    try:
        await client.start(token)
    finally:
        drain.cancel()
        if outbound in _monitor_subscribers:
            _monitor_subscribers.remove(outbound)
        await client.close()
