"""A pixel mask to closed loops: marching squares on the pixel grid.

Split out of trace-icons.py for the 500-line cap. Every ink pixel side facing
a non-ink neighbour is a unit boundary edge, and the edges chain head to tail
into closed loops. Coordinates stay integers -- one source pixel is one unit
-- because the output is meant to be pixel art, staircases and all."""
from collections import defaultdict

MIN_AREA = 1.0    # px^2; smaller loops are dither speckle, not linework

def outward_edges(mask):
    """{vertex: [vertex]} -- one directed unit edge per ink pixel side whose
    neighbour is not ink, wound so the ink stays on a consistent hand."""
    edges = defaultdict(list)
    for (x, y) in mask:
        if (x, y - 1) not in mask:
            edges[(x, y)].append((x + 1, y))
        if (x + 1, y) not in mask:
            edges[(x + 1, y)].append((x + 1, y + 1))
        if (x, y + 1) not in mask:
            edges[(x + 1, y + 1)].append((x, y + 1))
        if (x - 1, y) not in mask:
            edges[(x, y + 1)].append((x, y))
    return edges


def _step_from(edges, cur, nxt):
    """The next vertex after `nxt`, consuming the edge taken."""
    outs = edges.get(nxt)
    if not outs:
        return None                  # open chain; drop it rather than guess
    if len(outs) == 1:
        return outs.pop(0)
    # A vertex where two diagonally-touching regions meet. Take the sharpest
    # clockwise turn, which keeps the two regions separate instead of welding
    # them into one.
    dx, dy = nxt[0] - cur[0], nxt[1] - cur[1]

    def turn(p):
        ex, ey = p[0] - nxt[0], p[1] - nxt[1]
        return (dx * ey - dy * ex, dx * ex + dy * ey)

    step = min(outs, key=turn)
    outs.remove(step)
    return step


def boundary_loops(mask):
    """Marching squares: chain the outward unit edges into closed loops."""
    edges = outward_edges(mask)
    loops = []
    for start in list(edges):
        while edges.get(start):
            loop = [start]
            cur, nxt = start, edges[start].pop(0)
            while nxt != start:
                loop.append(nxt)
                step = _step_from(edges, cur, nxt)
                if step is None:
                    break
                cur, nxt = nxt, step
            if len(loop) >= 4 and abs(shoelace(loop)) >= MIN_AREA:
                loops.append(loop)
    return loops


def shoelace(loop):
    """Twice the signed area, halved -- used only to size a loop."""
    total = 0.0
    for i, (ax, ay) in enumerate(loop):
        bx, by = loop[(i + 1) % len(loop)]
        total += ax * by - bx * ay
    return total / 2.0


def drop_collinear(loop):
    out = []
    n = len(loop)
    for i in range(n):
        ax, ay = loop[i - 1]
        bx, by = loop[i]
        cx, cy = loop[(i + 1) % n]
        if (bx - ax) * (cy - by) != (by - ay) * (cx - bx):
            out.append((bx, by))
    return out or loop
