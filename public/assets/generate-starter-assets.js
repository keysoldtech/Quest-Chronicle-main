#!/usr/bin/env node
/**
 * Simple Asset Generator for Quest Chronicle
 * Creates basic colored PNG sprites using Canvas
 * Run: node generate-starter-assets.js
 */

const fs = require('fs');
const path = require('path');

// Try to load canvas module
let Canvas;
try {
    Canvas = require('canvas');
    console.log('✅ Canvas module found!');
} catch (e) {
    console.log('⚠️  Canvas module not found.');
    console.log('   Install with: npm install canvas');
    console.log('   Or use Option 2/3 in QUICK_START.md');
    process.exit(1);
}

const { createCanvas } = Canvas;

// Colors
const COLORS = {
    red: '#C83232',
    blue: '#3264C8',
    green: '#32C864',
    yellow: '#DCC832',
    purple: '#9632C8',
    white: '#F0F0F0',
    brown: '#785028',
    darkBrown: '#503C28',
    gray: '#646464',
    black: '#141414',
};

/**
 * Create a simple character sprite (32x32)
 */
function createCharacterSprite(name, primaryColor, secondaryColor) {
    const canvas = createCanvas(32, 32);
    const ctx = canvas.getContext('2d');
    
    // Transparent background
    ctx.clearRect(0, 0, 32, 32);
    
    // Body (circle)
    ctx.fillStyle = primaryColor;
    ctx.beginPath();
    ctx.arc(16, 16, 8, 0, Math.PI * 2);
    ctx.fill();
    
    // Highlight
    ctx.fillStyle = secondaryColor;
    ctx.beginPath();
    ctx.arc(13, 13, 3, 0, Math.PI * 2);
    ctx.fill();
    
    // Border for definition
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(16, 16, 8, 0, Math.PI * 2);
    ctx.stroke();
    
    return canvas.toBuffer('image/png');
}

/**
 * Create a simple monster sprite (32x32)
 */
function createMonsterSprite(name, color) {
    const canvas = createCanvas(32, 32);
    const ctx = canvas.getContext('2d');
    
    ctx.clearRect(0, 0, 32, 32);
    
    // Monster body
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(16, 18, 10, 0, Math.PI * 2);
    ctx.fill();
    
    // Eyes
    ctx.fillStyle = '#FFFFFF';
    ctx.beginPath();
    ctx.arc(12, 15, 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(20, 15, 2, 0, Math.PI * 2);
    ctx.fill();
    
    // Eye pupils
    ctx.fillStyle = '#000000';
    ctx.beginPath();
    ctx.arc(12, 15, 1, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(20, 15, 1, 0, Math.PI * 2);
    ctx.fill();
    
    // Border
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(16, 18, 10, 0, Math.PI * 2);
    ctx.stroke();
    
    return canvas.toBuffer('image/png');
}

/**
 * Create a tile (32x32)
 */
function createTile(name, color1, color2) {
    const canvas = createCanvas(32, 32);
    const ctx = canvas.getContext('2d');
    
    // Base color
    ctx.fillStyle = color1;
    ctx.fillRect(0, 0, 32, 32);
    
    // Checkered pattern
    ctx.fillStyle = color2;
    for (let i = 0; i < 32; i += 8) {
        for (let j = 0; j < 32; j += 8) {
            if ((i + j) % 16 === 0) {
                ctx.fillRect(i, j, 8, 8);
            }
        }
    }
    
    return canvas.toBuffer('image/png');
}

/**
 * Create background (600x600)
 */
function createBackground() {
    const canvas = createCanvas(600, 600);
    const ctx = canvas.getContext('2d');
    
    // Gradient background
    const gradient = ctx.createLinearGradient(0, 0, 600, 600);
    gradient.addColorStop(0, '#1A1A2E');
    gradient.addColorStop(1, '#16213E');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 600, 600);
    
    // Add some texture
    for (let i = 0; i < 50; i++) {
        ctx.fillStyle = `rgba(255, 255, 255, ${Math.random() * 0.1})`;
        ctx.fillRect(
            Math.random() * 600,
            Math.random() * 600,
            Math.random() * 10,
            Math.random() * 10
        );
    }
    
    return canvas.toBuffer('image/png');
}

// Main execution
async function main() {
    console.log('🎨 Quest Chronicle - Asset Generator\n');
    
    const basePath = __dirname;
    
    // Character sprites
    const characters = {
        'barbarian': [COLORS.red, COLORS.yellow],
        'warrior': [COLORS.blue, COLORS.gray],
        'rogue': [COLORS.gray, COLORS.black],
        'ranger': [COLORS.green, COLORS.brown],
        'mage': [COLORS.purple, COLORS.white],
        'cleric': [COLORS.white, COLORS.yellow],
    };
    
    console.log('👤 Creating character sprites...');
    for (const [name, [c1, c2]] of Object.entries(characters)) {
        const buffer = createCharacterSprite(name, c1, c2);
        fs.writeFileSync(path.join(basePath, 'sprites', `${name}.png`), buffer);
        console.log(`  ✅ ${name}.png`);
    }
    
    // Monster sprites
    const monsters = {
        'goblin': COLORS.green,
        'wolf': COLORS.gray,
        'skeleton': COLORS.white,
        'orc': COLORS.brown,
        'spider': COLORS.black,
        'dragon': COLORS.red,
        'zombie': COLORS.green,
    };
    
    console.log('\n👹 Creating monster sprites...');
    for (const [name, color] of Object.entries(monsters)) {
        const buffer = createMonsterSprite(name, color);
        fs.writeFileSync(path.join(basePath, 'sprites', `${name}.png`), buffer);
        console.log(`  ✅ ${name}.png`);
    }
    
    // Tiles
    const tiles = {
        'stone-floor': [COLORS.darkBrown, COLORS.brown],
        'stone-floor-dark': [COLORS.gray, COLORS.black],
    };
    
    console.log('\n🧱 Creating tiles...');
    for (const [name, [c1, c2]] of Object.entries(tiles)) {
        const buffer = createTile(name, c1, c2);
        fs.writeFileSync(path.join(basePath, 'tiles', `${name}.png`), buffer);
        console.log(`  ✅ ${name}.png`);
    }
    
    // Background
    console.log('\n🏰 Creating dungeon background...');
    const bgBuffer = createBackground();
    fs.writeFileSync(path.join(basePath, 'backgrounds', 'dungeon-room.png'), bgBuffer);
    console.log('  ✅ dungeon-room.png');
    
    console.log('\n✅ Asset generation complete!');
    console.log('\n🚀 Next steps:');
    console.log('   1. Restart your server: npm start');
    console.log('   2. Open browser and start a game');
    console.log('   3. Enter combat to see pixel art!');
    console.log('\n💡 Console should show: "[Grid] Pixel art assets detected"');
}

main().catch(console.error);
