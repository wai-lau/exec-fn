"""Security telemetry page: renders the /security dashboard content from the
combined JSON written by scripts/security/refresh.py (host cron, reads /var/log).

Pure rendering — NO log/file access beyond the prepared JSON in data/. Three
tabs (ssh / all-incoming / geo), inline SVG, no external assets. The route wraps
this in the standard page shell (head+nav+chrome+favicon) via _render_page."""
import json, html, math, os
from pathlib import Path

DATA_PATH = Path(os.environ.get("SECURITY_JSON", "/app/data/security.json"))

# palette (aligns with chrome.css cyber theme)
GREEN="#39d353"; CYAN="#2bd9d9"; MAG="#ff4dd2"; AMBER="#ffb454"; RED="#f85149"
BLUE="#539bf5"; PURP="#bc8cff"; MUT="#6e7681"; TXT="#c9d1d9"; GRID="#1c2533"

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
        c=AMBER if (mark and lab==mark) else color
        tag=' ◄ you' if (mark and lab==mark) else ''
        rows.append(f'<text x="{labw-8}" y="{y+h*0.68:.0f}" text-anchor="end" class="sl">{_e(lab)}</text>'
            f'<rect x="{labw}" y="{y+3}" width="{bw:.1f}" height="{h-6}" rx="3" fill="{c}" opacity="0.85"/>'
            f'<text x="{labw+bw+6:.1f}" y="{y+h*0.68:.0f}" class="sv">{_f(val)}{tag}</text>')
        y+=h+gap
    return f'<svg viewBox="0 0 {width} {y}" class="sc" preserveAspectRatio="xMinYMin meet">{"".join(rows)}</svg>'

def area(series, color, width=720, H=200, pad=34, gid="a"):
    if not series: return ""
    vals=[v for _,v in series]; mx=max(vals) or 1; n=len(series)
    x0=pad+30; x1=width-10; y0=10; y1=H-pad
    X=lambda i: x0+(x1-x0)*(i/(n-1 if n>1 else 1)); Y=lambda v: y1-(y1-y0)*(v/mx)
    pts=[(X(i),Y(v)) for i,(_,v) in enumerate(series)]
    line=" ".join(f"{x:.1f},{y:.1f}" for x,y in pts)
    ar=f"M{x0:.1f},{y1:.1f} L"+" L".join(f"{x:.1f},{y:.1f}" for x,y in pts)+f" L{x1:.1f},{y1:.1f} Z"
    g=[]
    for fr in (0,0.5,1):
        yy=y1-(y1-y0)*fr; g.append(f'<line x1="{x0}" y1="{yy:.1f}" x2="{x1}" y2="{yy:.1f}" stroke="{GRID}"/>'
            f'<text x="{x0-6}" y="{yy+4:.1f}" text-anchor="end" class="sa">{_f(mx*fr)}</text>')
    pi=max(range(n),key=lambda i:series[i][1]); px,py=pts[pi]
    anc="start" if pi<n*0.12 else ("end" if pi>n*0.88 else "middle"); dx=7 if anc=="start" else(-7 if anc=="end" else 0)
    pk=f'<circle cx="{px:.1f}" cy="{py:.1f}" r="3.5" fill="{color}"/><text x="{px+dx:.1f}" y="{py-8:.1f}" text-anchor="{anc}" class="sp">{_f(series[pi][1])}</text>'
    xl=[f'<text x="{X(i):.1f}" y="{H-8}" text-anchor="middle" class="sa">{_e(series[i][0][5:])}</text>' for i in {0,pi,n-1}]
    return (f'<svg viewBox="0 0 {width} {H}" class="sc" preserveAspectRatio="xMinYMin meet">'
        f'<defs><linearGradient id="g{gid}" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="{color}" stop-opacity="0.5"/><stop offset="1" stop-color="{color}" stop-opacity="0.03"/></linearGradient></defs>'
        f'{"".join(g)}<path d="{ar}" fill="url(#g{gid})"/><polyline points="{line}" fill="none" stroke="{color}" stroke-width="2"/>{pk}{"".join(xl)}</svg>')

def vbar(series, color, width=720, H=185, pad=28):
    if not series: return ""
    vals=[v for _,v in series]; mx=max(vals) or 1; n=len(series)
    x0=pad+24; x1=width-10; y0=10; y1=H-pad; bw=(x1-x0)/n; rows=[]
    pi=max(range(n),key=lambda i:series[i][1])
    for i,(lab,val) in enumerate(series):
        bh=(y1-y0)*val/mx; x=x0+i*bw
        rows.append(f'<rect x="{x+1:.1f}" y="{y1-bh:.1f}" width="{bw-2:.1f}" height="{bh:.1f}" rx="2" fill="{AMBER if i==pi else color}" opacity="0.88"/>')
        if i%3==0: rows.append(f'<text x="{x+bw/2:.1f}" y="{H-8}" text-anchor="middle" class="sa">{int(lab):02d}</text>')
    for fr in (0,0.5,1):
        yy=y1-(y1-y0)*fr; rows.append(f'<line x1="{x0}" y1="{yy:.1f}" x2="{x1}" y2="{yy:.1f}" stroke="{GRID}"/><text x="{x0-6}" y="{yy+4:.1f}" text-anchor="end" class="sa">{_f(mx*fr)}</text>')
    return f'<svg viewBox="0 0 {width} {H}" class="sc" preserveAspectRatio="xMinYMin meet">{"".join(rows)}</svg>'

def multiline(days, series, width=720, H=220, pad=36):
    mx=max((v for _,_,m in series for v in m.values()), default=1) or 1
    n=len(days); x0=pad+18; x1=width-12; y0=22; y1=H-pad
    X=lambda i: x0+(x1-x0)*(i/(n-1 if n>1 else 1)); Y=lambda v: y1-(y1-y0)*(v/mx)
    out=[]
    for fr in (0,0.25,0.5,0.75,1):
        yy=Y(mx*fr); out.append(f'<line x1="{x0}" y1="{yy:.1f}" x2="{x1}" y2="{yy:.1f}" stroke="{GRID}"/><text x="{x0-6}" y="{yy+4:.1f}" text-anchor="end" class="sa">{_f(mx*fr)}</text>')
    for li,(lab,color,m) in enumerate(series):
        seg=[]; cur=[]
        for i,dd in enumerate(days):
            if dd in m: cur.append((X(i),Y(m[dd])))
            elif len(cur)>1: seg.append(cur); cur=[]
            else: cur=[]
        if len(cur)>1: seg.append(cur)
        for pp in seg:
            out.append(f'<polyline points="{" ".join(f"{x:.1f},{y:.1f}" for x,y in pp)}" fill="none" stroke="{color}" stroke-width="2"/>')
        lx=x0+18+li*150
        out.append(f'<rect x="{lx}" y="6" width="14" height="9" rx="2" fill="{color}"/><text x="{lx+19}" y="14" class="sa">{_e(lab)}</text>')
    for i in (0,n//2,n-1):
        out.append(f'<text x="{X(i):.1f}" y="{H-8}" text-anchor="middle" class="sa">{_e(days[i][5:])}</text>')
    return f'<svg viewBox="0 0 {width} {H}" class="sc" preserveAspectRatio="xMinYMin meet">{"".join(out)}</svg>'

def dotmap(geo, width=960, H=460):
    pad=8; W=width-2*pad; Hh=H-2*pad
    X=lambda lon: pad+(lon+180)/360*W; Y=lambda lat: pad+(90-lat)/180*Hh
    out=[f'<rect x="{pad}" y="{pad}" width="{W}" height="{Hh}" fill="#0a121b" rx="6"/>']
    for lon in range(-180,181,30):
        x=X(lon); out.append(f'<line x1="{x:.1f}" y1="{pad}" x2="{x:.1f}" y2="{pad+Hh}" stroke="{GRID}" stroke-width="{1.4 if lon==0 else .6}"/><text x="{x:.1f}" y="{pad+Hh-3}" text-anchor="middle" class="sg">{lon}</text>')
    for lat in range(-60,91,30):
        y=Y(lat); out.append(f'<line x1="{pad}" y1="{y:.1f}" x2="{pad+W}" y2="{y:.1f}" stroke="{GRID}" stroke-width="{1.4 if lat==0 else .6}"/><text x="{pad+3}" y="{y-3:.1f}" class="sg">{lat}</text>')
    for o in sorted(geo,key=lambda o:o.get("total",0)):
        if o.get("lat") is None: continue
        x=X(o["lon"]); y=Y(o["lat"]); r=min(17,2+math.sqrt(o.get("total",1))*0.2)
        col=RED if o.get("ssh",0)>=o.get("web",0) else CYAN
        out.append(f'<circle cx="{x:.1f}" cy="{y:.1f}" r="{r:.1f}" fill="{col}" fill-opacity="0.45" stroke="{col}" stroke-opacity="0.7" stroke-width="0.6"/>')
    out.append(f'<rect x="{width-176}" y="14" width="168" height="44" rx="6" fill="#0d1722" stroke="{GRID}"/>'
        f'<circle cx="{width-160}" cy="30" r="6" fill="{RED}" fill-opacity="0.5"/><text x="{width-148}" y="34" class="sa">ssh-dominant</text>'
        f'<circle cx="{width-160}" cy="48" r="6" fill="{CYAN}" fill-opacity="0.5"/><text x="{width-148}" y="52" class="sa">web-dominant</text>')
    return f'<svg viewBox="0 0 {width} {H}" class="sc" preserveAspectRatio="xMinYMin meet">{"".join(out)}</svg>'

# ---------------------------------------------------------------- building blocks
def _card(big,small,color): return f'<div class="scard"><div class="sb" style="color:{color}">{big}</div><div class="ss">{small}</div></div>'
def _panel(t,sub,svg): return f'<section class="spanel"><h3>{_e(t)}</h3><div class="ssub">{_e(sub)}</div>{svg}</section>'

# ---------------------------------------------------------------- tabs
def _ssh_tab(A):
    if not A: return '<p class="snote">no ssh data yet</p>'
    T=A["totals"]; root=dict(A["top_users"]).get("root",0)
    rp=100*root/max(1,T["attempts"])
    users=[(u,c) for u,c in A["top_users"] if u!="root"][:13]
    cards="".join([_card(_f(T["attempts"]),"attack attempts",RED),_card(_f(T["unique_ips"]),"unique IPs",CYAN),
        _card(_f(T["unique_users"]),"usernames tried",MAG),_card(_f(T["bans"]),"fail2ban bans",AMBER),
        _card(_f(T["accepted"]),"valid-key logins",GREEN),_card(f"{rp:.0f}%","target root",RED)])
    return (f'<div class="scards">{cards}</div>'
        f'{_panel("Attack attempts / day",f"{T['day_first']} → {T['day_last']}",area(A["per_day_attempts"],RED,gid="ssh1"))}'
        f'<div class="sg2">{_panel("fail2ban bans / day","",area(A["per_day_bans"],AMBER,width=520,gid="ssh2"))}'
        f'{_panel("Attempts by hour","server local (UTC-4)",vbar(A["per_hour"],CYAN,width=520))}</div>'
        f'<div class="sg2">{_panel("Top usernames (excl. root)",f"root={_f(root)} shown in stats",hbar(users,MAG,width=520))}'
        f'{_panel("Top attacking IPs","",hbar([(i,c) for i,c in A["top_ips"]],CYAN,width=520,labw=130))}</div>'
        f'{_panel("Most-banned IPs",":",hbar([(i,c) for i,c in A["top_banned_ips"]],AMBER,labw=130))}')

def _web_tab(W,A):
    if not W: return '<p class="snote">no web data yet</p>'
    wt=W["totals"]; ssh_ev=(A["totals"]["attempts"]+A["totals"]["accepted"]) if A else 0
    cards="".join([_card(_f(ssh_ev+wt["requests"]),"total incoming",TXT),_card(_f(wt["requests"]),"HTTP(S) reqs",CYAN),
        _card(_f(ssh_ev),"SSH events",RED),_card(f"{wt['pct_4xx']:.0f}%","web 4xx (scan)",AMBER),
        _card(_f(wt["unique_ips"]),"web source IPs",MAG),_card(_f(wt["owner_hits"]),"your own traffic",GREEN)])
    web_day={d:v for d,v in W["per_day"]}; ssh_day={d:v for d,v in A["per_day_attempts"]} if A else {}
    days=sorted(set(web_day)|set(ssh_day))
    series=[("HTTP(S) reqs",CYAN,web_day)]+([("SSH attempts",RED,ssh_day)] if ssh_day else [])
    return (f'<div class="scards">{cards}</div>'
        f'{_panel("Incoming volume / day — web vs ssh","shared axis",multiline(days,series))}'
        f'<div class="sg2">{_panel("Web response classes","404 split out",hbar([(k,v) for k,v in W["status_class"]],AMBER,width=520,labw=70))}'
        f'{_panel("Client type","by user-agent (owner=human)",hbar([(k,v) for k,v in W["kind"]],GREEN,width=520,labw=110))}</div>'
        f'<div class="sg2">{_panel("Top requested paths","your endpoints + probes",hbar([(p,c) for p,c in W["top_paths"]],CYAN,width=520,labw=190))}'
        f'{_panel("Top scanner probes (404)","paths bots hunt for",hbar([(p,c) for p,c in W["top_404"]],RED,width=520,labw=190))}</div>'
        f'<div class="sg2">{_panel("Top web IPs","",hbar([(i,c) for i,c in W["top_ips"]],MAG,width=520,labw=130,mark=W.get("owner_ip")))}'
        f'{_panel("HTTP methods","PROPFIND/PRI/CONNECT = scans",hbar([(m,c) for m,c in W["methods"]],PURP,width=520,labw=110))}</div>'
        f'{_panel("Web requests by hour","server local (UTC-4)",vbar(W["per_hour"],CYAN))}')

def _geo_tab(Gd):
    if not Gd or not Gd.get("geo"): return '<p class="snote">no geo data yet</p>'
    M=Gd["meta"]; cc=Gd["cc_map"]
    countries=[(f'{cc.get(c,"")} · {c}',v) for c,v in Gd["country"]]
    asn=[(a[:34],v) for a,v in Gd["asn"]]
    geoloc_tot=sum(v for _,v in Gd["country"]) or 1; top5=sum(v for _,v in Gd["country"][:5])
    tc=Gd["country"][0]
    cards="".join([_card(_f(M["geolocated"]),f"IPs geolocated ({M['coverage_pct']:.0f}%)",CYAN),
        _card(str(len(Gd["country"])>=16 and "80+" or len(Gd["country"])),"countries",MAG),
        _card(cc.get(tc[0],"?"),f"top: {tc[0]}",AMBER),_card(f"{100*top5/geoloc_tot:.0f}%","from top-5",RED),
        _card(_f(M["unique_public"]),"unique public IPs",GREEN)])
    rows=[]
    for o in Gd["geo"][:24]:
        rows.append(f'<tr><td class="ip">{_e(o["ip"])}</td><td>{_e(o.get("cc") or "?")}</td>'
            f'<td>{_e((o.get("city") or "")[:18])}</td><td class="isp">{_e((o.get("isp") or "")[:30])}</td>'
            f'<td class="n" style="color:{RED}">{_f(o.get("ssh",0))}</td><td class="n" style="color:{CYAN}">{_f(o.get("web",0))}</td>'
            f'<td class="n"><b>{_f(o.get("total",0))}</b></td></tr>')
    return (f'<div class="scards">{cards}</div>'
        f'{_panel("Origin map","equirectangular; dot size=volume, colour=service",dotmap(Gd["geo"]))}'
        f'<div class="sg2">{_panel("Top countries","ssh+web events",hbar(countries,MAG,width=520,labw=170))}'
        f'{_panel("Top networks / ASNs","where traffic is hosted",hbar(asn,AMBER,width=520,labw=240))}</div>'
        f'<section class="spanel"><h3>Top attacker IPs</h3><div class="ssub">ssh=red web=cyan</div>'
        f'<table class="stab"><tr><th>IP</th><th>CC</th><th>City</th><th>ISP / host</th><th class="n">ssh</th><th class="n">web</th><th class="n">total</th></tr>{"".join(rows)}</table></section>')

_CSS = """
<style>
.secwrap{max-width:1080px;margin:0 auto;padding:8px 4px 60px;font:14px/1.5 ui-monospace,"Iosevka",Menlo,Consolas,monospace;color:#c9d1d9}
.sechead{display:flex;align-items:baseline;gap:12px;flex-wrap:wrap;margin:4px 0 6px}
.sechead h2{margin:0;font-size:20px;color:#fff}.sechead .meta{color:#6e7681;font-size:12px}
.sectabs{display:flex;gap:8px;margin:14px 0 6px;border-bottom:1px solid #1c2533}
.sectab{background:none;border:none;color:#6e7681;font:inherit;padding:8px 14px;cursor:pointer;border-bottom:2px solid transparent}
.sectab:hover{color:#c9d1d9}.sectab.on{color:#fff;border-bottom-color:#2bd9d9}
.secpane{display:none}.secpane.on{display:block}
.scards{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px;margin:16px 0}
.scard{background:#0d1420;border:1px solid #1c2533;border-radius:10px;padding:12px 14px}
.scard .sb{font-size:22px;font-weight:700;line-height:1.1}.scard .ss{color:#6e7681;font-size:11px;margin-top:3px}
.sg2{display:grid;grid-template-columns:1fr 1fr;gap:16px}@media(max-width:740px){.sg2{grid-template-columns:1fr}}
.spanel{background:#0b111b;border:1px solid #1c2533;border-radius:12px;padding:14px 16px;margin:16px 0}
.spanel h3{margin:0;font-size:14px;color:#fff}.spanel .ssub{color:#6e7681;font-size:11px;margin:2px 0 10px}
.sc{width:100%;height:auto;display:block}
.sl{fill:#c9d1d9;font-size:12px}.sv{fill:#6e7681;font-size:11px}.sa{fill:#6e7681;font-size:10px}.sp{fill:#fff;font-size:11px;font-weight:600}
.sg{fill:#33414f;font-size:9px}.sr{fill:#2c3a47;font-size:11px;letter-spacing:2px}
.snote{color:#6e7681;padding:30px;text-align:center}
.stab{width:100%;border-collapse:collapse;font-size:12px}.stab th,.stab td{text-align:left;padding:5px 8px;border-bottom:1px solid #1c2533}
.stab th{color:#6e7681}.stab td.ip{color:#ffb454}.stab td.isp{color:#6e7681}.stab td.n{text-align:right;font-variant-numeric:tabular-nums}
</style>
"""
_JS = """
<script>
(function(){
 document.querySelectorAll('.sectab').forEach(function(b){
  b.addEventListener('click',function(){
   var t=b.dataset.t;
   document.querySelectorAll('.sectab').forEach(function(x){x.classList.toggle('on',x.dataset.t===t)});
   document.querySelectorAll('.secpane').forEach(function(p){p.classList.toggle('on',p.dataset.t===t)});
   try{location.hash=t}catch(e){}
  });
 });
 var h=(location.hash||'').replace('#','');
 if(h){var b=document.querySelector('.sectab[data-t="'+h+'"]');if(b)b.click();}
})();
</script>
"""

def load_security_data():
    try:
        return json.loads(DATA_PATH.read_text())
    except (OSError, ValueError):
        return {}

def render_security(data):
    gen = data.get("generated") if data else None
    A = data.get("ssh") if data else None
    W = data.get("web") if data else None
    Gd = data.get("geo") if data else None
    if not data:
        body = '<p class="snote">Telemetry not generated yet — the host cron writes data/security.json hourly.</p>'
        return f'<div class="secwrap">{_CSS}<div class="sechead"><h2>◎ security</h2></div>{body}</div>'
    meta = f'web {W["totals"]["day_first"]}→{W["totals"]["day_last"]} · ssh {A["totals"]["day_first"]}→{A["totals"]["day_last"]}' if (W and A) else ""
    panes = (f'<div class="secpane on" data-t="geo">{_geo_tab(Gd)}</div>'
             f'<div class="secpane" data-t="ssh">{_ssh_tab(A)}</div>'
             f'<div class="secpane" data-t="web">{_web_tab(W,A)}</div>')
    return (f'<div class="secwrap">{_CSS}'
        f'<div class="sechead"><h2>◎ wai-lau.net security</h2>'
        f'<span class="meta">{_e(meta)} · generated {_e(gen)}</span></div>'
        f'<div class="sectabs">'
        f'<button class="sectab on" data-t="geo">geolocation</button>'
        f'<button class="sectab" data-t="ssh">ssh brute-force</button>'
        f'<button class="sectab" data-t="web">all incoming</button></div>'
        f'{panes}{_JS}</div>')
