# Experimental layout branch (`cursor/ui-desktop-layout-tabs`)

**Version:** v4.4.4 (includes playtest **v4.3.4** [`AUTHORITY-AND-EVENTS.md`](./AUTHORITY-AND-EVENTS.md) + **v4.3.1** layout revert + v4.3.0 reconnect/PWA/mobile polish).

## Desktop

Toolbar **View**: **Full** (default 3-column) · **Table** (center column only) · **Party & log** (party + journal; board hidden).

Preference: `localStorage` key `qc_desktop_layout` (`full` | `battle` | `party`).

## Mobile

Class `mobile-tab-layout` on `.game-area-mobile` enables:

- **Top tab strip:** Play · Hero · Party · **Journal** (replaces the old 5-icon bottom bar on this branch).
- **Journal** merges **World events**, **Party discoveries**, and **Chat & log** into one scrollable screen so nothing is removed from the game—only the navigation is simplified.

Preference: `localStorage` key `qc_mobile_tab` (`game` | `character` | `party` | `journal`).

## Compare

- **Layout-only + reconnect/PWA (no tab experiments):** `cursor/playtest-readiness-evaluation-0e37` @ **v4.3.0**
- **This branch:** v4.4.0 — desktop + mobile tab experiments above
