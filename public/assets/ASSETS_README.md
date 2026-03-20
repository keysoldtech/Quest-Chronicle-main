# Assets Directory

## 📁 Directory Structure

```
public/assets/
├── tiles/          # Dungeon floor/wall tiles (32×32px)
├── sprites/        # Character and monster sprites (32×32px)
├── backgrounds/    # Full dungeon backgrounds (600×600px)
└── ASSETS_README.md (this file)
```

## 🎨 Recommended Assets to Download

### Quick Setup (16-bit SNES Style):

**1. Download LPC Dungeon Tileset:**
- Visit: https://opengameart.org/content/lpc-dungeon
- Download ZIP
- Extract to your desktop
- Copy tiles to `public/assets/tiles/`

**2. Download LPC Character Sprites:**
- Visit: https://lpc.opengameart.org/
- Download character generator pack
- Extract character sprites
- Copy to `public/assets/sprites/`

## 📋 Required Files

### Tiles (place in `tiles/` folder):
- `stone-floor.png` (32×32) - Default floor
- `stone-floor-dark.png` (32×32) - Dark variant
- `stone-wall.png` (32×32) - Wall tile
- `wooden-floor.png` (32×32) - Alternative floor

### Character Sprites (place in `sprites/` folder):
- `barbarian.png` (32×32)
- `warrior.png` (32×32)
- `rogue.png` (32×32)
- `ranger.png` (32×32)
- `mage.png` (32×32)
- `cleric.png` (32×32)

### Monster Sprites (place in `sprites/` folder):
- `goblin.png` (32×32)
- `wolf.png` (32×32)
- `skeleton.png` (32×32)
- `orc.png` (32×32)
- `spider.png` (32×32)

### Background (place in `backgrounds/` folder):
- `dungeon-room.png` (600×600) - Full dungeon background

## 🚀 How to Add Assets

### Step 1: Download Assets
```bash
# Visit OpenGameArt.org
# Search "LPC Dungeon"
# Download and extract ZIP
```

### Step 2: Copy to Project
```bash
# Copy tiles
cp ~/Downloads/lpc-dungeon/tiles/* public/assets/tiles/

# Copy sprites
cp ~/Downloads/lpc-dungeon/sprites/* public/assets/sprites/

# Copy backgrounds
cp ~/Downloads/lpc-dungeon/backgrounds/* public/assets/backgrounds/
```

### Step 3: Rename Files (if needed)
The game expects specific filenames. Rename your files to match:
- Floor tiles: `stone-floor.png`
- Character sprites: `[classname].png` (lowercase)
- Monster sprites: `[monstername].png` (lowercase)

### Step 4: Restart Server
```bash
# Restart to pick up new assets
npm start
```

## 🎨 Current Status

The game is configured to use pixel art assets. If assets are not found, it will:
1. Fall back to emoji icons (current default)
2. Show placeholder colored squares
3. Continue working normally

To enable full pixel art mode, simply add the required files to the directories above!

## 📦 Free Asset Sources

See `PIXEL_ART_DUNGEON_ASSETS.md` in the root directory for:
- Complete list of free asset sources
- Direct download links
- License information
- Asset recommendations

## ✅ Asset Checklist

- [ ] Downloaded LPC Dungeon tileset
- [ ] Copied tiles to `tiles/` folder
- [ ] Copied character sprites to `sprites/` folder
- [ ] Copied monster sprites to `sprites/` folder
- [ ] Renamed files to match expected names
- [ ] Restarted server
- [ ] Tested in game!

## 🎮 Testing

After adding assets, test by:
1. Start game: `npm start`
2. Create room and start game
3. Enter combat
4. Check grid - should show pixel art!
5. If you see emoji, assets weren't loaded (check filenames)

## 📝 License Notes

When using assets, remember to:
- Check license requirements (CC0, CC BY, CC BY-SA)
- Provide attribution if required
- Keep license files with assets

Most LPC assets require attribution like:
```
Art by [Artist Name] (http://link-to-artist)
Licensed under CC BY-SA 3.0 or GPL 3.0
```

Add attribution to your game's credits screen or README.

---

**Ready to add assets?** Follow the steps above and enjoy your pixel art dungeon! 🏰✨
