// This file defines all static game data, including character classes, cards (items, spells, monsters, etc.),
// NPC dialogue, skill challenges, and other game constants. It is used exclusively by the server (`server.js`) to populate
// the game world and manage game mechanics. It is not sent to the client.

// --- INDEX ---
// 1. CLASSES
// 2. STATUS EFFECT DEFINITIONS
// 3. ACTION COSTS
// 4. NPC DIALOGUE
// 5. MAGICAL AFFIXES (for item generation)
// 6. CARD DATA
//    - 6.1. Weapon Cards
//    - 6.2. Armor Cards
//    - 6.3. Spell Cards
//    - 6.4. Item Cards (Consumables & Utility)
//    - 6.5. Event Cards (Categorized Decks)
// 7. MONSTER DATA
//    - 7.1. All Monsters List (structured)
//    - 7.2. Monster Tiers (for spawning)
// 8. MODULE EXPORTS

// --- 1. CLASSES & SPECIALIZATIONS ---
const classes = {
    Barbarian: { baseHp: 20, baseDamageBonus: 0, baseShieldBonus: 0, baseAP: 3, healthDice: 4, stats: { str: 4, dex: 2, con: 4, int: 0, wis: 0, cha: 1 }, primaryStat: 'str', ability: { name: 'Rage', apCost: 1, description: 'Enter a rage. Gain +4 damage on all attacks this turn.', effect: { type: 'buff', status: 'Raging', duration: 1, target: 'self' } } },
    Cleric:    { baseHp: 18, baseDamageBonus: 0, baseShieldBonus: 1, baseAP: 2, healthDice: 3, stats: { str: 2, dex: 0, con: 3, int: 1, wis: 4, cha: 2 }, primaryStat: 'wis', ability: { name: 'Divine Heal', apCost: 1, description: 'Heal yourself for 1d8 + WIS HP.', effect: { type: 'heal', dice: '1d8', statBonus: 'wis', target: 'self' } } },
    Mage:      { baseHp: 15, baseDamageBonus: 0, baseShieldBonus: 0, baseAP: 2, healthDice: 2, stats: { str: 0, dex: 2, con: 2, int: 5, wis: 2, cha: 1 }, primaryStat: 'int', ability: { name: 'Arcane Recovery', apCost: 0, description: 'Regain 1 AP. Usable once per turn.', effect: { type: 'resource', resource: 'ap', amount: 1 } } },
    Ranger:    { baseHp: 18, baseDamageBonus: 0, baseShieldBonus: 1, baseAP: 2, healthDice: 3, stats: { str: 1, dex: 4, con: 3, int: 1, wis: 3, cha: 0 }, primaryStat: 'dex', ability: { name: 'Hunter\'s Mark', apCost: 1, description: 'Mark a target. Your next attack against it has +5 to hit.', effect: { type: 'buff', status: 'Hunter\'s Mark Ready', duration: 2, target: 'self' } } },
    Rogue:     { baseHp: 16, baseDamageBonus: 0, baseShieldBonus: 0, baseAP: 3, healthDice: 2, stats: { str: 1, dex: 5, con: 2, int: 2, wis: 0, cha: 3 }, primaryStat: 'dex', ability: { name: 'Sneak Attack', apCost: 1, description: 'Your next attack this turn deals an extra 1d6 damage.', effect: { type: 'buff', status: 'Sneak Attack Ready', duration: 2, target: 'self' } } },
    Warrior:   { baseHp: 20, baseDamageBonus: 0, baseShieldBonus: 1, baseAP: 3, healthDice: 4, stats: { str: 5, dex: 1, con: 4, int: 0, wis: 1, cha: 1 }, primaryStat: 'str', ability: { name: 'Power Surge', apCost: 1, description: 'Your next attack has +2 to hit and +2 damage.', effect: { type: 'buff', status: 'Power Surge Ready', duration: 2, target: 'self' } } },
};

// Character Specialization Trees (3 branches per class, 3 tiers each)
const specializations = {
    Barbarian: {
        Berserker: {
            name: 'Berserker',
            description: 'Pure damage specialist',
            tiers: [
                { level: 3, name: 'Brutal Strikes', description: '+2 damage on all attacks', bonuses: { damageBonus: 2 } },
                { level: 5, name: 'Critical Edge', description: 'Critical hits on 19-20', effect: { critRange: [19, 20] } },
                { level: 7, name: 'Execute', description: 'Instant kill enemies below 25% HP', effect: { executeThreshold: 0.25 } }
            ]
        },
        Defender: {
            name: 'Defender',
            description: 'Tank specialist',
            tiers: [
                { level: 3, name: 'Iron Constitution', description: '+2 max HP per level', bonuses: { hpPerLevel: 2 } },
                { level: 5, name: 'Taunt', description: 'Force enemies to attack you (1 AP)', ability: { name: 'Taunt', apCost: 1 } },
                { level: 7, name: 'Damage Reduction', description: '20% damage reduction', bonuses: { damageReduction: 0.2 } }
            ]
        },
        Shaman: {
            name: 'Shaman',
            description: 'Party buffer',
            tiers: [
                { level: 3, name: 'War Cry', description: '+2 party damage for 2 turns', ability: { name: 'War Cry', apCost: 1, duration: 2 } },
                { level: 5, name: 'Blood Healing', description: 'Heal allies 5 HP when you kill', effect: { healOnKill: 5 } },
                { level: 7, name: 'Ancestral Resurrection', description: 'Revive fallen ally (2 AP, once per combat)', ability: { name: 'Resurrect', apCost: 2, uses: 1 } }
            ]
        }
    },
    Rogue: {
        Assassin: {
            name: 'Assassin',
            description: 'Burst damage from stealth',
            tiers: [
                { level: 3, name: 'Deadly Precision', description: '+1d6 sneak attack damage', bonuses: { sneakAttackDice: '1d6' } },
                { level: 5, name: 'Backstab', description: 'Auto-crit when attacking from behind', effect: { backstabCrit: true } },
                { level: 7, name: 'Assassinate', description: 'Instant kill targets below 50% HP', effect: { assassinateThreshold: 0.5 } }
            ]
        },
        Trickster: {
            name: 'Trickster',
            description: 'Control and debuffs',
            tiers: [
                { level: 3, name: 'Blinding Powder', description: 'Blind target for 1 turn (1 AP)', ability: { name: 'Blind', apCost: 1, duration: 1 } },
                { level: 5, name: 'Steal Buffs', description: 'Take enemy buffs for yourself', ability: { name: 'Steal', apCost: 1 } },
                { level: 7, name: 'Mass Confusion', description: 'Confuse all enemies (2 AP)', ability: { name: 'Confuse', apCost: 2, aoe: true } }
            ]
        },
        Scout: {
            name: 'Scout',
            description: 'Utility and mobility',
            tiers: [
                { level: 3, name: 'Fleet Footed', description: '+1 movement point', bonuses: { movementBonus: 1 } },
                { level: 5, name: 'Trap Sense', description: 'Auto-detect and disarm traps', effect: { autoDetectTraps: true } },
                { level: 7, name: 'Group Stealth', description: 'Whole party becomes hidden', ability: { name: 'Group Stealth', apCost: 2 } }
            ]
        }
    },
    Mage: {
        Elementalist: {
            name: 'Elementalist',
            description: 'Spell damage specialist',
            tiers: [
                { level: 3, name: 'Spell Power', description: '+1 to all spell damage', bonuses: { spellDamage: 1 } },
                { level: 5, name: 'Expanded Blast', description: '+1 radius to AoE spells', bonuses: { aoeRadius: 1 } },
                { level: 7, name: 'Chain Lightning', description: 'Hits 3 targets (2 AP)', ability: { name: 'Chain Lightning', apCost: 2, targets: 3 } }
            ]
        },
        Enchanter: {
            name: 'Enchanter',
            description: 'Control specialist',
            tiers: [
                { level: 3, name: 'Extended Control', description: '+1 turn CC duration', bonuses: { ccDuration: 1 } },
                { level: 5, name: 'Mass Polymorph', description: 'Turn enemies into sheep (2 AP)', ability: { name: 'Polymorph', apCost: 2, aoe: true } },
                { level: 7, name: 'Time Stop', description: 'Take 2 extra turns (3 AP, once per combat)', ability: { name: 'Time Stop', apCost: 3, extraTurns: 2, uses: 1 } }
            ]
        },
        Scholar: {
            name: 'Scholar',
            description: 'Support caster',
            tiers: [
                { level: 3, name: 'Mana Link', description: 'Share AP with allies (1 AP)', ability: { name: 'Mana Link', apCost: 1 } },
                { level: 5, name: 'Shield Allies', description: 'Grant party +2 AC (1 AP)', ability: { name: 'Shield', apCost: 1, duration: 2 } },
                { level: 7, name: 'Mass Resurrection', description: 'Revive all fallen allies (3 AP)', ability: { name: 'Mass Resurrect', apCost: 3 } }
            ]
        }
    },
    Warrior: {
        WeaponMaster: {
            name: 'Weapon Master',
            description: 'Melee damage specialist',
            tiers: [
                { level: 3, name: 'Precision Strikes', description: '+1 to hit', bonuses: { hitBonus: 1 } },
                { level: 5, name: 'Cleave', description: 'Hit 2 adjacent enemies (1 AP)', ability: { name: 'Cleave', apCost: 1, targets: 2 } },
                { level: 7, name: 'Whirlwind', description: 'Hit all adjacent enemies (2 AP)', ability: { name: 'Whirlwind', apCost: 2, aoe: true } }
            ]
        },
        Guardian: {
            name: 'Guardian',
            description: 'Protective tank',
            tiers: [
                { level: 3, name: 'Block for Allies', description: 'Redirect damage to you (0 AP reaction)', ability: { name: 'Block', apCost: 0, reaction: true } },
                { level: 5, name: 'Riposte', description: 'Counterattack when hit', effect: { counterattack: true } },
                { level: 7, name: 'Last Stand', description: 'Cannot die for 3 turns (2 AP)', ability: { name: 'Last Stand', apCost: 2, duration: 3 } }
            ]
        },
        Commander: {
            name: 'Commander',
            description: 'Party leader',
            tiers: [
                { level: 3, name: 'Rally', description: 'Heal party 1d8 HP (1 AP)', ability: { name: 'Rally', apCost: 1, dice: '1d8', aoe: true } },
                { level: 5, name: 'Inspire', description: 'Grant party +1 AP (2 AP)', ability: { name: 'Inspire', apCost: 2 } },
                { level: 7, name: 'Formation', description: 'Party gains +2 AC when adjacent', effect: { formationBonus: 2 } }
            ]
        }
    },
    Cleric: {
        DivineHealer: {
            name: 'Divine Healer',
            description: 'Healing specialist',
            tiers: [
                { level: 3, name: 'Enhanced Healing', description: '+50% healing power', bonuses: { healingBonus: 0.5 } },
                { level: 5, name: 'Heal Over Time', description: 'Heal 5 HP/turn for 3 turns (1 AP)', ability: { name: 'HoT', apCost: 1, healPerTurn: 5, duration: 3 } },
                { level: 7, name: 'Mass Heal', description: 'Heal all allies 3d8 HP (2 AP)', ability: { name: 'Mass Heal', apCost: 2, dice: '3d8', aoe: true } }
            ]
        },
        Crusader: {
            name: 'Crusader',
            description: 'Holy damage dealer',
            tiers: [
                { level: 3, name: 'Smite', description: '+2d6 radiant damage (1 AP)', ability: { name: 'Smite', apCost: 1, dice: '2d6' } },
                { level: 5, name: 'Turn Undead', description: 'Fear all undead enemies (1 AP)', ability: { name: 'Turn Undead', apCost: 1, aoe: true } },
                { level: 7, name: 'Divine Wrath', description: '4d8 AoE holy damage (2 AP)', ability: { name: 'Divine Wrath', apCost: 2, dice: '4d8', aoe: true } }
            ]
        },
        Priest: {
            name: 'Priest',
            description: 'Support specialist',
            tiers: [
                { level: 3, name: 'Bless', description: 'Party gains +1 to all rolls (1 AP)', ability: { name: 'Bless', apCost: 1, duration: 3 } },
                { level: 5, name: 'Remove Curse', description: 'Remove all debuffs from target (1 AP)', ability: { name: 'Cleanse', apCost: 1 } },
                { level: 7, name: 'Sanctuary', description: 'Party immune to damage for 1 turn (3 AP)', ability: { name: 'Sanctuary', apCost: 3, duration: 1 } }
            ]
        }
    },
    Ranger: {
        Marksman: {
            name: 'Marksman',
            description: 'Ranged damage',
            tiers: [
                { level: 3, name: 'Extended Range', description: '+2 attack range', bonuses: { rangeBonus: 2 } },
                { level: 5, name: 'Multi-Shot', description: 'Attack 2 targets (1 AP)', ability: { name: 'Multi-Shot', apCost: 1, targets: 2 } },
                { level: 7, name: 'Piercing Shot', description: 'Line AoE attack (2 AP)', ability: { name: 'Piercing Shot', apCost: 2, aoe: 'line' } }
            ]
        },
        BeastMaster: {
            name: 'Beast Master',
            description: 'Pet specialist - Summon and command a loyal companion',
            tiers: [
                { level: 3, name: 'Animal Companion', description: 'Summon a beast ally (1 AP, lasts until defeated)', ability: { name: 'Summon Companion', apCost: 1 } },
                { level: 5, name: 'Command Attack', description: 'Your companion attacks twice per turn', effect: { petExtraAttack: true } },
                { level: 7, name: 'Alpha Beast', description: 'Your companion gains +50% HP and damage', bonuses: { petStatsBonus: 0.5 } }
            ]
        },
        Tracker: {
            name: 'Tracker',
            description: 'Exploration expert',
            tiers: [
                { level: 3, name: 'Keen Eye', description: '+5 to Search checks', bonuses: { searchBonus: 5 } },
                { level: 5, name: 'Track Enemies', description: 'Reveal enemy positions', ability: { name: 'Track', apCost: 1 } },
                { level: 7, name: 'Ambush Mastery', description: 'Party acts first in ambushes', effect: { ambushAdvantage: true } }
            ]
        }
    }
};

// --- 2. STATUS EFFECT DEFINITIONS ---
const statusEffectDefinitions = {
    'Dashing': { bonuses: { movementBonus: 2 }, description: 'Movement speed doubled this turn.' },
    'Dodging': { bonuses: { shieldBonus: 2 }, description: 'Attacks against you have disadvantage (+2 Shield Bonus).' },
    'Engulfed': { cannotAct: true, description: 'Engulfed by the cube, taking acid damage.', trigger: 'start', damage: '1d6', saveDC: 13, saveStat: 'str', saveMessage: 'tries to escape the cube!' },
    'Frightened': { cannotAct: true, description: 'Cannot take actions for 1 turn.', trigger: 'end', saveDC: 13, saveStat: 'wis', saveMessage: 'tries to regain their courage!' },
    'Helped': { grantsAdvantageToNextAction: true, consumesOn: 'anyAction', description: 'Your next action has advantage.' },
    'Hunter\'s Mark Ready': { bonuses: { hitBonus: 5 }, consumesOn: 'attack', description: 'Your next attack has +5 to hit.' },
    'Obscured': { bonuses: { shieldBonus: 4 }, description: 'You are obscured by smoke, making you harder to hit (+4 Shield Bonus).' },
    'On Fire': { trigger: 'start', damage: '1d6', description: 'Takes 1d6 damage at the start of their turn.', saveDC: 12, saveStat: 'dex', saveMessage: 'tries to put out the flames!' },
    'Poisoned': { trigger: 'start', damage: '1d4', description: 'Takes 1d4 damage at the start of their turn.' },
    'Power Surge Ready': { bonuses: { hitBonus: 2, damageBonus: 2 }, consumesOn: 'attack', description: 'Your next attack has +2 to hit and +2 damage.' },
    'Raging': { bonuses: { damageBonus: 4 }, description: 'Dealing +4 damage on all attacks this turn.' },
    'Restrained': { cannotAct: true, description: 'Cannot move or take actions.', trigger: 'end', saveDC: 14, saveStat: ['str', 'dex'], saveMessage: 'tries to break free!' },
    'Sneak Attack Ready': { extraDamageDice: '1d6', consumesOn: 'attack', description: 'Your next attack deals an extra 1d6 damage.' },
    'Stunned': { cannotAct: true, description: 'Cannot take actions.', trigger: 'end', saveDC: 13, saveStat: 'con', saveMessage: 'tries to shake off the stun!' },
    'Vulnerable': { grantsAdvantageToNextAttacker: true, consumesOn: 'attacked', description: 'The next attack against this creature has advantage.' },
    'High Ground': { bonuses: {}, description: 'You gain advantage on attacks from elevation.' },
    'Oiled': { description: 'More susceptible to fire damage for a short time.' },
    'Wet': { description: 'Conductive. Lightning deals extra damage briefly.' }
};

// --- 3. ACTION COSTS ---
const actionCosts = {
    briefRespite: 1,
    fullRest: 2,
    guard: 1,
    dash: 1,
    dodge: 1,
    help: 1,
    search: 1,
    move: 0 // Movement is free but limited by movement points
};

// --- 3.5. COMBAT GRID CONFIGURATION ---
const gridConfig = {
    width: 5,
    height: 5,
    baseMovementPoints: 2, // Tiles you can move per turn (increased by Dash)
    adjacentPositions: [
        [-1, -1], [-1, 0], [-1, 1],  // Above row
        [0, -1],           [0, 1],    // Same row
        [1, -1],  [1, 0],  [1, 1]     // Below row
    ],
    rangeCategories: {
        melee: 1,      // Adjacent tiles only
        reach: 2,      // 2 tiles away
        ranged: 4,     // Up to 4 tiles
        spell: 5       // Full grid range
    }
};

// --- 4. NPC DIALOGUE ---
const npcDialogue = {
    dm: {
        playMonster: [
            "From the shadows, a grotesque creature emerges!", "You are not alone. Something scuttles toward you...", "A roar echoes through the chamber as a beast reveals itself!", "The air grows cold as a monster appears before you.", "Disturbing the dust, a creature of nightmare lurches into view.",
        ],
    }
};

// --- 5. RARITY TIERS & MAGICAL AFFIXES (for item generation) ---
const rarityTiers = {
    common: { name: 'Common', color: '#ffffff', weight: 50, affixCount: 0 },
    uncommon: { name: 'Uncommon', color: '#1eff00', weight: 30, affixCount: 1 },
    rare: { name: 'Rare', color: '#0070dd', weight: 15, affixCount: 1 },
    epic: { name: 'Epic', color: '#a335ee', weight: 4, affixCount: 2 },
    legendary: { name: 'Legendary', color: '#ff8000', weight: 1, affixCount: 2 },
    mythic: { name: 'Mythic', color: '#ffd700', weight: 0.4, affixCount: 3 }
};

const magicalAffixes = [
    // Tier 1 (Uncommon)
    { name: 'Hardened', tier: 1, bonuses: { shieldBonus: 1 }, types: ['armor'] },
    { name: 'Vicious', tier: 1, bonuses: { damageBonus: 1 }, types: ['weapon'] },
    { name: 'Agile', tier: 1, bonuses: { dex: 1 }, types: ['weapon', 'armor'] },
    { name: 'Sturdy', tier: 1, bonuses: { con: 1 }, types: ['armor'] },
    { name: 'of Fortitude', tier: 1, bonuses: { maxHp: 5 }, types: ['armor'] },
    { name: 'of Striking', tier: 1, bonuses: { str: 1 }, types: ['weapon'] },
    { name: 'Insightful', tier: 1, bonuses: { wis: 1 }, types: ['armor'] },
    { name: 'Artful', tier: 1, bonuses: { int: 1 }, types: ['weapon', 'armor'] },

    // Tier 2 (Rare)
    { name: 'Reinforced', tier: 2, bonuses: { shieldBonus: 2 }, types: ['armor'] },
    { name: 'Savage', tier: 2, bonuses: { damageBonus: 2 }, types: ['weapon'] },
    { name: 'Swift', tier: 2, bonuses: { ap: 1 }, types: ['weapon', 'armor'] },
    { name: 'of Vigor', tier: 2, bonuses: { maxHp: 10, con: 1 }, types: ['armor'] },
    { name: 'of Ruin', tier: 2, bonuses: { damageBonus: 1, str: 1 }, types: ['weapon'] },
    { name: 'Eloquent', tier: 2, bonuses: { cha: 2 }, types: ['armor'] },
    { name: 'of the Mind', tier: 2, bonuses: { int: 2, wis: 1 }, types: ['armor'] },

    // Tier 3 (Legendary)
    { name: 'Adamant', tier: 3, bonuses: { shieldBonus: 3, con: 1 }, types: ['armor'] },
    { name: 'Bloodthirsty', tier: 3, bonuses: { damageBonus: 3 }, types: ['weapon'] },
    { name: 'of the Titan', tier: 3, bonuses: { maxHp: 15, str: 1, con: 1 }, types: ['armor'] },
    { name: 'of Annihilation', tier: 3, bonuses: { damageBonus: 2, str: 2 }, types: ['weapon'] },
];

// --- 6. CARD DATA ---

// --- 6.1. Weapon Cards ---
const weaponCards = [
    { name: "Axechuck", type: "Weapon", apCost: 1, class: ["Warrior", "Barbarian", "Ranger"], effect: { dice: "1d6", description: "Thrown (20/60), Special: Returning Edge - Returns to hand at end of turn (If thrown and hand free)." } },
    { name: "Balanced Steel", type: "Weapon", apCost: 2, class: ["Warrior", "Rogue", "Ranger"], effect: { dice: "1d8", description: "Versatile (1d10), Special: Guard Breaker - Deals +2 damage to targets with active Shield HP." } },
    { name: "Bolt Sprinter", type: "Weapon", apCost: 2, class: ["Rogue", "Ranger"], effect: { dice: "1d8", description: "Ammunition, Loading, Special: Steady Aim - First attack on next turn deals +1d4 damage (If used Brace action this turn)." } },
    { name: "Bone Thumper", type: "Weapon", apCost: 2, class: ["Barbarian", "Warrior", "Cleric"], effect: { dice: "1d6", description: "Special: Solid Strike - Deal an additional 1 damage (When hitting target with Shield Bonus from armor, not shield)." } },
    { name: "Doomcleaver", type: "Weapon", apCost: 2, class: ["Barbarian", "Warrior"], effect: { dice: "2d6", description: "Two-Handed, Heavy, Special: Savage Chop - Make 1 additional melee attack vs same target on a natural 20 attack roll." } },
    { name: "Duelist's Point", type: "Weapon", apCost: 1, class: ["Rogue", "Warrior"], effect: { dice: "1d8", description: "Finesse, Special: Opening Flourish - The first successful attack against a creature in combat deals +1d4 damage." } },
    { name: "Farstrike Bow", type: "Weapon", apCost: 2, class: ["Ranger", "Warrior"], effect: { dice: "1d8", description: "Ammunition, Heavy, Two-Handed, Special: Piercing Shot - +1 Attack Roll but ignore 1 point of target's Shield Bonus (Ranged, 1/turn)." } },
    { name: "Impact Cleaver", type: "Weapon", apCost: 2, class: ["Barbarian", "Warrior"], effect: { dice: "1d8", description: "Versatile (1d10), Heavy, Special: Momentum Swing - Increase movement speed by 5 ft until end of turn (Versatile hit)." } },
    { name: "Quick Blade", type: "Weapon", apCost: 1, class: ["Rogue", "Ranger"], effect: { dice: "1d6", description: "Finesse, Special: Fluid Motion - Can use Break Away for 0 AP (If make two attacks with this weapon on turn)." } },
    { name: "Shadowtooth", type: "Weapon", apCost: 1, class: ["Rogue"], effect: { dice: "1d4", description: "Finesse, Thrown (20/60), Special: Poison Ready - Advantage on attack roll when applying poison." } },
    { name: "Swiftflight Bow", type: "Weapon", apCost: 2, class: ["Ranger", "Rogue"], effect: { dice: "1d6", description: "Ammunition, Close-Range Penalty (-1d4 damage when attacking Close enemy)" } },
    { name: "Wayfinder's Staff", type: "Weapon", apCost: 2, class: ["Mage", "Cleric", "Ranger"], effect: { dice: "1d6", description: "Versatile (1d8), Special: Deflect - As Reaction, spend 1 AP to gain +2 to Required Roll to Hit vs attacker (Until start of next turn)." } }
];

// --- 6.2. Armor Cards ---
const armorCards = [
    { name: "Arcanist's Weave", type: "Armor", class: ["Any"], effect: { bonuses: { shieldBonus: 2, ap: 2 }, description: "+1 to Magic Resistance." } },
    { name: "Bastion Shield", type: "Armor", class: ["Warrior", "Cleric", "Ranger", "Barbarian"], effect: { bonuses: { shieldBonus: 3, ap: -1 }, description: "Provides cover to adjacent allies." } },
    { name: "Crystal Hide", type: "Armor", class: ["Warrior", "Cleric", "Ranger", "Barbarian"], effect: { bonuses: { shieldBonus: 6, ap: 0 }, description: "Resistance to non-magical damage." } },
    { name: "Earth-Forged Mail", type: "Armor", class: ["Warrior"], effect: { bonuses: { shieldBonus: 7, ap: -1 }, description: "Resistance to Bludgeoning damage." } },
    { name: "Fury Cuirass", type: "Armor", class: ["Warrior", "Barbarian"], effect: { bonuses: { shieldBonus: 6, ap: 1 }, description: "While below half health, gain +1 to attack rolls." } },
    { name: "Hide Vest", type: "Armor", class: ["Any"], effect: { bonuses: { shieldBonus: 2, ap: 1 }, description: "Simple but effective protection made from cured animal hide." } },
    { name: "Indomitable Plating", type: "Armor", class: ["Warrior"], effect: { bonuses: { shieldBonus: 10, ap: -2 }, description: "Ignores the first point of damage from any attack." } },
    { name: "Ironclad Harness", type: "Armor", class: ["Warrior"], effect: { bonuses: { shieldBonus: 8, ap: -1 }, description: "Complete coverage in heavy metal, but restricts movement." } },
    { name: "Link Hauberk", type: "Armor", class: ["Warrior", "Cleric", "Ranger", "Barbarian"], effect: { bonuses: { shieldBonus: 4, ap: 0 }, description: "Interlocking rings provide reliable defense." } },
    { name: "Nightfall Shroud", type: "Armor", class: ["Any"], effect: { bonuses: { shieldBonus: 1, ap: 3 }, description: "Advantage on Stealth checks." } },
    { name: "Phase Shroud", type: "Armor", class: ["Any"], effect: { bonuses: { shieldBonus: 5, ap: 0 }, description: "Once per turn, may force an attacker to reroll their attack roll." } },
    { name: "Plate Cuirass", type: "Armor", class: ["Warrior", "Cleric"], effect: { bonuses: { shieldBonus: 6, ap: 0 }, description: "A sturdy defense for the chest." } },
    { name: "Round Shield", type: "Armor", class: ["Warrior", "Cleric", "Ranger", "Barbarian"], effect: { bonuses: { shieldBonus: 1, ap: 0 }, description: "+1 to Block rolls." } },
    { name: "Scaled Vest", type: "Armor", class: ["Warrior", "Ranger", "Rogue"], effect: { bonuses: { shieldBonus: 5, ap: 0 }, description: "Overlapping plates deflect blows." } },
    { name: "Spellward Plate", type: "Armor", class: ["Warrior"], effect: { bonuses: { shieldBonus: 7, ap: 0 }, description: "+1 to saving throws against spells." } },
    { name: "Spiritweave Robes", type: "Armor", class: ["Mage", "Cleric"], effect: { bonuses: { shieldBonus: 2, ap: 2 }, description: "Resistance to Necrotic damage." } },
    { name: "Sylvan Shroud", type: "Armor", class: ["Ranger", "Rogue"], effect: { bonuses: { shieldBonus: 3, ap: 2 }, description: "Advantage on Dexterity saving throws." } },
    { name: "Thornmail", type: "Armor", class: ["Barbarian"], effect: { bonuses: { shieldBonus: 4, ap: -1 }, description: "Deals 1 damage to attacker on a critical hit against the wearer." } },
    { name: "Toughened Hides", type: "Armor", class: ["Any"], effect: { bonuses: { shieldBonus: 3, ap: 1 }, description: "Resistance to Piercing damage." } },
    { name: "Wyrmscale Mail", type: "Armor", class: ["Warrior"], effect: { bonuses: { shieldBonus: 9, ap: 0 }, description: "Immunity to one type of elemental damage (Fire, Cold, etc.). Player's choice." } }
];

// --- 6.3. Spell Cards ---
const spellCards = [
    // Level 1
    { name: "Acid Burst", type: "Spell", level: 1, apCost: 1, class: ["Mage", "Ranger"], effect: { type: "damage", dice: "1d6", target: "aoe", description: "Deals 1d6 acid damage to each creature in a 5-foot radius sphere at Far range." } },
    { name: "Cinder Shot", type: "Spell", level: 1, apCost: 1, class: ["Mage", "Ranger"], effect: { type: "damage", dice: "1d10", target: "any-monster", description: "Deals 1d10 fire damage at Far range. 33% chance to set the target On Fire.", chanceToApplyStatus: { status: 'On Fire', chance: 0.33 } } },
    { name: "Flame Fan", type: "Spell", level: 1, apCost: 1, class: ["Mage"], effect: { type: "damage", dice: "3d6", target: "aoe", description: "Deals 3d6 fire damage in a 15-foot cone. (DEX save DC 13 for half). 25% chance to set targets On Fire.", chanceToApplyStatus: { status: 'On Fire', chance: 0.25 } } },
    { name: "Force Barrier", type: "Spell", level: 1, apCost: 1, class: ["Mage"], effect: { type: "buff", bonuses: { shieldBonus: 5 }, duration: 2, target: "self", description: "Increase your Shield Points by 5 until the start of your next turn." } },
    { name: "Force Darts", type: "Spell", level: 1, apCost: 1, class: ["Mage"], effect: { type: "damage", dice: "1d4+1", target: "multi-monster", description: "Deals 1d4+1 force damage to up to three targets at Far range." } },
    { name: "Frost Beam", type: "Spell", level: 1, apCost: 1, class: ["Mage", "Ranger"], effect: { type: "damage", dice: "1d8", status: "Slowed", duration: 2, target: "any-monster", description: "Deals 1d8 cold damage and reduces target's speed by 10 feet until the start of your next turn." } },
    { name: "Grasping Vines", type: "Spell", level: 1, apCost: 1, class: ["Ranger"], effect: { type: "control", status: "Restrained", duration: 2, target: "aoe", description: "Restrains creatures in a 20-foot square at Far range. (STR save DC 13)." } },
    { name: "Healing Touch", type: "Spell", level: 1, apCost: 1, class: ["Cleric", "Ranger"], effect: { type: "heal", dice: "1d8+5", target: "any-player", description: "Heals a creature you touch for 1d8+5 HP." } },
    { name: "Illumination", type: "Spell", level: 1, apCost: 0, class: ["Mage", "Cleric", "Ranger"], effect: { type: "utility", utilityType: "light", description: "An object you touch emits bright light in a 20-foot radius and dim light for an additional 20 feet. The light lasts for 10 minutes." } },
    { name: "Drench", type: "Spell", level: 1, apCost: 1, class: ["Mage", "Ranger"], effect: { type: 'utility', status: 'Wet', target: 'any-monster', description: 'Soak a target, making it conductive for lightning.' } },
    { name: "Water Jet", type: "Spell", level: 1, apCost: 1, class: ["Mage"], effect: { type: 'control', status: 'Wet', target: 'aoe', description: 'Blast an area with water.' } },
    { name: "Inspire Allies", type: "Spell", level: 1, apCost: 1, class: ["Cleric", "Ranger"], effect: { type: "buff", dice: "1d4", duration: 2, target: "party", description: "Up to three creatures gain 1d4 bonus to attack rolls and saving throws for 1 minute." } },
    { name: "Jolt Touch", type: "Spell", level: 1, apCost: 1, class: ["Mage"], effect: { type: "damage", dice: "1d8", status: "Stunned", duration: 2, target: "any-monster", description: "Deals 1d8 lightning damage. Target can't take reactions until the start of its next turn." } },
    { name: "Obscuring Mist", type: "Spell", level: 1, apCost: 1, class: ["Mage", "Ranger"], effect: { type: "utility", utilityType: "field_effect", description: "Creates a 20-foot radius sphere of fog centered on a point within range. The sphere spreads around corners, and its area is heavily obscured. It lasts for 1 minute or until a wind of moderate or greater speed disperses it." } },
    { name: "Radiant Strike", type: "Spell", level: 1, apCost: 1, class: ["Cleric"], effect: { type: "damage", dice: "4d6", target: "any-monster", description: "Deals 4d6 radiant damage. The next attack roll against the target has advantage." } },
    { name: "Restore Form", type: "Spell", level: 1, apCost: 0, class: ["Mage", "Cleric", "Ranger"], effect: { type: "utility", utilityType: "repair", description: "This spell repairs a single break or tear in an object you touch, such as a broken chain link, two halves of a broken key, a torn cloak, or a leaking wineskin." } },
    { name: "Shockwave", type: "Spell", level: 1, apCost: 1, class: ["Mage", "Ranger"], effect: { type: "damage", dice: "2d8", target: "aoe", description: "Deals 2d8 thunder damage in a 15-foot cube and pushes creatures 10 feet away. (CON save DC 13)." } },
    { name: "Skill Boon", type: "Spell", level: 1, apCost: 1, class: ["Cleric", "Ranger"], effect: { type: "buff", dice: "1d4", duration: 2, target: "any-player", description: "Target gains 1d4 bonus to one ability check for 1 minute." } },
    { name: "Slumber Wave", type: "Spell", level: 1, apCost: 1, class: ["Mage"], effect: { type: "control", description: "Up to 5d8 hit points of creatures at Far range fall unconscious for 1 minute." } },
    { name: "Toxic Cloud", type: "Spell", level: 1, apCost: 1, class: ["Mage", "Ranger"], effect: { type: "damage", dice: "1d12", target: "any-monster", description: "Deals 1d12 poison damage at Close range. (CON save DC 13)." } },
    { name: "Warding Touch", type: "Spell", level: 1, apCost: 1, class: ["Mage", "Cleric", "Ranger"], effect: { type: "buff", dice: "1d4", duration: 2, target: "any-player", description: "Target gains 1d4 bonus to one saving throw for 1 minute." } },
    // Level 2
    { name: "Illusory Doubles", type: "Spell", level: 2, apCost: 2, class: ["Mage"], effect: { type: "buff", description: "Creates three illusory duplicates of yourself for 10 minutes." } },
    { name: "Immobilize Foe", type: "Spell", level: 2, apCost: 2, class: ["Mage", "Cleric"], effect: { type: "control", status: "Paralyzed", duration: 2, target: "any-monster", description: "A humanoid must make a Wisdom saving throw (DC 13) or be paralyzed for 1 minute." } },
    { name: "Inferno Rays", type: "Spell", level: 2, apCost: 2, class: ["Mage"], effect: { type: "damage", dice: "2d6", target: "multi-monster", description: "You create three rays of fire, each dealing 2d6 fire damage." } },
    { name: "Lunar Ray", type: "Spell", level: 2, apCost: 2, class: ["Cleric", "Ranger"], effect: { type: "damage", dice: "2d10", target: "aoe", description: "A beam of light deals 2d10 radiant damage to any creature that enters it or starts its turn there for 1 minute." } },
    { name: "Mind Scan", type: "Spell", level: 2, apCost: 2, class: ["Mage"], effect: { type: "utility", utilityType: "information", description: "Allows you to read the surface thoughts of creatures within 30 feet for 1 minute." } },
    { name: "Sonic Burst", type: "Spell", level: 2, apCost: 2, class: ["Mage", "Ranger"], effect: { type: "damage", dice: "3d8", target: "aoe", description: "Deals 3d8 thunder damage in a 10-foot radius sphere. (CON save DC 14 for half)." } },
    { name: "Sticky Webbing", type: "Spell", level: 2, apCost: 2, class: ["Mage", "Ranger"], effect: { type: "control", status: "Restrained", duration: 3, target: "aoe", description: "Creates a large mass of thick, sticky webbing. Creatures in the webs are restrained." } },
    { name: "Umbral Sphere", type: "Spell", level: 2, apCost: 2, class: ["Mage"], effect: { type: "utility", utilityType: "field_effect", description: "A 15-foot radius sphere of magical darkness extends from a point you choose. The darkness spreads around corners. A creature with darkvision can't see through this darkness, and nonmagical light can't illuminate it. It lasts for 10 minutes." } },
    { name: "Vanish", type: "Spell", level: 2, apCost: 2, class: ["Mage", "Ranger"], effect: { type: "buff", status: "Invisible", duration: 3, target: "any-player", description: "Makes a creature invisible for up to 1 hour." } },
    { name: "Wind Blast", type: "Spell", level: 2, apCost: 2, class: ["Ranger"], effect: { type: "control", description: "Blows a 60-foot line of wind, pushing creatures 15 feet. (STR save DC 13)." } },
    // Level 3
    { name: "Abolish Magic", type: "Spell", level: 3, apCost: 3, class: ["Mage", "Cleric"], effect: { type: "utility", utilityType: "dispelling", description: "Ends one spell on a creature or object." } },
    { name: "Accelerate", type: "Spell", level: 3, apCost: 3, class: ["Mage"], effect: { type: "buff", description: "A creature gains increased speed, +2 to AC, advantage on DEX saves, and one extra action for 1 minute." } },
    { name: "Aquatic Adaptation", type: "Spell", level: 3, apCost: 3, class: ["Cleric", "Ranger"], effect: { type: "buff", description: "Gives creatures the ability to breathe underwater for 24 hours." } },
    { name: "Captivating Display", type: "Spell", level: 3, apCost: 3, class: ["Mage", "Cleric"], effect: { type: "control", status: "Charmed", duration: 2, target: "aoe", description: "Creatures in a 30-foot cube become charmed if they fail a WIS save (DC 14) for 1 minute." } },
    { name: "Decelerate", type: "Spell", level: 3, apCost: 3, class: ["Mage"], effect: { type: "debuff", description: "Up to six creatures have their speed halved, -2 to AC, and limited actions for 1 minute." } },
    { name: "Inferno Sphere", type: "Spell", level: 3, apCost: 3, class: ["Mage"], effect: { type: "damage", dice: "6d6", target: "aoe", description: "Deals 6d6 fire damage in a 20-foot radius sphere. (DEX save DC 15 for half)." } },
    { name: "Life Transfer", type: "Spell", level: 3, apCost: 3, class: ["Cleric"], effect: { type: "heal", description: "You take 4d8 necrotic damage, and one creature you touch regains twice that amount of hit points." } },
    { name: "Thunder Stroke", type: "Spell", level: 3, apCost: 3, class: ["Cleric", "Ranger"], effect: { type: "damage", dice: "6d6", target: "any-monster", description: "Deals 6d6 lightning damage. If the target is a construct, it has disadvantage on attack rolls for 1 minute." } },
    { name: "Revivify", type: "Spell", level: 3, apCost: 3, class: ["Cleric"], effect: { type: "heal", description: "You touch a creature that has died within the last minute. That creature returns to life with 1 hit point." } },
    { name: "Wall of Air", type: "Spell", level: 3, apCost: 3, class: ["Mage", "Ranger"], effect: { type: "utility", utilityType: "field_effect", description: "Creates an invisible wall of wind. Ranged weapon attacks that pass through the wall are made with disadvantage." } }
];

// --- 6.4. Item Cards (Consumables & Utility) ---
const itemCards = [
    { name: "Healing Potion", type: "Consumable", category: "Potion", apCost: 1, effect: { type: "heal", dice: "2d4+2", target: "self", description: "Heals you for 2d4+2 HP." } },
    { name: "Oil Flask", type: "Consumable", category: "Utility", apCost: 1, effect: { type: 'utility', status: 'Oiled', duration: 3, target: 'any-monster', description: 'Coat a target in oil, making them vulnerable to fire.' } },
    { name: "Grease Bomb", type: "Consumable", category: "Utility", apCost: 1, effect: { type: 'control', status: 'Oiled', target: 'aoe', description: 'Splash nearby enemies with oil.' } },
    { name: "Greater Healing Potion", type: "Consumable", category: "Potion", apCost: 1, effect: { type: "heal", dice: "4d4+4", target: "self", description: "Heals you for 4d4+4 HP." } },
    { name: "Antidote", type: "Consumable", category: "Potion", apCost: 1, effect: { type: "utility", status: "Cure Poison", target: "self", description: "Cures the Poisoned condition." } },
    { name: "Smokebomb", type: "Consumable", category: "Utility", apCost: 1, effect: { type: 'buff', status: 'Obscured', duration: 2, target: 'self', description: 'Creates a cloud of smoke. You become Obscured for 1 round, making you harder to hit.' } },
    { name: "Alchemist's Fire", type: "Consumable", category: "Damage", apCost: 1, effect: { type: "damage", dice: "1d4", status: "On Fire", target: "any-monster", description: "Deals 1d4 fire damage and the target is set On Fire." } },
    { name: "Tanglefoot Bag", type: "Consumable", category: "Utility", apCost: 1, effect: { type: "control", status: "Restrained", duration: 1, target: "any-monster", description: "Restrains a target for 1 turn." } },
    { name: "Scroll of Protection", type: "Consumable", category: "Scroll", apCost: 1, effect: { type: 'utility', utilityType: 'add_shield_hp', value: 5, target: "self", description: "Grants 5 temporary Shield HP for 1 round." } },
    { name: "Lockpicks", type: "Item", category: "Utility", apCost: 0, relevantSkill: "dex", effect: { type: "utility", grantsAdvantage: true, description: "Grants advantage on skill checks to disarm traps or open locks." } }
];

// --- 6.5. Event Cards ---
const worldEventCards = [
    { name: "Magical Disturbance", type: "World Event", duration: 2, description: "All spells cast cost 1 additional AP." },
    { name: "Blood Moon", type: "World Event", duration: 3, description: "All monsters deal +2 damage." },
    { name: "Sudden Growth", type: "World Event", duration: 2, description: "All healing is doubled." },
    { name: "Crumbling Dungeon", type: "World Event", eventType: 'skill_challenge', duration: 1, 
      stages: [
          { description: "The ceiling begins to collapse! The party must make a DEX check to find cover.", dc: 14, skill: 'dex', 
            success: { type: 'none', text: "The party finds a safe spot just in time!" }, 
            failure: { type: 'aoe_damage', value: '1d6', text: "Falling debris hits all monsters!" } }
      ]
    },
    // New events to expand content
    { name: "Mysterious Fog", type: "World Event", duration: 2, description: "Visibility fades. Ranged attacks have -2 to hit." },
    { name: "Echoing Chants", type: "World Event", duration: 3, description: "Allies feel invigorated. +1 AP to the party this turn." },
    { name: "Cursed Ground", type: "World Event", duration: 2, description: "At end of each turn, each player makes a CON save (DC 12) or takes 1 damage." },
    { name: "Wild Surge", type: "World Event", duration: 1, description: "On spell cast, roll 1d4: 1) +2 dmg, 2) -2 dmg, 3) target random enemy, 4) refund 1 AP." }
];

const environmentalCards = [
    { name: "Trapped Chest", type: "Environmental", description: "A large, tempting chest sits in the corner. It might be trapped.", 
      skillInteractions: [
          { name: 'Disarm Trap', apCost: 1, eventType: 'multi_stage_skill_challenge', stages: [
              { description: "First, you must inspect the lock for any hidden mechanisms. (WIS)", dc: 13, skill: 'wis', 
                success: { type: 'none', text: "You spot a hidden needle mechanism." },
                failure: { type: 'self_damage', value: '1d4', text: "You prick your finger on a poisoned needle!" } },
              { description: "Now, carefully use your tools to disable the trap. (DEX)", dc: 15, skill: 'dex', 
                success: { type: 'loot', text: "Success! The chest clicks open, revealing its contents." },
                failure: { type: 'self_damage', value: '1d8', text: "A small explosion goes off in your face!" } }
          ]},
          { name: 'Smash It', apCost: 2, skill: 'str', dc: 16, 
            success: { type: 'loot', text: "You break the chest open, revealing its contents!" },
            failure: { type: 'self_damage', value: '1d6', text: "You smash the chest, but also the fragile potion that was inside." }
          }
      ]
    },
];

const partyEventCards = []; // Future expansion

// --- 7. MONSTER DATA ---
const allMonsters = [
    { name: "Goblin Archer", type: "Monster", maxHp: 12, attackBonus: 4, requiredRollToHit: 13, effect: { dice: "1d6+2" }, xpValue: 10, stats: { str: 1, dex: 3, con: 1, int: 0, wis: 1, cha: 0 } },
    { name: "Dire Wolf", type: "Monster", maxHp: 20, attackBonus: 5, requiredRollToHit: 14, effect: { dice: "2d6+3" }, xpValue: 15, stats: { str: 3, dex: 2, con: 2, int: 0, wis: 1, cha: 0 } },
    { name: "Giant Spider", type: "Monster", maxHp: 18, attackBonus: 3, requiredRollToHit: 12, effect: { dice: "1d8+1", description: "On hit, target must succeed a DC 11 CON save or be Poisoned." }, xpValue: 12, stats: { str: 2, dex: 3, con: 2, int: 0, wis: 0, cha: 0 } },
    { name: "Orc Brute", type: "Monster", maxHp: 25, attackBonus: 5, requiredRollToHit: 15, effect: { dice: "2d8+3" }, xpValue: 20, stats: { str: 4, dex: 1, con: 3, int: 0, wis: 0, cha: 1 } },
    { name: "Hobgoblin Soldier", type: "Monster", maxHp: 22, attackBonus: 4, requiredRollToHit: 16, effect: { dice: "1d10+2" }, xpValue: 18, stats: { str: 3, dex: 2, con: 2, int: 1, wis: 1, cha: 1 } },
    { name: "Gelatinous Cube", type: "Monster", maxHp: 40, attackBonus: 4, requiredRollToHit: 12, effect: { dice: "2d6", description: "On hit, the target is Engulfed." }, xpValue: 30, stats: { str: 2, dex: 0, con: 4, int: 0, wis: 0, cha: 0 } },
    { name: "Skeleton Guard", type: "Monster", maxHp: 15, attackBonus: 2, requiredRollToHit: 13, effect: { dice: "1d6" }, xpValue: 8, stats: { str: 1, dex: 2, con: 1, int: 0, wis: 0, cha: 0 } },
    { name: "Cave Bear", type: "Monster", maxHp: 30, attackBonus: 6, requiredRollToHit: 14, effect: { dice: "2d10+4" }, xpValue: 25, stats: { str: 4, dex: 1, con: 3, int: 0, wis: 1, cha: 0 } },
    { name: "Stone Golem", type: "Monster", maxHp: 50, attackBonus: 6, requiredRollToHit: 17, effect: { dice: "3d8+4" }, xpValue: 50, isBoss: true, stats: { str: 5, dex: 0, con: 5, int: 0, wis: 0, cha: 0 } },
    { name: "Lich Apprentice", type: "Monster", maxHp: 45, attackBonus: 5, requiredRollToHit: 14, effect: { dice: "3d6", description: "On hit, casts a random level 1 spell on the target." }, xpValue: 60, isBoss: true,
      stats: { str: 1, dex: 2, con: 2, int: 4, wis: 3, cha: 2 },
      abilities: [
          { name: "Ray of Sickness", type: 'damage', dice: '2d8', cooldown: 3, description: 'Fires a sickening green ray.' },
          { name: "Paralyzing Touch", type: 'control', status: 'Stunned', duration: 2, cooldown: 4, description: 'Touches a target to stun them.' }
      ]
    }
];

// --- 7.2. Monster Tiers ---
const monsterTiers = {
    tier1: allMonsters.filter(m => m.maxHp <= 25 && !m.isBoss),
    tier2: allMonsters.filter(m => m.maxHp > 25 && m.maxHp <= 45 && !m.isBoss),
    tier3: allMonsters.filter(m => m.isBoss),
};

// --- 7.5. DYNAMIC DUNGEON EVENTS ---
const dungeonEvents = {
    ambushes: [
        { name: 'Goblin Ambush', description: 'Goblins attack from the shadows!', enemies: ['Goblin', 'Goblin'], surprise: true },
        { name: 'Wolf Pack', description: 'A pack of wolves surrounds you!', enemies: ['Wolf', 'Wolf', 'Wolf'], surprise: true },
        { name: 'Bandit Crossfire', description: 'Arrows rain from cover!', enemies: ['Goblin Archer', 'Goblin Archer'], surprise: true }
    ],
    traps: [
        { name: 'Spike Trap', description: 'Sharp spikes spring from the floor!', saveStat: 'dex', saveDC: 13, damage: '2d6', trapType: 'damage' },
        { name: 'Pit Trap', description: 'The floor gives way beneath you!', saveStat: 'str', saveDC: 14, damage: '1d10', fallDamage: true },
        { name: 'Gas Trap', description: 'Poisonous gas fills the room!', saveStat: 'con', saveDC: 12, damage: '1d6', status: 'Poisoned', duration: 3 },
        { name: 'Swinging Axe', description: 'Timing is everything...', saveStat: 'dex', saveDC: 15, damage: '2d8' }
    ],
    puzzles: [
        { name: 'Ancient Riddle', description: 'An ancient inscription poses a riddle...', solveStat: 'int', solveDC: 14, reward: 'epic_item' },
        { name: 'Lock Puzzle', description: 'A complex lock blocks your path.', solveStat: 'dex', solveDC: 13, reward: 'treasure' },
        { name: 'Mystical Runes', description: 'Glowing runes pulse with magic.', solveStat: 'wis', solveDC: 15, reward: 'spell' },
        { name: 'Illusion Door', description: 'Which door is real?', solveStat: 'int', solveDC: 12, reward: 'rare_item' }
    ],
    npcs: [
        { name: 'Wandering Merchant', description: 'A merchant offers his wares.', interaction: 'trade', priceModifier: 0.8 },
        { name: 'Injured Adventurer', description: 'An injured adventurer needs help.', interaction: 'rescue', reward: 'ally' },
        { name: 'Mysterious Stranger', description: 'A hooded figure watches you...', interaction: 'quest', reward: 'special' },
        { name: 'Treasure Map Seller', description: 'Sells a map to a secret room.', interaction: 'trade', priceModifier: 1.2 }
    ],
    hazards: [
        { name: 'Collapsing Ceiling', description: 'The ceiling begins to crumble!', saveStat: 'dex', saveDC: 13, damage: '3d6', aoe: true },
        { name: 'Flooding Room', description: 'Water rushes in from all sides!', saveStat: 'str', saveDC: 14, damage: '2d6', duration: 3 },
        { name: 'Spreading Fire', description: 'Flames spread across the floor!', saveStat: 'dex', saveDC: 12, damage: '1d6', status: 'On Fire', duration: 2 },
        { name: 'Poison Spores', description: 'A cloud of spores descends.', saveStat: 'con', saveDC: 13, damage: '1d8', status: 'Poisoned', duration: 2 }
    ]
};


// --- SYNERGY SYSTEM (Phase 3) ---
const synergies = {
    // Action Synergies
    coordinatedStrike: {
        name: 'Coordinated Strike',
        description: 'Help + Attack from ally grants bonus damage',
        triggers: ['help_ally', 'attack_within_1_turn'],
        bonus: { damageBonus: 3 },
        icon: 'swords'
    },
    charge: {
        name: 'Charge',
        description: 'Dash + Attack in same turn deals extra damage',
        triggers: ['dash_self', 'attack_same_turn'],
        bonus: { damageBonus: 2 },
        icon: 'sprint'
    },
    fortifiedRest: {
        name: 'Fortified Rest',
        description: 'Guard + Rest heals for double',
        triggers: ['guard_self', 'rest_same_turn'],
        bonus: { healingMultiplier: 2 },
        icon: 'healing'
    },
    dodgeCounter: {
        name: 'Dodge Counter',
        description: 'Dodging grants free attack on next attacker',
        triggers: ['dodge_self', 'attacked_within_1_turn'],
        bonus: { freeAttack: true },
        icon: 'counter'
    },
    
    // Position Synergies
    flankingCritical: {
        name: 'Devastating Blow',
        description: 'Flanking + Critical hit deals triple damage',
        triggers: ['flanking', 'critical_hit'],
        bonus: { critMultiplier: 3 },
        icon: 'emergency'
    },
    backToBack: {
        name: 'Shield Wall',
        description: 'Adjacent allies gain +2 shield',
        triggers: ['adjacent_ally'],
        bonus: { shieldBonus: 2 },
        icon: 'shield'
    },
    surrounded: {
        name: 'Desperate Fury',
        description: 'Surrounded by 3+ enemies grants +1 AP',
        triggers: ['surrounded_3_enemies'],
        bonus: { apBonus: 1 },
        icon: 'crisis_alert'
    },
    
    // Class Synergies
    battleBlessing: {
        name: 'Battle Blessing',
        description: 'Cleric healing Barbarian grants damage bonus',
        triggers: ['cleric_heal', 'barbarian_target'],
        bonus: { damageBonus: 2, duration: 2 },
        icon: 'volunteer_activism'
    },
    arcaneAmbush: {
        name: 'Arcane Ambush',
        description: 'Mage + Rogue attacking same target grants crit chance',
        triggers: ['mage_attack', 'rogue_attack_same_target'],
        bonus: { critChance: 20 },
        icon: 'magic_exchange'
    },
    
    // Ability Chain Synergies
    ragingCharge: {
        name: 'Raging Charge',
        description: 'Rage + Dash + Attack devastating combo',
        triggers: ['rage_ability', 'dash_same_turn', 'attack_same_turn'],
        bonus: { damageBonus: 6 },
        icon: 'fitness_center'
    },
    sneakyCritical: {
        name: 'Assassinate',
        description: 'Sneak Attack + Critical Hit = Massive damage',
        triggers: ['sneak_attack_ability', 'critical_hit'],
        bonus: { damageMultiplier: 2.5 },
        icon: 'dangerous'
    },
    elementCombustion: {
        name: 'Combustion',
        description: 'Oil then Fire ignites for bonus damage',
        triggers: ['oil_applied', 'fire_spell'],
        bonus: { damageBonus: 4 },
        icon: 'local_fire_department'
    },
    electrocute: {
        name: 'Electrocute',
        description: 'Water then Lightning shocks for bonus damage',
        triggers: ['water_applied', 'lightning_spell'],
        bonus: { damageBonus: 3 },
        icon: 'bolt'
    }
};

// --- ACHIEVEMENT SYSTEM (Phase 4) ---
const achievements = {
    firstBlood: { id: 'firstBlood', name: 'First Blood', description: 'Defeat your first monster', icon: 'swords', reward: { essence: 10 }, condition: { type: 'monstersDefeated', value: 1 } },
    slayer: { id: 'slayer', name: 'Monster Slayer', description: 'Defeat 50 monsters', icon: 'skull', reward: { essence: 50 }, condition: { type: 'monstersDefeated', value: 50 } },
    legendary: { id: 'legendary', name: 'Legendary Hunter', description: 'Find 5 legendary items', icon: 'diamond', reward: { essence: 100 }, condition: { type: 'legendaryItemsFound', value: 5 } },
    tactician: { id: 'tactician', name: 'Tactician', description: 'Trigger 10 synergies', icon: 'auto_awesome', reward: { essence: 25 }, condition: { type: 'synergiesTriggered', value: 10 } },
    masterFlanker: { id: 'masterFlanker', name: 'Master Flanker', description: 'Get 50 flanking bonuses', icon: 'target', reward: { essence: 75 }, condition: { type: 'flankingBonuses', value: 50 } },
    specialist: { id: 'specialist', name: 'Specialist', description: 'Unlock all specs for one class', icon: 'emoji_events', reward: { essence: 200 }, condition: { type: 'allSpecsOneClass', value: true } },
    survivor: { id: 'survivor', name: 'Survivor', description: 'Complete 10 dungeons', icon: 'shield_person', reward: { essence: 100 }, condition: { type: 'dungeonsCompleted', value: 10 } },
    bossSlayer: { id: 'bossSlayer', name: 'Boss Slayer', description: 'Defeat your first boss', icon: 'castle', reward: { essence: 200 }, condition: { type: 'bossesDefeated', value: 1 } },
    teamPlayer: { id: 'teamPlayer', name: 'Team Player', description: 'Complete 5 multiplayer runs', icon: 'groups', reward: { essence: 75 }, condition: { type: 'multiplayerRuns', value: 5 } },
    speedRunner: { id: 'speedRunner', name: 'Speed Runner', description: 'Complete dungeon in under 15 minutes', icon: 'speed', reward: { essence: 150 }, condition: { type: 'speedRun', value: 900 } }
};

// Meta-Progression Perks (Phase 4)
const metaPerks = {
    startingGold: { id: 'startingGold', name: 'Wealthy Start', description: 'Start with +50 gold', icon: 'paid', cost: 50, tier: 1, effect: { startingGold: 50 } },
    extraHp: { id: 'extraHp', name: 'Vitality', description: 'Start with +5 max HP', icon: 'favorite', cost: 50, tier: 1, effect: { startingHp: 5 } },
    luckyStart: { id: 'luckyStart', name: 'Lucky Charm', description: '+5% loot rarity', icon: 'casino', cost: 50, tier: 1, effect: { lootRarityBonus: 0.05 } },
    fastLearner: { id: 'fastLearner', name: 'Fast Learner', description: '+10% XP gain', icon: 'school', cost: 100, tier: 2, effect: { xpMultiplier: 1.1 } },
    combatant: { id: 'combatant', name: 'Combat Training', description: '+1 damage', icon: 'swords', cost: 100, tier: 2, effect: { damageBonus: 1 } },
    masterTactician: { id: 'masterTactician', name: 'Master Tactician', description: 'Synergies +50% stronger', icon: 'psychology', cost: 200, tier: 3, effect: { synergyBonus: 0.5 } },
    criticalExpert: { id: 'criticalExpert', name: 'Critical Expert', description: '+5% crit chance', icon: 'emergency', cost: 200, tier: 3, effect: { critChance: 0.05 } }
};

// Boss Encounters (Phase 4)
const bosses = {
    gorehowl: { id: 'gorehowl', name: 'Gorehowl the Berserker', tier: 1, hp: 150, damage: '2d8+5', abilities: ['Rage', 'Cleave'], loot: 'epic', essence: 100 },
    frostmaw: { id: 'frostmaw', name: 'Frostmaw the Ancient', tier: 2, hp: 250, damage: '3d6+8', abilities: ['Ice Breath', 'Freeze'], loot: 'legendary', essence: 200 },
    lichKing: { id: 'lichKing', name: 'The Lich King', tier: 2, hp: 200, damage: '2d10+6', abilities: ['Summon Undead', 'Death Touch'], loot: 'legendary', essence: 200 },
    titanforge: { id: 'titanforge', name: 'Titanforge Golem', tier: 3, hp: 350, damage: '4d6+10', abilities: ['Armor Shell', 'Ground Slam'], loot: 'legendary', essence: 300 },
    shadowblade: { id: 'shadowblade', name: 'Shadowblade Assassin', tier: 3, hp: 180, damage: '5d4+12', abilities: ['Shadow Step', 'Backstab'], loot: 'legendary', essence: 250 }
};

module.exports = {
    classes,
    specializations,
    statusEffectDefinitions,
    actionCosts,
    gridConfig,
    npcDialogue,
    rarityTiers,
    magicalAffixes,
    weaponCards,
    armorCards,
    spellCards,
    itemCards,
    worldEventCards,
    environmentalCards,
    partyEventCards,
    monsterTiers,
    dungeonEvents,
    synergies,
    achievements,
    metaPerks,
    bosses
};