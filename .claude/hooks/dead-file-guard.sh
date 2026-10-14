#!/usr/bin/env bash
# PreToolUse(Edit|Write) guard: refuse to edit files nothing renders.
#
# Nightfall's 2D `components/Netmap.tsx` is orphan code — App.tsx does
# `import Netmap from "./Netmap3D"`, so every netmap change belongs under
# components/netmap3d/ or Netmap3D.tsx (memory: feedback_nightfall_netmap3d_only).
# Editing the 2D file looks like progress and ships nothing.
#
# Fail-open: any error exits 0. Never block on a hook bug.
set -u

payload="$(cat)"
path="$(printf '%s' "$payload" | jq -r '.tool_input.file_path // empty' 2>/dev/null)"
[ -n "$path" ] || exit 0

case "$path" in
  */nightfall-src/components/Netmap.tsx) ;;
  *) exit 0 ;;
esac

reason="components/Netmap.tsx is DEAD CODE — nightfall renders Netmap3D exclusively (App.tsx aliases 'import Netmap from \"./Netmap3D\"'). An edit here ships nothing. Node rendering (pulse, colour, overlay, hostile flag, edge styling) lives in components/netmap3d/NetmapNode.tsx, NetmapEdges.tsx, NetmapFloor.tsx, or components/Netmap3D.tsx — three.js material/mesh code, not 2D CSS classes."

jq -n --arg r "$reason" \
  '{hookSpecificOutput:{hookEventName:"PreToolUse",permissionDecision:"deny",permissionDecisionReason:$r}}'
exit 0
