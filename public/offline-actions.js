// Offline Action Handler - Client-side game logic for offline play
// Handles all player actions when not connected to server

/** Mirrors server `dungeonEvents.npcs` for path "event" rooms and parity with resolveEventChoice. */
const OFFLINE_NPC_EVENT_TEMPLATES = [
    { name: 'Wandering Merchant', description: 'A merchant offers his wares.', interaction: 'trade', priceModifier: 0.85 },
    { name: 'Injured Adventurer', description: 'An injured adventurer needs help.', interaction: 'rescue', reward: 'ally' },
    { name: 'Mysterious Stranger', description: 'A hooded figure watches you...', interaction: 'quest', reward: 'special' },
    { name: 'Treasure Map Seller', description: 'Sells a map to a secret room.', interaction: 'trade', priceModifier: 1.12 }
];

function offlineBuildNpcEventData(template) {
    const id = `event_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const eventData = {
        id,
        type: 'npc',
        name: template.name,
        description: template.description,
        interaction: template.interaction,
        priceModifier: template.priceModifier,
        reward: template.reward,
        choices: []
    };
    if (template.interaction === 'trade') {
        eventData.choices = [
            { label: 'Trade', description: `Browse wares (${Math.round((template.priceModifier || 1) * 100)}% prices)` },
            { label: 'Pass', description: 'Continue onward' }
        ];
    } else if (template.interaction === 'rescue') {
        eventData.choices = [
            { label: 'Help', description: 'Aid the adventurer for a potential reward' },
            { label: 'Ignore', description: 'Leave them be' }
        ];
    } else {
        eventData.choices = [
            { label: 'Investigate', description: 'Risk injury for potential rewards' },
            { label: 'Bypass', description: 'Avoid risk, no reward' }
        ];
    }
    return eventData;
}

const OfflineActionHandler = {
    // Check if we're in offline mode
    isOffline() {
        return typeof offlineMode !== 'undefined' && offlineMode && offlineMode.enabled;
    },
    
    // Main action router
    handleAction(action, payload = {}) {
        if (!this.isOffline()) return false;
        
        console.log('[Offline] Handling action:', action, payload);
        
        const player = currentRoomState.players[myId];
        if (!player) return false;
        
        switch(action) {
            case 'attack': return this.handleAttack(player, payload);
            case 'castSpell': return this.handleCastSpell(player, payload);
            case 'useConsumable': return this.handleUseConsumable(player, payload);
            case 'guard': return this.handleGuard(player);
            case 'rest': return this.handleRest(player);
            case 'respite': return this.handleRespite(player);
            case 'dash': return this.handleDash(player);
            case 'dodge': return this.handleDodge(player);
            case 'endTurn': return this.handleEndTurn(player);
            case 'buyItem': return this.handleBuyItem(player, payload);
            case 'move': return this.handleMove(player, payload);
            case 'equipItem': return this.handleEquip(player, payload);
            case 'resolveSkillCheckRoll': return this.handleSkillCheckRoll(player, payload);
            case 'chooseClass': return this.handleChooseClass(player, payload);
            case 'resolveEvent': return this.handleResolveEvent(player, payload);
            default:
                console.warn('[Offline] Unhandled action:', action);
                return false;
        }
    },

    /** Random NPC encounter for offline "event" path (same button outcomes as online). */
    presentPathNpcEvent() {
        const t = OFFLINE_NPC_EVENT_TEMPLATES[Math.floor(Math.random() * OFFLINE_NPC_EVENT_TEMPLATES.length)];
        const eventData = offlineBuildNpcEventData(t);
        if (typeof eventManager !== 'undefined') {
            eventManager.showEvent(eventData);
        }
    },

    openOfflineMerchantShop(player, priceModifier = 1) {
        const sample = [
            { name: 'Healing Potion', type: 'Consumable', price: 10 },
            { name: 'Lockpicks', type: 'Item', price: 8 },
            { name: 'Quick Blade', type: 'Weapon', price: 20 },
            { name: 'Hide Vest', type: 'Armor', price: 15 }
        ];
        const shopTs = Date.now();
        const inv = sample.map((c, i) => ({
            ...c,
            id: `shop_${shopTs}_${i}`,
            price: Math.max(1, Math.round((c.price || 10) * priceModifier))
        }));
        currentRoomState.gameState.shop = { id: `shop_${shopTs}`, inventory: inv };
        const modal = document.getElementById('shop-modal');
        if (modal && typeof renderShopInventory === 'function') {
            renderShopInventory(inv, currentRoomState.gameState.shop.id);
            if (typeof clientState !== 'undefined') {
                clientState.shopState = {
                    isMultiplayer: false,
                    totalPlayers: 1,
                    playerId: typeof myId !== 'undefined' ? myId : 'offline',
                    isFinished: false
                };
            }
            const closeBtn = document.getElementById('shop-close-btn');
            if (closeBtn) {
                closeBtn.onclick = () => {
                    modal.classList.add('hidden');
                    if (typeof NotificationManager !== 'undefined') {
                        NotificationManager.resumeGameFromModal('shop');
                    }
                };
            }
            if (typeof NotificationManager !== 'undefined') {
                NotificationManager.pauseGameForModal('shop');
            }
            modal.classList.remove('hidden');
            if (typeof updateShopUI === 'function') updateShopUI();
        }
    },

    handleResolveEvent(player, payload) {
        const eventId = payload?.eventId;
        const idx = Math.max(0, parseInt(payload?.choiceIndex, 10) || 0);
        const pending = player.pendingDungeonEvent;

        if (!pending || pending.id !== eventId) {
            this.addChatLog('system-bad', player.name, `${player.name}'s encounter choice could not be applied (stale event).`);
            player.pendingDungeonEvent = null;
            this.updateUI();
            return true;
        }
        player.pendingDungeonEvent = null;

        if (pending.interaction === 'trade') {
            if (idx === 0) {
                this.addChatLog('action-good', player.name, `${player.name} visits ${pending.name || 'the merchant'}.`);
                this.openOfflineMerchantShop(player, pending.priceModifier || 1);
            } else {
                this.addChatLog('action', player.name, `${player.name} declines and moves on.`);
            }
        } else if (pending.interaction === 'rescue') {
            if (idx === 0) {
                if (!Array.isArray(player.hand)) player.hand = [];
                const potion = {
                    name: 'Healing Potion',
                    type: 'Consumable',
                    category: 'Potion',
                    apCost: 1,
                    effect: { type: 'heal', dice: '2d4+2', target: 'self' },
                    id: `pot_${Date.now()}`
                };
                player.hand.push(potion);
                currentRoomState.gameState.partyHope = Math.min(100, (currentRoomState.gameState.partyHope || 5) + 3);
                player.gold = (player.gold || 0) + 8;
                this.addChatLog('action-good', player.name, `${player.name} helps the stranded adventurer — Healing Potion, 8 gold, party hope rises.`);
            } else {
                this.addChatLog('action', player.name, `${player.name} leaves the traveler behind.`);
            }
        } else {
            if (idx === 0) {
                const dmg = this.rollDice('1d4').total;
                player.stats.currentHp = Math.max(1, (player.stats.currentHp || 1) - dmg);
                const gold = this.rollDice('2d6').total;
                player.gold = (player.gold || 0) + gold;
                this.addChatLog('action-good', player.name, `${player.name} investigates — trap for ${dmg} damage, found ${gold} gold.`);
            } else {
                this.addChatLog('action', player.name, `${player.name} keeps their distance.`);
            }
        }

        this.updateUI();
        return true;
    },

    handleBuyItem(player, payload) {
        const shop = currentRoomState?.gameState?.shop;
        if (!shop) return true;
        const idx = shop.inventory.findIndex(c => c.id === payload.cardId);
        if (idx === -1) return true;
        const card = shop.inventory[idx];
        const price = Number(payload.price || card.price || 10);
        const gold = player.gold || 0;
        if (gold < price) { showToast('Not enough gold', 'error'); return true; }
        player.gold = gold - price;
        // Give the card (simple: add to hand)
        player.hand.push({ ...card, id: `${card.type || 'Item'}_${Date.now()}` });
        shop.inventory.splice(idx, 1);
        this.addChatLog('system-good', player.name, `${player.name} bought ${card.name} for ${price} gold.`);
        // Update gold UI immediately
        try { renderShopInventory(shop.inventory, shop.id, currentRoomState); } catch (_) {}
        this.updateUI();
        return true;
    },

    handleChooseClass(player, payload) {
        const classId = payload?.classId;
        if (!classId || !currentRoomState?.staticData?.classes?.[classId]) {
            showToast('Please select a class.', 'error');
            return true;
        }
        // Set class and baseline stats similar to online flow
        player.class = classId;
        // Initialize AP and HP reasonably; mirror online start shape
        player.stats.maxAP = player.stats.maxAP || 2;
        player.currentAp = player.stats.maxAP;
        player.stats.maxHp = player.stats.maxHp || 18;
        player.stats.currentHp = player.stats.currentHp || player.stats.maxHp;
        // Give unarmed strike to hand if missing
        if (!player.equipment.weapon) {
            player.equipment.weapon = { id: 'unarmed', name: 'Unarmed Strike', type: 'Weapon', apCost: 1, effect: { dice: '1d4' } };
        }
        // Transition to started phase for offline play
        if (currentRoomState?.gameState?.phase === 'class_selection') {
            currentRoomState.gameState.phase = 'started';
            currentRoomState.gameState.turnOrder = [player.id];
            currentRoomState.gameState.currentPlayerIndex = 0;
            currentRoomState.gameState.turnCount = 1;
            // Place player on grid if not present
            const grid = currentRoomState.gameState.grid || (currentRoomState.gameState.grid = { width: 5, height: 5, entities: {} });
            if (!grid.entities[player.id]) {
                grid.entities[player.id] = { x: 2, y: 4, type: 'player' };
            }
            // Spawn a monster to make combat feel alive
            if ((currentRoomState.gameState.board?.monsters || []).length === 0) {
                this.spawnMonster();
            }
        }
        // Close modal and render gameplay
        const modal = document.getElementById('class-selection-modal');
        if (modal) modal.classList.add('hidden');
        this.updateUI();
        return true;
    },
    
    // Dice rolling utilities
    rollDie(sides) {
        return Math.floor(Math.random() * sides) + 1;
    },
    
    rollWithAdvantage(sides) {
        const a = this.rollDie(sides);
        const b = this.rollDie(sides);
        return Math.max(a, b);
    },
    
    rollWithDisadvantage(sides) {
        const a = this.rollDie(sides);
        const b = this.rollDie(sides);
        return Math.min(a, b);
    },
    
    rollDice(notation) {
        const match = notation.match(/(\d+)d(\d+)(?:\+(\d+))?/);
        if (!match) return { total: 0, rolls: [], bonus: 0 };
        
        const count = parseInt(match[1]);
        const sides = parseInt(match[2]);
        const bonus = parseInt(match[3] || 0);
        
        const rolls = [];
        for (let i = 0; i < count; i++) {
            rolls.push(this.rollDie(sides));
        }
        
        const total = rolls.reduce((sum, r) => sum + r, 0) + bonus;
        return { total, rolls, bonus };
    },
    
    // Basic actions
    handleGuard(player) {
        if (player.currentAp < 1) {
            showToast('Not enough AP', 'error');
            return true;
        }
        
        player.currentAp -= 1;
        player.stats.shieldHp = (player.stats.shieldHp || 0) + (player.stats.shieldBonus || 2);
        
        this.addChatLog('action', player.name, `${player.name} guards! (+${player.stats.shieldBonus || 2} shield HP)`);
        this.updateUI();
        if (player.currentAp <= 0 && typeof showEndTurnPrompt === 'function') setTimeout(() => showEndTurnPrompt(), 250);
        return true;
    },
    
    handleRest(player) {
        if (player.currentAp < 2) {
            showToast('Not enough AP (need 2)', 'error');
            return true;
        }
        
        player.currentAp -= 2;
        const healing = this.rollDice('1d8').total + Math.floor((player.stats.con || 0) / 2);
        player.stats.currentHp = Math.min(player.stats.maxHp, player.stats.currentHp + healing);
        
        this.addChatLog('action-good', player.name, `${player.name} rests and heals ${healing} HP`);
        this.updateUI();
        if (player.currentAp <= 0 && typeof showEndTurnPrompt === 'function') setTimeout(() => showEndTurnPrompt(), 250);
        return true;
    },
    
    handleRespite(player) {
        if (player.currentAp < 1) {
            showToast('Not enough AP', 'error');
            return true;
        }
        
        player.currentAp -= 1;
        const healing = this.rollDice('1d4').total;
        player.stats.currentHp = Math.min(player.stats.maxHp, player.stats.currentHp + healing);
        
        this.addChatLog('action-good', player.name, `${player.name} takes a brief respite (+${healing} HP)`);
        this.updateUI();
        if (player.currentAp <= 0 && typeof showEndTurnPrompt === 'function') setTimeout(() => showEndTurnPrompt(), 250);
        return true;
    },
    
    handleDash(player) {
        if (player.currentAp < 1) {
            showToast('Not enough AP', 'error');
            return true;
        }
        
        player.currentAp -= 1;
        player.movementPoints = (player.movementPoints || 2) + 2;
        
        this.addChatLog('action', player.name, `${player.name} dashes forward!`);
        this.updateUI();
        return true;
    },
    
    handleDodge(player) {
        if (player.currentAp < 1) {
            showToast('Not enough AP', 'error');
            return true;
        }
        
        player.currentAp -= 1;
        player.stats.shieldHp = (player.stats.shieldHp || 0) + 2;
        
        this.addChatLog('action', player.name, `${player.name} dodges! (+2 shield HP)`);
        this.updateUI();
        return true;
    },
    
    // End turn and run NPC/monster turns
    handleEndTurn(player) {
        console.log('[Offline] Ending turn');
        
        // Run NPC turns first
        this.runNpcTurns();
        
        // Monster turns
        this.runMonsterTurns();
        
        // Spawn monster occasionally
        if (Math.random() < 0.3 && currentRoomState.gameState.board.monsters.length < 3) {
            this.spawnMonster();
        }
        
        // Increment turn count
        currentRoomState.gameState.turnCount = (currentRoomState.gameState.turnCount || 0) + 1;

        // Offline parity: occasionally present Choose Your Path based on interval
        const interval = (currentRoomState.settings?.pathChoiceInterval) || 2;
        const round = currentRoomState.gameState.turnCount;
        const canPresent = (round - (currentRoomState.gameState.lastPathChoiceRound || 0)) >= interval;
        if (canPresent) {
            currentRoomState.gameState.lastPathChoiceRound = round;
            // Generate 3 options similar to online
            const types = ['combat', 'treasure', 'event', 'shop', 'rest'];
            const options = [];
            while (options.length < 3) {
                const t = types[Math.floor(Math.random() * types.length)];
                options.push({ id: `room_${Date.now()}_${options.length}`, type: t, preview: { danger: '?', reward: '?' } });
            }
            // Try to avoid immediate repeats
            const recent = currentRoomState.gameState.recentRoomTypes || [];
            const unique = options.filter(o => !recent.includes(o.type));
            currentRoomState.gameState.nextRooms = unique.length >= 2 ? unique.slice(0,3) : options;
            currentRoomState.gameState.pathChooserId = myId;
            try { renderChoosePathModal(); } catch (_) {}
        }
        
        // Reset player for next turn (this should happen after NPC/monster turns)
        player.currentAp = player.stats.maxAP || player.stats.ap || 5;
        player.movementPoints = 2;
        player.stats.shieldHp = 0;
        
        this.addChatLog('system', null, `Turn ${currentRoomState.gameState.turnCount} - Your turn!`);
        
        this.updateUI();
        showToast('Your turn!', 'info');
        return true;
    },

    // Companion system integration
    handleSummonCompanion(player, payload) {
        const apCost = 1;
        if (player.currentAp < apCost) {
            showToast('Not enough AP to summon', 'error');
            return true;
        }
        if (player.companion && player.companion.currentHp > 0) {
            showToast('You already have a companion!', 'info');
            return true;
        }
        const type = (payload?.companionType || 'wolf').toLowerCase();
        const ok = CompanionSystem.summonCompanion(player, type);
        if (ok) {
            player.currentAp -= apCost;
            this.addChatLog('system-good', player.name, `${player.name} summons a ${type}!`);
            this.updateUI();
        }
        return true;
    },

    handleCompanionAttack(player, payload) {
        if (!player.companion || player.companion.currentHp <= 0) {
            showToast('No active companion', 'error');
            return true;
        }
        if (player.currentAp < 1) {
            showToast('Not enough AP', 'error');
            return true;
        }
        const targetId = payload?.targetId;
        const result = CompanionSystem.companionAttack(player.companion, targetId);
        if (!result) {
            showToast('Invalid target', 'error');
            return true;
        }
        player.currentAp -= 1;
        const target = currentRoomState.gameState.board.monsters.find(m => m.id === targetId);
        const summary = result.hit ? `hits for ${result.damage} damage` : 'misses';
        this.addChatLog(result.hit ? 'combat-hit' : 'combat', player.name, `Companion ${summary}!`);
        
        if (result.defeated) {
            this.handleMonsterDefeat(player, target);
        }
        
        // Command Attack: bonus strike
        if (CompanionSystem.shouldAttackTwice(player) && target && target.currentHp > 0) {
            const bonus = CompanionSystem.companionAttack(player.companion, targetId);
            if (bonus) {
                const sum2 = bonus.hit ? `hits for ${bonus.damage} damage` : 'misses';
                this.addChatLog(bonus.hit ? 'combat-hit' : 'combat', player.name, `Companion (2nd) ${sum2}!`);
                if (bonus.defeated) {
                    this.handleMonsterDefeat(player, target);
                }
            }
        }
        
        this.updateUI();
        return true;
    },
    
    // Combat system
    handleAttack(player, payload) {
        const { targetId, weaponId } = payload;
        
        const weapon = player.equipment?.weapon || 
                      player.hand.find(c => c.id === weaponId) ||
                      { name: 'Unarmed Strike', apCost: 1, effect: { dice: '1d4' } };
        
        const apCost = weapon.apCost || 1;
        if (player.currentAp < apCost) {
            showToast('Not enough AP', 'error');
            return true;
        }
        
        const target = currentRoomState.gameState.board.monsters.find(m => m.id === targetId);
        if (!target) {
            showToast('Target not found', 'error');
            return true;
        }
        
        player.currentAp -= apCost;
        
        // Attack roll with simple advantage: if companion is alive, grant advantage
        // If a roll was provided by the dice modal, use it; otherwise roll now
        let attackRoll = payload?.roll || this.rollDie(20);
        if (player.companion && player.companion.currentHp > 0) {
            attackRoll = this.rollWithAdvantage(20);
        }
        const hitBonus = player.stats.hitBonus || 0;
        const total = attackRoll + hitBonus;
        const hit = total >= (target.requiredRollToHit || 12);
        
        this.addChatLog('combat', player.name, `${player.name} attacks ${target.name}! Rolled ${attackRoll}+${hitBonus}=${total} vs AC ${target.requiredRollToHit || 12} - ${hit ? 'HIT!' : 'Miss!'}`);
        
        if (hit) {
            const damageResult = this.rollDice(weapon.effect.dice);
            const damageBonus = player.stats.damageBonus || 0;
            const totalDamage = damageResult.total + damageBonus;
            
            target.currentHp -= totalDamage;
            
            this.addChatLog('combat-hit', player.name, `${player.name} deals ${totalDamage} damage!`);
            
            if (typeof showDamageNumber === 'function') {
                showDamageNumber(totalDamage, window.innerWidth / 2, window.innerHeight / 2, attackRoll === 20);
            }
            
            if (attackRoll === 20 && typeof showCriticalFlash === 'function') {
                showCriticalFlash();
            }
            
            if (target.currentHp <= 0) {
                this.handleMonsterDefeat(player, target);
            }
        }
        
        this.updateUI();
        return true;
    },
    
    // Monster defeat
    handleMonsterDefeat(player, monster) {
        const xpGained = monster.xpValue || 10;
        player.xp = (player.xp || 0) + xpGained;
        
        this.addChatLog('system-good', player.name, `${monster.name} defeated! +${xpGained} XP`);
        
        currentRoomState.gameState.board.monsters = currentRoomState.gameState.board.monsters.filter(m => m.id !== monster.id);
        
        if (currentRoomState.gameState.grid.entities[monster.id]) {
            delete currentRoomState.gameState.grid.entities[monster.id];
        }
        
        const xpNeeded = player.xpToNextLevel || 25;
        if (player.xp >= xpNeeded) {
            this.handleLevelUp(player);
        }
        
        if (Math.random() < 0.3) { this.dropLoot(); }
        // Risk/Reward: offer a simple choice after each kill
        this.offerRiskRewardChoice();
    },

    offerRiskRewardChoice() {
        // Use the unified event modal for offline risk choices for parity
        const player = currentRoomState.players[myId];
        if (!player) return;
        const eventData = {
            id: `risk_${Date.now()}`,
            type: 'hazard',
            name: 'Cursed Font',
            description: 'Drink to gain power now, at a cost later.',
            choices: [
                { label: 'Drink', description: '+5 Max HP now, -1 AP next combat' },
                { label: 'Walk Away', description: 'Avoid the curse' }
            ]
        };
        const handle = (index) => {
            if (index === 0) {
                player.stats.maxHp += 5;
                player.stats.currentHp = Math.min(player.stats.maxHp, player.stats.currentHp + 5);
                player._nextCombatApPenalty = 1;
                OfflineActionHandler.addChatLog('system', player.name, 'You feel empowered... but something was taken.');
            } else {
                OfflineActionHandler.addChatLog('system', player.name, 'You resist the tempting power.');
            }
        };
        // Wire temporary listeners through eventManager
        if (typeof eventManager !== 'undefined') {
            const originalSelect = eventManager.selectChoice.bind(eventManager);
            eventManager.selectChoice = (choiceIndex) => {
                handle(choiceIndex);
                const modal = document.getElementById('event-modal');
                if (modal) modal.classList.add('hidden');
                eventManager.selectChoice = originalSelect; // restore
            };
            eventManager.showEvent(eventData);
        } else {
            // Fallback: confirmation dialog
            const choice = confirm('Risk/Reward: Drink from the cursed font? (+5 max HP now, but -1 AP next combat)');
            handle(choice ? 0 : 1);
        }
    },
    
    // Level up
    handleLevelUp(player) {
        player.level = (player.level || 1) + 1;
        
        // CRITICAL FIX: Reset XP to 0 after leveling (keep excess for chained level ups)
        const excessXp = player.xp - player.xpToNextLevel;
        player.xp = Math.max(0, excessXp); // Reset to 0, but keep any excess XP
        
        player.xpToNextLevel = Math.floor((player.xpToNextLevel || 25) * 1.5);
        player.stats.currentHp = player.stats.maxHp;
        
        const stats = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
        const statToIncrease = stats[Math.floor(Math.random() * stats.length)];
        player.stats[statToIncrease] = (player.stats[statToIncrease] || 0) + 1;
        
        this.addChatLog('system-good', player.name, `Level ${player.level}! ${statToIncrease.toUpperCase()} +1, Full Heal!`);
        
        if (typeof showLevelUpEffect === 'function') {
            showLevelUpEffect();
        }
        
        showToast(`Level ${player.level}!`, 'success', 4000);
    },
    
    // Loot drop
    dropLoot() {
        const loot = { 
            name: 'Healing Potion', 
            type: 'Consumable', 
            apCost: 1, 
            effect: { type: 'heal', dice: '2d4+2' },
            id: 'loot-' + Date.now()
        };
        
        currentRoomState.gameState.lootPool = currentRoomState.gameState.lootPool || [];
        currentRoomState.gameState.lootPool.push(loot);
        
        this.addChatLog('system-good', null, `${loot.name} dropped!`);
    },
    
    // Spell casting
    handleCastSpell(player, payload) {
        const { cardId, targetId } = payload;
        const spell = player.hand.find(c => c.id === cardId);
        
        if (!spell) {
            showToast('Spell not found', 'error');
            return true;
        }
        
        const apCost = spell.apCost || 2;
        if (player.currentAp < apCost) {
            showToast('Not enough AP', 'error');
            return true;
        }
        
        player.currentAp -= apCost;
        
        const target = currentRoomState.players[targetId] || 
                      currentRoomState.gameState.board.monsters.find(m => m.id === targetId);
        
        if (spell.effect.type === 'damage') {
            const damage = this.rollDice(spell.effect.dice).total;
            target.currentHp -= damage;
            
            this.addChatLog('combat', player.name, `${player.name} casts ${spell.name} for ${damage} damage!`);
            
            if (target.currentHp <= 0 && target.type === 'Monster') {
                this.handleMonsterDefeat(player, target);
            }
        } else if (spell.effect.type === 'heal') {
            const healing = this.rollDice(spell.effect.dice).total;
            target.stats.currentHp = Math.min(target.stats.maxHp, target.stats.currentHp + healing);
            
            this.addChatLog('action-good', player.name, `${player.name} casts ${spell.name}, healing ${healing} HP!`);
        }
        
        if (spell.type === 'Utility' || spell.category === 'Utility') {
            player.hand = player.hand.filter(c => c.id !== cardId);
        }
        
        this.updateUI();
        if (typeof showToast === 'function') {
            showToast('Spell resolved', 'success', 1200);
        }
        return true;
    },
    
    // Use consumable
    handleUseConsumable(player, payload) {
        const { cardId } = payload;
        const item = player.hand.find(c => c.id === cardId);
        
        if (!item) {
            showToast('Item not found', 'error');
            return true;
        }
        
        const apCost = item.apCost || 1;
        if (player.currentAp < apCost) {
            showToast('Not enough AP', 'error');
            return true;
        }
        
        player.currentAp -= apCost;
        
        if (item.effect.type === 'heal') {
            const healing = this.rollDice(item.effect.dice).total;
            player.stats.currentHp = Math.min(player.stats.maxHp, player.stats.currentHp + healing);
            
            this.addChatLog('action-good', player.name, `${player.name} uses ${item.name}, healing ${healing} HP!`);
        }
        
        player.hand = player.hand.filter(c => c.id !== cardId);
        
        this.updateUI();
        return true;
    },
    
    // Equip item
    handleEquip(player, payload) {
        const { cardId } = payload;
        const card = player.hand.find(c => c.id === cardId);
        
        if (!card) {
            showToast('Equip from your hand: select a weapon/armor card there, then Equip.', 'warning', 4000);
            return true;
        }
        
        if (player.currentAp < 1) {
            showToast('Not enough AP to equip (need 1 AP).', 'error');
            return true;
        }
        
        player.currentAp -= 1;
        
        player.equipment = player.equipment || {};
        
        const slot = card.type === 'Weapon' ? 'weapon' : card.type === 'Armor' ? 'armor' : null;
        if (!slot) {
            showToast('Only weapons and armor can be equipped.', 'warning');
            player.currentAp += 1;
            return true;
        }
        const prev = player.equipment[slot];
        player.equipment[slot] = card;
        player.hand = player.hand.filter(c => c.id !== cardId);
        if (prev) {
            player.hand.push(prev);
            this.addChatLog('action', player.name, `${player.name} swapped to ${card.name} (previous ${prev.name} returned to hand).`);
        } else {
            this.addChatLog('action-good', player.name, `${player.name} equipped ${card.name}.`);
        }
        
        this.updateUI();
        return true;
    },
    
    // Class Selection
    handleClassSelection(classId) {
        const player = currentRoomState.players[myId];
        if (!player || player.class) return false;
        
        const classData = currentRoomState.staticData.classes[classId];
        if (!classData) return false;
        
        // Apply class to player
        player.class = classId;
        
        // Calculate stats based on class
        player.stats = {
            str: classData.stats.str,
            dex: classData.stats.dex,
            con: classData.stats.con,
            int: classData.stats.int,
            wis: classData.stats.wis,
            cha: classData.stats.cha,
            maxHp: classData.baseHp,
            currentHp: classData.baseHp,
            maxAP: classData.baseAP,
            currentAp: classData.baseAP,
            hitBonus: 0,
            shieldBonus: classData.baseShieldBonus,
            damageBonus: classData.baseDamageBonus
        };
        
        // Update movement points
        player.movementPoints = 2;
        
        this.addChatLog('system', 'System', `${player.name} chose ${classId} class!`);
        
        // Check if all players have chosen classes
        const allPlayersReady = Object.values(currentRoomState.players).filter(p => !p.isNpc).every(p => p.class);
        
        if (allPlayersReady) {
            // Auto-start the game in offline mode
            this.startGame();
        }
        
        this.updateUI();
        return true;
    },
    
    // Start Game
    startGame() {
        currentRoomState.gameState.phase = 'started';
        currentRoomState.gameState.turnCount = 1;
        currentRoomState.gameState.currentPlayerIndex = 0;
        
        // Initialize grid positions for all players
        const grid = currentRoomState.gameState.grid;
        const playerIds = currentRoomState.gameState.turnOrder;
        
        // Place player at center
        grid.entities[myId] = { x: 2, y: 2, type: 'player' };
        
        // Reset all players for first turn
        Object.values(currentRoomState.players).forEach(player => {
            if (!player.isNpc) {
                player.currentAp = player.stats.maxAP;
                player.movementPoints = 2;
            }
        });
        
        this.addChatLog('system', 'System', 'Game started! Good luck, adventurers!');
        this.updateUI();
    },
    
    // Movement
    handleMove(player, payload) {
        const { targetX, targetY, movementCost } = payload;
        
        console.log('[Offline] Move attempt:', { targetX, targetY, movementCost, currentMP: player.movementPoints });
        
        // Double-check movement points (in case of race conditions)
        if (player.movementPoints < movementCost) {
            console.log('[Offline] Move failed - insufficient movement points:', player.movementPoints, '<', movementCost);
            return false;
        }
        
        // Client already validated movement points, so just execute the move
        const grid = currentRoomState.gameState.grid;
        const playerPos = grid.entities[player.id];
        
        if (playerPos) {
            playerPos.x = targetX;
            playerPos.y = targetY;
            player.movementPoints -= movementCost;
            
            console.log('[Offline] Move successful:', { newPos: { x: targetX, y: targetY }, remainingMP: player.movementPoints });
            
            this.addChatLog('action', player.name, `${player.name} moves to (${targetX}, ${targetY})`);
            
            // Immediately update the grid visual
            if (typeof combatGrid !== 'undefined' && combatGrid.render) {
                combatGrid.render();
            }
        } else {
            console.log('[Offline] Move failed - no player position found');
            return false;
        }
        
        this.updateUI();
        return true;
    },
    
    // Skill Check Roll (for trapped chests, etc.)
    handleSkillCheckRoll(player, payload) {
        const { skill, dc, rollType } = payload;
        
        // Roll the dice
        const roll = this.rollDice('1d20');
        const modifier = player.stats[skill] || 0;
        const total = roll.total + modifier;
        
        // Determine success/failure
        const success = total >= dc;
        const resultText = success ? 'Success!' : 'Failure!';
        
        this.addChatLog('dice', player.name, `${player.name} attempts ${skill} check (DC ${dc}): ${roll.total} + ${modifier} = ${total} - ${resultText}`);
        
        // Handle success/failure effects
        if (success) {
            // Success - no negative effects
            this.addChatLog('action-good', player.name, `${player.name} successfully completes the ${rollType}!`);
        } else {
            // Failure - apply negative effects (damage, status effects, etc.)
            const damage = Math.floor(Math.random() * 6) + 1; // 1d6 damage
            player.stats.currentHp = Math.max(0, player.stats.currentHp - damage);
            
            this.addChatLog('combat', player.name, `${player.name} fails the ${rollType} and takes ${damage} damage!`);
            
            if (player.stats.currentHp <= 0) {
                player.isDowned = true;
                this.addChatLog('combat', player.name, `${player.name} is downed!`);
            }
        }
        
        this.updateUI();
        return true;
    },
    
    // Monster turns
    runMonsterTurns() {
        const monsters = currentRoomState.gameState.board.monsters;
        const player = currentRoomState.players[myId];
        
        if (!monsters || !player) return;
        
        monsters.forEach(monster => {
            if (monster.currentHp <= 0) return;
            
            // Decide whether to attack player or companion if present
            const targetIsCompanion = !!(player.companion && player.companion.currentHp > 0) && Math.random() < 0.5;
            if (targetIsCompanion) {
                const attackRoll = this.rollDie(20) + (monster.attackBonus || 2);
                const targetAC = player.companion.ac || 12;
                if (attackRoll >= targetAC) {
                    const damage = this.rollDice(monster.effect?.dice || '1d6').total;
                    const defeated = CompanionSystem.companionTakeDamage(player.companion, damage);
                    this.addChatLog('combat', monster.name, `${monster.name} hits your companion for ${damage}!`);
                    if (defeated) {
                        this.addChatLog('system-bad', player.name, `Your companion falls!`);
                        CompanionSystem.removeCompanion(player);
                    }
                } else {
                    this.addChatLog('combat', monster.name, `${monster.name} misses your companion!`);
                }
            } else {
                const attackRoll = this.rollDie(20) + (monster.attackBonus || 2);
                const playerAC = 10 + (player.stats.shieldBonus || 0);
                
                if (attackRoll >= playerAC) {
                    const damage = this.rollDice(monster.effect?.dice || '1d6').total;
                    const shieldAbsorb = Math.min(damage, player.stats.shieldHp || 0);
                    const actualDamage = damage - shieldAbsorb;
                    
                    if (player.stats.shieldHp > 0) {
                        player.stats.shieldHp = Math.max(0, player.stats.shieldHp - damage);
                    }
                    
                    player.stats.currentHp -= actualDamage;
                    
                    this.addChatLog('combat', monster.name, `${monster.name} hits for ${damage} damage!`);
                    
                    if (player.stats.currentHp <= 0) {
                        player.stats.currentHp = 0;
                        player.isDowned = true;
                        showToast('You have been downed!', 'error', 5000);
                    }
                } else {
                    this.addChatLog('combat', monster.name, `${monster.name} misses!`);
                }
            }
        });
    },
    
    // NPC turns - handle NPC companion actions
    runNpcTurns() {
        const npcs = Object.values(currentRoomState.players).filter(p => p.isNpc && !p.isDowned);
        
        npcs.forEach(npc => {
            // Simple NPC AI: attack monsters if in range, otherwise move closer
            const monsters = currentRoomState.gameState.board.monsters;
            const grid = currentRoomState.gameState.grid;
            const npcPos = grid.entities[npc.id];
            
            if (npcPos && monsters.length > 0) {
                // Find closest monster
                let closestMonster = null;
                let closestDistance = 999;
                
                monsters.forEach(monster => {
                    const monsterPos = grid.entities[monster.id];
                    if (monsterPos) {
                        const distance = Math.abs(npcPos.x - monsterPos.x) + Math.abs(npcPos.y - monsterPos.y);
                        if (distance < closestDistance) {
                            closestDistance = distance;
                            closestMonster = monster;
                        }
                    }
                });
                
                if (closestMonster && closestDistance <= 2) {
                    // Attack monster
                    const monsterPos = grid.entities[closestMonster.id];
                    if (Math.random() < 0.8) {
                        const damage = Math.floor(Math.random() * 8) + npc.stats.str;
                        closestMonster.currentHp -= damage;
                        this.addChatLog('combat', npc.name, `${npc.name} attacks ${closestMonster.name} for ${damage} damage!`);
                        
                        if (closestMonster.currentHp <= 0) {
                            this.handleMonsterDefeat(npc, closestMonster);
                        }
                    } else {
                        this.addChatLog('combat', npc.name, `${npc.name} misses ${closestMonster.name}!`);
                    }
                } else if (closestMonster) {
                    // Move towards monster
                    const monsterPos = grid.entities[closestMonster.id];
                    const dx = monsterPos.x > npcPos.x ? 1 : monsterPos.x < npcPos.x ? -1 : 0;
                    const dy = monsterPos.y > npcPos.y ? 1 : monsterPos.y < npcPos.y ? -1 : 0;
                    
                    const newX = npcPos.x + dx;
                    const newY = npcPos.y + dy;
                    
                    // Check if move is valid
                    if (newX >= 0 && newX < 5 && newY >= 0 && newY < 5) {
                        const isOccupied = Object.values(grid.entities).some(pos => pos && pos.x === newX && pos.y === newY);
                        if (!isOccupied) {
                            npcPos.x = newX;
                            npcPos.y = newY;
                            this.addChatLog('action', npc.name, `${npc.name} moves to (${newX}, ${newY})`);
                        }
                    }
                }
            }
            
            // Reset NPC AP for next turn
            npc.currentAp = npc.stats.maxAP;
            npc.movementPoints = 2;
        });
    },
    
    // Spawn monster
    spawnMonster() {
        const templates = [
            { name: 'Goblin', maxHp: 12, currentHp: 12, attackBonus: 2, requiredRollToHit: 13, effect: { dice: '1d6' }, xpValue: 10 },
            { name: 'Skeleton', maxHp: 15, currentHp: 15, attackBonus: 3, requiredRollToHit: 14, effect: { dice: '1d8' }, xpValue: 15 },
            { name: 'Orc', maxHp: 18, currentHp: 18, attackBonus: 4, requiredRollToHit: 15, effect: { dice: '1d8+2' }, xpValue: 20 }
        ];
        
        const template = templates[Math.floor(Math.random() * templates.length)];
        const monster = { 
            ...template, 
            id: 'monster-' + Date.now(),
            type: 'Monster',
            statusEffects: []
        };
        
        currentRoomState.gameState.board.monsters.push(monster);
        
        // Place on grid
        const grid = currentRoomState.gameState.grid;
        for (let y = 0; y < 3; y++) {
            for (let x = 0; x < 5; x++) {
                const occupied = Object.values(grid.entities || {}).some(e => e.x === x && e.y === y);
                if (!occupied) {
                    grid.entities[monster.id] = { x, y, type: 'monster' };
                    this.addChatLog('dm', 'DM', `A ${monster.name} appears!`);
                    return;
                }
            }
        }
    },
    
    // Helpers
    addChatLog(type, playerName, text) {
        currentRoomState.chatLog = currentRoomState.chatLog || [];
        currentRoomState.chatLog.push({
            type,
            playerName,
            text,
            timestamp: Date.now()
        });
    },
    
    updateUI() {
        if (typeof renderUI === 'function') renderUI();
        if (typeof combatGrid !== 'undefined' && combatGrid.render) combatGrid.render();
    }
};
