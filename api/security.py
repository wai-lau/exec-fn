"""Security telemetry page: renders the /security dashboard content from the
combined JSON written by scripts/security/refresh.py (host cron, reads /var/log).

Pure rendering — NO log/file access beyond the prepared JSON in data/. ONE long
public page (no tabs): an origin map of the automated bot/scanner traffic that
hits any public server, plus a few geo/type breakdowns. Every panel is framed as
bot/scanner noise so the big counts don't read as human users. No raw attacker
IPs / usernames / owner-identifying data (page is public). Inline SVG, no external
assets. The route wraps this in the standard shell (head+nav+chrome) via
_render_page."""
import json
import html
import math
import os
from pathlib import Path

DATA_PATH = Path(os.environ.get("SECURITY_JSON", "/app/data/security.json"))

# SVG chart DATA colours — Ono-Sendai green only (series differentiate by shade,
# not hue). SVG fill= attributes can't resolve var(), so these are concrete hsl.
G="hsl(135 100% 50%)"; GDIM="hsl(135 50% 42%)"; GHI="hsl(135 100% 72%)"; GRID="hsl(135 30% 16%)"

def _e(s): return html.escape(str(s))
def _f(n):
    try: return f"{int(n):,}"
    except (ValueError, TypeError): return str(n)

# ---------------------------------------------------------------- chart helpers
def hbar(data, color, h=24, gap=7, labw=170, valw=72, width=720, mark=None):
    if not data: return ""
    mx=max(v for _,v in data) or 1; barw=width-labw-valw; rows=[]; y=0
    for lab,val in data:
        bw=max(2,barw*val/mx)
        c=GHI if (mark and lab==mark) else color
        tag=' ◄ you' if (mark and lab==mark) else ''
        rows.append(f'<text x="{labw-8}" y="{y+h*0.68:.0f}" text-anchor="end" class="sl">{_e(lab)}</text>'
            f'<rect x="{labw}" y="{y+3}" width="{bw:.1f}" height="{h-6}" rx="3" fill="{c}" opacity="0.85"/>'
            f'<text x="{labw+bw+6:.1f}" y="{y+h*0.68:.0f}" class="sv">{_f(val)}{tag}</text>')
        y+=h+gap
    return f'<svg viewBox="0 0 {width} {y}" class="sc" preserveAspectRatio="xMinYMin meet">{"".join(rows)}</svg>'

def dotmap(geo, width=960, H=460, zoom=1.2):
    # equirectangular world; `zoom` crops the projection window centred on (0,0)
    # so empty ocean/poles fall away (zoom=1.2 → the requested 20% zoom-in). All
    # populated land sits inside lon ±150 / lat ±75, so nothing meaningful clips.
    pad=8; W=width-2*pad; Hh=H-2*pad
    lon_span=360/zoom; lat_span=180/zoom; lon0=-lon_span/2; lat_top=lat_span/2
    X=lambda lon: pad+(lon-lon0)/lon_span*W; Y=lambda lat: pad+(lat_top-lat)/lat_span*Hh
    out=[f'<rect x="{pad}" y="{pad}" width="{W}" height="{Hh}" fill="hsl(135 35% 6%)" rx="6"/>']
    for lon in range(-180,181,30):
        if lon<lon0 or lon>-lon0: continue
        x=X(lon); out.append(f'<line x1="{x:.1f}" y1="{pad}" x2="{x:.1f}" y2="{pad+Hh}" stroke="{GRID}" stroke-width="{1.4 if lon==0 else .6}"/><text x="{x:.1f}" y="{pad+Hh-3}" text-anchor="middle" class="sg">{lon}</text>')
    for lat in range(-60,91,30):
        if lat<-lat_top or lat>lat_top: continue
        y=Y(lat); out.append(f'<line x1="{pad}" y1="{y:.1f}" x2="{pad+W}" y2="{y:.1f}" stroke="{GRID}" stroke-width="{1.4 if lat==0 else .6}"/><text x="{pad+3}" y="{y-3:.1f}" class="sg">{lat}</text>')
    for o in sorted(geo,key=lambda o:o.get("total",0)):
        if o.get("lat") is None: continue
        x=X(o["lon"]); y=Y(o["lat"]); r=min(17,2+math.sqrt(o.get("total",1))*0.2)
        col=G if o.get("ssh",0)>=o.get("web",0) else GDIM
        out.append(f'<circle cx="{x:.1f}" cy="{y:.1f}" r="{r:.1f}" fill="{col}" fill-opacity="0.45" stroke="{col}" stroke-opacity="0.7" stroke-width="0.6"/>')
    out.append(f'<rect x="{width-186}" y="14" width="178" height="44" rx="6" fill="hsl(135 28% 9%)" stroke="{GRID}"/>'
        f'<circle cx="{width-170}" cy="30" r="6" fill="{G}" fill-opacity="0.5"/><text x="{width-158}" y="34" class="sa">SSH login bots</text>'
        f'<circle cx="{width-170}" cy="48" r="6" fill="{GDIM}" fill-opacity="0.5"/><text x="{width-158}" y="52" class="sa">web scanners</text>')
    return f'<svg viewBox="0 0 {width} {H}" class="sc" preserveAspectRatio="xMinYMin meet">{"".join(out)}</svg>'

# ---------------------------------------------------------------- building blocks
def _panel(t,sub,svg):
    subhtml = f'<div class="ssub">{_e(sub)}</div>' if sub else ""
    return f'<section class="spanel"><h3>{_e(t)}</h3>{subhtml}{svg}</section>'

_CSS = """
<style>
/* /security on the shared document theme: chrome uses the chrome.css --doc-*
   tokens; the SVG chart DATA colours are all Ono-Sendai green shades (G/GDIM/GHI,
   set inline — SVG fill= can't resolve var()). .secwrap adds the
   .doc-card class (see render_security) and just widens it for the dashboard. */
body{background:var(--doc-bg)}
.secwrap{width:min(1080px,94vw)}
.sg2{display:grid;grid-template-columns:1fr 1fr;gap:var(--space-6)}@media(max-width:740px){.sg2{grid-template-columns:1fr}}
/* no per-panel card — the whole page is already one .doc-card; panels are just
   labelled sections with vertical rhythm (no nested card-on-card). */
.spanel{margin:var(--space-6) 0}
/* origin map bleeds to the card edges (cancels .doc-card's 52px/clamp h-padding),
   scaling it up full-width; the h3 title stays inset with the rest. */
.spanel-map .sc{width:calc(100% + 2 * clamp(28px, 6vw, 60px));margin-left:calc(-1 * clamp(28px, 6vw, 60px))}
.spanel h3{margin:0;font-size:var(--fs-sm);color:var(--doc-green);text-transform:uppercase;letter-spacing:var(--tracking-caps)}.spanel .ssub{color:var(--doc-ink-soft);font-size:var(--fs-sm);margin:var(--space-0-5) 0 var(--space-3)}
.sc{width:100%;height:auto;display:block}
.sl{fill:var(--doc-ink);font-size:12px}.sv{fill:var(--doc-ink-soft);font-size:11px}.sa{fill:var(--doc-ink-soft);font-size:10px}.sp{fill:var(--doc-green);font-size:11px;font-weight:600}
.sg{fill:var(--doc-rule);font-size:9px}
.snote{color:var(--doc-ink-soft);padding:30px;text-align:center}
</style>
"""

def load_security_data():
    try:
        return json.loads(DATA_PATH.read_text())
    except (OSError, ValueError):
        return {}

def render_security(data):
    W = data.get("web") if data else None
    Gd = data.get("geo") if data else None
    if not data or not Gd or not Gd.get("geo"):
        body = '<p class="snote">Telemetry not generated yet — the host cron refreshes it hourly.</p>'
        return f'<div class="secwrap doc-card">{_CSS}{body}</div>'
    parts = []
    # 1. origin map — the hero, first thing, zoomed in; no subtitle line.
    parts.append(f'<section class="spanel spanel-map"><h3>Origin of automated traffic</h3>{dotmap(Gd["geo"])}</section>')
    # NOTE: deliberately NO user-agent "human vs bot" split — the `kind` field
    # classifies by UA string, which bots spoof (browser-UA "human" bucket is
    # mostly automated), so it reads as tens of thousands of humans and inverts
    # the whole point. The datacenter-ASN + all-404 charts below carry the
    # "it's all bots" story honestly.
    # 2 + 3. geo breakdown of the bot traffic.
    countries=[(f'{Gd["cc_map"].get(c,"")} · {c}',v) for c,v in Gd["country"]]
    asn=[(a[:34],v) for a,v in Gd["asn"]]
    parts.append(f'<div class="sg2">{_panel("Scanner traffic by country","",hbar(countries,G,width=520,labw=170))}'
        f'{_panel("Networks hosting the bots","",hbar(asn,G,width=520,labw=240))}</div>')
    # 5. what the scanners hunt for — all 404s, none of these paths exist here.
    if W and W.get("top_404"):
        parts.append(_panel("What the scanners hunt for",
            "paths bots probe for — every one a 404 (none exist here)",
            hbar([(p,c) for p,c in W["top_404"]],G,labw=200)))
    return f'<div class="secwrap doc-card">{_CSS}{"".join(parts)}</div>'
