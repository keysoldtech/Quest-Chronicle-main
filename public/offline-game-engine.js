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
                    stats: this.getClassStats(playerClass, diff.playerStartingHp),
                    hand: [],
                    equippedWeapon: null,
                    equippedArmor: null,
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
        
        // Simple starting weapon
        player.equippedWeapon = {
            id: 'starter-weapon',
            name: 'Iron Sword',
            type: 'Weapon',
            effect: { dice: '1d6', description: 'A basic weapon.' }
        };
        
        // Simple starting armor
        player.equippedArmor = {
            id: 'starter-armor',
            name: 'Leather Armor',
            type: 'Armor',
            effect: { shieldBonus: 1, description: 'Basic protection.' }
        };
        
        player.stats.ac = 10 + player.stats.dex + 1; // Base + DEX + armor
        player.stats.shieldBonus = 1;
        
        // Starting items
        player.hand.push({
            id: 'potion-1',
            name: 'Health Potion',
            type: 'Item',
            effect: { type: 'heal', dice: '2d4', description: 'Heal 2d4 HP.' }
        });
    }

    // CRITICAL FIX: Add missing addChatLog function
    addChatLog(type, message) {
        this.gameState.chatLog.push({
            type: type,
            playerName: this.gameState.players[this.playerId]?.name || 'System',
            text: message,
            timestamp: Date.now()
        });
    }

    // CRITICAL FIX: Enhanced monster spawning with special abilities
    spawnMonster() {
        const monsterTemplates = [
            { 
                name: 'Goblin', 
                ac: 12, 
                hp: 7, 
                damage: '1d6',
                attackBonus: 2,
                specialAbilities: [
                    { name: 'Sneak Attack', type: 'damage', damage: '1d4' }
                ]
            },
            { 
                name: 'Orc', 
                ac: 13, 
                hp: 15, 
                damage: '1d8',
                attackBonus: 3,
                specialAbilities: [
                    { name: 'Rage', type: 'damage', damage: '2d6' }
                ]
            },
            { 
                name: 'Troll', 
                ac: 15, 
                hp: 25, 
                damage: '2d6',
                attackBonus: 4,
                specialAbilities: [
                    { name: 'Regeneration', type: 'heal', healing: '1d8' },
                    { name: 'Intimidating Roar', type: 'status', status: 'Frightened', duration: 2 }
                ]
            },
            { 
                name: 'Dragon', 
                ac: 18, 
                hp: 50, 
                damage: '3d8',
                attackBonus: 6,
                specialAbilities: [
                    { name: 'Fire Breath', type: 'damage', damage: '4d6' },
                    { name: 'Wing Buffet', type: 'status', status: 'Prone', duration: 1 }
                ]
            }
        ];
        
        // Choose monster based on turn count (harder monsters later)
        let template;
        if (this.gameState.turnCount < 5) {
            template = monsterTemplates[0]; // Goblin
        } else if (this.gameState.turnCount < 15) {
            template = monsterTemplates[Math.floor(Math.random() * 2)]; // Goblin or Orc
        } else if (this.gameState.turnCount < 30) {
            template = monsterTemplates[Math.floor(Math.random() * 3)]; // Goblin, Orc, or Troll
        } else {
            template = monsterTemplates[Math.floor(Math.random() * monsterTemplates.length)]; // Any monster
        }
        
        const monster = {
            id: 'monster-' + Date.now(),
            name: template.name,
            ac: template.ac,
            currentHp: template.hp,
            maxHp: template.hp,
            damage: template.damage,
            attackBonus: template.attackBonus,
            specialAbilities: template.specialAbilities || [],
            statusEffects: []
        };
        
        this.gameState.board.monsters.push(monster);
        this.addChatLog('system', `${monster.name} appears!`);
    }

    // CRITICAL FIX: Enhanced combat system with all online features
    performAttack(weaponId, targetId) {
        const player = this.gameState.players[this.playerId];
        const target = this.gameState.board.monsters.find(m => m.id === targetId);
        
        if (!target) return;
        
        // Get weapon
        const weapon = player.equipment?.weapon || player.equippedWeapon || 
                      { id: 'unarmed', name: 'Unarmed Strike', apCost: 1, effect: { dice: '1d4' } };
        
        if (player.currentAp < weapon.apCost) return;
        
        player.currentAp -= weapon.apCost;
        
        // Calculate attack bonus with all modifiers
        const strBonus = Math.floor((player.stats.str - 10) / 2);
        const hitBonus = player.stats.hitBonus || 0;
        const flankingBonus = this.calculateFlankingBonus(player, target);
        const coverPenalty = target.positioning?.cover || 0;
        
        // Roll attack with advantage/disadvantage
        const rollA = this.rollDice(1, 20);
        const rollB = this.rollDice(1, 20);
        const hasAdvantage = this.hasAdvantage(player, target);
        const hasDisadvantage = coverPenalty >= 2;
        
        let attackRoll = rollA;
        if (hasAdvantage && !hasDisadvantage) attackRoll = Math.max(rollA, rollB);
        if (hasDisadvantage && !hasAdvantage) attackRoll = Math.min(rollA, rollB);
        
        const total = attackRoll + strBonus + hitBonus + flankingBonus - coverPenalty;
        
        this.addChatLog('roll', `${player.name} attacks ${target.name} with ${weapon.name}! Rolled ${attackRoll} + ${strBonus + hitBonus + flankingBonus} - ${coverPenalty} = ${total} vs AC ${target.ac}`);
        
        if (total >= target.ac) {
            // Hit! Calculate damage with all bonuses
            const damageRoll = this.rollDiceWithDetails(weapon.effect.dice);
            const damageBonus = player.stats.damageBonus || 0;
            const totalDamage = damageRoll.total + damageBonus + flankingBonus;
            
            // Apply damage
            target.currentHp -= totalDamage;
            
            this.addChatLog('combat-good', `HIT! Dealt ${totalDamage} damage to ${target.name}!`);
            
            // Check for critical hit
            if (attackRoll === 20) {
                const critDamage = this.rollDiceWithDetails(weapon.effect.dice);
                target.currentHp -= critDamage.total;
                this.addChatLog('combat-good', `CRITICAL HIT! Extra ${critDamage.total} damage!`);
            }
            
            if (target.currentHp <= 0) {
                this.addChatLog('combat-good', `${target.name} is defeated!`);
                this.gameState.board.monsters = this.gameState.board.monsters.filter(m => m.id !== targetId);
                this.monstersKilled++;
                
                // Gain XP
                const xpGain = 10 + Math.floor(this.gameState.turnCount / 5);
                player.stats.xp += xpGain;
                this.addChatLog('action-good', `${player.name} gains ${xpGain} XP!`);
                this.checkLevelUp(player);
                
                // Spawn new monster
                setTimeout(() => this.spawnMonster(), 1000);
            }
        } else {
            this.addChatLog('combat-bad', `MISS!`);
        }
        
        this.updateGameState();
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

    // CRITICAL FIX: Add missing spell casting system
    castSpell(cardId, targetId) {
        const player = this.gameState.players[this.playerId];
        const spell = player.hand.find(c => c.id === cardId);
        const target = this.gameState.board.monsters.find(m => m.id === targetId);
        
        if (!spell || !target || player.currentAp < (spell.apCost || 1)) return;
        
        player.currentAp -= (spell.apCost || 1);
        
        // Remove spell from hand
        player.hand = player.hand.filter(c => c.id !== cardId);
        
        const effect = spell.effect;
        
        if (effect.type === 'damage' && effect.dice) {
            const damageRoll = this.rollDiceWithDetails(effect.dice);
            const intBonus = Math.floor((player.stats.int - 10) / 2);
            const totalDamage = damageRoll.total + intBonus;
            
            target.currentHp -= totalDamage;
            this.addChatLog('combat-good', `${player.name} casts ${spell.name} and deals ${totalDamage} damage to ${target.name}!`);
            
            if (target.currentHp <= 0) {
                this.addChatLog('combat-good', `${target.name} is defeated!`);
                this.gameState.board.monsters = this.gameState.board.monsters.filter(m => m.id !== targetId);
                this.monstersKilled++;
            }
        } else if (effect.type === 'heal') {
            const healingRoll = this.rollDiceWithDetails(effect.dice);
            const wisBonus = Math.floor((player.stats.wis - 10) / 2);
            const totalHealing = healingRoll.total + wisBonus;
            
            player.stats.currentHp = Math.min(player.stats.maxHp, player.stats.currentHp + totalHealing);
            this.addChatLog('action-good', `${player.name} casts ${spell.name} and heals for ${totalHealing} HP!`);
        } else if (effect.type === 'utility' && effect.status) {
            this.applyStatusEffect(target, effect.status, effect.duration || 2);
            this.addChatLog('action', `${player.name} casts ${spell.name} - ${target.name} is ${effect.status}!`);
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
    
    // CRITICAL FIX: Add missing equipment system
    equipItem(cardId) {
        const player = this.gameState.players[this.playerId];
        const item = player.hand.find(c => c.id === cardId);
        
        if (!item || player.currentAp < 1) return;
        
        player.currentAp -= 1;
        
        // Remove from hand
        player.hand = player.hand.filter(c => c.id !== cardId);
        
        // Equip based on type
        if (item.type === 'Weapon') {
            player.equipment = player.equipment || {};
            player.equipment.weapon = item;
            this.addChatLog('action', `${player.name} equips ${item.name}!`);
        } else if (item.type === 'Armor') {
            player.equipment = player.equipment || {};
            player.equipment.armor = item;
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
        
        if (!item || player.currentAp < 1) return;
        
        player.currentAp -= 1;
        
        if (item.effect.type === 'heal') {
            const healing = this.rollDice(2, 4); // Health potion
            player.stats.currentHp = Math.min(player.stats.maxHp, player.stats.currentHp + healing);
            this.addChatLog('action-good', `${player.name} uses ${item.name} and heals for ${healing} HP!`);
            
            // Remove item
            player.hand = player.hand.filter(i => i.id !== itemId);
        }
        
        this.updateGameState();
    }
    
    // CRITICAL FIX: Add missing level up and specialization system
    checkLevelUp(player) {
        const xpNeeded = player.level * 100; // Simple XP curve
        if (player.stats.xp >= xpNeeded) {
            player.level++;
            player.stats.xp -= xpNeeded;
            
            // Increase stats
            const statIncrease = Math.floor(Math.random() * 6) + 1; // Random stat to increase
            const stats = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
            const statName = stats[statIncrease - 1];
            player.stats[statName]++;
            
            this.addChatLog('action-good', `${player.name} reached Level ${player.level} and increased their ${statName.toUpperCase()}!`);
            
            // Check for specialization unlock at levels 3, 5, 7
            if ([3, 5, 7].includes(player.level)) {
                this.promptSpecializationChoice(player);
            }
            
            // Recalculate stats
            this.recalculatePlayerStats(player);
        }
    }
    
    promptSpecializationChoice(player) {
        // Simplified specialization system for offline mode
        const specializations = {
            'Barbarian': ['Berserker', 'Totem Warrior'],
            'Ranger': ['Beast Master', 'Hunter'],
            'Rogue': ['Assassin', 'Thief'],
            'Warrior': ['Champion', 'Battle Master'],
            'Wizard': ['Evocation', 'Abjuration'],
            'Cleric': ['Life Domain', 'War Domain']
        };
        
        const classSpecs = specializations[player.class] || ['Generalist'];
        const randomSpec = classSpecs[Math.floor(Math.random() * classSpecs.length)];
        
        if (!player.specializations) player.specializations = {};
        const tier = player.level === 3 ? 1 : player.level === 5 ? 2 : 3;
        player.specializations[tier] = { branch: randomSpec, tier };
        
        this.addChatLog('action-good', `${player.name} gains specialization: ${randomSpec}!`);
        
        // Apply specialization bonuses
        this.applySpecializationBonuses(player, randomSpec, tier);
    }
    
    applySpecializationBonuses(player, specialization, tier) {
        const bonuses = {
            'Berserker': { str: 1, damageBonus: 2 },
            'Totem Warrior': { con: 1, shieldBonus: 1 },
            'Beast Master': { wis: 1, companionBonus: true },
            'Hunter': { dex: 1, hitBonus: 2 },
            'Assassin': { dex: 1, critBonus: 1 },
            'Thief': { dex: 1, movementBonus: 1 },
            'Champion': { str: 1, critRange: 1 },
            'Battle Master': { str: 1, tacticalBonus: 2 },
            'Evocation': { int: 1, spellDamage: 2 },
            'Abjuration': { int: 1, shieldBonus: 2 },
            'Life Domain': { wis: 1, healingBonus: 2 },
            'War Domain': { str: 1, weaponBonus: 1 },
            'Generalist': { all: 1 }
        };
        
        const bonus = bonuses[specialization] || { all: 1 };
        Object.keys(bonus).forEach(stat => {
            if (stat === 'all') {
                // Increase all stats by 1
                ['str', 'dex', 'con', 'int', 'wis', 'cha'].forEach(s => {
                    player.stats[s] = (player.stats[s] || 10) + 1;
                });
            } else {
                player.stats[stat] = (player.stats[stat] || 10) + bonus[stat];
            }
        });
        
        this.recalculatePlayerStats(player);
    }
    
    recalculatePlayerStats(player) {
        // Recalculate derived stats based on base stats
        player.stats.maxHp = Math.max(1, player.stats.con * 2 + player.level * 2);
        player.stats.currentHp = Math.min(player.stats.currentHp, player.stats.maxHp);
        player.stats.ac = 10 + Math.floor((player.stats.dex - 10) / 2);
        player.stats.hitBonus = Math.floor((player.stats.str - 10) / 2);
        player.stats.damageBonus = Math.floor((player.stats.str - 10) / 2);
        player.stats.shieldBonus = Math.floor((player.stats.con - 10) / 2);
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
        
        const targetAC = player.stats.ac + (player.stats.shieldHp > 0 ? player.stats.shieldBonus : 0);
        
        this.addChatLog('combat', `${monster.name} attacks ${player.name}! Rolled ${attackRoll} + ${monsterBonus} = ${total} vs AC ${targetAC}`);
        
        if (total >= targetAC) {
            const damageRoll = this.rollDiceWithDetails(monster.damage || '1d6');
            const totalDamage = damageRoll.total;
            
            // Apply to shield first
            if (player.stats.shieldHp > 0) {
                const shieldDamage = Math.min(totalDamage, player.stats.shieldHp);
                player.stats.shieldHp -= shieldDamage;
                const remainingDamage = totalDamage - shieldDamage;
                
                if (remainingDamage > 0) {
                    player.stats.currentHp -= remainingDamage;
                }
                
                this.addChatLog('combat-bad', `HIT! ${totalDamage} damage (absorbed ${shieldDamage} from shield)!`);
            } else {
                player.stats.currentHp -= totalDamage;
                this.addChatLog('combat-bad', `HIT! Dealt ${totalDamage} damage to ${player.name}!`);
            }
            
            // Check for critical hit
            if (attackRoll === 20) {
                const critDamage = this.rollDiceWithDetails(monster.damage || '1d6');
                player.stats.currentHp -= critDamage.total;
                this.addChatLog('combat-bad', `CRITICAL HIT! Extra ${critDamage.total} damage!`);
            }
            
            // Check if player is defeated
            if (player.stats.currentHp <= 0) {
                this.gameState.phase = 'game_over';
                this.gameState.winner = 'Monsters';
                this.addChatLog('system-bad', 'You have been defeated!');
            }
        } else {
            this.addChatLog('combat', `MISS!`);
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
    
    gainXp(amount) {
        if (!this.gameState || !this.gameState.players[this.playerId]) return;
        
        const player = this.gameState.players[this.playerId];
        const currentXp = player.stats.xp || 0;
        const newXp = currentXp + amount;
        
        player.stats.xp = newXp;
        
        // Check for level up
        const requiredXp = this.getRequiredXpForLevel(player.stats.level || 1);
        if (newXp >= requiredXp) {
            this.triggerLevelUp();
        }
        
        this.updateUI();
    }
    
    triggerLevelUp() {
        if (!this.gameState || !this.gameState.players[this.playerId]) return;
        
        const player = this.gameState.players[this.playerId];
        const currentLevel = player.stats.level || 1;
        const newLevel = currentLevel + 1;
        
        player.stats.level = newLevel;
        player.stats.xp = 0; // Reset XP after level up
        
        // Increase max HP
        const hpIncrease = 2;
        player.stats.maxHp = (player.stats.maxHp || 20) + hpIncrease;
        player.stats.currentHp = player.stats.maxHp; // Full heal on level up
        
        // Add to chat log
        this.gameState.chatLog.push({
            type: 'system',
            text: `${player.name} leveled up to level ${newLevel}!`,
            timestamp: Date.now()
        });
        
        this.updateUI();
    }
    
    setMaxLevel() {
        if (!this.gameState || !this.gameState.players[this.playerId]) return;
        
        const player = this.gameState.players[this.playerId];
        player.stats.level = 10;
        player.stats.xp = 0;
        player.stats.maxHp = 40; // Max level HP
        player.stats.currentHp = player.stats.maxHp;
        
        this.gameState.chatLog.push({
            type: 'system',
            text: `${player.name} reached maximum level!`,
            timestamp: Date.now()
        });
        
        this.updateUI();
    }
    
    addGold(amount) {
        if (!this.gameState || !this.gameState.players[this.playerId]) return;
        
        const player = this.gameState.players[this.playerId];
        player.gold = (player.gold || 0) + amount;
        
        this.gameState.chatLog.push({
            type: 'system',
            text: `${player.name} gained ${amount} gold!`,
            timestamp: Date.now()
        });
        
        this.updateUI();
    }
    
    spawnMonster() {
        if (!this.gameState) return;
        
        // Spawn a random monster
        const monsterTypes = ['Goblin', 'Orc', 'Skeleton', 'Spider', 'Wolf'];
        const randomType = monsterTypes[Math.floor(Math.random() * monsterTypes.length)];
        
        const monster = {
            id: `monster_${Date.now()}`,
            name: randomType,
            type: 'monster',
            stats: {
                level: 1,
                currentHp: 15,
                maxHp: 15,
                ac: 10,
                damage: 4
            },
            position: { x: 1, y: 1 } // Spawn in front row
        };
        
        this.gameState.board.monsters.push(monster);
        
        this.gameState.chatLog.push({
            type: 'system',
            text: `A ${randomType} appeared!`,
            timestamp: Date.now()
        });
        
        this.updateUI();
    }
    
    fullHeal() {
        if (!this.gameState || !this.gameState.players[this.playerId]) return;
        
        const player = this.gameState.players[this.playerId];
        player.stats.currentHp = player.stats.maxHp;
        player.isDowned = false;
        
        this.gameState.chatLog.push({
            type: 'system',
            text: `${player.name} was fully healed!`,
            timestamp: Date.now()
        });
        
        this.updateUI();
    }
    
    triggerSpecializationChoice() {
        if (!this.gameState || !this.gameState.players[this.playerId]) return;
        
        const player = this.gameState.players[this.playerId];
        if (player.stats.level >= 3 && !player.specialization) {
            // Trigger specialization modal
            this.gameState.chatLog.push({
                type: 'system',
                text: `${player.name} can now choose a specialization!`,
                timestamp: Date.now()
            });
            
            // In a real implementation, this would trigger the specialization modal
            // For now, just add to chat log
            this.updateUI();
        }
    }
    
    toggleGodMode() {
        this.godMode = !this.godMode;
        
        this.gameState.chatLog.push({
            type: 'system',
            text: `God mode ${this.godMode ? 'enabled' : 'disabled'}!`,
            timestamp: Date.now()
        });
        
        this.updateUI();
    }
    
    getRequiredXpForLevel(level) {
        // Simple XP curve: 100 * level
        return level * 100;
    }
    
    updateUI() {
        // Trigger UI update if in offline mode
        if (this.isOfflineMode && typeof renderUI === 'function') {
            try {
                renderUI();
            } catch (error) {
                console.error('[OfflineGameEngine] Error updating UI:', error);
            }
        }
    }

    saveGame() {
        if (!this.gameState) return false;
        
        try {
            const saveData = {
                gameState: this.gameState,
                monstersKilled: this.monstersKilled,
                timestamp: Date.now(),
                version: '3.0.0'
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
