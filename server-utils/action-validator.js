/**
 * Action Validator - Centralized validation for game actions
 * Provides reusable validation rules and composable validation chains
 */

class ValidationError extends Error {
    constructor(message, code = 'VALIDATION_ERROR') {
        super(message);
        this.name = 'ValidationError';
        this.code = code;
        this.userFriendly = true; // Safe to show to user
    }
}

class ActionValidator {
    constructor(gameManager) {
        this.gm = gameManager;
    }

    /**
     * Validation Rules Library
     * Each rule throws ValidationError if check fails
     */
    rules = {
        // Player validation
        isPlayerTurn: (room, player) => {
            if (!room.gameState.turnOrder || room.gameState.turnOrder.length === 0) {
                throw new ValidationError('No turn order established', 'NO_TURN_ORDER');
            }
            
            const currentPlayerId = room.gameState.turnOrder[room.gameState.currentPlayerIndex];
            if (currentPlayerId !== player.id) {
                const currentPlayer = room.players[currentPlayerId];
                throw new ValidationError(
                    `Not your turn. It's ${currentPlayer?.name || 'another player'}'s turn.`,
                    'NOT_YOUR_TURN'
                );
            }
        },

        hasEnoughAP: (player, cost) => {
            const actualCost = typeof cost === 'function' ? cost(player) : cost;
            if ((player.currentAp || 0) < actualCost) {
                throw new ValidationError(
                    `Not enough AP. Need ${actualCost}, have ${player.currentAp || 0}`,
                    'INSUFFICIENT_AP'
                );
            }
        },

        isNotDowned: (player) => {
            if (player.isDowned) {
                throw new ValidationError(
                    'Cannot act while downed',
                    'PLAYER_DOWNED'
                );
            }
        },

        hasNoPendingAction: (player) => {
            if (player.pendingAction) {
                throw new ValidationError(
                    `Complete your current action first (${player.pendingAction})`,
                    'PENDING_ACTION'
                );
            }
        },

        playerExists: (room, playerId) => {
            if (!room.players[playerId]) {
                throw new ValidationError(
                    'Player not found',
                    'PLAYER_NOT_FOUND'
                );
            }
        },

        isNotDisconnected: (player) => {
            if (player.disconnected) {
                throw new ValidationError(
                    'Player is disconnected',
                    'PLAYER_DISCONNECTED'
                );
            }
        },

        // Game state validation
        gameInProgress: (room) => {
            if (room.gameState.phase !== 'started') {
                throw new ValidationError(
                    `Game not started (phase: ${room.gameState.phase})`,
                    'GAME_NOT_STARTED'
                );
            }
        },

        gameNotPaused: (room) => {
            if (room.gameState.isPaused) {
                throw new ValidationError(
                    `Game is paused: ${room.gameState.pauseReason || 'unknown reason'}`,
                    'GAME_PAUSED'
                );
            }
        },

        gameNotOver: (room) => {
            if (room.gameState.winner) {
                throw new ValidationError(
                    'Game is already over',
                    'GAME_OVER'
                );
            }
        },

        // Target validation
        targetExists: (room, targetId) => {
            const isPlayer = !!room.players[targetId];
            const isMonster = room.gameState.board.monsters?.some(m => m.id === targetId);
            
            if (!isPlayer && !isMonster) {
                throw new ValidationError(
                    'Target not found',
                    'TARGET_NOT_FOUND'
                );
            }
        },

        targetIsEnemy: (room, player, targetId) => {
            // If target is a player, they must be on opposing team (not implemented yet)
            // For now, just check if target is a monster
            const isMonster = room.gameState.board.monsters?.some(m => m.id === targetId);
            if (!isMonster) {
                throw new ValidationError(
                    'Can only target enemies',
                    'INVALID_TARGET'
                );
            }
        },

        targetIsAlly: (room, player, targetId) => {
            if (!room.players[targetId]) {
                throw new ValidationError(
                    'Target must be a player',
                    'INVALID_TARGET'
                );
            }
            // Could add team check here in the future
        },

        targetNotDowned: (room, targetId) => {
            const target = room.players[targetId];
            if (target && target.isDowned) {
                throw new ValidationError(
                    'Target is downed',
                    'TARGET_DOWNED'
                );
            }
        },

        targetInRange: (room, player, targetId, range) => {
            const grid = room.gameState.grid;
            const playerPos = grid.entities[player.id];
            const targetPos = grid.entities[targetId];
            
            if (!playerPos || !targetPos) {
                throw new ValidationError(
                    'Position not found for range check',
                    'POSITION_NOT_FOUND'
                );
            }
            
            const distance = Math.abs(playerPos.x - targetPos.x) + Math.abs(playerPos.y - targetPos.y);
            if (distance > range) {
                throw new ValidationError(
                    `Target out of range. Distance: ${distance}, Max: ${range}`,
                    'OUT_OF_RANGE'
                );
            }
        },

        // Item/Card validation
        cardInHand: (player, cardId) => {
            if (!player.hand || !player.hand.some(c => c.id === cardId)) {
                throw new ValidationError(
                    'Card not in hand',
                    'CARD_NOT_FOUND'
                );
            }
        },

        hasEquippedWeapon: (player) => {
            if (!player.equipment?.weapon) {
                throw new ValidationError(
                    'No weapon equipped',
                    'NO_WEAPON'
                );
            }
        },

        hasEquipment: (player, slot) => {
            if (!player.equipment || !player.equipment[slot]) {
                throw new ValidationError(
                    `No ${slot} equipped`,
                    'NO_EQUIPMENT'
                );
            }
        },

        itemExists: (room, itemId) => {
            const inLoot = room.gameState.lootPool?.some(i => i.id === itemId);
            if (!inLoot) {
                throw new ValidationError(
                    'Item not found',
                    'ITEM_NOT_FOUND'
                );
            }
        },

        // Room validation
        roomExists: (rooms, roomId) => {
            if (!rooms[roomId]) {
                throw new ValidationError(
                    'Room not found',
                    'ROOM_NOT_FOUND'
                );
            }
        },

        isRoomHost: (room, socketId) => {
            if (room.hostId !== socketId) {
                throw new ValidationError(
                    'Only the host can perform this action',
                    'NOT_HOST'
                );
            }
        },

        roomNotFull: (room, maxPlayers = 4) => {
            const humanPlayers = Object.values(room.players).filter(p => !p.isNpc);
            if (humanPlayers.length >= maxPlayers) {
                throw new ValidationError(
                    'Room is full',
                    'ROOM_FULL'
                );
            }
        },

        // Skill challenge validation
        skillChallengeActive: (room) => {
            if (!room.gameState.skillChallenge?.isActive) {
                throw new ValidationError(
                    'No active skill challenge',
                    'NO_SKILL_CHALLENGE'
                );
            }
        },

        // Ability validation
        abilityNotUsed: (player) => {
            if (player.usedAbilityThisTurn) {
                throw new ValidationError(
                    'Already used class ability this turn',
                    'ABILITY_USED'
                );
            }
        },

        hasClass: (player) => {
            if (!player.class) {
                throw new ValidationError(
                    'Must choose a class first',
                    'NO_CLASS'
                );
            }
        },

        // Custom validation
        custom: (condition, message, code = 'CUSTOM_ERROR') => {
            if (!condition) {
                throw new ValidationError(message, code);
            }
        }
    };

    /**
     * Validate an action using multiple rules
     * @param {string} action - Action name (for logging)
     * @param {Array<string|object>} validations - Rule names or {rule, args} objects
     * @param {object} context - Context object with common values
     * @returns {boolean} True if all validations pass
     * @throws {ValidationError} If any validation fails
     */
    validate(action, validations, context = {}) {
        for (const validation of validations) {
            try {
                if (typeof validation === 'string') {
                    // Simple rule name
                    const rule = this.rules[validation];
                    if (!rule) {
                        console.warn(`[Validator] Unknown rule: ${validation}`);
                        continue;
                    }
                    
                    // Try to call with common context values
                    rule.call(this, context.room, context.player, context.target, context.value);
                    
                } else if (typeof validation === 'object') {
                    // Object with {rule, args}
                    const rule = this.rules[validation.rule];
                    if (!rule) {
                        console.warn(`[Validator] Unknown rule: ${validation.rule}`);
                        continue;
                    }
                    
                    rule.call(this, ...validation.args);
                }
            } catch (error) {
                if (error instanceof ValidationError) {
                    // Add action context to error
                    error.action = action;
                    error.validation = typeof validation === 'string' ? validation : validation.rule;
                }
                throw error;
            }
        }
        
        return true;
    }

    /**
     * Validate an action and return result instead of throwing
     * @param {string} action - Action name
     * @param {Array} validations - Validations to check
     * @param {object} context - Context object
     * @returns {object} {valid: boolean, error: string|null}
     */
    check(action, validations, context = {}) {
        try {
            this.validate(action, validations, context);
            return { valid: true, error: null };
        } catch (error) {
            if (error instanceof ValidationError) {
                return {
                    valid: false,
                    error: error.message,
                    code: error.code
                };
            }
            // Unexpected error
            console.error('[Validator] Unexpected error:', error);
            return {
                valid: false,
                error: 'An unexpected error occurred',
                code: 'UNEXPECTED_ERROR'
            };
        }
    }

    /**
     * Add a custom validation rule
     * @param {string} name - Rule name
     * @param {Function} rule - Rule function
     */
    addRule(name, rule) {
        if (this.rules[name]) {
            console.warn(`[Validator] Overwriting existing rule: ${name}`);
        }
        this.rules[name] = rule;
    }
}

// Export
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { ActionValidator, ValidationError };
}

