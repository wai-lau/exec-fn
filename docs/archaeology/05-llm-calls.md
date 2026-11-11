## 5. LLM call sites + prompt caching

Current design: [ARCHITECTURE.md §5](../architecture/05-llm-calls.md).

  **TODAY moved from the top into the volatile tail — it was the silent invalidator.** The restructure was required because the tools alone (~3.5K) sit under opus's 4096 minimum.

### Moved out of ARCHITECTURE.md (2026-10-15 pass)

- Earlier token figures (~8.7K/13.4K tarot, ~6.6K, ~5.9K, ~5.2K) had drifted as prompts grew; remeasured 2026-10-14 (tools alone for Exec = 3,749, static text 2,745).
- `TODAY` sat at the top of the old single-string Exec prompt and silently invalidated the cache every request; moved to the volatile tail.
- **Two-pass Exec turn (2026-09-24):** replaced a single pass that acted and talked in one response, and learned to talk INSTEAD of acting: history reaches the model flattened, so it read dozens of its own turns saying "Added X" with no tool call beside them. Observed: "hang out with Nick" / "hang out with Jesse" answered "Added ... to the ideas pool", no tool called, and an invented `card=` id in the answer row — past a static-prefix rule already saying, in capitals, never to describe an action without the tool.
- **Cost measured live (2026-09-24, one-off, not re-run):** 8.6-9.3s to first text on a create, 2.3s on a question.
- **Follow-up action diff:** after a tool round the follow-up turn rebuilt the system prompt, so board lists included a card the turn just created and the model reported a phantom duplicate; fixed by the ACTIONS YOU JUST TOOK block.
- **Card id on log entries:** one `create_card` WITH a due_date emits both `created` and `updated`; by title alone that read as two cards, producing the phantom "there was already one in the pool from earlier this turn".
- CLAUDE.md's old paragraph: "TODAY was the silent invalidator until it moved into Exec's volatile tail, and the follow-up turn's ACTIONS YOU JUST TOOK block appends to that tail for the same reason."


---

