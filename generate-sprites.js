#!/usr/bin/env node
/**
 * Generate Free Sprite Assets for Quest & Chronicle
 * Creates pixel art sprites using Canvas (no external assets needed!)
 * Run with: node generate-sprites.js
 */

const fs = require('fs');
const path = require('path');
const { createCanvas } = require('canvas');

const OUTPUT_DIR = path.join(__dirname, 'public/assets/sprites');

// Ensure output directory exists
if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

const sprites = {
    // Character classes
    barbarian: { color: '#D32F2F', accent: '#FFB74D', pattern: 'warrior' },
    warrior: { color: '#1976D2', accent: '#90CAF9', pattern: 'knight' },
    ranger: { color: '#388E3C', accent: '#A5D6A7', pattern: 'archer' },
    rogue: { color: '#424242', accent: '#9E9E9E', pattern: 'thief' },
    mage: { color: '#7B1FA2', accent: '#CE93D8', pattern: 'wizard' },
    cleric: { color: '#F57C00', accent: '#FFE082', pattern: 'priest' },
    
    // Common monsters
    goblin: { color: '#558B2F', accent: '#C5E1A5', pattern: 'monster' },
    wolf: { color: '#616161', accent: '#BDBDBD', pattern: 'beast' },
    skeleton: { color: '#ECEFF1', accent: '#CFD8DC', pattern: 'undead' },
    orc: { color: '#6D4C41', accent: '#A1887F', pattern: 'brute' },
    spider: { color: '#263238', accent: '#546E7A', pattern: 'crawler' },
    dragon: { color: '#C62828', accent: '#FFAB91', pattern: 'boss' }
};

function drawSprite(name, config) {
    const canvas = createCanvas(64, 64);
    const ctx = canvas.getContext('2d');
    
    // Background (transparent)
    ctx.clearRect(0, 0, 64, 64);
    
    // Draw based on pattern
    if (config.pattern === 'warrior' || config.pattern === 'knight') {
        // Helmet/head
        ctx.fillStyle = config.color;
        ctx.fillRect(20, 12, 24, 20);
        ctx.fillStyle = config.accent;
        ctx.fillRect(24, 16, 4, 8);
        ctx.fillRect(36, 16, 4, 8);
        
        // Body/armor
        ctx.fillStyle = config.color;
        ctx.fillRect(16, 32, 32, 20);
        ctx.fillRect(12, 36, 8, 16); // Left arm
        ctx.fillRect(44, 36, 8, 16); // Right arm
        ctx.fillRect(20, 52, 10, 12); // Legs
        ctx.fillRect(34, 52, 10, 12);
        
        // Details
        ctx.fillStyle = config.accent;
        ctx.fillRect(28, 36, 8, 12);
        
    } else if (config.pattern === 'archer') {
        ctx.fillStyle = config.color;
        ctx.fillRect(20, 10, 24, 24);
        ctx.fillStyle = config.accent;
        ctx.fillRect(26, 18, 12, 10);
        ctx.fillStyle = config.color;
        ctx.fillRect(20, 34, 24, 18);
        ctx.fillRect(14, 36, 10, 16);
        ctx.fillRect(40, 36, 10, 16);
        ctx.fillRect(22, 52, 8, 12);
        ctx.fillRect(34, 52, 8, 12);
        ctx.fillStyle = config.accent;
        ctx.fillRect(8, 32, 2, 20);
        
    } else if (config.pattern === 'thief') {
        ctx.fillStyle = config.color;
        ctx.fillRect(22, 12, 20, 22);
        ctx.fillStyle = config.accent;
        ctx.fillRect(26, 20, 4, 4);
        ctx.fillRect(34, 20, 4, 4);
        ctx.fillStyle = config.color;
        ctx.fillRect(24, 34, 16, 18);
        ctx.fillRect(18, 36, 8, 14);
        ctx.fillRect(38, 36, 8, 14);
        ctx.fillRect(24, 52, 6, 12);
        ctx.fillRect(34, 52, 6, 12);
        ctx.fillStyle = config.accent;
        ctx.fillRect(46, 42, 8, 2);
        
    } else if (config.pattern === 'wizard') {
        ctx.fillStyle = config.color;
        ctx.beginPath();
        ctx.moveTo(32, 6);
        ctx.lineTo(20, 20);
        ctx.lineTo(44, 20);
        ctx.closePath();
        ctx.fill();
        ctx.fillRect(18, 20, 28, 4);
        ctx.fillStyle = config.accent;
        ctx.fillRect(24, 24, 16, 10);
        ctx.fillStyle = config.color;
        ctx.fillRect(18, 34, 28, 22);
        ctx.fillRect(12, 38, 10, 12);
        ctx.fillRect(42, 38, 10, 12);
        ctx.fillStyle = config.accent;
        ctx.fillRect(6, 28, 2, 28);
        ctx.fillRect(4, 28, 6, 4);
        ctx.fillRect(26, 40, 3, 3);
        ctx.fillRect(35, 46, 3, 3);
        
    } else if (config.pattern === 'priest') {
        ctx.fillStyle = config.color;
        ctx.fillRect(20, 12, 24, 22);
        ctx.fillStyle = config.accent;
        ctx.fillRect(26, 20, 12, 10);
        ctx.fillStyle = config.color;
        ctx.fillRect(16, 34, 32, 22);
        ctx.fillRect(10, 38, 10, 14);
        ctx.fillRect(44, 38, 10, 14);
        ctx.fillStyle = config.accent;
        ctx.fillRect(30, 42, 4, 10);
        ctx.fillRect(28, 46, 8, 4);
        
    } else if (config.pattern === 'monster' || config.pattern === 'beast' || config.pattern === 'brute' || config.pattern === 'crawler') {
        ctx.fillStyle = config.color;
        ctx.fillRect(18, 20, 28, 28);
        ctx.fillStyle = config.accent;
        ctx.fillRect(24, 26, 4, 4);
        ctx.fillRect(36, 26, 4, 4);
        ctx.fillRect(26, 38, 3, 4);
        ctx.fillRect(30, 38, 3, 4);
        ctx.fillRect(34, 38, 3, 4);
        ctx.fillStyle = config.color;
        ctx.fillRect(14, 44, 6, 12);
        ctx.fillRect(44, 44, 6, 12);
        
    } else if (config.pattern === 'undead') {
        ctx.fillStyle = config.color;
        ctx.fillRect(20, 16, 24, 20);
        ctx.fillStyle = '#000';
        ctx.fillRect(24, 22, 6, 6);
        ctx.fillRect(34, 22, 6, 6);
        ctx.fillRect(24, 32, 3, 4);
        ctx.fillRect(28, 32, 3, 4);
        ctx.fillRect(32, 32, 3, 4);
        ctx.fillRect(36, 32, 3, 4);
        ctx.fillStyle = config.color;
        ctx.fillRect(22, 36, 20, 16);
        ctx.fillStyle = '#000';
        for (let i = 0; i < 4; i++) {
            ctx.fillRect(26, 38 + i * 3, 12, 2);
        }
        ctx.fillStyle = config.color;
        ctx.fillRect(24, 52, 6, 12);
        ctx.fillRect(34, 52, 6, 12);
        
    } else if (config.pattern === 'boss') {
        ctx.fillStyle = config.color;
        ctx.fillRect(16, 14, 32, 32);
        ctx.fillStyle = '#FF0000';
        ctx.fillRect(22, 22, 6, 6);
        ctx.fillRect(36, 22, 6, 6);
        ctx.fillStyle = config.accent;
        ctx.fillRect(14, 14, 4, 10);
        ctx.fillRect(46, 14, 4, 10);
        ctx.fillStyle = '#FFF';
        ctx.fillRect(24, 36, 4, 6);
        ctx.fillRect(36, 36, 4, 6);
        ctx.fillStyle = config.color;
        ctx.fillRect(6, 24, 10, 16);
        ctx.fillRect(48, 24, 10, 16);
        ctx.fillRect(20, 46, 8, 10);
        ctx.fillRect(36, 46, 8, 10);
    }
    
    return canvas;
}

console.log('🎨 Generating Free Sprite Assets...\n');

let successCount = 0;
for (const [name, config] of Object.entries(sprites)) {
    try {
        const canvas = drawSprite(name, config);
        const buffer = canvas.toBuffer('image/png');
        const outputPath = path.join(OUTPUT_DIR, `${name}.png`);
        fs.writeFileSync(outputPath, buffer);
        console.log(`✅ Generated: ${name}.png`);
        successCount++;
    } catch (error) {
        console.error(`❌ Failed to generate ${name}.png:`, error.message);
    }
}

console.log(`\n✨ Done! Generated ${successCount}/${Object.keys(sprites).length} sprites`);
console.log(`📁 Location: ${OUTPUT_DIR}`);
console.log('\n💡 If you see "canvas" module error, install it with:');
console.log('   npm install canvas');

