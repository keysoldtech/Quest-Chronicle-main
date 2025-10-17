#!/usr/bin/env node
/**
 * Generate SVG Sprite Assets (No dependencies needed!)
 * Creates clean pixel-style SVG sprites
 * Run with: node generate-svg-sprites.js
 */

const fs = require('fs');
const path = require('path');

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
    
    // Monsters
    goblin: { color: '#558B2F', accent: '#C5E1A5', pattern: 'monster' },
    wolf: { color: '#616161', accent: '#BDBDBD', pattern: 'beast' },
    skeleton: { color: '#ECEFF1', accent: '#CFD8DC', pattern: 'undead' },
    orc: { color: '#6D4C41', accent: '#A1887F', pattern: 'brute' },
    spider: { color: '#263238', accent: '#546E7A', pattern: 'crawler' },
    dragon: { color: '#C62828', accent: '#FFAB91', pattern: 'boss' }
};

function generateSVG(name, config) {
    let rects = '';
    
    if (config.pattern === 'warrior' || config.pattern === 'knight') {
        rects += `<rect x="20" y="12" width="24" height="20" fill="${config.color}"/>`;
        rects += `<rect x="24" y="16" width="4" height="8" fill="${config.accent}"/>`;
        rects += `<rect x="36" y="16" width="4" height="8" fill="${config.accent}"/>`;
        rects += `<rect x="16" y="32" width="32" height="20" fill="${config.color}"/>`;
        rects += `<rect x="12" y="36" width="8" height="16" fill="${config.color}"/>`;
        rects += `<rect x="44" y="36" width="8" height="16" fill="${config.color}"/>`;
        rects += `<rect x="20" y="52" width="10" height="12" fill="${config.color}"/>`;
        rects += `<rect x="34" y="52" width="10" height="12" fill="${config.color}"/>`;
        rects += `<rect x="28" y="36" width="8" height="12" fill="${config.accent}"/>`;
        
    } else if (config.pattern === 'archer') {
        rects += `<rect x="20" y="10" width="24" height="24" fill="${config.color}"/>`;
        rects += `<rect x="26" y="18" width="12" height="10" fill="${config.accent}"/>`;
        rects += `<rect x="20" y="34" width="24" height="18" fill="${config.color}"/>`;
        rects += `<rect x="14" y="36" width="10" height="16" fill="${config.color}"/>`;
        rects += `<rect x="40" y="36" width="10" height="16" fill="${config.color}"/>`;
        rects += `<rect x="22" y="52" width="8" height="12" fill="${config.color}"/>`;
        rects += `<rect x="34" y="52" width="8" height="12" fill="${config.color}"/>`;
        rects += `<rect x="8" y="32" width="2" height="20" fill="${config.accent}"/>`;
        
    } else if (config.pattern === 'thief') {
        rects += `<rect x="22" y="12" width="20" height="22" fill="${config.color}"/>`;
        rects += `<rect x="26" y="20" width="4" height="4" fill="${config.accent}"/>`;
        rects += `<rect x="34" y="20" width="4" height="4" fill="${config.accent}"/>`;
        rects += `<rect x="24" y="34" width="16" height="18" fill="${config.color}"/>`;
        rects += `<rect x="18" y="36" width="8" height="14" fill="${config.color}"/>`;
        rects += `<rect x="38" y="36" width="8" height="14" fill="${config.color}"/>`;
        rects += `<rect x="24" y="52" width="6" height="12" fill="${config.color}"/>`;
        rects += `<rect x="34" y="52" width="6" height="12" fill="${config.color}"/>`;
        rects += `<rect x="46" y="42" width="8" height="2" fill="${config.accent}"/>`;
        
    } else if (config.pattern === 'wizard') {
        rects += `<polygon points="32,6 20,20 44,20" fill="${config.color}"/>`;
        rects += `<rect x="18" y="20" width="28" height="4" fill="${config.color}"/>`;
        rects += `<rect x="24" y="24" width="16" height="10" fill="${config.accent}"/>`;
        rects += `<rect x="18" y="34" width="28" height="22" fill="${config.color}"/>`;
        rects += `<rect x="12" y="38" width="10" height="12" fill="${config.color}"/>`;
        rects += `<rect x="42" y="38" width="10" height="12" fill="${config.color}"/>`;
        rects += `<rect x="6" y="28" width="2" height="28" fill="${config.accent}"/>`;
        rects += `<rect x="4" y="28" width="6" height="4" fill="${config.accent}"/>`;
        rects += `<rect x="26" y="40" width="3" height="3" fill="${config.accent}"/>`;
        rects += `<rect x="35" y="46" width="3" height="3" fill="${config.accent}"/>`;
        
    } else if (config.pattern === 'priest') {
        rects += `<rect x="20" y="12" width="24" height="22" fill="${config.color}"/>`;
        rects += `<rect x="26" y="20" width="12" height="10" fill="${config.accent}"/>`;
        rects += `<rect x="16" y="34" width="32" height="22" fill="${config.color}"/>`;
        rects += `<rect x="10" y="38" width="10" height="14" fill="${config.color}"/>`;
        rects += `<rect x="44" y="38" width="10" height="14" fill="${config.color}"/>`;
        rects += `<rect x="30" y="42" width="4" height="10" fill="${config.accent}"/>`;
        rects += `<rect x="28" y="46" width="8" height="4" fill="${config.accent}"/>`;
        
    } else if (config.pattern === 'monster' || config.pattern === 'beast' || config.pattern === 'brute' || config.pattern === 'crawler') {
        rects += `<rect x="18" y="20" width="28" height="28" fill="${config.color}"/>`;
        rects += `<rect x="24" y="26" width="4" height="4" fill="${config.accent}"/>`;
        rects += `<rect x="36" y="26" width="4" height="4" fill="${config.accent}"/>`;
        rects += `<rect x="26" y="38" width="3" height="4" fill="${config.accent}"/>`;
        rects += `<rect x="30" y="38" width="3" height="4" fill="${config.accent}"/>`;
        rects += `<rect x="34" y="38" width="3" height="4" fill="${config.accent}"/>`;
        rects += `<rect x="14" y="44" width="6" height="12" fill="${config.color}"/>`;
        rects += `<rect x="44" y="44" width="6" height="12" fill="${config.color}"/>`;
        
    } else if (config.pattern === 'undead') {
        rects += `<rect x="20" y="16" width="24" height="20" fill="${config.color}"/>`;
        rects += `<rect x="24" y="22" width="6" height="6" fill="#000"/>`;
        rects += `<rect x="34" y="22" width="6" height="6" fill="#000"/>`;
        rects += `<rect x="24" y="32" width="3" height="4" fill="#000"/>`;
        rects += `<rect x="28" y="32" width="3" height="4" fill="#000"/>`;
        rects += `<rect x="32" y="32" width="3" height="4" fill="#000"/>`;
        rects += `<rect x="36" y="32" width="3" height="4" fill="#000"/>`;
        rects += `<rect x="22" y="36" width="20" height="16" fill="${config.color}"/>`;
        rects += `<rect x="26" y="38" width="12" height="2" fill="#000"/>`;
        rects += `<rect x="26" y="41" width="12" height="2" fill="#000"/>`;
        rects += `<rect x="26" y="44" width="12" height="2" fill="#000"/>`;
        rects += `<rect x="26" y="47" width="12" height="2" fill="#000"/>`;
        rects += `<rect x="24" y="52" width="6" height="12" fill="${config.color}"/>`;
        rects += `<rect x="34" y="52" width="6" height="12" fill="${config.color}"/>`;
        
    } else if (config.pattern === 'boss') {
        rects += `<rect x="16" y="14" width="32" height="32" fill="${config.color}"/>`;
        rects += `<rect x="22" y="22" width="6" height="6" fill="#FF0000"/>`;
        rects += `<rect x="36" y="22" width="6" height="6" fill="#FF0000"/>`;
        rects += `<rect x="14" y="14" width="4" height="10" fill="${config.accent}"/>`;
        rects += `<rect x="46" y="14" width="4" height="10" fill="${config.accent}"/>`;
        rects += `<rect x="24" y="36" width="4" height="6" fill="#FFF"/>`;
        rects += `<rect x="36" y="36" width="4" height="6" fill="#FFF"/>`;
        rects += `<rect x="6" y="24" width="10" height="16" fill="${config.color}"/>`;
        rects += `<rect x="48" y="24" width="10" height="16" fill="${config.color}"/>`;
        rects += `<rect x="20" y="46" width="8" height="10" fill="${config.color}"/>`;
        rects += `<rect x="36" y="46" width="8" height="10" fill="${config.color}"/>`;
    }
    
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64" style="image-rendering: pixelated; image-rendering: crisp-edges;">
${rects}
</svg>`;
}

console.log('🎨 Generating SVG Sprite Assets...\n');

let successCount = 0;
for (const [name, config] of Object.entries(sprites)) {
    try {
        const svg = generateSVG(name, config);
        const outputPath = path.join(OUTPUT_DIR, `${name}.svg`);
        fs.writeFileSync(outputPath, svg);
        console.log(`✅ Generated: ${name}.svg`);
        successCount++;
    } catch (error) {
        console.error(`❌ Failed to generate ${name}.svg:`, error.message);
    }
}

console.log(`\n✨ Done! Generated ${successCount}/${Object.keys(sprites).length} SVG sprites`);
console.log(`📁 Location: ${OUTPUT_DIR}`);
console.log('\n💡 SVG sprites work everywhere - no dependencies needed!');
console.log('   To convert to PNG, open generate-free-sprites.html in browser');

