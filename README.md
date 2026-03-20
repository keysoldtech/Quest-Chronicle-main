# 🎮 Quest & Chronicle - Multiplayer Tactical Card Game

**Version:** v4.2.5  
**Status:** Play-Testing Ready ✅  
**Platform:** Web (PWA) - Works on all devices  
**Modes:** Online Multiplayer + Offline Solo Play  

---

## 🎯 Quick Start

### Play Online (Easiest):
1. Visit: https://quest-chronicle.onrender.com
2. Enter your name
3. Create or join a game
4. Choose your class
5. Play!

### Play Offline:
1. Play online first
2. Save your game (Save & Quit)
3. Turn off internet
4. Load saved game
5. Continue playing solo!

---

## 🧪 Automated tests

Requires **Node.js 18+** (built-in test runner).

```bash
npm test
```

- **`lib/qc-dice.cjs`** — dice parsing and rolls (used by `server.js` and tests).
- **`tests/qc-dice.test.cjs`** — dice notation and deterministic RNG rolls.
- **`tests/offline-actions-contract.test.cjs`** — ensures offline event hooks stay wired in `public/offline-actions.js` / `public/client.js`.

Manual playtest checklist: [`docs/PLAYTEST.md`](docs/PLAYTEST.md).

---

## 🎮 Game Features

### Core Gameplay:
- **Turn-based tactical combat** on a 5x5 grid
- **6 character classes:** Barbarian, Warrior, Ranger, Rogue, Mage, Cleric
- **3 game modes:** Beginner (simple), Advanced (tactical), Custom (your way)
- **XP progression:** Level 1 at 25 XP, scales by 1.5x each level
- **Monster scaling:** Every 5 player levels (Elite at 5, Dread at 10)
- **Infinite runs:** Survive as long as you can!

### Combat System:
- **Weapon ranges** (Advanced mode): Melee (1 cell), Reach (2), Ranged (2+), Magic (unlimited)
- **Grid positioning:** Flanking bonuses (+2 attack when you surround enemies)
- **Movement:** 2 points/turn (4 with Dash action)
- **Status effects:** Restrained blocks attacks/movement, others with timers
- **AOE spells:** Hit multiple enemies at once
- **Critical hits:** Screen flash + bonus damage

### Actions Available:
- **Attack:** Weapon attacks with d20 rolls
- **Cast Spell:** Damage, healing, or buff spells
- **Use Item:** Consumable potions and utility items
- **Guard:** Gain shield HP (1 AP)
- **Rest:** Heal 1d8+CON (2 AP)
- **Respite:** Heal 1d4 (1 AP)
- **Dash:** +2 movement this turn (1 AP)
- **Dodge:** +2 shield HP (1 AP)
- **Move:** Reposition on grid (uses movement points, not AP)
- **End Turn:** Finish your turn

### Progression:
- **XP from combat:** Defeat monsters to gain experience
- **Level up:** Choose stat to increase +1, get full heal
- **Loot system:** Random drops from defeated enemies
- **Specializations:** Unlock at levels 3, 5, 7 (unique abilities per class)
- **Account XP:** Permanent upgrades in Legend & Legacy screen

### UI Features:
- **Full guide** with search (purple book button)
- **Status indicators:** See active buffs/debuffs with timers
- **Confirmation popups:** Prevent accidental actions
- **Damage numbers:** Floating combat feedback
- **Animations:** Attack slashes, spell particles, level up effects
- **Sound effects:** 14 effects (optional audio files)
- **Mobile optimized:** Touch controls, responsive design

### Multiplayer:
- **Room codes:** Create and share 4-letter codes
- **Voice chat:** WebRTC built-in
- **Smart NPC AI:** Replaces disconnected players
- **Real-time sync:** Socket.IO powered

### Offline Mode:
- **Save to 3 slots:** Choose where to save
- **Load anytime:** Resume from any slot
- **True solo play:** All actions work without server
- **No internet needed:** Complete offline experience

---

## 💻 Running Locally

### Prerequisites:
- Node.js 16+ and npm
- Git

### Installation:
```bash
# Clone the repository
git clone https://github.com/keysoldtech/Quest-Chronicle.git
cd Quest-Chronicle

# Install dependencies
npm install

# Start the server
npm start
```

Server will run on `http://localhost:3000`

### Environment Variables (Optional):
```bash
PORT=3000  # Default port
NODE_ENV=production  # Or 'development'
```

---

## 🥧 Raspberry Pi Setup (Home Server)

### Requirements:
- Raspberry Pi 3B+ or newer
- Raspbian OS / Raspberry Pi OS
- Internet connection
- Router access for port forwarding

### Step 1: Install Node.js
```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Install Node.js (using NodeSource)
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt install -y nodejs

# Verify
node --version  # Should show v18.x
npm --version
```

### Step 2: Install the Game
```bash
# Install git
sudo apt install git -y

# Clone repository
cd /home/pi
git clone https://github.com/keysoldtech/Quest-Chronicle.git
cd Quest-Chronicle

# Install dependencies
npm install

# Test run
npm start
```

Game runs on `http://[pi-ip]:3000`

### Step 3: Set Up as System Service
```bash
# Create service file
sudo nano /etc/systemd/system/quest-chronicle.service
```

Paste this:
```ini
[Unit]
Description=Quest and Chronicle Game Server
After=network.target

[Service]
Type=simple
User=pi
WorkingDirectory=/home/pi/Quest-Chronicle
ExecStart=/usr/bin/npm start
Restart=on-failure
RestartSec=10
StandardOutput=syslog
StandardError=syslog
SyslogIdentifier=quest-chronicle

[Install]
WantedBy=multi-user.target
```

Enable and start:
```bash
sudo systemctl daemon-reload
sudo systemctl enable quest-chronicle
sudo systemctl start quest-chronicle
sudo systemctl status quest-chronicle
```

### Step 4: Access From Local Network
Find your Pi's IP:
```bash
hostname -I
```

Access from any device on your network:
```
http://192.168.1.XXX:3000
```

### Step 5: Make Publicly Accessible (Optional)

**Option A: Port Forwarding (Free)**
1. Log into your router (usually 192.168.1.1)
2. Find "Port Forwarding" or "NAT"
3. Forward external port 3000 to Pi's IP port 3000
4. Find your public IP: https://whatismyipaddress.com
5. Share: `http://YOUR-PUBLIC-IP:3000`

**Considerations:**
- Dynamic IP changes (consider dynamic DNS service like DuckDNS)
- Security: Consider adding authentication
- Bandwidth: Home upload speed limits concurrent players

**Option B: Cloudflare Tunnel (Recommended)**
```bash
# Install cloudflared
wget https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm64.deb
sudo dpkg -i cloudflared-linux-arm64.deb

# Authenticate
cloudflared tunnel login

# Create tunnel
cloudflared tunnel create quest-chronicle

# Configure tunnel
nano ~/.cloudflared/config.yml
```

Add:
```yaml
tunnel: [your-tunnel-id]
credentials-file: /home/pi/.cloudflared/[your-tunnel-id].json

ingress:
  - hostname: quest-chronicle.yourdomain.com
    service: http://localhost:3000
  - service: http_status:404
```

Run tunnel:
```bash
cloudflared tunnel run quest-chronicle
```

Benefits: Free, secure, no port forwarding, gets domain name

### Step 6: Auto-Start on Boot
Already done with systemd service above!

To check logs:
```bash
sudo journalctl -u quest-chronicle -f
```

To restart:
```bash
sudo systemctl restart quest-chronicle
```

### Raspberry Pi Performance Tips:
- Use Raspberry Pi 4 for best performance (4+ players)
- Pi 3B+ works great for 2-3 players
- Consider adding heatsink for long sessions
- Use ethernet instead of WiFi for stability

---

## 🎲 Game Mechanics Reference

### Character Stats:
- **STR (Strength):** Melee damage + physical checks
- **DEX (Dexterity):** Ranged damage + agility
- **CON (Constitution):** Max HP + endurance
- **INT (Intelligence):** Spell damage + knowledge (+5% XP per point!)
- **WIS (Wisdom):** Healing power + perception
- **CHA (Charisma):** Social interactions + morale

### Resources:
- **HP (Health Points):** Your life - reach 0 and you're downed
- **AP (Action Points):** Spend on actions (3-6 depending on class)
- **Movement Points:** Spend on grid movement (2/turn, separate from AP)
- **XP (Experience):** Gain from defeating monsters, level up when full

### Combat Mechanics:
- **Attack Roll:** d20 + hit bonus vs enemy AC
- **Damage Roll:** Weapon dice + damage bonus
- **Critical Hit:** Natural 20 = special effects
- **Flanking:** +2 attack when you and ally surround enemy
- **Shield HP:** Temporary HP that absorbs damage (lost at turn start)
- **Status Effects:** Buffs/debuffs with countdown timers

### Weapon Types (Advanced Mode):
- **Melee:** Adjacent only (1 cell) - Swords, axes, daggers
- **Reach:** Up to 2 cells - Spears, halberds
- **Ranged:** 2+ cells away (can't attack adjacent!) - Bows, crossbows
- **Magic:** Unlimited range - All spells

### Status Effects:
- **Restrained:** Cannot attack or move, -2 to attacks if bypassed
- **Blessed:** +2 to attack rolls
- **Poisoned:** Take damage each turn
- **Shielded:** Bonus shield HP
- **Dashing:** +2 movement this turn
- All show with countdown timers in player list

### Monster Scaling:
- **Levels 1-4:** Normal monsters
- **Levels 5-9:** Elite monsters (1.5x HP, +1 attack)
- **Levels 10-14:** Dread monsters (2.0x HP, +2 attack)
- **Levels 15-19:** (2.5x HP, +3 attack)
- **Levels 20+:** (3.0x HP, +4 attack)

### Loot System:
- **Drop Chance:** 30-80% depending on settings
- **Rarity Tiers:** Common, Uncommon, Rare, Legendary
- **Types:** Weapons, Armor, Consumables, Spells, Utility

### Grid Positioning:
- **5x5 grid:** Tactical battlefield
- **Front rows (0-2):** Where monsters spawn
- **Back rows (3-4):** Where players start
- **Movement cost:** 1 point per cell (Manhattan distance)
- **Flanking positions:** Adjacent to same enemy with ally

### Skill Checks:
- **Trapped Chests:** Multi-stage challenges (WIS then DEX)
- **Disarm Trap:** Careful approach
- **Smash It:** Brute force (STR check)
- **Lockpicks:** Grant advantage on DEX checks
- **Discovery Rolls:** Find hidden items

### NPC AI:
- **Smart behavior:** Uses spells, items, strategic targeting
- **Priority system:** Heal when low, buff when needed, attack smartly
- **No AP waste:** Uses all action points efficiently
- **Target selection:** Focuses on weakest enemies

---

## 🔧 Customization

### Custom Game Mode Options:
1. Start with weapon (yes/no)
2. Start with armor (yes/no)
3. Starting items (0-5)
4. Starting spells (0-5)
5. Enforce weapon ranges (yes/no)
6. Loot drop rate (0-100%)
7. Max hand size (5-12)
8. Discovery rolls (yes/no)

### Settings (In-Game):
- Master volume
- SFX volume
- Animation speed
- Show damage numbers
- Screen shake
- Synergy tracker

---

## 📁 Project Structure

```
Quest-Chronicle/
├── server.js                 # Main game server
├── game-data.js             # All game content (classes, items, monsters)
├── package.json             # Dependencies
├── public/
│   ├── index.html           # Main game page
│   ├── client.js            # Client-side game logic (4,700 lines)
│   ├── style.css            # All styling (5,700 lines)
│   ├── animations.css       # Battle animations
│   ├── character-viewer.css # Character sheet styles
│   ├── sound-manager.js     # Audio system
│   ├── offline-actions.js   # Offline game engine (370 lines)
│   ├── offline-game-engine.js # Offline utilities
│   ├── companion-system.js  # Pet system (feature branch)
│   ├── manifest.json        # PWA manifest
│   ├── sw.js                # Service worker (offline caching)
│   ├── icons/               # App icons (72px to 512px)
│   │   └── logo.png         # Main logo
│   ├── assets/              # Game assets (optional)
│   │   ├── sprites/         # Character/monster sprites
│   │   └── tiles/           # Grid tiles
│   └── sounds/              # Sound effects (optional)
└── docs/
    └── (cleaned)
```

---

## 🛠️ Development

### Running in Development Mode:
```bash
npm start
# or
node server.js
```

### Testing:
```bash
npm test
# Clear browser cache before manual QA; open dev console (F12)
# Verbose trace (optional): localStorage.setItem('qc_debug','1') then refresh — voice, socket, grid, load-game, etc.
```

### Deploying to Render.com:
1. Fork this repository
2. Create Render.com account
3. New Web Service → Connect GitHub repo
4. Build Command: `npm install`
5. Start Command: `node server.js`
6. Deploy!

---

## 🎨 Optional Enhancements

### Adding Sound Effects:
Place MP3 files in `public/sounds/`:
- attack.mp3, hit.mp3, miss.mp3
- spell-cast.mp3, heal.mp3
- level-up.mp3, monster-death.mp3
- button-click.mp3, card-play.mp3
- critical.mp3, monster-spawn.mp3

Game has graceful fallback (works without sounds).

Free sources: Freesound.org, OpenGameArt.org, Mixkit.co

### Adding Character Sprites:
Place PNG files in `public/assets/sprites/`:
- barbarian.png, warrior.png, ranger.png
- rogue.png, mage.png, cleric.png
- goblin.png, skeleton.png, orc.png, wolf.png

Game falls back to emojis if sprites missing.

---

## 📊 Technical Details

### Technologies:
- **Backend:** Node.js + Express
- **Real-time:** Socket.IO
- **Frontend:** Vanilla JavaScript (no framework)
- **Styling:** CSS3 with custom properties
- **Offline:** Service Workers + localStorage
- **PWA:** Installable as app

### Browser Support:
- ✅ Chrome/Edge (recommended)
- ✅ Safari (iOS + macOS)
- ✅ Firefox
- ⚠️ Mobile browsers (tested on Galaxy S24, iPhone)

### Performance:
- Smooth 60fps animations
- <3s initial load time
- <100ms action response
- Works on 2GB RAM devices

---

## 🐛 Troubleshooting

### Game not loading?
- Clear browser cache
- Hard refresh: Ctrl+Shift+R (Cmd+Shift+R on Mac)
- Check version number matches

### Offline play not working?
- Must save game online first
- Browser must support service workers
- Check console for errors (F12)

### Actions not responding offline?
- Verify version is v3.6.0+
- Check console for `[Offline] Handling action` logs
- Make sure `offlineMode` is enabled

### Grid not showing?
- Desktop: Should auto-show during gameplay
- Mobile: Tap "View Grid" button
- Check console for `[Grid] Grid visible` log

### Render deployment failing?
- Check Render logs
- Verify Node.js v18+
- Check for syntax errors: `node -c server.js`

---

## 🤝 Contributing

This is a personal project but feedback welcome!

**Found a bug?** Open an issue with:
- Version number
- Browser/device
- Steps to reproduce
- Console errors

**Feature ideas?** Describe use case and why it would be fun!

---

## 📜 License

This project is for personal/educational use.

---

## 🎯 Version History

- **v4.2.5** (Current) - Skill check: `skillCheckResolved` includes `rollerId`; `buyItem` while shop open bypasses turn gate; pending NPC `resolveEvent` before turn gate; multi-stage chest + path chooser fixes
- **v4.2.4** - Multiplayer sync: emit state before `turnStarted`; action bar + `turnPopupReady` from game state; log toasts after paint; respect `isPaused` for actions
- **v4.2.3** - Console: voice/socket/grid/load-game logs behind `qc_debug`; in-game menu About line; `application-name` meta
- **v4.2.2** - Polish: quieter default console (opt-in `qc_debug`), PWA title/description, dependency audit
- **v4.2.1** - Playtest stability: dice UI, grid fallbacks, NPC event choices match buttons, UI gate timeouts
- **v4.2.0** - Package / README alignment
- **v3.6.0** - AOE spells + Status effect impact
- **v3.5.6** - Offline solo play complete
- **v3.4.0** - Guide screen with search
- **v3.3.0** - XP scaling + Monster scaling + End turn prompts
- **v3.2.0** - Weapon ranges + Expanded custom mode
- **v3.1.0** - Grid fixes + Movement feedback
- **v3.0.x** - Initial polish pass
- Earlier versions: Core development

---

## 🎮 Game Modes Explained

### Beginner Mode:
- No weapon range restrictions
- Attack from anywhere
- Great for learning
- Faster-paced

### Advanced Mode:
- Weapon ranges enforced
- Tactical positioning required
- Movement crucial
- More strategic

### Custom Mode:
- 8 fully customizable options
- Set difficulty your way
- Adjust loot, starting gear, rules
- Experiment and find your perfect game!

---

## 🏆 Tips for Success

### Combat:
- **Coordinate with party** for flanking bonuses
- **Use grid positioning** - put ranged in back, melee in front
- **Save movement** for repositioning or escaping
- **Watch status effects** - they impact gameplay now!

### Progression:
- **INT increases XP gain** (+5% per point)
- **Level up early** - first level only needs 25 XP!
- **Defeat monsters** rather than avoiding
- **Use AOE spells** when facing multiple enemies

### Offline Play:
- **Save frequently** to different slots
- **Each slot** is a separate save state
- **Delete old saves** to free up space
- **Plan ahead** - no server means no NPCs to help

---

## 📞 Support

**Issues?** Check console logs (F12)  
**Questions?** Review the in-game guide (purple book)  
**Updates?** Pull latest from GitHub  

---

**Current Version:** v4.2.5  
**Last Updated:** 2026-03-20  
**Status:** Play-test ready ✅  

**Enjoy the game!** 🎮✨

---

*Quest & Chronicle - A tactical multiplayer card game with true offline solo play*
