#!/usr/bin/env python3
"""
Simple Pixel Art Asset Generator for Quest Chronicle
Creates basic 32x32 pixel sprites using PIL
"""

try:
    from PIL import Image, ImageDraw
    HAS_PIL = True
except ImportError:
    HAS_PIL = False
    print("⚠️  PIL not installed. Install with: pip3 install Pillow")
    print("Creating text-based placeholders instead...")

import os

# Colors (RGB)
COLORS = {
    'red': (200, 50, 50),
    'blue': (50, 100, 200),
    'green': (50, 200, 100),
    'yellow': (220, 200, 50),
    'purple': (150, 50, 200),
    'white': (240, 240, 240),
    'brown': (120, 80, 50),
    'dark_brown': (80, 60, 40),
    'gray': (100, 100, 100),
    'black': (20, 20, 20),
}

def create_character_sprite(name, primary_color, secondary_color, symbol):
    """Create a simple 32x32 character sprite"""
    if not HAS_PIL:
        return None
    
    img = Image.new('RGBA', (32, 32), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    
    # Body (simple circle)
    draw.ellipse([8, 8, 24, 24], fill=primary_color)
    # Highlight
    draw.ellipse([10, 10, 16, 16], fill=secondary_color)
    
    return img

def create_monster_sprite(name, color, pattern='circle'):
    """Create a simple 32x32 monster sprite"""
    if not HAS_PIL:
        return None
    
    img = Image.new('RGBA', (32, 32), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    
    if pattern == 'circle':
        draw.ellipse([6, 6, 26, 26], fill=color)
        # Eyes
        draw.ellipse([10, 12, 14, 16], fill=(255, 255, 255))
        draw.ellipse([18, 12, 22, 16], fill=(255, 255, 255))
    
    return img

def create_tile(name, color1, color2):
    """Create a simple 32x32 tile"""
    if not HAS_PIL:
        return None
    
    img = Image.new('RGB', (32, 32), color1)
    draw = ImageDraw.Draw(img)
    
    # Checkered pattern
    for i in range(0, 32, 8):
        for j in range(0, 32, 8):
            if (i + j) % 16 == 0:
                draw.rectangle([i, j, i+8, j+8], fill=color2)
    
    return img

# Create assets
def main():
    if not HAS_PIL:
        print("Skipping image generation - PIL not available")
        return
    
    base_path = os.path.dirname(__file__)
    
    # Characters
    chars = {
        'barbarian': (COLORS['red'], COLORS['yellow'], '⚔'),
        'warrior': (COLORS['blue'], COLORS['gray'], '🛡'),
        'rogue': (COLORS['gray'], COLORS['black'], '🗡'),
        'ranger': (COLORS['green'], COLORS['brown'], '🏹'),
        'mage': (COLORS['purple'], COLORS['white'], '🔮'),
        'cleric': (COLORS['white'], COLORS['yellow'], '✨'),
    }
    
    print("🎨 Creating character sprites...")
    for name, (c1, c2, symbol) in chars.items():
        img = create_character_sprite(name, c1, c2, symbol)
        if img:
            img.save(f"{base_path}/sprites/{name}.png")
            print(f"  ✅ {name}.png")
    
    # Monsters
    monsters = {
        'goblin': (COLORS['green'], 'circle'),
        'wolf': (COLORS['gray'], 'circle'),
        'skeleton': (COLORS['white'], 'circle'),
        'orc': (COLORS['brown'], 'circle'),
        'spider': (COLORS['black'], 'circle'),
        'dragon': (COLORS['red'], 'circle'),
        'zombie': (COLORS['green'], 'circle'),
    }
    
    print("\n👹 Creating monster sprites...")
    for name, (color, pattern) in monsters.items():
        img = create_monster_sprite(name, color, pattern)
        if img:
            img.save(f"{base_path}/sprites/{name}.png")
            print(f"  ✅ {name}.png")
    
    # Tiles
    tiles = {
        'stone-floor': (COLORS['dark_brown'], COLORS['brown']),
        'stone-floor-dark': (COLORS['gray'], COLORS['black']),
    }
    
    print("\n🧱 Creating tiles...")
    for name, (c1, c2) in tiles.items():
        img = create_tile(name, c1, c2)
        if img:
            img.save(f"{base_path}/tiles/{name}.png")
            print(f"  ✅ {name}.png")
    
    print("\n✅ Asset generation complete!")
    print("Restart your server to see pixel art mode!")

if __name__ == '__main__':
    main()

