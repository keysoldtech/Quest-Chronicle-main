# Playtest checklist (v4.3.11)

Use this for a quick smoke pass before sharing a build.

**Before manual QA:** run `npm test` (Node 18+).

**Optional (debugging):** in the browser console, `localStorage.setItem('qc_debug','1')` then refresh to log notifications, modals, voice (WebRTC), socket lifecycle, grid, and load-game details. Remove with `localStorage.removeItem('qc_debug')`.

**PWA / mobile install:** open the deployed site in mobile Chrome or Safari → “Add to Home Screen” → launch from icon (standalone). Confirm no double browser chrome; safe-area on notched devices looks acceptable.

## Online (multiplayer)

- [ ] Connect two browsers (or incognito + normal), same room.
- [ ] **Reconnect:** start a run, toggle airplane mode briefly (or kill tab and reopen same origin) → session should **rejoin** without duplicate room spam; toasts not duplicated every second.
- [ ] Class selection → grid appears, turn order advances.
- [ ] **Turn + toasts:** after combat log toasts queue up, when your turn begins **every** queued toast runs **before** the **Your Turn** banner and action bar unlock; nothing is skipped.
- [ ] Dice modal: roll resolves without `NaN`; modal dismisses cleanly.
- [ ] Move on grid: only valid cells highlight; mobile grid button works when phase is `started`.
- [ ] Dungeon **event** (NPC): choices apply; **trade** opens shop; buy deducts gold; **Finish Shopping** clears pause for everyone (no stuck “Shopping…” / not-your-turn). **rescue** / **investigate** paths behave without console errors.
- [ ] **Path shop after End Turn (MP):** end your turn → path choice → pick **shop** → finish shopping → next turn should **not** be yours again immediately (turn should advance to the next explorer / DM slot in order).
- [ ] Blocking modals (e.g. class pick) block “your turn” gating; non-blocking overlays (e.g. combat grid) do not wedge the UI.

## Offline solo

- [ ] Start offline solo → pick class → combat/grid usable.
- [ ] **Choose path → Event**: NPC modal appears; **Trade** → shop opens; purchase works; close shop resumes.
- [ ] **Help** on rescue → potion in hand, gold/hope update in UI.
- [ ] **Investigate** on stranger → HP drops (min 1), gold increases.

## Regression spot-checks

- [ ] End turn / turn banner after long modal sessions (no infinite “waiting”).
- [ ] Grid sprites: broken images fall back to emoji where implemented.

## Layout (v4.3.11)

- [ ] **Full window:** On the game screen, the **page** does not scroll (only panels: board, hand, side columns, log).
- [ ] **Resize:** Shrink window height below ~720px at desktop width → **bottom tab bar** appears (mobile-style); widen/tall again → 3-column desktop returns.

## Card / combat (v4.3.10)

- [ ] **Wyrmscale Mail:** equip → log mentions Fire default; open **View avatar** (self) on your turn → **Wyrmscale immunity** dropdown changes element; incoming spell of that type should deal **0** to HP (after shield).
- [ ] **Spellward / Sylvan:** cast a single-target **fire/cold/lightning/acid** damage spell on a geared ally — half damage on failed save uses DEX; WIS half uses **Spellward +1**; **Sylvan** can roll DEX with advantage for those saves.
- [ ] **Lich Apprentice:** on a melee hit, combat log shows a **random level 1** spell name and extra damage/status may apply.
- [ ] **Life Transfer** (level 3 Cleric): caster takes **4d8 necrotic** (Spiritweave halves if equipped), target heals **2×** that roll.
