"""Rolling-window rate limits on noodle's signed WRITES (vote, settings,
remove, rekey), per client IP and per poll -- in memory, like Ask's own
(ask.py). Without them anyone holding a slug could post votes as fast as the
server would take them."""
import math
import threading
import time
from collections import defaultdict, deque

from noodle import config

_LOCK = threading.Lock()
_hits: dict[str, deque] = defaultdict(deque)
_calls = 0
_SWEEP_EVERY = 256


class Limited(Exception):
    def __init__(self, retry_after: int):
        super().__init__(f"too many changes -- wait {retry_after}s")
        self.retry_after = retry_after


def _windows(slug: str, ip: str) -> list[tuple[str, int, int]]:
    return [
        ("ip:" + ip, config.WRITE_IP_RATE, config.WRITE_IP_WINDOW_S),
        ("poll:" + slug, config.WRITE_POLL_RATE, config.WRITE_POLL_WINDOW_S),
    ]


def take_write(slug: str, ip: str, now: float | None = None) -> None:
    """Count one write against both windows, or raise Limited with the LONGEST
    wait among the full ones (nothing is counted then)."""
    global _calls
    now = time.monotonic() if now is None else now
    wins = _windows(slug, ip)
    with _LOCK:
        wait = 0.0
        for key, rate, window in wins:
            q = _hits[key]
            while q and q[0] <= now - window:
                q.popleft()
            if len(q) >= rate:
                wait = max(wait, q[0] + window - now)
        if wait > 0:
            raise Limited(max(1, math.ceil(wait)))
        for key, _, _ in wins:
            _hits[key].append(now)
        _calls += 1
        if _calls % _SWEEP_EVERY == 0:
            longest = max(config.WRITE_IP_WINDOW_S, config.WRITE_POLL_WINDOW_S)
            for key in [k for k, q in _hits.items() if not q or q[-1] <= now - longest]:
                del _hits[key]
