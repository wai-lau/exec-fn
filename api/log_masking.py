"""Masks noodle slugs and draft tokens out of uvicorn's access log (the docker
log). A poll's link IS its key -- the slug opens its sealed file, `?t=` mints
its poll -- so a request line must never carry them into a log (security
audit 2026-10-14; nginx masks its own log the same way:
/etc/nginx/conf.d/noodle-log-mask.conf)."""
import logging
import re

_SLUG = re.compile(r"(/(?:api/)?noodle/)[A-Za-z0-9_-]{22}")
_TOKEN = re.compile(r"([?&]t=)[^&\s]*")


def mask(path: str) -> str:
    return _TOKEN.sub(r"\1<token>", _SLUG.sub(r"\1<slug>", path))


class NoodleMask(logging.Filter):
    """uvicorn.access records carry (client, method, path, http_version, status)
    as args; the path is rewritten, everything else left alone."""

    def filter(self, record: logging.LogRecord) -> bool:
        args = record.args
        if isinstance(args, tuple) and len(args) >= 3 and isinstance(args[2], str):
            record.args = (*args[:2], mask(args[2]), *args[3:])
        return True


def install() -> None:
    logging.getLogger("uvicorn.access").addFilter(NoodleMask())
