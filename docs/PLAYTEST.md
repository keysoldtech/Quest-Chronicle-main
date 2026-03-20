# Playtest checklist (v4.2.8)

Use this for a quick smoke pass before sharing a build.

**Before manual QA:** run `npm test` (Node 18+).

**Optional (debugging):** in the browser console, `localStorage.setItem('qc_debug','1')` then refresh to log notifications, modals, voice (WebRTC), socket lifecycle, grid, and load-game details. Remove with `localStorage.removeItem('qc_debug')`.

## Online (multiplayer)

- [ ] Connect two browsers (or incognito + normal), same room.
- [ ] Class selection → grid appears, turn order advances.
- [ ] Dice modal: roll resolves without `NaN`; modal dismisses cleanly.
- [ ] Move on grid: only valid cells highlight; mobile grid button works when phase is `started`.
- [ ] Dungeon **event** (NPC): choices apply; **trade** opens shop; buy deducts gold; **rescue** / **investigate** paths behave without console errors.
- [ ] Blocking modals (e.g. class pick) block “your turn” gating; non-blocking overlays (e.g. combat grid) do not wedge the UI.

## Offline solo

- [ ] Start offline solo → pick class → combat/grid usable.
- [ ] **Choose path → Event**: NPC modal appears; **Trade** → shop opens; purchase works; close shop resumes.
- [ ] **Help** on rescue → potion in hand, gold/hope update in UI.
- [ ] **Investigate** on stranger → HP drops (min 1), gold increases.

## Regression spot-checks

- [ ] End turn / turn banner after long modal sessions (no infinite “waiting”).
- [ ] Grid sprites: broken images fall back to emoji where implemented.
