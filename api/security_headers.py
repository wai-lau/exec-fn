"""Site-wide security headers, stamped on every response (pure ASGI, like
main.CacheControlMiddleware: header-only, never buffers a body or an SSE
stream). Added 2026-10-14 after a security audit found none at all:

- Strict-Transport-Security: an http:// link could be TLS-stripped, and a
  noodle link's key lives in its #fragment -- readable by any page an on-path
  attacker serves in place of the real one. One year; no includeSubDomains
  and no preload, both hard to take back.
- X-Frame-Options: SAMEORIGIN -- no other site may frame a page here (the
  printer's own iframe on /printer is same-origin and keeps working).
- X-Content-Type-Options: nosniff.

A response that already carries one of these keeps its own value.
"""
from starlette.datastructures import MutableHeaders

_HEADERS = (
    ("Strict-Transport-Security", "max-age=31536000"),
    ("X-Frame-Options", "SAMEORIGIN"),
    ("X-Content-Type-Options", "nosniff"),
)


class SecurityHeadersMiddleware:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)

        async def send_wrapper(message):
            if message["type"] == "http.response.start":
                headers = MutableHeaders(raw=message["headers"])
                for name, value in _HEADERS:
                    if name not in headers:
                        headers[name] = value
            await send(message)

        await self.app(scope, receive, send_wrapper)
