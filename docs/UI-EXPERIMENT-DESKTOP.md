# Experimental desktop UI (`cursor/ui-desktop-layout-tabs`)

**Adds (v4.2.8):** a **View** toolbar on the desktop game screen:

| Mode | What you see |
|------|----------------|
| **Full** | Default three-column layout (party · board · log/loot). |
| **Table** | Center column only — wider board and hand; party and log panels hidden. |
| **Party & log** | Party list + Game log / Party discoveries; board and action bar hidden (for reading/planning). |

The choice is saved in `localStorage` under key `qc_desktop_layout` (`full` | `battle` | `party`).

**Compare with:** branch `cursor/playtest-readiness-evaluation-0e37` @ **v4.2.7** — same viewport/sticky action-bar fixes, **without** this toolbar.
