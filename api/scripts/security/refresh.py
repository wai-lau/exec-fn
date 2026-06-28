#!/usr/bin/env python3
"""HOST-side security telemetry refresh (run by root cron on the droplet).

Reads /var/log/{auth,nginx/access,fail2ban}.log* (root-only), geolocates the
top attacker IPs via ip-api.com (cached), and writes data/security.json which
the gitignored api/data/ volume exposes to the container for the /security page.

Runs OUTSIDE the container so the internet-facing app never gets host log access.
Owner IP comes from env SECURITY_OWNER_IP (never hardcode — exec-fn is public).
Stdlib only."""
import glob, gzip, re, io, json, os, ipaddress, urllib.request, time, tempfile
from collections import Counter
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]            # api/
OUT  = Path(os.environ.get("SECURITY_OUT", ROOT / "data" / "security.json"))
GEO_CACHE = Path(os.environ.get("SECURITY_GEO_CACHE", ROOT / "data" / "geo_cache.json"))
OWNER = os.environ.get("SECURITY_OWNER_IP", "").strip()
TOPN = int(os.environ.get("SECURITY_GEO_TOPN", "600"))
IP = r"(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})"

def openf(p):
    return io.TextIOWrapper(gzip.open(p, "rb"), errors="replace") if p.endswith(".gz") else open(p, "r", errors="replace")

MON = {m: i for i, m in enumerate("Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec".split(), 1)}

# ---------------------------------------------------------------- ssh (auth.log)
def parse_ssh():
    re_inv = re.compile(r"Invalid user (\S+) from " + IP)
    re_au  = re.compile(r"authenticating user (\S+) " + IP)
    re_fp  = re.compile(r"Failed password for (?:invalid user )?(\S+) from " + IP)
    re_acc = re.compile(r"Accepted (?:publickey|password) for (\S+) from " + IP)
    re_ts  = re.compile(r"^(\d{4})-(\d{2})-(\d{2})T(\d{2}):")
    ip_ct=Counter(); user_ct=Counter(); per_day=Counter(); per_hour=Counter()
    acc=Counter(); total=0; seen=set()
    for path in sorted(glob.glob("/var/log/auth.log*")):
        try: f=openf(path)
        except OSError: continue
        with f:
            for line in f:
                m=re_ts.match(line); day=hour=None
                if m: day=f"{m.group(1)}-{m.group(2)}-{m.group(3)}"; hour=int(m.group(4))
                u=ip=None
                for r in (re_inv,re_au,re_fp):
                    mm=r.search(line)
                    if mm: u,ip=mm.group(1),mm.group(2); break
                if u and ip:
                    total+=1; ip_ct[ip]+=1; user_ct[u[:24]]+=1; seen.add(ip)
                    if day: per_day[day]+=1
                    if hour is not None: per_hour[hour]+=1
                    continue
                ma=re_acc.search(line)
                if ma: acc[ma.group(1)]+=1
    # fail2ban
    ban_day=Counter(); ban_ip=Counter(); bans=0
    re_ban=re.compile(r"^(\d{4})-(\d{2})-(\d{2}) .* \[sshd\] Ban "+IP)
    for path in sorted(glob.glob("/var/log/fail2ban.log*")):
        try: f=openf(path)
        except OSError: continue
        with f:
            for line in f:
                mb=re_ban.search(line)
                if mb: bans+=1; ban_day[f"{mb.group(1)}-{mb.group(2)}-{mb.group(3)}"]+=1; ban_ip[mb.group(4)]+=1
    days=sorted(set(per_day)|set(ban_day))
    return {"totals":{"attempts":total,"unique_ips":len(seen),"unique_users":len(user_ct),
            "bans":bans,"accepted":sum(acc.values()),
            "day_first":days[0] if days else None,"day_last":days[-1] if days else None},
        "top_ips":ip_ct.most_common(15),"top_users":user_ct.most_common(15),
        "top_banned_ips":ban_ip.most_common(15),
        "per_day_attempts":[[d,per_day.get(d,0)] for d in days],
        "per_day_bans":[[d,ban_day.get(d,0)] for d in days],
        "per_hour":[[h,per_hour.get(h,0)] for h in range(24)]}, ip_ct

# ---------------------------------------------------------------- web (nginx)
def parse_web():
    strict=re.compile(r'^(\S+) \S+ \S+ \[([^\]]+)\] "([A-Z]+) (\S+) (HTTP/[0-9.]+)" (\d{3}) (\S+) "([^"]*)" "([^"]*)"')
    loose=re.compile(r'^(\S+) \S+ \S+ \[([^\]]+)\] ".*?" (\d{3}) ')
    bot=re.compile(r"bot|spider|crawl|curl|wget|python|go-http|scan|nmap|masscan|zgrab|nikto|httpx|libwww|okhttp|semrush|ahrefs|censys|facebookexternal|bytespider",re.I)
    brow=re.compile(r"Mozilla.*(Chrome|Safari|Firefox|Edg|OPR|Gecko)",re.I)
    per_day=Counter(); per_hour=Counter(); status_ct=Counter(); status_class=Counter()
    paths=Counter(); p404=Counter(); ips=Counter(); methods=Counter(); uas=Counter()
    httpver=Counter(); kind=Counter(); total=0; owner_hits=0; malformed=0; seen=set()
    def daypart(t):
        try:
            d,mon,rest=t.split("/"); yr=rest.split(":")[0]; hh=rest.split(":")[1]
            return f"{yr}-{MON[mon]:02d}-{int(d):02d}",int(hh)
        except Exception: return None,None
    for path in sorted(glob.glob("/var/log/nginx/access.log*")):
        try: f=openf(path)
        except OSError: continue
        with f:
            for line in f:
                m=strict.match(line)
                if m:
                    ip,t,meth,url,ver,st,_by,_ref,ua=m.groups(); st=int(st)
                    p=url.split("?",1)[0][:60]; methods[meth]+=1; httpver[ver]+=1; paths[p]+=1
                    if st==404: p404[p]+=1
                    if ua in("-",""): kind["unknown"]+=1
                    elif bot.search(ua): kind["bot"]+=1
                    elif brow.search(ua): kind["human"]+=1
                    else: kind["other"]+=1
                    short=re.sub(r"\s+"," ",re.sub(r"\(.*?\)","",ua)).strip()[:40] or "-"; uas[short]+=1
                else:
                    m=loose.match(line)
                    if not m: malformed+=1; continue
                    ip,t,st=m.group(1),m.group(2),int(m.group(3)); malformed+=1
                total+=1; seen.add(ip)
                if OWNER and ip==OWNER: owner_hits+=1
                ips[ip]+=1; status_ct[st]+=1
                status_class["404" if st==404 else f"{st//100}xx"]+=1
                day,hr=daypart(t)
                if day: per_day[day]+=1
                if hr is not None: per_hour[hr]+=1
    days=sorted(per_day)
    return {"totals":{"requests":total,"unique_ips":len(seen),"owner_hits":owner_hits,
            "malformed":malformed,"day_first":days[0] if days else None,"day_last":days[-1] if days else None,
            "pct_4xx":round(100*(status_class.get("4xx",0)+status_class.get("404",0))/max(1,total),1),
            "pct_bot":round(100*kind.get("bot",0)/max(1,total),1)},
        "owner_ip":OWNER or None,
        "per_day":[[d,per_day[d]] for d in days],"per_hour":[[h,per_hour.get(h,0)] for h in range(24)],
        "status_class":sorted(status_class.items(),key=lambda x:-x[1]),"top_status":status_ct.most_common(8),
        "top_paths":paths.most_common(15),"top_404":p404.most_common(15),"top_ips":ips.most_common(15),
        "methods":methods.most_common(8),"kind":kind.most_common(),"top_uas":uas.most_common(12),
        "httpver":httpver.most_common()}, ips

# ---------------------------------------------------------------- geo (cached)
def public(ip):
    if OWNER and ip==OWNER: return False
    try:
        a=ipaddress.ip_address(ip); return a.is_global and not a.is_private
    except ValueError: return False

def geolocate(ssh_ips, web_ips):
    vol={}
    for ip,c in ssh_ips.items():
        if public(ip): vol.setdefault(ip,[0,0]); vol[ip][0]+=c
    for ip,c in web_ips.items():
        if public(ip): vol.setdefault(ip,[0,0]); vol[ip][1]+=c
    rows=sorted(((ip,s,w,s+w) for ip,(s,w) in vol.items()), key=lambda r:-r[3])
    top=rows[:TOPN]
    all_total=sum(r[3] for r in rows); top_total=sum(r[3] for r in top)
    try: cache=json.loads(GEO_CACHE.read_text())
    except (OSError,ValueError): cache={}
    need=[ip for ip,_,_,_ in top if ip not in cache]
    fields="status,country,countryCode,city,lat,lon,isp,as,query"
    for i in range(0,len(need),100):
        batch=need[i:i+100]
        try:
            req=urllib.request.Request("http://ip-api.com/batch?fields="+fields,
                data=json.dumps(batch).encode(),headers={"Content-Type":"application/json"})
            with urllib.request.urlopen(req,timeout=40) as r:
                for o in json.loads(r.read()):
                    if o.get("status")=="success":
                        cache[o["query"]]={"cc":o.get("countryCode"),"country":o.get("country"),
                            "city":o.get("city"),"lat":o.get("lat"),"lon":o.get("lon"),
                            "isp":o.get("isp"),"as":o.get("as")}
        except Exception as e:
            print("geo batch err:",e)
        time.sleep(1.6)
    _atomic(GEO_CACHE, json.dumps(cache))
    geo=[]; country=Counter(); cc_map={}; asn=Counter()
    for ip,s,w,t in top:
        g=cache.get(ip)
        if not g: continue
        c=g.get("country") or "?"
        geo.append({"ip":ip,"cc":g.get("cc"),"country":c,"city":g.get("city"),"lat":g.get("lat"),
                    "lon":g.get("lon"),"isp":g.get("isp"),"as":g.get("as"),"ssh":s,"web":w,"total":t})
        country[c]+=t; cc_map[c]=g.get("cc"); asn[g.get("as") or "?"]+=t
    geo.sort(key=lambda x:-x["total"])
    return {"geo":geo,"country":country.most_common(16),"cc_map":cc_map,"asn":asn.most_common(15),
            "meta":{"geolocated":len(geo),"coverage_pct":round(100*top_total/max(1,all_total),1),
                    "all_total":all_total,"unique_public":len(rows)}}

def _atomic(path, text):
    path=Path(path); path.parent.mkdir(parents=True, exist_ok=True)
    fd,tmp=tempfile.mkstemp(dir=str(path.parent), suffix=".tmp")
    with os.fdopen(fd,"w") as f: f.write(text)
    os.replace(tmp, path)

def main():
    ssh, ssh_ips = parse_ssh()
    web, web_ips = parse_web()
    try: geo = geolocate(ssh_ips, web_ips)
    except Exception as e:
        print("geo failed:", e); geo = {"geo":[],"country":[],"cc_map":{},"asn":[],"meta":{"geolocated":0,"coverage_pct":0,"all_total":0,"unique_public":0}}
    out={"generated": datetime.now().astimezone().isoformat(timespec="seconds"),
         "ssh": ssh, "web": web, "geo": geo}
    _atomic(OUT, json.dumps(out))
    print(f"wrote {OUT}: ssh={ssh['totals']['attempts']} web={web['totals']['requests']} geo={geo['meta']['geolocated']}")

if __name__ == "__main__":
    main()
