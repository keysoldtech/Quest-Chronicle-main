// Offline Solo Game Engine - Client-Side Game Logic for Offline Play
// This enables playing Quest & Chronicle without a server connection
// Fully functional on all platforms: Windows, macOS, Linux, Android, iOS

class OfflineGameEngine {
    constructor() {
        this.gameState = null;
        this.playerId = 'offline-player';
        this.isOfflineMode = false;
        this.autoSaveInterval = null;
        this.monstersKilled = 0;
        this.godMode = false;
    }

    // Initialize offline solo game
    startOfflineGame(playerName, gameMode = 'Easy', playerClass) {
        this.isOfflineMode = true;
        this.monstersKilled = 0;
        
        const difficulty = {
            'Easy': { monsterHpMult: 0.8, monsterDamageMult: 0.8, playerStartingHp: 1.2 },
            'Normal': { monsterHpMult: 1.0, monsterDamageMult: 1.0, playerStartingHp: 1.0 },
            'Hard': { monsterHpMult: 1.3, monsterDamageMult: 1.2, playerStartingHp: 0.9 }
        };
        
        const diff = difficulty[gameMode] || difficulty['Normal'];
        
        this.gameState = {
            roomId: 'offline-room',
            phase: 'playing',
            gameMode: gameMode,
            difficulty: diff,
            turnCount: 0,
            currentPlayerIndex: 0,
            turnOrder: [this.playerId],
            winner: null,
            monstersKilled: 0,
            players: {
                [this.playerId]: {
                    id: this.playerId,
                    name: playerName,
                    class: playerClass,
                    role: 'Explorer',
                    isNpc: false,
                    currentAp: 3,
                    maxAp: 3,
                    usedAbilityThisTurn: false,
                    pendingAction: null,
                    isDowned: false,
                    level: 1,
                    stats: this.getClassStats(playerClass, diff.playerStartingHp),
                    hand: [],
                    equipment: { weapon: null, armor: null },
                    statusEffects: []
                }
            },
            board: {
                monsters: [],
                environment: []
            },
            grid: {
                width: 5,
                height: 5,
                entities: {}
            },
            lootPool: [],
            chatLog: [
                { type: 'system', text: `Welcome to Offline Solo Mode!`, timestamp: Date.now() },
                { type: 'system', text: `Difficulty: ${gameMode}`, timestamp: Date.now() },
                { type: 'system', text: `Playing as ${playerClass}. Good luck!`, timestamp: Date.now() }
            ],
            partyHope: 5,
            worldEvents: { currentEvent: null, duration: 0 },
            lastSave: Date.now()
        };

        // Give starting equipment
        this.giveStartingEquipment();
        
        // Spawn first monster
        this.spawnMonster();
        
        // Start auto-save
        this.startAutoSave();
        
        // Initialize dev tools
        this.initializeDevTools();
        
        return this.gameState;
    }

    getClassStats(className, hpMultiplier = 1.0) {
        const classData = {
            Barbarian: { str: 4, dex: 2, con: 4, int: 0, wis: 0, cha: 1, baseMaxHp: 20, ac: 10, shieldBonus: 0, shieldHp: 0 },
            Cleric: { str: 2, dex: 0, con: 3, int: 1, wis: 4, cha: 2, baseMaxHp: 18, ac: 11, shieldBonus: 1, shieldHp: 0 },
            Mage: { str: 0, dex: 2, con: 2, int: 5, wis: 2, cha: 1, baseMaxHp: 15, ac: 10, shieldBonus: 0, shieldHp: 0 },
            Ranger: { str: 1, dex: 4, con: 3, int: 1, wis: 3, cha: 0, baseMaxHp: 18, ac: 11, shieldBonus: 1, shieldHp: 0 },
            Rogue: { str: 1, dex: 5, con: 2, int: 2, wis: 0, cha: 3, baseMaxHp: 16, ac: 10, shieldBonus: 0, shieldHp: 0 },
            Warrior: { str: 5, dex: 1, con: 4, int: 0, wis: 1, cha: 1, baseMaxHp: 20, ac: 11, shieldBonus: 1, shieldHp: 0 }
        };
        
        const stats = { ...classData[className] };
        const maxHp = Math.floor(stats.baseMaxHp * hpMultiplier);
        
        return { 
            ...stats, 
            maxHp, 
            currentHp: maxHp, 
            damageBonus: 0, 
            xp: 0, 
            level: 1 
        };
    }

    giveStartingEquipment() {
        const player = this.gameState.players[this.playerId];
        
        player.equipment = player.equipment || { weapon: null, armor: null };
        
        player.equipment.weapon = {
            id: 'starter-weapon',
            name: 'Iron Sword',
            type: 'Weapon',
            apCost: 1,
            effect: { dice: '1d6', description: 'A basic weapon.' }
        };
        
        player.equipment.armor = {
            id: 'starter-armor',
            name: 'Leather Armor',
            type: 'Armor',
            effect: { bonuses: { shieldBonus: 1 }, description: 'Basic protection.' }
        };
        
        player.stats.shieldBonus = 1;
        
        player.hand.push({
            id: 'potion-1',
            name: 'Healing Potion',
            type: 'Consumable',
            category: 'Potion',
            apCost: 1,
            effect: { type: 'heal', dice: '2d4+2', target: 'self', description: 'Heals you for 2d4+2 HP.' }
        });
    }

    // Monster templates aligned with server-side allMonsters from game-data.js
    static MONSTER_TEMPLATES = {
        tier1: [
            { name: 'Goblin Archer', maxHp: 12, attackBonus: 4, requiredRollToHit: 13, damage: '1d6+2', xpValue: 10, stats: { str: 1, dex: 3, con: 1, int: 0, wis: 1, cha: 0 } },
            { name: 'Skeleton Guard', maxHp: 15, attackBonus: 2, requiredRollToHit: 13, damage: '1d6', xpValue: 8, stats: { str: 1, dex: 2, con: 1, int: 0, wis: 0, cha: 0 } },
            { name: 'Giant Spider', maxHp: 18, attackBonus: 3, requiredRollToHit: 12, damage: '1d8+1', xpValue: 12, stats: { str: 2, dex: 3, con: 2, int: 0, wis: 0, cha: 0 },
                specialAbilities: [{ name: 'Venomous Bite', type: 'status', status: 'Poisoned', duration: 2 }] },
            { name: 'Dire Wolf', maxHp: 20, attackBonus: 5, requiredRollToHit: 14, damage: '2d6+3', xpValue: 15, stats: { str: 3, dex: 2, con: 2, int: 0, wis: 1, cha: 0 } },
            { name: 'Hobgoblin Soldier', maxHp: 22, attackBonus: 4, requiredRollToHit: 16, damage: '1d10+2', xpValue: 18, stats: { str: 3, dex: 2, con: 2, int: 1, wis: 1, cha: 1 } },
            { name: 'Orc Brute', maxHp: 25, attackBonus: 5, requiredRollToHit: 15, damage: '2d8+3', xpValue: 20, stats: { str: 4, dex: 1, con: 3, int: 0, wis: 0, cha: 1 } },
        ],
        tier2: [
            { name: 'Cave Bear', maxHp: 30, attackBonus: 6, requiredRollToHit: 14, damage: '2d10+4', xpValue: 25, stats: { str: 4, dex: 1, con: 3, int: 0, wis: 1, cha: 0 } },
            { name: 'Gelatinous Cube', maxHp: 40, attackBonus: 4, requiredRollToHit: 12, damage: '2d6', xpValue: 30, stats: { str: 2, dex: 0, con: 4, int: 0, wis: 0, cha: 0 },
                specialAbilities: [{ name: 'Engulf', type: 'status', status: 'Restrained', duration: 2 }] },
        ],
        tier3: [
            { name: 'Stone Golem', maxHp: 50, attackBonus: 6, requiredRollToHit: 17, damage: '3d8+4', xpValue: 50, isBoss: true, stats: { str: 5, dex: 0, con: 5, int: 0, wis: 0, cha: 0 } },
            { name: 'Lich Apprentice', maxHp: 45, attackBonus: 5, requiredRollToHit: 14, damage: '3d6', xpValue: 60, isBoss: true, stats: { str: 1, dex: 2, con: 2, int: 4, wis: 3, cha: 2 },
                specialAbilities: [
                    { name: 'Ray of Sickness', type: 'damage', damage: '2d8' },
                    { name: 'Paralyzing Touch', type: 'status', status: 'Stunned', duration: 2 }
                ] },
        ]
    };

    _pickMonsterTemplate() {
        const diff = this.gameState.difficulty;
        const hpMult = diff?.monsterHpMult || 1.0;
        const dmgMult = diff?.monsterDamageMult || 1.0;
        const turn = this.gameState.turnCount || 0;

        let pool;
        if (turn < 8) {
            pool = OfflineGameEngine.MONSTER_TEMPLATES.tier1;
        } else if (turn < 20) {
            pool = [...OfflineGameEngine.MONSTER_TEMPLATES.tier1, ...OfflineGameEngine.MONSTER_TEMPLATES.tier2];
        } else {
            pool = [...OfflineGameEngine.MONSTER_TEMPLATES.tier1, ...OfflineGameEngine.MONSTER_TEMPLATES.tier2, ...OfflineGameEngine.MONSTER_TEMPLATES.tier3];
        }

        const template = pool[Math.floor(Math.random() * pool.length)];
        const scaledHp = Math.max(1, Math.round(template.maxHp * hpMult));

        return {
            id: 'monster-' + Date.now() + '-' + Math.floor(Math.random() * 1000),
            name: template.name,
            type: 'Monster',
            maxHp: scaledHp,
            currentHp: scaledHp,
            attackBonus: template.attackBonus,
            requiredRollToHit: template.requiredRollToHit,
            damage: template.damage,
            xpValue: template.xpValue,
            isBoss: template.isBoss || false,
            stats: { ...template.stats },
            specialAbilities: template.specialAbilities ? template.specialAbilities.map(a => ({ ...a })) : [],
            statusEffects: []
        };
    }

    spawnMonster() {
        if (!this.gameState) return;
        const monster = this._pickMonsterTemplate();
        this.gameState.board.monsters.push(monster);

        if (this.gameState.grid) {
            const occupied = new Set(
                Object.values(this.gameState.grid.entities).map(e => `${e.x},${e.y}`)
            );
            for (let y = 0; y < this.gameState.grid.height; y++) {
                for (let x = 0; x < this.gameState.grid.width; x++) {
                    if (!occupied.has(`${x},${y}`)) {
                        this.gameState.grid.entities[monster.id] = { x, y, type: 'monster' };
                        break;
                    }
                }
                if (this.gameState.grid.entities[monster.id]) break;
            }
        }

        this.addChatLog('system', `A ${monster.name} appears!`);
    }

    performAttack(weaponId, targetId) {
        const player = this.gameState.players[this.playerId];
        const target = this.gameState.board.monsters.find(m => m.id === targetId);
        
        if (!target) return;
        
        const weapon = player.equipment?.weapon ||
                      { id: 'unarmed', name: 'Unarmed Strike', apCost: 1, effect: { dice: '1d4' } };
        
        const apCost = weapon.apCost || 1;
        if (player.currentAp < apCost) return;
        
        player.currentAp -= apCost;
        
        const primaryStat = this._getPrimaryStat(player);
        const statBonus = player.stats[primaryStat] || 0;
        const hitBonus = player.stats.hitBonus || 0;
        const flankingBonus = this.calculateFlankingBonus(player, target);
        
        const rollA = this.rollDice(1, 20);
        const rollB = this.rollDice(1, 20);
        const hasAdvantage = this.hasAdvantage(player, target);
        const hasDisadvantage = false;
        
        let attackRoll = rollA;
        if (hasAdvantage && !hasDisadvantage) attackRoll = Math.max(rollA, rollB);
        if (hasDisadvantage && !hasAdvantage) attackRoll = Math.min(rollA, rollB);
        
        const totalBonus = statBonus + hitBonus + flankingBonus;
        const total = attackRoll + totalBonus;
        const targetAC = target.requiredRollToHit || 12;
        
        this.addChatLog('roll', `${player.name} attacks ${target.name} with ${weapon.name}! Rolled ${attackRoll} + ${totalBonus} = ${total} vs AC ${targetAC}`);
        
        const isCrit = attackRoll === 20;
        
        if (total >= targetAC || isCrit) {
            const damageRoll = this.rollDiceWithDetails(weapon.effect.dice);
            const damageBonus = player.stats.damageBonus || 0;
            let totalDamage = damageRoll.total + damageBonus;
            
            if (isCrit) {
                const critExtra = this.rollDiceWithDetails(weapon.effect.dice);
                totalDamage += critExtra.total;
                this.addChatLog('combat-good', `CRITICAL HIT!`);
            }
            
            target.currentHp -= totalDamage;
            
            this.addChatLog('combat-good', `HIT! Dealt ${totalDamage} damage to ${target.name}!`);
            
            if (target.currentHp <= 0) {
                this.addChatLog('combat-good', `${target.name} is defeated!`);
                this.gameState.board.monsters = this.gameState.board.monsters.filter(m => m.id !== targetId);
                this.monstersKilled++;
                this.gameState.monstersKilled = (this.gameState.monstersKilled || 0) + 1;
                
                const xpGain = target.xpValue || (10 + Math.floor(this.gameState.turnCount / 5));
                player.stats.xp = (player.stats.xp || 0) + xpGain;
                this.addChatLog('action-good', `${player.name} gains ${xpGain} XP!`);
                this.checkLevelUp(player);
                
                if (this.gameState.board.monsters.length === 0) {
                    setTimeout(() => this.spawnMonster(), 1000);
                }
            }
        } else {
            this.addChatLog('combat-bad', `MISS!`);
        }
        
        this.updateGameState();
    }

    _getPrimaryStat(player) {
        const primaryMap = {
            Barbarian: 'str', Warrior: 'str', Rogue: 'dex',
            Ranger: 'dex', Mage: 'int', Cleric: 'wis'
        };
        return primaryMap[player.class] || 'str';
    }
    
    // Helper methods for combat
    calculateFlankingBonus(attacker, target) {
        // Simplified flanking calculation for offline mode
        if (attacker.positioning?.range === 'close' && target.positioning?.range === 'close') {
            return 2; // Flanking bonus
        }
        return 0;
    }
    
    hasAdvantage(player, target) {
        // Check for advantage conditions
        if (player.statusEffects?.some(e => e.name === 'Helped')) return true;
        if (target.statusEffects?.some(e => e.name === 'Prone')) return true;
        return false;
    }
    
    rollDiceWithDetails(diceString) {
        const match = diceString.match(/(\d+)d(\d+)([+-]\d+)?/);
        if (!match) return { total: 0, rolls: [] };
        
        const count = parseInt(match[1]);
        const sides = parseInt(match[2]);
        const bonus = match[3] ? parseInt(match[3]) : 0;
        
        const rolls = [];
        for (let i = 0; i < count; i++) {
            rolls.push(this.rollDice(1, sides));
        }
        
        return {
            total: rolls.reduce((sum, roll) => sum + roll, 0) + bonus,
            rolls: rolls,
            bonus: bonus
        };
    }

    performAction(action, payload = {}) {
        const player = this.gameState.players[this.playerId];
        
        switch(action) {
            case 'guard':
                if (player.currentAp >= 1) {
                    player.currentAp -= 1;
                    player.stats.shieldHp += player.stats.shieldBonus;
                    this.addChatLog('action', `${player.name} takes a guarded stance, gaining ${player.stats.shieldBonus} Shield HP.`);
                }
                break;
                
            case 'dodge':
                if (player.currentAp >= 1) {
                    player.currentAp -= 1;
                    this.applyStatusEffect(player, 'Dodging', 1);
                    this.addChatLog('action', `${player.name} takes a defensive stance, dodging incoming attacks!`);
                }
                break;
                
            case 'dash':
                if (player.currentAp >= 1) {
                    player.currentAp -= 1;
                    this.applyStatusEffect(player, 'Dashing', 1);
                    this.addChatLog('action', `${player.name} dashes forward with increased speed!`);
                }
                break;
                
            case 'search':
                if (player.currentAp >= 1) {
                    player.currentAp -= 1;
                    const roll = this.rollDice(1, 20);
                    const wisBonus = Math.floor((player.stats.wis - 10) / 2);
                    const total = roll + wisBonus;
                    
                    this.addChatLog('roll', `${player.name} searches... Rolled ${roll} + ${wisBonus} = ${total}`);
                    
                    if (total >= 12) {
                        const item = {
                            id: 'found-' + Date.now(),
                            name: 'Health Potion',
                            type: 'Item',
                            effect: { type: 'heal', dice: '2d4', description: 'Heal 2d4 HP.' }
                        };
                        player.hand.push(item);
                        this.addChatLog('action-good', `${player.name} found a ${item.name}!`);
                    } else {
                        this.addChatLog('action', `${player.name} searches but finds nothing of value.`);
                    }
                }
                break;
                
            case 'respite':
                if (player.currentAp >= 1) {
                    player.currentAp -= 1;
                    const healing = this.rollDice(1, 4);
                    player.stats.currentHp = Math.min(player.stats.maxHp, player.stats.currentHp + healing);
                    this.addChatLog('action-good', `${player.name} takes a brief respite and heals for ${healing} HP.`);
                }
                break;
                
            case 'rest':
                if (player.currentAp >= 2) {
                    player.currentAp -= 2;
                    const healing = this.rollDice(4, 4); // Barbarian/Warrior dice
                    player.stats.currentHp = Math.min(player.stats.maxHp, player.stats.currentHp + healing);
                    this.addChatLog('action-good', `${player.name} takes a full rest and heals for ${healing} HP.`);
                }
                break;
                
            // CRITICAL FIX: Add missing tactical actions
            case 'takeCover':
                if (player.currentAp >= 1) {
                    player.currentAp -= 1;
                    player.positioning = player.positioning || { range: 'close', cover: 0, elevation: 0 };
                    player.positioning.cover = Math.min(2, (player.positioning.cover || 0) + 2);
                    this.addChatLog('action', `${player.name} takes cover (+2 cover).`);
                }
                break;
                
            case 'advance':
                if (player.currentAp >= 1) {
                    player.currentAp -= 1;
                    player.positioning = player.positioning || { range: 'close', cover: 0, elevation: 0 };
                    player.positioning.range = 'close';
                    this.addChatLog('action', `${player.name} advances.`);
                }
                break;
                
            case 'retreat':
                if (player.currentAp >= 1) {
                    player.currentAp -= 1;
                    player.positioning = player.positioning || { range: 'close', cover: 0, elevation: 0 };
                    player.positioning.range = 'far';
                    this.addChatLog('action', `${player.name} retreats.`);
                }
                break;
                
            case 'intimidate':
                if (player.currentAp >= 1 && payload.targetId) {
                    player.currentAp -= 1;
                    const target = this.gameState.board.monsters.find(m => m.id === payload.targetId);
                    if (target) {
                        const bonus = Math.floor((player.stats.cha || 0) / 2);
                        const roll = this.rollDice(1, 20) + bonus;
                        const dc = 10 + Math.floor((target.stats?.cha || 10) / 2);
                        const success = roll >= dc;
                        if (success) target.requiredRollToHit = (target.requiredRollToHit || 0) + 1;
                        this.addChatLog(success ? 'action-good' : 'action', 
                            `${player.name} attempts to intimidate ${target.name} (${roll} vs DC ${dc})${success ? ' - success!' : ' - failed.'}`);
                    }
                }
                break;
                
            case 'persuade':
                if (player.currentAp >= 1 && payload.targetId) {
                    player.currentAp -= 1;
                    const target = this.gameState.board.monsters.find(m => m.id === payload.targetId);
                    if (target) {
                        const bonus = Math.floor((player.stats.cha || 0) / 2);
                        const roll = this.rollDice(1, 20) + bonus;
                        const dc = 10 + Math.floor((target.stats?.cha || 10) / 2);
                        const success = roll >= dc;
                        if (success) target.requiredRollToHit = (target.requiredRollToHit || 0) + 1;
                        this.addChatLog(success ? 'action-good' : 'action', 
                            `${player.name} attempts to persuade ${target.name} (${roll} vs DC ${dc})${success ? ' - success!' : ' - failed.'}`);
                    }
                }
                break;
                
            case 'help':
                if (player.currentAp >= 1 && payload.targetPlayerId) {
                    player.currentAp -= 1;
                    const targetPlayer = this.gameState.players[payload.targetPlayerId];
                    if (targetPlayer && targetPlayer.id !== player.id) {
                        this.applyStatusEffect(targetPlayer, 'Helped', 2);
                        this.addChatLog('action', `${player.name} helps ${targetPlayer.name}, granting them advantage on their next action!`);
                    }
                }
                break;
                
            // CRITICAL FIX: Add missing combat actions
            case 'attack':
                if (payload.weaponId && payload.targetId) {
                    this.performAttack(payload.weaponId, payload.targetId);
                }
                break;
                
            case 'castSpell':
                if (payload.cardId && payload.targetId) {
                    this.castSpell(payload.cardId, payload.targetId);
                }
                break;
                
            case 'useAbility':
                if (payload.ability) {
                    this.useAbility(payload.ability);
                }
                break;
                
            case 'equipItem':
                if (payload.cardId) {
                    this.equipItem(payload.cardId);
                }
                break;
                
            case 'discardCard':
                if (payload.cardId) {
                    this.discardCard(payload.cardId);
                }
                break;
                
            case 'claimLoot':
                if (payload.cardId) {
                    this.claimLoot(payload.cardId);
                }
                break;
                
            case 'resolveSkillInteraction':
                if (payload.cardId && payload.interactionName) {
                    this.resolveSkillInteraction(payload.cardId, payload.interactionName);
                }
                break;
        }
    }

    castSpell(cardId, targetId) {
        const player = this.gameState.players[this.playerId];
        const spell = player.hand.find(c => c.id === cardId);
        
        if (!spell || player.currentAp < (spell.apCost || 1)) return;
        
        player.currentAp -= (spell.apCost || 1);
        player.hand = player.hand.filter(c => c.id !== cardId);
        
        const effect = spell.effect;
        
        if (effect.type === 'damage' && effect.dice) {
            const target = this.gameState.board.monsters.find(m => m.id === targetId);
            if (!target) return;
            
            const damageRoll = this.rollDiceWithDetails(effect.dice);
            const spellPower = player.stats.spellPower || player.stats.int || 0;
            const totalDamage = damageRoll.total + spellPower;
            
            target.currentHp -= totalDamage;
            this.addChatLog('combat-good', `${player.name} casts ${spell.name} for ${totalDamage} damage to ${target.name}!`);
            
            if (effect.chanceToApplyStatus && Math.random() < effect.chanceToApplyStatus.chance) {
                this.applyStatusEffect(target, effect.chanceToApplyStatus.status, 2);
                this.addChatLog('combat', `${target.name} is ${effect.chanceToApplyStatus.status}!`);
            }
            
            if (target.currentHp <= 0) {
                this.addChatLog('combat-good', `${target.name} is defeated!`);
                this.gameState.board.monsters = this.gameState.board.monsters.filter(m => m.id !== targetId);
                this.monstersKilled++;
                this.gameState.monstersKilled = (this.gameState.monstersKilled || 0) + 1;
                const xpGain = target.xpValue || 10;
                player.stats.xp = (player.stats.xp || 0) + xpGain;
                this.addChatLog('action-good', `${player.name} gains ${xpGain} XP!`);
                this.checkLevelUp(player);
            }
        } else if (effect.type === 'heal' && effect.dice) {
            const healingRoll = this.rollDiceWithDetails(effect.dice);
            const healingPower = player.stats.healingPower || player.stats.wis || 0;
            const totalHealing = healingRoll.total + healingPower;
            
            player.stats.currentHp = Math.min(player.stats.maxHp, player.stats.currentHp + totalHealing);
            this.addChatLog('action-good', `${player.name} casts ${spell.name} and heals for ${totalHealing} HP!`);
        } else if (effect.type === 'control' && effect.status) {
            const target = this.gameState.board.monsters.find(m => m.id === targetId);
            if (target) {
                this.applyStatusEffect(target, effect.status, effect.duration || 2);
                this.addChatLog('action', `${player.name} casts ${spell.name} - ${target.name} is ${effect.status}!`);
            }
        } else if (effect.type === 'buff') {
            if (effect.status) {
                this.applyStatusEffect(player, effect.status, effect.duration || 2);
            }
            if (effect.bonuses?.shieldBonus) {
                player.stats.shieldHp = (player.stats.shieldHp || 0) + effect.bonuses.shieldBonus;
            }
            this.addChatLog('action-good', `${player.name} casts ${spell.name}!`);
        }
        
        this.updateGameState();
    }
    
    // CRITICAL FIX: Add missing ability system
    useAbility(ability) {
        const player = this.gameState.players[this.playerId];
        
        if (player.currentAp < ability.apCost || player.usedAbilityThisTurn) return;
        
        player.currentAp -= ability.apCost;
        player.usedAbilityThisTurn = true;
        
        if (ability.effect?.type === 'buff') {
            this.applyStatusEffect(player, ability.effect.status, ability.effect.duration);
            this.addChatLog('action-good', `${player.name} uses ${ability.name}!`);
        }
        
        this.updateGameState();
    }
    
    equipItem(cardId) {
        const player = this.gameState.players[this.playerId];
        const item = player.hand.find(c => c.id === cardId);
        
        if (!item) return;
        
        player.hand = player.hand.filter(c => c.id !== cardId);
        player.equipment = player.equipment || { weapon: null, armor: null };
        
        if (item.type === 'Weapon') {
            if (player.equipment.weapon) {
                player.hand.push(player.equipment.weapon);
            }
            player.equipment.weapon = item;
            this.addChatLog('action', `${player.name} equips ${item.name}!`);
        } else if (item.type === 'Armor') {
            if (player.equipment.armor) {
                player.hand.push(player.equipment.armor);
            }
            player.equipment.armor = item;
            if (item.effect?.bonuses?.shieldBonus) {
                player.stats.shieldBonus = item.effect.bonuses.shieldBonus;
            }
            this.addChatLog('action', `${player.name} equips ${item.name}!`);
        }
        
        this.updateGameState();
    }
    
    // CRITICAL FIX: Add missing card management
    discardCard(cardId) {
        const player = this.gameState.players[this.playerId];
        const card = player.hand.find(c => c.id === cardId);
        
        if (!card) return;
        
        player.hand = player.hand.filter(c => c.id !== cardId);
        this.addChatLog('action', `${player.name} discards ${card.name}.`);
        
        this.updateGameState();
    }
    
    claimLoot(cardId) {
        const player = this.gameState.players[this.playerId];
        const loot = this.gameState.lootPool.find(c => c.id === cardId);
        
        if (!loot) return;
        
        // Add to hand if there's space
        if (player.hand.length < 7) {
            player.hand.push(loot);
            this.gameState.lootPool = this.gameState.lootPool.filter(c => c.id !== cardId);
            this.addChatLog('action-good', `${player.name} claims ${loot.name}!`);
        } else {
            this.addChatLog('action', `${player.name} cannot carry more items!`);
        }
        
        this.updateGameState();
    }
    
    resolveSkillInteraction(cardId, interactionName) {
        const player = this.gameState.players[this.playerId];
        const card = this.gameState.board.environment.find(c => c.id === cardId);
        
        if (!card || !card.skillInteractions) return;
        
        const interaction = card.skillInteractions.find(i => i.name === interactionName);
        if (!interaction || player.currentAp < interaction.apCost) return;
        
        player.currentAp -= interaction.apCost;
        
        // Simple skill check
        const skill = interaction.skill || 'dex';
        const skillBonus = Math.floor((player.stats[skill] - 10) / 2);
        const roll = this.rollDice(1, 20) + skillBonus;
        const dc = interaction.dc || 12;
        
        this.addChatLog('roll', `${player.name} attempts ${interactionName}... Rolled ${roll} vs DC ${dc}`);
        
        if (roll >= dc) {
            this.addChatLog('action-good', `${player.name} succeeds!`);
            // Add reward or effect here
        } else {
            this.addChatLog('action', `${player.name} fails.`);
        }
        
        this.updateGameState();
    }

    useItem(itemId) {
        const player = this.gameState.players[this.playerId];
        const item = player.hand.find(i => i.id === itemId);
        
        if (!item) return;
        const apCost = item.apCost || 1;
        if (player.currentAp < apCost) return;
        
        player.currentAp -= apCost;
        
        const effect = item.effect;
        if (effect.type === 'heal' && effect.dice) {
            const healRoll = this.rollDiceWithDetails(effect.dice);
            const healing = healRoll.total;
            player.stats.currentHp = Math.min(player.stats.maxHp, player.stats.currentHp + healing);
            this.addChatLog('action-good', `${player.name} uses ${item.name} and heals for ${healing} HP!`);
            player.hand = player.hand.filter(i => i.id !== itemId);
        } else if (effect.type === 'damage' && effect.dice) {
            const target = this.gameState.board.monsters[0];
            if (target) {
                const dmgRoll = this.rollDiceWithDetails(effect.dice);
                target.currentHp -= dmgRoll.total;
                this.addChatLog('combat-good', `${player.name} uses ${item.name} for ${dmgRoll.total} damage!`);
                if (effect.status) {
                    this.applyStatusEffect(target, effect.status, effect.duration || 2);
                }
                player.hand = player.hand.filter(i => i.id !== itemId);
            }
        } else if (effect.type === 'buff' && effect.status) {
            this.applyStatusEffect(player, effect.status, effect.duration || 2);
            this.addChatLog('action-good', `${player.name} uses ${item.name}!`);
            player.hand = player.hand.filter(i => i.id !== itemId);
        } else if (effect.type === 'utility') {
            if (effect.utilityType === 'add_shield_hp' && effect.value) {
                player.stats.shieldHp = (player.stats.shieldHp || 0) + effect.value;
                this.addChatLog('action-good', `${player.name} uses ${item.name} and gains ${effect.value} Shield HP!`);
            } else if (effect.status === 'Cure Poison') {
                player.statusEffects = (player.statusEffects || []).filter(e => e.name !== 'Poisoned');
                this.addChatLog('action-good', `${player.name} uses ${item.name} and is cured of poison!`);
            } else if (effect.status) {
                const target = this.gameState.board.monsters[0];
                if (target) {
                    this.applyStatusEffect(target, effect.status, effect.duration || 3);
                    this.addChatLog('action', `${player.name} uses ${item.name} on ${target.name}!`);
                }
            }
            player.hand = player.hand.filter(i => i.id !== itemId);
        } else if (effect.type === 'control' && effect.status) {
            const target = this.gameState.board.monsters[0];
            if (target) {
                this.applyStatusEffect(target, effect.status, effect.duration || 1);
                this.addChatLog('action', `${player.name} uses ${item.name} - ${target.name} is ${effect.status}!`);
            }
            player.hand = player.hand.filter(i => i.id !== itemId);
        }
        
        this.updateGameState();
    }
    
    _xpToNextLevel(level) {
        if (level <= 1) return 25;
        return Math.floor(25 * Math.pow(1.5, level - 1));
    }

    checkLevelUp(player) {
        const currentLevel = player.stats.level || player.level || 1;
        const xpNeeded = this._xpToNextLevel(currentLevel);
        
        if ((player.stats.xp || 0) >= xpNeeded) {
            player.stats.xp -= xpNeeded;
            const newLevel = currentLevel + 1;
            player.stats.level = newLevel;
            player.level = newLevel;
            
            const primary = this._getPrimaryStat(player);
            player.stats[primary] = (player.stats[primary] || 0) + 1;
            
            const hpGain = (player.stats.con || 2) + this.rollDice(1, 4);
            player.stats.maxHp = (player.stats.maxHp || 20) + hpGain;
            player.stats.currentHp = player.stats.maxHp;
            
            this.addChatLog('action-good', `${player.name} reached Level ${newLevel}! +${hpGain} Max HP, +1 ${primary.toUpperCase()}!`);
            
            if ([3, 5, 7].includes(newLevel)) {
                this.promptSpecializationChoice(player);
            }
        }
    }
    
    promptSpecializationChoice(player) {
        const specTrees = {
            Barbarian: ['Berserker', 'Defender', 'Shaman'],
            Rogue: ['Assassin', 'Trickster', 'Scout'],
            Mage: ['Elementalist', 'Enchanter', 'Scholar'],
            Warrior: ['WeaponMaster', 'Guardian', 'Commander'],
            Cleric: ['DivineHealer', 'Crusader', 'Priest'],
            Ranger: ['Marksman', 'BeastMaster', 'Tracker']
        };
        
        const classSpecs = specTrees[player.class] || ['Generalist'];
        const randomSpec = classSpecs[Math.floor(Math.random() * classSpecs.length)];
        
        if (!player.specializations) player.specializations = {};
        const tier = player.level === 3 ? 1 : player.level === 5 ? 2 : 3;
        player.specializations[tier] = { branch: randomSpec, tier };
        
        this.addChatLog('action-good', `${player.name} gains specialization: ${randomSpec}!`);
        this.applySpecializationBonuses(player, randomSpec, tier);
    }
    
    applySpecializationBonuses(player, specialization, tier) {
        const bonuses = {
            Berserker:     { damageBonus: 2 },
            Defender:      { maxHp: 4 },
            Shaman:        { damageBonus: 1, healingPower: 1 },
            Assassin:      { damageBonus: 2 },
            Trickster:     { spellPower: 1 },
            Scout:         { dex: 1 },
            Elementalist:  { spellPower: 2 },
            Enchanter:     { int: 1 },
            Scholar:       { healingPower: 2 },
            WeaponMaster:  { hitBonus: 1, damageBonus: 1 },
            Guardian:      { shieldBonus: 2 },
            Commander:     { healingPower: 1, damageBonus: 1 },
            DivineHealer:  { healingPower: 2, wis: 1 },
            Crusader:      { damageBonus: 2, str: 1 },
            Priest:        { wis: 1, healingPower: 1 },
            Marksman:      { hitBonus: 1, dex: 1 },
            BeastMaster:   { wis: 1 },
            Tracker:       { wis: 1, dex: 1 },
        };
        
        const bonus = bonuses[specialization] || {};
        for (const [key, value] of Object.entries(bonus)) {
            player.stats[key] = (player.stats[key] || 0) + (value * tier);
        }
    }
    
    recalculatePlayerStats(player) {
        const baseHp = player.stats.baseMaxHp || 20;
        const level = player.stats.level || player.level || 1;
        player.stats.maxHp = baseHp + (player.stats.con * 2) + ((level - 1) * 3);
        player.stats.currentHp = Math.min(player.stats.currentHp, player.stats.maxHp);

        const armorBonus = player.equipment?.armor?.effect?.bonuses?.shieldBonus || 0;
        player.stats.shieldBonus = armorBonus + (player.stats.con > 3 ? 1 : 0);
    }
    
    // CRITICAL FIX: Add missing updateGameState function
    updateGameState() {
        // Trigger UI update
        if (window.renderGameplayState) {
            const player = this.gameState.players[this.playerId];
            window.renderGameplayState(player, this.gameState);
        }
    }

    endTurn() {
        const player = this.gameState.players[this.playerId];
        
        // Reset AP
        player.currentAp = 3;
        player.usedAbilityThisTurn = false;
        
        // Decrement status effect durations
        player.statusEffects = player.statusEffects.map(e => ({...e, duration: e.duration - 1})).filter(e => e.duration > 0);
        
        // Monster turn
        this.takeMonsterTurn();
        
        // Increment turn
        this.gameState.turnCount++;
        
        this.addChatLog('system', `--- Turn ${this.gameState.turnCount} ---`);
    }

    // CRITICAL FIX: Enhanced monster AI with special abilities
    takeMonsterTurn() {
        const player = this.gameState.players[this.playerId];
        
        this.gameState.board.monsters.forEach(monster => {
            // Enhanced AI: choose between attack and special ability
            const hasSpecialAbility = monster.specialAbilities && monster.specialAbilities.length > 0;
            const useSpecial = hasSpecialAbility && Math.random() < 0.3; // 30% chance for special
            
            if (useSpecial && monster.specialAbilities) {
                this.useMonsterSpecialAbility(monster, player);
            } else {
                this.performMonsterAttack(monster, player);
            }
        });
    }
    
    performMonsterAttack(monster, player) {
        const attackRoll = this.rollDice(1, 20);
        const monsterBonus = monster.attackBonus || 2;
        const total = attackRoll + monsterBonus;
        
        const baseAC = 10 + (player.stats.dex || 0);
        const shieldHP = player.stats.shieldHp || 0;
        const targetAC = baseAC + (shieldHP > 0 ? (player.stats.shieldBonus || 0) : 0);
        
        const isCrit = attackRoll === 20;
        
        this.addChatLog('combat', `${monster.name} attacks ${player.name}! Rolled ${attackRoll} + ${monsterBonus} = ${total} vs AC ${targetAC}`);
        
        if (total >= targetAC || isCrit) {
            const damageRoll = this.rollDiceWithDetails(monster.damage || '1d6');
            let totalDamage = damageRoll.total;
            
            if (isCrit) {
                const critExtra = this.rollDiceWithDetails(monster.damage || '1d6');
                totalDamage += critExtra.total;
                this.addChatLog('combat-bad', `CRITICAL HIT!`);
            }
            
            if (player.stats.shieldHp > 0) {
                const shieldAbsorb = Math.min(totalDamage, player.stats.shieldHp);
                player.stats.shieldHp -= shieldAbsorb;
                const overflow = totalDamage - shieldAbsorb;
                
                if (overflow > 0) {
                    player.stats.currentHp -= overflow;
                }
                this.addChatLog('combat-bad', `HIT! ${totalDamage} damage (shield absorbed ${shieldAbsorb})!`);
            } else {
                player.stats.currentHp -= totalDamage;
                this.addChatLog('combat-bad', `HIT! ${totalDamage} damage to ${player.name}!`);
            }
            
            if (player.stats.currentHp <= 0) {
                player.stats.currentHp = 0;
                player.isDowned = true;
                this.gameState.phase = 'game_over';
                this.gameState.winner = 'Monsters';
                this.addChatLog('system-bad', `${player.name} has been defeated! Game Over.`);
            }
        } else {
            this.addChatLog('combat', `${monster.name} misses!`);
        }
    }
    
    useMonsterSpecialAbility(monster, player) {
        const ability = monster.specialAbilities[Math.floor(Math.random() * monster.specialAbilities.length)];
        
        this.addChatLog('combat', `${monster.name} uses ${ability.name}!`);
        
        switch (ability.type) {
            case 'damage':
                const damageRoll = this.rollDiceWithDetails(ability.damage || '2d6');
                player.stats.currentHp -= damageRoll.total;
                this.addChatLog('combat-bad', `${ability.name} deals ${damageRoll.total} damage!`);
                break;
                
            case 'status':
                this.applyStatusEffect(player, ability.status, ability.duration || 2);
                this.addChatLog('combat-bad', `${player.name} is ${ability.status}!`);
                break;
                
            case 'heal':
                const healRoll = this.rollDiceWithDetails(ability.healing || '1d8');
                monster.currentHp = Math.min(monster.maxHp, monster.currentHp + healRoll.total);
                this.addChatLog('combat', `${monster.name} heals for ${healRoll.total} HP!`);
                break;
        }
    }

    // CRITICAL FIX: Enhanced status effects system
    applyStatusEffect(target, effectName, duration) {
        if (!target.statusEffects) target.statusEffects = [];
        
        const statusDef = this.getStatusEffectDefinition(effectName);
        if (!statusDef) return;
        
        const existing = target.statusEffects.find(e => e.name === effectName);
        if (existing) {
            existing.duration = Math.max(existing.duration, duration);
        } else {
            target.statusEffects.push({ 
                name: effectName, 
                duration,
                bonuses: statusDef.bonuses || {},
                trigger: statusDef.trigger || 'passive'
            });
        }
        
        // Apply immediate effects
        if (statusDef.bonuses) {
            this.applyStatusBonuses(target);
        }
    }
    
    getStatusEffectDefinition(effectName) {
        const definitions = {
            'Dodging': { 
                bonuses: { shieldBonus: 2 }, 
                trigger: 'passive',
                description: 'Grants +2 Shield Bonus'
            },
            'Dashing': { 
                bonuses: { movementBonus: 2 }, 
                trigger: 'passive',
                description: 'Grants +2 Movement Bonus'
            },
            'Helped': { 
                bonuses: { advantage: true }, 
                trigger: 'next_action',
                description: 'Grants advantage on next action'
            },
            'Prone': { 
                bonuses: { acPenalty: 2 }, 
                trigger: 'passive',
                description: 'Grants disadvantage to attackers'
            },
            'Oiled': { 
                bonuses: { fireVulnerability: true }, 
                trigger: 'passive',
                description: 'Vulnerable to fire damage'
            },
            'Wet': { 
                bonuses: { lightningVulnerability: true }, 
                trigger: 'passive',
                description: 'Vulnerable to lightning damage'
            },
            'Restrained': { 
                bonuses: { movementBlocked: true }, 
                trigger: 'passive',
                description: 'Cannot move'
            }
        };
        
        return definitions[effectName] || null;
    }
    
    applyStatusBonuses(target) {
        // Apply status effect bonuses to target stats
        if (target.statusEffects) {
            target.statusEffects.forEach(effect => {
                if (effect.bonuses) {
                    Object.keys(effect.bonuses).forEach(bonus => {
                        if (bonus === 'shieldBonus') {
                            target.stats.shieldBonus = (target.stats.shieldBonus || 0) + effect.bonuses[bonus];
                        } else if (bonus === 'movementBonus') {
                            target.movementBonus = (target.movementBonus || 0) + effect.bonuses[bonus];
                        }
                        // Add more bonus types as needed
                    });
                }
            });
        }
    }

    addChatLog(type, text, playerName = null) {
        this.gameState.chatLog.push({
            type,
            text,
            playerName,
            timestamp: Date.now()
        });
    }

    rollDice(count, sides) {
        let total = 0;
        for (let i = 0; i < count; i++) {
            total += Math.floor(Math.random() * sides) + 1;
        }
        return total;
    }

    getGameState() {
        return this.gameState;
    }

    // Auto-save functionality
    startAutoSave() {
        // Auto-save every 30 seconds
        this.autoSaveInterval = setInterval(() => {
            this.saveGame();
        }, 30000);
    }

    stopAutoSave() {
        if (this.autoSaveInterval) {
            clearInterval(this.autoSaveInterval);
            this.autoSaveInterval = null;
        }
    }
    
    // Dev Tools Methods
    initializeDevTools() {
        // Make dev tools available globally
        window.offlineGameEngine = this;
    }
    
    // --- Dev Tools ---
    gainXp(amount) {
        if (!this.gameState || !this.gameState.players[this.playerId]) return;
        const player = this.gameState.players[this.playerId];
        player.stats.xp = (player.stats.xp || 0) + amount;
        this.checkLevelUp(player);
        this.updateGameState();
    }
    
    setMaxLevel() {
        if (!this.gameState || !this.gameState.players[this.playerId]) return;
        const player = this.gameState.players[this.playerId];
        while ((player.stats.level || player.level || 1) < 10) {
            player.stats.xp = this._xpToNextLevel(player.stats.level || player.level || 1);
            this.checkLevelUp(player);
        }
        this.addChatLog('system', `${player.name} reached maximum level!`);
        this.updateGameState();
    }
    
    addGold(amount) {
        if (!this.gameState || !this.gameState.players[this.playerId]) return;
        const player = this.gameState.players[this.playerId];
        player.gold = (player.gold || 0) + amount;
        this.addChatLog('system', `${player.name} gained ${amount} gold!`);
        this.updateGameState();
    }
    
    devSpawnMonster() {
        this.spawnMonster();
        this.updateGameState();
    }
    
    fullHeal() {
        if (!this.gameState || !this.gameState.players[this.playerId]) return;
        const player = this.gameState.players[this.playerId];
        player.stats.currentHp = player.stats.maxHp;
        player.isDowned = false;
        this.gameState.phase = 'playing';
        this.addChatLog('system', `${player.name} was fully healed!`);
        this.updateGameState();
    }
    
    toggleGodMode() {
        this.godMode = !this.godMode;
        this.addChatLog('system', `God mode ${this.godMode ? 'enabled' : 'disabled'}!`);
        this.updateGameState();
    }

    saveGame() {
        if (!this.gameState) return false;
        
        try {
            const saveData = {
                gameState: this.gameState,
                monstersKilled: this.monstersKilled,
                timestamp: Date.now(),
                version: '4.2.0'
            };
            
            localStorage.setItem('qc_offline_save', JSON.stringify(saveData));
            this.gameState.lastSave = Date.now();
            console.log('[OfflineEngine] Game saved successfully');
            return true;
        } catch (e) {
            console.error('[OfflineEngine] Failed to save game:', e);
            return false;
        }
    }

    static loadGame() {
        try {
            const saved = localStorage.getItem('qc_offline_save');
            if (!saved) return null;
            
            const saveData = JSON.parse(saved);
            
            // Check if save is less than 7 days old
            const age = Date.now() - saveData.timestamp;
            if (age > 7 * 24 * 60 * 60 * 1000) {
                console.log('[OfflineEngine] Save too old, discarding');
                return null;
            }
            
            console.log('[OfflineEngine] Loaded saved game');
            return saveData;
        } catch (e) {
            console.error('[OfflineEngine] Failed to load game:', e);
            return null;
        }
    }

    static clearSave() {
        localStorage.removeItem('qc_offline_save');
        console.log('[OfflineEngine] Save cleared');
    }

    resumeGame(saveData) {
        this.gameState = saveData.gameState;
        this.monstersKilled = saveData.monstersKilled || 0;
        this.isOfflineMode = true;
        this.startAutoSave();
        return this.gameState;
    }

    endGame() {
        this.stopAutoSave();
        OfflineGameEngine.clearSave();
        
        // Record stats
        const player = this.gameState.players[this.playerId];
        const stats = {
            turnCount: this.gameState.turnCount,
            monstersKilled: this.gameState.monstersKilled || 0,
            xpEarned: player.stats.xp,
            class: player.class,
            difficulty: this.gameState.gameMode
        };
        
        return stats;
    }
}

// Export for use in client.js
if (typeof module !== 'undefined' && module.exports) {
    module.exports = OfflineGameEngine;
}
