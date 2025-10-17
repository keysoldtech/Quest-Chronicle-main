# 🎨 Install Pixel Art Assets - 3 Simple Options

## ⚡ FASTEST: Use Node.js Generator (2 minutes)

### Step 1: Install Canvas (if needed)
```bash
npm install canvas
```

### Step 2: Generate Assets
```bash
cd public/assets
node generate-starter-assets.js
```

### Step 3: Restart & Play!
```bash
npm start
# Open game, start combat, see pixel art! 🎉
```

---

## 🌐 EASY: Download from Kenney (5 minutes)

### Step 1: Download
Visit: https://kenney.nl/assets/micro-roguelike
Click "Download" button (no account needed!)

### Step 2: Use Online Sprite Extractor
Visit: https://www.leshylabs.com/apps/sstool/
Upload the spritesheet, extract individual sprites

### Step 3: Copy to Project
```bash
cp extracted-sprites/* public/assets/sprites/
```

---

## 🎨 BEST: OpenGameArt.org (15 minutes, highest quality)

### LPC Dungeon Pack
```bash
# 1. Visit in browser:
open "https://opengameart.org/content/lpc-dungeon"

# 2. Click green "Download" button

# 3. Extract and copy
cd ~/Downloads
unzip LPC_Dungeon.zip
cd /path/to/Quest-Chronicle

# 4. Copy tiles (rename to match expected names)
cp ~/Downloads/LPC_Dungeon/floor/stone*.png public/assets/tiles/stone-floor.png
```

### LPC Character Sprites
```bash
# 1. Visit character generator:
open "https://lpc.opengameart.org/"

# 2. Select character type (warrior, mage, etc.)

# 3. Download individual sprites

# 4. Copy to project
cp ~/Downloads/character-sprites/*.png public/assets/sprites/
```

---

## 🆘 Troubleshooting

### "Cannot find module 'canvas'"
```bash
# Install canvas module
npm install canvas

# Or use Python version:
python3 create-simple-assets.py
```

### "Assets not loading"
```bash
# Check files exist:
ls public/assets/tiles/stone-floor.png

# Restart server:
npm start

# Hard refresh browser:
Ctrl+Shift+R (Windows/Linux)
Cmd+Shift+R (Mac)
```

### "Still showing emoji"
```bash
# Check console (F12):
# Should see: "[Grid] Pixel art assets detected and loaded"

# If not, check:
1. Files are named exactly: stone-floor.png (lowercase, hyphen)
2. Files are in correct folders
3. Server was restarted
```

---

## ✅ What Gets Created

### By Node.js Generator:
```
sprites/
  barbarian.png   (red circle)
  warrior.png     (blue circle)  
  rogue.png       (gray circle)
  ranger.png      (green circle)
  mage.png        (purple circle)
  cleric.png      (white circle)
  goblin.png      (green monster)
  wolf.png        (gray monster)
  skeleton.png    (white monster)
  orc.png         (brown monster)
  spider.png      (black monster)
  dragon.png      (red monster)
  zombie.png      (green monster)

tiles/
  stone-floor.png      (checkered brown)
  stone-floor-dark.png (checkered gray)

backgrounds/
  dungeon-room.png (600x600 dark dungeon)
```

Simple but functional! Perfect for testing the system.

---

## 🎯 Recommended Approach

### For Immediate Testing:
✅ Use Node.js generator (simple colored circles)

### For Better Graphics:
✅ Download Kenney Micro Roguelike (8-bit style)

### For Best Quality:
✅ Download LPC packs (16-bit SNES style)

---

## 📞 Need Help?

See full guides:
- `QUICK_START.md` - All options explained
- `PIXEL_ART_DUNGEON_ASSETS.md` - Complete asset source list
- `ASSETS_README.md` - Detailed setup instructions

---

**Let's get you out of emoji mode!** 🚀
