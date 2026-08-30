"""Unit tests for the /printer proxy rewrites (pure, no live app).

The fixtures are verbatim slices of what the ELEGOO Centauri Carbon
(firmware V1.4.49) actually serves -- the index shell, main.js's websocket
URL, the 25.<hash>.js video <img> binding + file-host template literals, and
the SDCP video-URL frame -- so a firmware bump that changes a shape shows up
here before it silently breaks the page."""
import os
import sys

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "api"))

from printer_proxy import (  # noqa: E402
    REWRITE_VERSION, client_response_headers, not_modified, proxy_etag, rewrite_html,
    rewrite_js, rewrite_kind, rewrite_ws_text, upstream_request_headers,
)

INDEX = (
    '<!DOCTYPE html><html lang="en"><head><base href="/">'
    '<link rel="icon" type="image/x-icon" href="favicon.ico">'
    '<link rel="stylesheet" href="/assets/iconfont/iconfont.css" media="print">'
    '<link rel="stylesheet" href="styles.948ae391de6d85346226.css">'
    '</head><body><app-root></app-root>'
    '<script src="runtime.d8e385257819bb9e3f4a.js" defer></script></body></html>'
)


# ── html ──────────────────────────────────────────────────────────────────────
def test_html_base_href_moves_under_prefix():
    assert '<base href="/printer/">' in rewrite_html(INDEX)


def test_html_absolute_asset_paths_move_under_prefix():
    assert 'href="/printer/assets/iconfont/iconfont.css"' in rewrite_html(INDEX)


def test_html_relative_paths_untouched():
    out = rewrite_html(INDEX)
    assert 'href="favicon.ico"' in out
    assert 'href="styles.948ae391de6d85346226.css"' in out
    assert 'src="runtime.d8e385257819bb9e3f4a.js"' in out


def test_html_injects_frame_overrides_once_unrerooted():
    out = rewrite_html(INDEX)
    assert out.count('<link rel="stylesheet" href="/printer-frame.css?v=1"></head>') == 1
    assert 'href="/printer/printer-frame.css' not in out  # injected after the re-root pass


def test_html_protocol_relative_untouched():
    assert rewrite_html('<script src="//cdn.example/x.js">') == '<script src="//cdn.example/x.js">'


# ── js ────────────────────────────────────────────────────────────────────────
MAIN_JS = 'connect(){this.url=`ws://${this.hostName}:3030/websocket`,this.createWebSocket()}'
CHUNK_JS = (
    'u.Q6J("src","http://"+(null==t.printerDetail||null==t.printerDetail.Data'
    '?null:t.printerDetail.Data.VideoUrl),u.LSH)'
)
DOWNLOAD_JS = 'o.href=`http://${this.webSocketService.hostName}:80${i}`,o.download=""'
UPLOAD_JS = 'this.fileUploadService.uploadFile(`http://${this.webSocketService.hostName}:80/uploadFile/upload`,f)'


def test_js_websocket_url_becomes_same_origin_proxy():
    out = rewrite_js(MAIN_JS)
    assert "3030" not in out
    assert 'this.url=`${location.protocol==="https:"?"wss":"ws"}://${location.host}/ws/printer`' in out


def test_js_video_img_src_drops_http_scheme():
    out = rewrite_js(CHUNK_JS)
    assert '"http://"' not in out
    assert 'u.Q6J("src",(null==t.printerDetail||null==t.printerDetail.Data?null:t.printerDetail.Data.VideoUrl),u.LSH)' == out


def test_js_file_host_becomes_proxy_prefix():
    assert rewrite_js(DOWNLOAD_JS) == 'o.href=`${location.origin}/printer${i}`,o.download=""'
    assert rewrite_js(UPLOAD_JS) == 'this.fileUploadService.uploadFile(`${location.origin}/printer/uploadFile/upload`,f)'


def test_js_unrelated_http_strings_untouched():
    src = 'if(n.startsWith("http://")||n.startsWith("https://"))return e.handle(t)'
    assert rewrite_js(src) == src


def test_js_absolute_asset_paths_move_under_prefix():
    # compiled Angular template: [["src","/assets/images/network/start.png"],…]
    src = 'u.TgZ(0,"img",83),["src","/assets/images/network/start.png"],x=`/assets/images/network/${n}.png`'
    out = rewrite_js(src)
    assert '"/printer/assets/images/network/start.png"' in out
    assert '`/printer/assets/images/network/${n}.png`' in out
    assert "/assets/" not in out.replace("/printer/assets/", "")


def test_js_webrtc_signalling_socket_left_alone():
    # Deliberately out of scope (needs VIDEO_WEBRTC, which this printer lacks,
    # plus a fourth tunnel port). Pin it so a future rule is a conscious change.
    src = 'connectSocket(){this.init(),this.socket=new WebSocket(`ws://${this.webSocketService.hostName}:8883`)}'
    assert rewrite_js(src) == src


# ── ws frames ─────────────────────────────────────────────────────────────────
def test_ws_video_url_rewritten_to_same_origin_route():
    frame = '{"Data":{"Cmd":386,"Data":{"Ack":0,"VideoUrl":"192.168.2.25:3031/video"}},"Topic":"sdcp/response/x"}'
    assert '"VideoUrl":"/printer/video"' in rewrite_ws_text(frame)
    assert "3031" not in rewrite_ws_text(frame)


def test_ws_empty_video_url_untouched():
    frame = '{"Data":{"VideoUrl":""}}'
    assert rewrite_ws_text(frame) == frame


def test_ws_task_thumbnail_and_timelapse_urls_move_under_prefix():
    # cmd 321 (history task detail): the SPA binds Thumbnail straight onto an <img src>
    frame = ('{"Data":{"Cmd":321,"Data":{"Ack":0,"HistoryDetailList":[{"Thumbnail":'
             '"http://192.168.2.25/board-resource/history_image/42df3c5c.png",'
             '"TimeLapseVideoUrl":"http://192.168.2.25:80/board-resource/timelapse/x.mp4",'
             '"TaskName":"/local/ECC_0.4_tri.gcode"}]}}}')
    out = rewrite_ws_text(frame)
    assert '"Thumbnail":"/printer/board-resource/history_image/42df3c5c.png"' in out
    assert '"TimeLapseVideoUrl":"/printer/board-resource/timelapse/x.mp4"' in out
    assert '"TaskName":"/local/ECC_0.4_tri.gcode"' in out  # a bare path is not a URL
    assert "192.168.2.25" not in out


def test_ws_other_ports_left_alone():
    frame = '{"X":"http://192.168.2.25:3030/uploadFile/upload","MainboardIP":"192.168.2.25"}'
    assert rewrite_ws_text(frame) == frame


def test_ws_status_frame_untouched():
    frame = '{"Status":{"TempOfNozzle":220.4,"CurrenCoord":"245.35,119.50,-1.73"},"Topic":"sdcp/status/x"}'
    assert rewrite_ws_text(frame) == frame


# ── content-type dispatch ─────────────────────────────────────────────────────
def test_rewrite_kind():
    assert rewrite_kind("text/html; charset=utf-8") == "html"
    assert rewrite_kind("application/javascript") == "js"
    assert rewrite_kind("text/javascript; charset=utf-8") == "js"
    assert rewrite_kind("text/css") is None
    assert rewrite_kind("multipart/x-mixed-replace; boundary=--foo") is None
    assert rewrite_kind("") is None


# ── header allowlists ─────────────────────────────────────────────────────────
def test_request_headers_never_leak_auth_to_printer():
    out = upstream_request_headers({
        "cookie": "session=secret", "authorization": "Bearer key", "host": "wai-lau.net",
        "accept": "text/html", "accept-encoding": "gzip, br", "if-none-match": '"abc"',
        "content-length": "4096",
    })
    assert "cookie" not in out and "authorization" not in out and "host" not in out
    assert out["accept"] == "text/html"
    assert "if-none-match" not in out  # conditionals are answered by the proxy, never the printer
    assert out["accept-encoding"] == "identity"
    assert out["content-length"] == "4096"  # streamed upload keeps its known length


def test_response_headers_drop_length_encoding_and_reroot_location():
    out = client_response_headers({
        "content-type": "text/html", "content-length": "2166", "content-encoding": "gzip",
        "etag": '"x"', "transfer-encoding": "chunked", "location": "/network/control",
        "cache-control": "public, max-age=31536000",
    })
    assert out["content-type"] == "text/html" and out["etag"] == '"x"'  # pass-through kind keeps the printer's tag
    assert "content-length" not in out and "content-encoding" not in out and "transfer-encoding" not in out
    assert out["location"] == "/printer/network/control"


def test_response_is_always_private_no_cache():
    # Auth-gated proxy: never a shared-cache candidate, whatever upstream says.
    assert client_response_headers({"cache-control": "public, max-age=86400"})["cache-control"] == "private, no-cache"
    assert client_response_headers({})["cache-control"] == "private, no-cache"


@pytest.mark.parametrize("loc", ["http://elsewhere/x", "//elsewhere/x", "/\\elsewhere/x", "elsewhere/x"])
def test_response_non_root_relative_location_dropped(loc):
    assert "location" not in client_response_headers({"location": loc})


# ── conditional requests ──────────────────────────────────────────────────────
def test_rewritten_body_etag_carries_rewrite_version():
    assert proxy_etag('"1782465519.416037"', "js") == f'"1782465519.416037-rw{REWRITE_VERSION}"'
    assert proxy_etag('W/"abc"', "html") == f'"abc-rw{REWRITE_VERSION}"'
    assert proxy_etag('"abc"', None) == '"abc"'
    assert proxy_etag(None, "js") is None


def test_rewritten_body_drops_last_modified_but_passthrough_keeps_it():
    up = {"etag": '"e"', "last-modified": "Tue, 01 Jan 2030 00:00:00 GMT", "content-type": "text/javascript"}
    assert "last-modified" not in client_response_headers(up, "js")
    assert client_response_headers(dict(up, **{"content-type": "text/css"}), None)["last-modified"] == up["last-modified"]


def test_not_modified_matches_only_the_proxy_etag():
    tag = f'"e-rw{REWRITE_VERSION}"'
    assert not_modified({"if-none-match": tag}, tag)
    assert not_modified({"if-none-match": f'"other", W/{tag}'}, tag)
    assert not_modified({"if-none-match": "*"}, tag)
    # a browser copy patched by OLDER rules holds the bare printer tag -> miss -> refetch
    assert not not_modified({"if-none-match": '"e"'}, tag)
    assert not not_modified({}, tag)
    assert not not_modified({"if-none-match": tag}, None)
