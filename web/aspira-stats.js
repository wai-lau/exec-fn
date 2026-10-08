// /aspira - the tower card's STAT ROWS (split from aspira-ui.js at its 500-line cap,
// 2026-10-08): each kind's own rows (SPEC) and one "now -> next" row (statRow), its
// change painted red when it is for the worse. UI only; loaded before aspira-ui.js and
// called at run time (aspira-sliders.js cardStats, aspira-chooser.js).

// SOL's form, in one short line for the popup (the same row at every level, so
// the next-level preview lines up)
function rayForm(st) {
  if (st.critScale) return "crit chance ×" + st.critScale;
  if (st.ricochet) return "chains to " + st.ricochet;
  if (st.smash) return "kill bursts " + Math.round(st.smash.frac * 100) + "% r" + st.smash.r;
  if (st.beams > 2) return st.beams + " beams";
  return "—";
}
// The popup's RIGHT column (owner): stats only that tower type has, as
// [label, value] rows, computed for a level so the next one can be previewed.
const SPEC = {
  arc: st => {
    const tree = [1]; for (let l = 1; l <= st.layers; l++) tree.push(st.branch ** l);
    return [["Hits", tree.join("→")], ["Arc dmg", Math.round(st.dmg * st.arcFall)],
      ["Charge", st.charge ? Math.round(st.charge.frac * 100) + "% of hit · arcs " + (st.charge.arcs === 1 ? "once" : st.charge.arcs === 2 ? "twice" : st.charge.arcs + "×") : "—"],
      // a chart ARC: no reach from the tower - EACH JUMP its own, shrinking (owner)
      ...(st.skill ? [["Jumps", st.layers + (st.layers > 1 ? " jumps" : " jump") + " · first " + Math.round(st.arcRange)]] // (the first jump's reach LAST: it only rises, the card reads the last number)
        : [["Arc hop", Math.round(st.arcRange)], ["Reach", Math.round(chainReach(st))]]),
      ["Delay", hopDelay(st).toFixed(2) + "s"]];
  },
  frz: st => st.skill ? [["Aura slow", Math.round(st.aura * 100) + "%"], ["Aura dmg", (st.dmg * st.rate).toFixed(1) + "/s"],
    ["Rime", st.rime ? "every " + st.rimeEvery + "s, +" + Math.round(st.rime * 100) + "% forever" : "—"], ["Moons", st.moonN ? st.moonN + " at " + Math.round(st.moonK * 100) + "%" : "—"]]
    : [["Slow", Math.round(st.slow * 100) + "%"], ["Lasts", st.permafrost ? "forever" : SLOW_TIME.toFixed(1) + "s"],
    ["Targets", st.all ? "all" : st.targets], ["Shields", "−1 / pulse"],
    ["Shatter", st.shatter ? Math.round(st.dmg * st.shatter.mul) + " r" + st.shatter.r : "—"],
    ["Extra", st.frostbite ? "blast slows " + st.frostbite + "s" : st.brittle ? "+" + Math.round((st.brittle - 1) * 100) + "% taken"
      : st.chillStop ? "95% for " + st.chillStop + "s" : "—"]],
  // acidic terms, never heat (owner, 2026-10-07): the acid CORRODES, BUILDS on its target, PEAKS
  acd: st => [["Corrode", Math.round(st.dmg) + "/s"], ["Builds", "×2 / " + st.double + "s"],
    ["Peak", "×" + st.cap + " (" + Math.round(st.dmg * st.cap) + "/s)"], ["Jets", st.allInRange ? "all in range" : st.targets],
    ["Circle", st.plagueR ? Math.round(st.plagueR) + (st.bloom ? "→" + Math.round(st.plagueR * st.bloom) : "") : "—"],
    ["Armor", st.corrode ? "−" + st.corrode + " / tick" : "—"], ["Shields", "−1 / tick"],
    // puddles one number a row (owner, 2026-10-07: "1 / 1.4s · 1.5s · r20" was unreadable), so each
    // reads now -> next on its own and its colour judges that one number
    // always the same rows ("—" with no puddles), so a pull from Contagion 0 lines up now -> next
    ["Pool burn", st.contagion ? Math.round(st.contagionHeat * 100) + "% of jet" : "—"], ["Drips every", st.contagion ? st.contagion.every + "s" : "—"],
    ["Pool size", st.contagion ? st.contagion.r : "—"], ["Pool lasts", st.contagion ? st.contagion.life + "s" : "—"], ["Pool slow", st.contagionSlow ? Math.round(st.contagionSlow * 100) + "%" : "—"]],
  sol: st => [["Crit", Math.round(st.crit * 100) + "%"], ["Crit ×", st.critMul], ["Locks", st.targets],
    ["Beams", st.beams || 1], ...(st.skill ? [["Refract", st.refraction ? "+" + st.refraction + " in a " + (st.cone || SOL_CONE) * 2 + "° cone" : "—"]] : []),
    // short enough for the card's right column (owner, 2026-10-07: "1 × (−1.5 armor, +1% crit) / hit" ran off it)
    [st.skill ? "Breach" : "Bleed", st.bleedArmor ? "−" + st.bleedArmor + " armor" + (st.bleedCrit ? ", +" + Math.round(st.bleedCrit * 100) + "% crit" : "") + (st.breach > 1 ? " ×" + st.breach : "") + "/hit" : "—"],
    ["Form", rayForm(st)]],
};

// One stat row: "now" alone at max level, "now -> next" when an upgrade
// would change it, so the payoff of the upgrade is visible before buying it.
// A change for the WORSE shows red and bold (owner): compared on the last
// number in each value, lower-is-better for the rows in LOWER_BETTER, and a
// number giving way to "—" (a stat the upgrade removes) counts as worse.
const LOWER_BETTER = new Set(["Delay", "Builds", "Drips every"]); // (Drips every: a shorter wait is better)
function lastNum(v) { const m = String(v).match(/\d+(\.\d+)?/g); return m ? Number(m[m.length - 1]) : NaN; }
function worse(label, now, next) {
  const a = lastNum(now), b = lastNum(next);
  if (isNaN(b)) return !isNaN(a) && String(next) === "—";
  return !isNaN(a) && (LOWER_BETTER.has(label) ? b > a : b < a);
}
function statRow(label, now, next) {
  const cls = next !== null && worse(label, now, next) ? "asp-next asp-worse" : "asp-next";
  const arrow = next !== null && next !== now ? ' <span class="' + cls + '">→ ' + next + "</span>" : "";
  return "<dt>" + label + "</dt><dd>" + now + arrow + "</dd>";
}
