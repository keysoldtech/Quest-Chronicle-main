# Authority, pause, and socket events

Internal reference for **Quest & Chronicle** online play: what the server owns, when the game is “paused,” which client events can fire out of turn, and ordering guarantees that prevent UI desync.

For manual QA, see [`PLAYTEST.md`](./PLAYTEST.md).

---

## 1. Single source of truth

| Layer | Role |
|-------|------|
| **`server.js` → `GameManager`** | Authoritative game rules, combat, loot, turns, shops, dungeon events. Mutates `room` / `room.gameState` / `room.players`. |
| **`emitGameState(roomId)`** | The **only** broadcast of full room snapshot. Emits **`gameStateUpdate`** to everyone in the room (includes `staticData` for classes). |
| **`public/client.js`** | Treats **`gameStateUpdate`** as truth: assigns `currentRoomState` and drives UI. **Do not** assume combat/turn/gold state from older socket events alone. **Turn UX:** `turnPopupReady` (action bar / click gating) only becomes true after the **Your Turn** overlay has been shown for the current turn session, **after** the toast queue has drained (no skipping queued combat toasts). **Toasts:** most combat/action lines stay in the **chat log** only; only a few high-signal types toast for *other* players (e.g. `dm`, `system-good`). |
| **Card specials** | Many weapon/armor lines are implemented in **`server.js`** (`_applyWeaponDamageModifiers`, `_applyDamage`, `resolveAttackRoll`, `resolveDodge`, `resolveRetreat`, `_resolveDiceSequence`, `resolveAOESpell`, `resolveCastSpell`, `resolveSkillCheckRoll`, `resolveMove`). Spell cards use optional **`effect.damageType`** for resistances. **Wyrmscale Mail:** `player.wyrmscaleImmunityType` + `playerAction` **`setWyrmscaleImmunity`** (your turn only). **Lich Apprentice:** `_lichRandomSpellOnHit` on successful melee hit. |
| **`public/offline-*.js`** | Mirrors server behavior for solo offline; not authoritative online. |

---

## 2. What “paused” means (`room.gameState.isPaused`)

When **`isPaused`** is true, **`moveToNextTurn`** does not advance the turn (interrupt-safe). Typical **`pauseReason`** values:

| Reason (examples) | Set by | Cleared by |
|-------------------|--------|------------|
| `Shopping...` | `openShop` (multiplayer) | `markPlayerShopFinished` when **all** human players finish (`closeShop` / legacy `playerShopComplete`) |
| `` `Player is in ${modalType} modal` `` | `pauseGameForModal` (client) | `resumeGameFromModal` **only** when `pauseReason` **exactly equals** that string (not substring match — `"Shopping..."` must not be cleared by `modalType === 'shop'`) |
| Level-up / specialization copy | Level/specialization flows | `resolveLevelUpChoice` / `resolveSpecializationChoice` when unpaused |

**Client:** `NotificationManager.pauseGameForModal` / `resumeGameFromModal` mirror UI gating; they must stay consistent with server rules above.

---

## 3. Turn gate vs out-of-turn actions

**Default:** `resolvePlayerAction` requires the caller to be **`turnOrder[currentPlayerIndex]`** (and handles `pendingAction` for roll flows).

**Bypasses** (intentional — see `resolvePlayerAction` early returns):

| `payload.action` | Condition |
|------------------|-----------|
| `resolveLevelUpChoice` | Always allowed when sent (level-up interrupt). |
| `selectSpecialization` | Allowed with branch/tier (specialization interrupt). |
| `resolveEvent` | Requires `player.pendingDungeonEvent` (NPC encounter). |
| `buyItem` | Allowed while `room.gameState.shop` is active (shop is a global pause, not “your combat turn”). |

Everything else in the main `switch` is subject to the turn check.

---

## 4. Inbound socket API (client → server)

| Event | Purpose |
|-------|---------|
| `createRoom` / `joinRoom` / `rejoinRoom` | Lobby and reconnect. |
| `startGame` / `chooseClass` | Setup / run start. |
| `equipItem` | `{ cardId }` — **your turn**, weapon/armor **in hand**, 1 AP; previous slot returns to hand. |
| `endTurn` | Ends explorer turn (`beginEndOfTurnPhase`). |
| `playerAction` | **Main action pipe** — attacks, spells, grid, skill checks, path choices wrapped as actions, etc. (`resolvePlayerAction`). |
| `pauseGameForModal` / `resumeGameFromModal` | UI coordination; see §2 for resume matching. |
| `closeShop` | Player done shopping; drives `markPlayerShopFinished`. |
| `playerShopComplete` | Legacy alias; same finish logic as `closeShop`. |
| `chooseNextRoom` | Path picker confirms next room. **Shop from path:** sets `gameState.pendingTurnAfterPathShop`; when MP shop closes (`markPlayerShopFinished` all done), server calls `moveToNextTurn` once — path choice happens *after* `endTurn` without having advanced the turn pointer yet. |
| `playerAction` → `setWyrmscaleImmunity` | `{ element: 'fire'|'cold'|'lightning'|'acid'|'thunder' }` — only on **your turn**, only while **Wyrmscale Mail** is equipped. |
| `chatMessage` | Chat. |
| Voice helpers | `join-voice-chat`, `leave-voice-chat`, `webrtc-signal`. |

---

## 5. Outbound events (server → client)

| Event | Typical use |
|-------|----------------|
| **`gameStateUpdate`** | Full room state after **almost every** meaningful change. **Clients should refresh UI from this.** |
| **`turnStarted`** | `{ playerId }` — **after** state is emitted in `startNewTurn` so the board matches the banner. |
| **`actionError`** | String message (e.g. not your turn). |
| **`playerIdentity`** | Persists `playerId` + `roomId` for `rejoinRoom`. |
| **`shopOpened`** | Per-player when shop opens (inventory, flags). |
| **`levelUpPrompt`**, **`specializationPrompt`** | Interrupt flows. |
| **`promptSkillCheckRoll`**, **`promptAttackRoll`**, combat follow-ups | Targeted prompts. |
| **`dungeonEvent`**, **`synergyTriggered`**, etc. | Event / feedback. |
| **`gameOver`** | Run end. |

Ordering rule worth preserving: **`emitGameState` before `turnStarted`** where both fire, so “YOUR TURN” never shows stale board/hand.

---

## 6. Design rules for new features

1. **Mutate server state first**, then **`emitGameState`**, then any **extra** event (`turnStarted`, prompts).  
2. **New “interrupt” flows** should either set **`isPaused`** with a clear **`pauseReason`**, or use an existing bypass pattern — don’t leave **`isPaused`** true without a defined clear path.  
3. **New `playerAction` types:** decide up front: **turn-gated** vs **bypass** (shop / encounter / level-up pattern). Document here when added.  
4. **Client:** derive “can I act?” from **`currentRoomState`** (`isPaused`, `turnOrder`, `currentPlayerIndex`, modals) — not only from **`turnStarted`**.  
5. **Offline:** update **`offline-actions.js` / `offline-game-engine.js`** when server rules change, or document intentional drift.

---

## 7. Further reading (external)

High-level patterns (systems thinking, data-driven rules, card AI) can complement this doc but do **not** replace server/client specifics above. See project discussion and links shared in chat (e.g. systems architecture, parametric rules, card AI layering).
