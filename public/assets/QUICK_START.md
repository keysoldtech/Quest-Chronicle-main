# 🚀 Quick Start - Get Out of Emoji Mode NOW!

## 3 Options to Get Pixel Art Assets

---

## ⚡ Option 1: Use Online Free Assets (EASIEST - 5 minutes)

### Method A: Kenney.nl (CC0 - Public Domain)

**1. Download:**
```bash
# Visit in browser:
open "https://kenney.nl/assets/micro-roguelike"

# Click "Download" button (no account needed!)
# File: microRoguelike_1.0.0.zip
```

**2. Extract and Copy:**
```bash
# Unzip the download
cd ~/Downloads
unzip microRoguelike_1.0.0.zip

# Copy to project (adjust path to your Quest Chronicle folder)
cd /path/to/Quest-Chronicle

# The Kenney pack has a spritesheet - you'll need to extract individual sprites
# For now, we'll use simpler assets below
```

---

### Method B: OpenGameArt.org (Best Quality)

**1. Download LPC Dungeon:**
```bash
# In browser, visit:
open "https://opengameart.org/content/lpc-dungeon"

# Click green "Download" button
# File: LPC_Dungeon.zip (or similar)
```

**2. Extract:**
```bash
cd ~/Downloads
unzip LPC_Dungeon.zip
```

**3. Copy to Project:**
```bash
cd /path/to/Quest-Chronicle

# Copy tiles
cp ~/Downloads/LPC_Dungeon/tiles/floor_stone*.png public/assets/tiles/stone-floor.png

# Copy sprites (you may need to find LPC character sprites separately)
# Visit: https://lpc.opengameart.org/ for character generator
```

---

## 🎨 Option 2: Generate Simple Assets (FASTEST - 2 minutes)

### Use Python Script (if you have PIL/Pillow):

```bash
# Install Pillow if needed
pip3 install Pillow

# Generate assets
cd public/assets
python3 create-simple-assets.py

# Should create:
# - sprites/barbarian.png
# - sprites/warrior.png
# - sprites/rogue.png
# - sprites/ranger.png
# - sprites/mage.png
# - sprites/cleric.png
# - sprites/goblin.png
# - sprites/wolf.png
# - tiles/stone-floor.png
```

---

## 🖼️ Option 3: Use Pre-Made Simple Assets (RIGHT NOW!)

### I'll create ultra-simple starter assets for you:

```bash
cd /path/to/Quest-Chronicle/public/assets

# Create simple colored square "sprites" as placeholders
# Run these commands:
```

Let me create actual working placeholder PNGs for you...

---

## ✅ After Getting Assets

### 1. Verify Files Exist:
```bash
ls -la public/assets/tiles/
# Should see: stone-floor.png

ls -la public/assets/sprites/
# Should see: barbarian.png, warrior.png, etc.
```

### 2. Restart Server:
```bash
npm start
```

### 3. Check Console:
```
Open browser console (F12)
Look for: "[Grid] Pixel art assets detected and loaded"
```

### 4. Start Game:
```
Create game → Start combat → See pixel art! 🎉
```

---

## 🎯 Minimum Required Files

To get OUT of emoji mode, you need at least:

### Critical (1 file):
```
✅ public/assets/tiles/stone-floor.png
```
This single file triggers pixel art mode!

### Recommended (6 files):
```
✅ public/assets/sprites/barbarian.png
✅ public/assets/sprites/warrior.png
✅ public/assets/sprites/rogue.png
✅ public/assets/sprites/ranger.png
✅ public/assets/sprites/mage.png
✅ public/assets/sprites/cleric.png
```

### Nice to Have (7+ files):
```
✅ public/assets/sprites/goblin.png
✅ public/assets/sprites/wolf.png
✅ public/assets/sprites/skeleton.png
✅ public/assets/sprites/orc.png
✅ public/assets/backgrounds/dungeon-room.png
```

---

## 🆘 Troubleshooting

### Still Seeing Emoji?

**Check 1: Files exist**
```bash
ls public/assets/tiles/stone-floor.png
# Should show the file
```

**Check 2: File is PNG**
```bash
file public/assets/tiles/stone-floor.png
# Should say: PNG image data, 32 x 32, 8-bit/color RGBA
```

**Check 3: Server restarted**
```bash
# Kill old server (Ctrl+C)
# Start new server
npm start
```

**Check 4: Hard refresh browser**
```
Ctrl + Shift + R  (Windows/Linux)
Cmd + Shift + R   (Mac)
```

**Check 5: Console logs**
```javascript
// In browser console (F12), should see:
[Grid] Pixel art assets detected and loaded
// NOT:
[Grid] No pixel art assets found, using emoji fallback
```

---

## 📦 What Gets Downloaded (Examples)

### Kenney Micro Roguelike:
- **Size:** ~50KB
- **Style:** 8×8 ultra-retro
- **License:** CC0 (Public Domain)
- **Contents:** Spritesheet with characters, monsters, tiles

### LPC Dungeon:
- **Size:** ~5MB
- **Style:** 32×32 detailed
- **License:** CC BY-SA 3.0
- **Contents:** Individual PNG files for everything

---

## 🎮 Testing

After adding assets:

```bash
# Start server
npm start

# Open browser
open http://localhost:3000

# Create game
# Start combat
# Look at grid!

Expected:
✅ Checkered stone floor on cells
✅ Character sprites (not emoji)
✅ Monster sprites (not emoji)
✅ Crisp pixel graphics
```

---

## 🔧 Create Your Own Simple Assets

### Using Any Image Editor:

**Requirements:**
- **Size:** 32×32 pixels
- **Format:** PNG with transparency
- **Style:** Pixel art (low resolution, sharp edges)

**Tools:**
- **Aseprite:** $19.99 (best pixel art tool)
- **Piskel:** Free online (piskelapp.com)
- **Photoshop/GIMP:** Set canvas to 32×32px
- **MS Paint:** Works! Just make it 32×32

**Quick Method:**
1. Open tool
2. Create 32×32 canvas
3. Draw simple shape (circle, square)
4. Add color
5. Save as PNG
6. Name it `barbarian.png`, `warrior.png`, etc.

---

## 💡 Tips

### Tip 1: Start with ONE file
Just create `stone-floor.png` to test the system!

### Tip 2: Use placeholders
Simple colored squares work fine for testing:
- Red square = Barbarian
- Blue square = Warrior
- Green square = Rogue

### Tip 3: Upgrade later
Start with simple assets, add better ones later!

### Tip 4: Mix and match
- Use emoji for some characters
- Use sprites for others
- System handles both!

---

## 📚 More Resources

**Free Asset Packs:**
- Kenney: https://kenney.nl/assets
- OpenGameArt: https://opengameart.org/
- itch.io: https://itch.io/game-assets/free
- Oryx: http://oryxdesignlab.com/

**Documentation:**
- See `PIXEL_ART_DUNGEON_ASSETS.md` for full list
- See `ASSETS_README.md` for setup details

---

## ✅ Success Checklist

- [ ] Downloaded or created `stone-floor.png`
- [ ] Placed in `public/assets/tiles/`
- [ ] Created at least 1 character sprite
- [ ] Placed in `public/assets/sprites/`
- [ ] Restarted server
- [ ] Hard refreshed browser
- [ ] Console shows "assets detected"
- [ ] Grid shows pixel art!

---

**Ready to get out of emoji mode?** Pick an option above and let's go! 🚀
