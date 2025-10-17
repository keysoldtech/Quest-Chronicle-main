#!/usr/bin/env node
/*
 Generates sprite-manifest.json from "Custom Sprites" folders, preferring 4x PNGs.
 Output to public/assets/sprites/sprite-manifest.json
*/
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SPRITES_ROOT = path.join(ROOT, 'public', 'assets', 'sprites');
const CUSTOM_ROOT = path.join(SPRITES_ROOT, 'Custom Sprites', 'Custom Sprites');
const OUT_PATH = path.join(SPRITES_ROOT, 'sprite-manifest.json');

function safeWalk(dir) {
  if (!fs.existsSync(dir)) return [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) files.push(...safeWalk(p));
    else files.push(p);
  }
  return files;
}

function normalizeName(name) {
  return name.toLowerCase().replace(/\s+/g, '-');
}

function relToPublic(p) {
  return '/' + path.posix.join(...path.relative(path.join(ROOT, 'public'), p).split(path.sep));
}

function buildManifest() {
  const manifest = { player: {}, monster: {}, companion: {} };

  // Map class names to generic sprites if present in base folder
  const basePngs = ['barbarian','cleric','mage','ranger','rogue','warrior'];
  for (const name of basePngs) {
    const p = path.join(SPRITES_ROOT, `${name}.png`);
    if (fs.existsSync(p)) {
      manifest.player[name] = { '1x': relToPublic(p) };
    }
  }

  // Basic Monster Sprites, Basic Undead Sprites, basic magical sprites, Basic Animal Sprites, Basic Vermin Sprites
  const spriteSets = [
    'Basic Monster Sprites',
    'Basic Undead Sprites',
    'basic magical sprites',
    'Basic Animal Sprites',
    'Basic Holy Sprites',
    'Basic Vermin Sprites'
  ];

  const setAlias = {
    'Basic Animal Sprites': 'animal',
    'Basic Holy Sprites': 'holy',
    'basic magical sprites': 'magical',
    'Basic Undead Sprites': 'undead',
    'Basic Vermin Sprites': 'vermin',
    'Basic Monster Sprites': 'monster'
  };

  for (const set of spriteSets) {
    const setDir = path.join(CUSTOM_ROOT, set);
    if (!fs.existsSync(setDir)) continue;
    const files = fs.readdirSync(setDir).filter(f => f.toLowerCase().endsWith('.png'));
    // Expect patterns like "Basic 1x.png", "Basic 4x.png" or "Basic Undead 4x.png"
    const buckets = {};
    for (const file of files) {
      const lower = file.toLowerCase();
      const sizeMatch = lower.match(/(\d+)x\.png$/);
      if (!sizeMatch) continue;
      const size = `${parseInt(sizeMatch[1],10)}x`;
      const keyBase = lower.replace(/\s*\d+x\.png$/, '').trim(); // e.g., 'basic', 'basic-undead'
      const key = keyBase.replace(/\s+/g, '-');
      buckets[key] = buckets[key] || {};
      buckets[key][size] = relToPublic(path.join(setDir, file));
    }
    // Assign buckets to monster category with sensible names
    const defaultKey = setAlias[set] || null;
    for (const [k, sizes] of Object.entries(buckets)) {
      // Prefer explicit alias for the whole set when filenames are generic like "Basic Sprites 1x.png"
      let mapKey = defaultKey;
      if (!mapKey) {
        mapKey = k
          .replace('basic-', '')
          .replace('sprites', '')
          .replace('sprite', '')
          .replace(/-+/g, '-')
          .replace(/^-|-$|\./g, '');
      }
      if (!mapKey) continue; // skip invalid
      manifest.monster[mapKey] = sizes;
    }
  }

  // From Animations folders, map each specific monster name to its PNG
  const animationSets = [
    'Basic Monster Animations',
    'Basic Undead Animations',
    'basic magical animations',
    'Basic Animal Animations',
    'Basic Holy Animations',
    'Basic Vermin Animations'
  ];
  for (const set of animationSets) {
    const setDir = path.join(CUSTOM_ROOT, set);
    if (!fs.existsSync(setDir)) continue;
    const entries = fs.readdirSync(setDir, { withFileTypes: true });
    for (const d of entries) {
      if (!d.isDirectory()) continue;
      const png = path.join(setDir, d.name, `${d.name.replace(/\s+/g,'')}.png`);
      const png2 = path.join(setDir, d.name, `${d.name}.png`);
      let chosen = null;
      if (fs.existsSync(png)) chosen = png;
      else if (fs.existsSync(png2)) chosen = png2;
      if (chosen) {
        const key = normalizeName(d.name);
        manifest.monster[key] = manifest.monster[key] || {};
        manifest.monster[key]['4x'] = relToPublic(chosen);
      }
    }
  }

  // Basic companion mappings to existing monsters
  const compMap = ['wolf','bear','hawk'];
  for (const c of compMap) {
    if (manifest.monster[c]) manifest.companion[c] = manifest.monster[c];
  }

  // Prefer 4x entries by duplicating down to lower scales if missing
  const fillDown = (entry) => {
    if (!entry) return;
    const pref = entry['4x'] || entry['3x'] || entry['2x'] || entry['1x'] || null;
    if (!pref) return;
    if (!entry['2x']) entry['2x'] = pref;
    if (!entry['1x']) entry['1x'] = pref;
  };
  for (const cat of Object.values(manifest)) {
    for (const key of Object.keys(cat)) {
      fillDown(cat[key]);
    }
  }

  return manifest;
}

function main() {
  const manifest = buildManifest();
  fs.mkdirSync(SPRITES_ROOT, { recursive: true });
  fs.writeFileSync(OUT_PATH, JSON.stringify(manifest, null, 2));
  console.log('Wrote manifest to', OUT_PATH);
}

if (require.main === module) main();
