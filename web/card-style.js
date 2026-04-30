/* Shared card color logic — used by kanban, prophecies, directives */
const CAT_HUE   = {Book:193, Self:193, Social:130, Interfacing:36, Hobby:8};
const CAT_LIGHT = {Book:0, Self:0, Social:0, Interfacing:0, Hobby:0};
const CAT_SAT   = {Social:-20, Interfacing:+35, Self:+35, Hobby:+10, Book:+30};

function cardStyle(c) {
  const h = CAT_HUE[c.category];
  if (h === undefined) return {bg:'', border:'', dark:false};
  const dl = CAT_LIGHT[c.category] || 0;
  const ds = CAT_SAT[c.category]   || 0;
  const col         = `hsl(${h},${75+ds}%,${68+dl}%)`;
  const borderMid   = `hsl(${h},${65+ds}%,${60+dl}%)`;
  const borderBright = `hsl(${h},${90+ds}%,${78+dl}%)`;
  if (c.size === 'chore') {
    return {bg:`background:hsla(${h},${75+ds}%,${68+dl}%,0.15);color:${col};`, border:'border-color:transparent;', dark:true};
  } else if (c.size === 'task') {
    return {bg:`background:hsla(${h},${75+ds}%,${68+dl}%,0.25);color:${col};`, border:`border-color:${borderMid};`, dark:true};
  } else if (c.size === 'book') {
    return {bg:`background:hsl(0,0%,10%);color:${col};`, border:`border-color:${borderMid};`, dark:true};
  } else if (c.size === 'project') {
    return {bg:`background:hsl(${h},${50+ds}%,${54+dl}%);`, border:'border-color:transparent;', dark:false};
  } else {
    return {bg:`background:hsl(${h},${55+ds}%,${62+dl}%);`, border:`border-color:${borderBright};`, dark:false};
  }
}
