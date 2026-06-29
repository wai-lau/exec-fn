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
import json
import os

_MAX_LEN = 2000  # Discord per-message hard cap.

_tools_cache = None


def _tools():
    """Build the Exec chat tools once (mirrors routes_chat's module-level build)."""
    global _tools_cache
    if _tools_cache is None:
        from chat import _chat_tools
        _tools_cache = _chat_tools()
    return _tools_cache


async def exec_reply(text: str) -> str:
    """Run one Exec turn for an inbound DM and return the reply text.

    Mirrors routes_chat.generate() but non-streaming: load the shared history,
    one tool round, then persist via _save_chat so the web bubble sees it. The
    sync helpers (prompt build, tool handlers, file I/O) go through to_thread so
    a DM turn never stalls the shared event loop."""
    import anthropic
    from chat import _build_chat_system_prompt, _save_chat, get_chat
    from chat_tools import _handle_tool
    from nudge import clear_awaiting_focused

    # A DM is a reply to any focused awaiting nudge — pause the stall timer.
    await asyncio.to_thread(clear_awaiting_focused)

    chat = await asyncio.to_thread(get_chat)
    # API-clean history: drop monitor lines + the server-side ts the API rejects.
    history = [
        {"role": m["role"], "content": m["content"]}
        for m in chat.get("messages", [])
        if m.get("role") in ("user", "assistant")
    ]
    messages = history + [{"role": "user", "content": text}]
    system = await asyncio.to_thread(_build_chat_system_prompt, "planning")
    tools = _tools()
    client = anthropic.AsyncAnthropic()

    final = await client.messages.create(
        model="claude-opus-4-8", max_tokens=1024,
        system=system, tools=tools, messages=messages,
    )
    assistant_content = [
        {"type": "text", "text": b.text} if b.type == "text"
        else {"type": "tool_use", "id": b.id, "name": b.name, "input": b.input}
        for b in final.content if b.type in ("text", "tool_use")
    ]
    all_messages = messages + [{"role": "assistant", "content": assistant_content}]
    reply_text = "".join(b.text for b in final.content if b.type == "text")

    # One tool round (matches the web bubble's single follow-up).
    tool_results = []
    for b in final.content:
        if b.type != "tool_use":
            continue
        result = await asyncio.to_thread(_handle_tool, b.name, b.input)
        if b.name == "advance_chunk" and isinstance(result, dict) and result.get("ok"):
            from monitor import schedule_monitor
            schedule_monitor()
        tool_results.append({
            "type": "tool_result", "tool_use_id": b.id, "content": json.dumps(result),
        })
    if tool_results:
        all_messages.append({"role": "user", "content": tool_results})
        final2 = await client.messages.create(
            model="claude-opus-4-8", max_tokens=512,
            system=system, tools=tools, messages=all_messages,
        )
        cont = "".join(b.text for b in final2.content if b.type == "text")
        if cont:
            all_messages.append({"role": "assistant", "content": [{"type": "text", "text": cont}]})
            reply_text = (reply_text + "\n\n" + cont).strip()

    await asyncio.to_thread(_save_chat, all_messages, "planning")
    return reply_text or "[no reply]"


async def _send_chunked(target, text: str) -> None:
    """Send text as one or more messages under Discord's 2000-char cap."""
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
