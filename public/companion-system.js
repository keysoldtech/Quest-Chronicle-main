// Companion System - Handles pet/companion mechanics for Beast Master
// This system allows Rangers to summon and command animal companions

const CompanionSystem = {
    // Companion templates
    companionTemplates: {
        wolf: {
            name: 'Wolf Companion',
            type: 'Companion',
            maxHp: 15,
            ac: 12,
            attackBonus: 3,
            damageBonus: 2,
            damageDice: '1d6',
            requiredRollToHit: 13,
            speed: 3, // movement points
            sprite: 'wolf'
        },
        bear: {
            name: 'Bear Companion',
            type: 'Companion',
            maxHp: 25,
            ac: 13,
            attackBonus: 4,
            damageBonus: 3,
            damageDice: '1d8',
            requiredRollToHit: 14,
            speed: 2,
            sprite: 'bear'
        },
        hawk: {
            name: 'Hawk Companion',
            type: 'Companion',
            maxHp: 10,
            ac: 14,
            attackBonus: 5,
            damageBonus: 1,
            damageDice: '1d4',
            requiredRollToHit: 12,
            speed: 4,
            sprite: 'hawk'
        }
    },
    
    // Summon companion for a player
    summonCompanion(player, companionType = 'wolf') {
        if (player.companion && player.companion.currentHp > 0) {
            showToast('You already have a companion!', 'info');
            return false;
        }
        
        const template = this.companionTemplates[companionType];
        if (!template) {
            console.error('[Companion] Unknown type:', companionType);
            return false;
        }
        
        // Apply Beast Master bonuses
        const bonusMultiplier = this.getBeastMasterBonus(player);
        
        player.companion = {
            ...template,
            id: `companion-${player.id}`,
            ownerId: player.id,
            currentHp: Math.floor(template.maxHp * bonusMultiplier),
            maxHp: Math.floor(template.maxHp * bonusMultiplier),
            attackBonus: template.attackBonus + Math.floor((bonusMultiplier - 1) * 2),
            statusEffects: []
        };
        
        // Place companion near player on grid
        this.placeCompanionOnGrid(player);
        
        console.log('[Companion] Summoned:', player.companion.name);
        return true;
    },
    
    // Get Beast Master tier bonuses
    getBeastMasterBonus(player) {
        let multiplier = 1.0;
        
        // Support legacy and current specialization structures
        // Legacy: player.specializationChoices.tier3 === 'Alpha Beast'
        if (player.specializationChoices && player.specializationChoices.tier3 === 'Alpha Beast') {
            return 1.5;
        }
        
        // Current server structure: player.specializations[tier] = { branch, tier }
        if (player.specializations) {
            const tier3 = player.specializations[3];
            if (tier3 && tier3.branch === 'BeastMaster') {
                multiplier = 1.5; // Alpha Beast tier selected
            }
        }
        
        return multiplier;
    },
    
    // Place companion on grid near player
    placeCompanionOnGrid(player) {
        if (!currentRoomState.gameState?.grid) return;
        
        const grid = currentRoomState.gameState.grid;
        const playerPos = grid.entities[player.id];
        
        if (!playerPos) return;
        
        // Try to place adjacent to player first
        const adjacentPositions = [
            { x: playerPos.x + 1, y: playerPos.y },
            { x: playerPos.x - 1, y: playerPos.y },
            { x: playerPos.x, y: playerPos.y + 1 },
            { x: playerPos.x, y: playerPos.y - 1 }
        ];
        
        for (const pos of adjacentPositions) {
            if (pos.x >= 0 && pos.x < 5 && pos.y >= 0 && pos.y < 5) {
                const occupied = Object.values(grid.entities).some(e => e.x === pos.x && e.y === pos.y);
                if (!occupied) {
                    grid.entities[player.companion.id] = { x: pos.x, y: pos.y, type: 'companion' };
                    console.log('[Companion] Placed at', pos.x, pos.y);
                    return;
                }
            }
        }
        
        // Fallback: place in the first available free cell
        for (let y = 0; y < grid.height; y++) {
            for (let x = 0; x < grid.width; x++) {
                const occupied = Object.values(grid.entities).some(e => e.x === x && e.y === y);
                if (!occupied) {
                    grid.entities[player.companion.id] = { x, y, type: 'companion' };
                    console.warn('[Companion] No adjacent space, placed at first free cell', x, y);
                    return;
                }
            }
        }
        
        console.warn('[Companion] No free space available to place companion');
    },
    
    // Companion attacks (called during player's turn or auto)
    companionAttack(companion, targetId) {
        if (!companion || companion.currentHp <= 0) return null;
        
        const target = currentRoomState.gameState.board.monsters.find(m => m.id === targetId);
        if (!target) return null;
        
        // Attack roll
        const attackRoll = Math.floor(Math.random() * 20) + 1;
        const total = attackRoll + companion.attackBonus;
        const hit = total >= target.requiredRollToHit;
        
        let result = {
            hit,
            attackRoll,
            total,
            damage: 0,
            defeated: false
        };
        
        if (hit) {
            // Damage roll
            const diceMatch = companion.damageDice.match(/(\d+)d(\d+)/);
            if (diceMatch) {
                const count = parseInt(diceMatch[1]);
                const sides = parseInt(diceMatch[2]);
                let damage = 0;
                for (let i = 0; i < count; i++) {
                    damage += Math.floor(Math.random() * sides) + 1;
                }
                damage += companion.damageBonus;
                
                target.currentHp -= damage;
                result.damage = damage;
                
                if (target.currentHp <= 0) {
                    result.defeated = true;
                }
            }
        }
        
        return result;
    },
    
    // Check if companion attacks twice (Command Attack ability)
    shouldAttackTwice(player) {
        // Legacy structure
        if (player.specializationChoices && player.specializationChoices.tier2 === 'Command Attack') return true;
        // Current structure
        if (player.specializations) {
            const tier2 = player.specializations[2];
            return !!(tier2 && tier2.branch === 'BeastMaster');
        }
        return false;
    },
    
    // Companion takes damage
    companionTakeDamage(companion, damage) {
        if (!companion) return;
        
        companion.currentHp -= damage;
        
        if (companion.currentHp <= 0) {
            companion.currentHp = 0;
            return true; // Companion defeated
        }
        
        return false;
    },
    
    // Remove companion from board and grid
    removeCompanion(player) {
        if (!player.companion) return;
        
        // Remove from grid
        if (currentRoomState.gameState?.grid?.entities[player.companion.id]) {
            delete currentRoomState.gameState.grid.entities[player.companion.id];
        }
        
        // Remove from player
        player.companion = null;
        
        console.log('[Companion] Removed');
    }
};

// Expose globally
if (typeof window !== 'undefined') {
    window.CompanionSystem = CompanionSystem;
}
