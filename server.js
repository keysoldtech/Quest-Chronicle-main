// This file is the main Node.js server for the Quest & Chronicle application.
// It uses Express to serve the static frontend files (HTML, CSS, JS) from the 'public' directory
// and uses Socket.IO for real-time, event-based communication to manage the multiplayer game logic.

// --- INDEX ---
// 1. SERVER SETUP
// 2. HELPER FUNCTIONS
// 3. GAME STATE MANAGEMENT (GameManager Class)
//    - 3.1. Constructor & Core Utilities
//    - 3.2. Room & Player Management
//    - 3.3. Game Lifecycle (Create, Join, Start)
//    - 3.4. Player Setup (Class, Stats, Cards)
//    - 3.5. Turn Management
//    - 3.6. AI Logic (NPC Turns) & Event Triggers
//    - 3.7. Action Resolution (Attacks, Abilities, etc.)
//    - 3.8. Loot & Item Generation
//    - 3.9. Event & Challenge Handling
//    - 3.10. Chat & Disconnect Logic
// 4. SOCKET.IO CONNECTION HANDLING
//
// --- FUTURE: ASYMMETRIC DM MODE (1v4) ---
// Architecture notes for the planned Dungeon Master player mode:
//
// Currently the DM is an NPC ('npc-dm') that auto-spawns monsters and takes
// automated turns via takeDmTurn(). To support a human DM:
//
// 1. Room creation: add a `dmMode: 'human'|'ai'` flag in createRoom payload.
//    When human, one player slot is assigned role:'DM' instead of role:'Explorer'.
//
// 2. Turn flow: when dmMode is 'human', skip the AI spawn/attack logic in
//    takeDmTurn() and instead emit a 'dmTurnStarted' event to the DM socket.
//    The DM client would show a separate UI panel for:
//    - Choosing which monster to spawn (from available decks/hand)
//    - Placing monsters on the grid
//    - Directing monster attacks against specific explorers
//    - Triggering dungeon events, traps, and hazards
//    - Controlling world events
//
// 3. DM hand: the DM draws from monster/event decks into a hand and plays
//    cards similarly to explorers, spending DM AP (separate AP pool).
//
// 4. Balance: DM actions should be constrained by AP, hand size, and
//    cooldowns to prevent overwhelming the explorer party. The synergy and
//    party hope systems can serve as soft difficulty regulators.
//
// 5. Win condition: Explorers win by surviving N rooms or defeating the
//    final boss. DM wins by downing all explorers.
//
// Key files that will need changes:
// - server.js: createRoom, startGame, takeDmTurn, moveToNextTurn, action routing
// - client.js: DM-specific UI panels, monster placement, event triggers
// - game-data.js: DM-specific cards, DM ability definitions

// --- 1. SERVER SETUP ---
const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const path = require('path');
const gameData = require('./game-data'); // Import card and class data
const {
    parseDiceString: qcParseDiceString,
    rollDiceWithDetails: qcRollDiceWithDetails
} = require('./lib/qc-dice.cjs');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));
// Lightweight JSON parser for small request bodies
app.use(express.json({ limit: '128kb' }));

// --- Minimal, opt-in telemetry intake ---
// Disabled by default; enable with TELEMETRY_ENABLED=true
const TELEMETRY_ENABLED = process.env.TELEMETRY_ENABLED === 'true';

function sanitizeProps(obj) {
    if (!obj || typeof obj !== 'object') return {};
    const result = {};
    const keys = Object.keys(obj).slice(0, 25);
    for (const key of keys) {
        const safeKey = String(key).slice(0, 64);
        const value = obj[key];
        if (value === null || value === undefined) continue;
        if (typeof value === 'string') result[safeKey] = value.slice(0, 128);
        else if (typeof value === 'number' || typeof value === 'boolean') result[safeKey] = value;
        else result[safeKey] = String(value).slice(0, 128);
    }
    return result;
}

app.post('/telemetry', (req, res) => {
    // If disabled, acknowledge without storing
    if (!TELEMETRY_ENABLED) return res.status(204).end();

    try {
        const body = req.body || {};
        const events = Array.isArray(body.events) ? body.events.slice(0, 100) : [];
        if (events.length === 0) return res.status(204).end();

        const safeEvents = events.map((e) => ({
            name: typeof e.name === 'string' ? e.name.slice(0, 64) : 'unknown',
            ts: typeof e.ts === 'number' ? e.ts : Date.now(),
            props: sanitizeProps(e.props)
        }));

        const summary = {
            sessionId: typeof body.sessionId === 'string' ? body.sessionId.slice(0, 64) : 'n/a',
            count: safeEvents.length,
            sentAt: body.sentAt,
            tzOffset: body.tzOffset,
            ua: (body.userAgent || '').slice(0, 128),
            reason: body.reason || 'n/a'
        };

        // For now, only log counts to stdout; integrate a real backend later
        console.log('[Telemetry] batch received:', summary);
    } catch (err) {
        console.error('[Telemetry] error processing payload:', err);
        // Do not surface errors to clients
    } finally {
        res.status(204).end();
    }
});

// Create a lookup map for all cards for efficient access
const allCards = [
    ...gameData.itemCards,
    ...gameData.spellCards,
    ...gameData.weaponCards,
    ...gameData.armorCards
];
const cardDataMap = allCards.reduce((map, card) => {
    map[card.name] = card;
    return map;
}, {});

// --- Companion templates (server-authoritative for Beast Master) ---
const companionTemplates = {
    wolf: {
        name: 'Wolf Companion',
        type: 'Companion',
        maxHp: 15,
        ac: 12,
        attackBonus: 3,
        damageBonus: 2,
        damageDice: '1d6',
        requiredRollToHit: 13,
        speed: 3
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
        speed: 2
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
        speed: 4
    }
};

// --- 2. HELPER FUNCTIONS ---
function shuffle(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
}

// Deterministic PRNG for Daily Challenge mode (Mulberry32)
function mulberry32(seed) {
    let t = seed >>> 0;
    return function() {
        t += 0x6D2B79F5;
        let r = Math.imul(t ^ (t >>> 15), 1 | t);
        r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
        return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
    };
}

// Seeded shuffle helper, deterministic for a given seed
function seededShuffle(array, seed) {
    const rand = mulberry32(Number(seed) >>> 0);
    const arr = array.slice();
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}

// FNV-1a hash to derive sub-seeds from base seed
function hashStringToSeed(str) {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < String(str).length; i++) {
        h ^= String(str).charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return h >>> 0;
}

function deriveSeed(baseSeed, label) {
    return (Number(baseSeed) ^ hashStringToSeed(label)) >>> 0;
}

// Deterministic random per room and label for Daily mode
function nextDailyRandom(room, label) {
    if (room?.gameState?.runModifiers?.daily && room?.gameState?.seed != null) {
        room._dailyRandCounters = room._dailyRandCounters || {};
        const key = String(label || 'default');
        const idx = room._dailyRandCounters[key] || 0;
        room._dailyRandCounters[key] = idx + 1;
        const seed = (Number(room.gameState.seed) ^ hashStringToSeed(key) ^ idx) >>> 0;
        const rng = mulberry32(seed);
        return rng();
    }
    return Math.random();
}

/**
 * Sanitizes a string by escaping HTML characters to prevent XSS.
 * @param {string} unsafe The string to sanitize.
 * @returns {string} The sanitized string.
 */
function escapeHtml(unsafe) {
    if (typeof unsafe !== 'string') return '';
    return unsafe
         .replace(/&/g, "&amp;")
         .replace(/</g, "&lt;")
         .replace(/>/g, "&gt;")
         .replace(/"/g, "&quot;")
         .replace(/'/g, "&#039;");
}


// --- 3. GAME STATE MANAGEMENT (GameManager Class) ---
class GameManager {
    // --- 3.1. Constructor & Core Utilities ---
    constructor() {
        this.rooms = {};
        this.socketToRoom = {}; // Maps socket.id to roomId for efficient lookups
        this.cardIdCounter = 1000; // Start card IDs high to avoid collision with data file
    }

    findRoomBySocket(socket) {
        const roomId = this.socketToRoom[socket.id];
        return this.rooms[roomId];
    }
    
    // The single point of emission for game state, ensuring clients are always in sync.
    emitGameState(roomId) {
        if (this.rooms[roomId]) {
            const stateWithStaticData = {
                ...this.rooms[roomId],
                staticData: { // We only need to send static data once, but this is simple for now
                    classes: gameData.classes
                }
            };
            io.to(roomId).emit('gameStateUpdate', stateWithStaticData);
        }
    }

    generateRoomId() {
        let roomId;
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
        do {
            roomId = '';
            for (let i = 0; i < 4; i++) {
                roomId += chars.charAt(Math.floor(Math.random() * chars.length));
            }
        } while (this.rooms[roomId]);
        return roomId;
    }
    
    generateUniqueCardId() {
        this.cardIdCounter++;
        return `card-${this.cardIdCounter}`;
    }
    
    parseDiceString(diceString) {
        return qcParseDiceString(diceString);
    }

    rollDie(dieString) { // e.g., 'd6', 'd20'
        if (!dieString || !dieString.startsWith('d')) return 0;
        const sides = parseInt(dieString.substring(1), 10);
        if (isNaN(sides)) return 0;
        return Math.floor(Math.random() * sides) + 1;
    }

    rollDiceWithDetails(diceString) {
        return qcRollDiceWithDetails(diceString);
    }

    _triggerRiposte(room, player, monster) {
        try {
            if (!monster || player.isDowned) return;
            const weapon = player.equipment?.weapon || { id: 'unarmed', name: 'Unarmed Strike', type: 'Weapon', apCost: 0, effect: { dice: '1d4' } };
            const tempAttacker = { id: player.id, name: player.name, stats: { hitBonus: player.stats.hitBonus } };
            room.chatLog.push({ type: 'combat', playerName: player.name, text: `${player.name} reacts with Riposte!`, timestamp: Date.now() });
            this._resolveNpcOrMonsterAttack(room, tempAttacker, monster, weapon);
        } catch (e) {
            console.error('Riposte failed', e);
        }
    }

    // --- Beast Master helpers ---
    _hasBeastMasterTier(player, tierNumber) {
        if (player.specializationChoices) {
            if (tierNumber === 1) return player.specializationChoices.tier1 === 'Animal Companion';
            if (tierNumber === 2) return player.specializationChoices.tier2 === 'Command Attack';
            if (tierNumber === 3) return player.specializationChoices.tier3 === 'Alpha Beast';
        }
        if (player.specializations) {
            const selected = player.specializations[tierNumber];
            return !!(selected && selected.branch === 'BeastMaster');
        }
        return false;
    }

    _getBeastMasterMultiplier(player) {
        return this._hasBeastMasterTier(player, 3) ? 1.5 : 1.0;
    }

    _placeCompanionNearPlayer(room, player) {
        const grid = room.gameState.grid;
        const playerPos = grid.entities[player.id];
        if (!playerPos) return;
        const tryPositions = [
            { x: playerPos.x + 1, y: playerPos.y },
            { x: playerPos.x - 1, y: playerPos.y },
            { x: playerPos.x, y: playerPos.y + 1 },
            { x: playerPos.x, y: playerPos.y - 1 }
        ];
        const inBounds = (pos) => pos.x >= 0 && pos.x < room.gameState.grid.width && pos.y >= 0 && pos.y < room.gameState.grid.height;
        for (const pos of tryPositions) {
            if (!inBounds(pos)) continue;
            const occupied = Object.values(grid.entities).some(e => e && e.x === pos.x && e.y === pos.y);
            if (!occupied) {
                grid.entities[player.companion.id] = { x: pos.x, y: pos.y, type: 'companion' };
                return;
            }
        }
        for (let y = 0; y < room.gameState.grid.height; y++) {
            for (let x = 0; x < room.gameState.grid.width; x++) {
                const occupied = Object.values(grid.entities).some(e => e && e.x === x && e.y === y);
                if (!occupied) {
                    grid.entities[player.companion.id] = { x, y, type: 'companion' };
                    return;
                }
            }
        }
    }

    resolveSummonCompanion(room, player, companionType = 'wolf') {
        const currentTurnPlayerId = room.gameState.turnOrder[room.gameState.currentPlayerIndex];
        if (player.id !== currentTurnPlayerId) return;
        const apCost = 1;
        if (player.currentAp < apCost) {
            // CRITICAL FIX: Send specific AP error for summon companion
            const playerSocket = io.sockets.sockets.get(player.id);
            if (playerSocket) {
                if (player.currentAp === 0) {
                    playerSocket.emit('actionError', 'NO_AP_END_TURN');
                } else {
                    playerSocket.emit('actionError', `Not enough AP to summon companion. Need ${apCost} AP, have ${player.currentAp}.`);
                }
            }
            return;
        }
        if (player.class !== 'Ranger') return;
        if (!this._hasBeastMasterTier(player, 1)) return;
        if (player.companion && player.companion.currentHp > 0) return;

        const key = String(companionType || 'wolf').toLowerCase();
        const template = companionTemplates[key] || companionTemplates.wolf;
        const mult = this._getBeastMasterMultiplier(player);
        const bonusAttack = Math.floor((mult - 1) * 2);
        player.companion = {
            ...template,
            id: `companion-${player.id}`,
            ownerId: player.id,
            maxHp: Math.floor(template.maxHp * mult),
            currentHp: Math.floor(template.maxHp * mult),
            attackBonus: template.attackBonus + bonusAttack,
            statusEffects: []
        };

        this._placeCompanionNearPlayer(room, player);
        player.currentAp -= apCost;
        room.chatLog.push({ type: 'system-good', playerName: player.name, text: `${player.name} summons a ${key}!`, timestamp: Date.now() });
        this.emitGameState(room.id);
    }

    resolveCompanionAttack(room, player, targetId) {
        const currentTurnPlayerId = room.gameState.turnOrder[room.gameState.currentPlayerIndex];
        if (player.id !== currentTurnPlayerId) return;
        if (!player.companion || player.companion.currentHp <= 0) return;
        if (player.currentAp < 1) {
            // CRITICAL FIX: Send specific AP error for companion attack
            const playerSocket = io.sockets.sockets.get(player.id);
            if (playerSocket) {
                if (player.currentAp === 0) {
                    playerSocket.emit('actionError', 'NO_AP_END_TURN');
                } else {
                    playerSocket.emit('actionError', `Not enough AP for companion attack. Need 1 AP, have ${player.currentAp}.`);
                }
            }
            return;
        }
        const target = room.gameState.board.monsters.find(m => m.id === targetId);
        if (!target) return;

        const performAttack = () => {
            const roll = this.rollDiceWithDetails('1d20').total;
            const total = roll + (player.companion.attackBonus || 0);
            const hit = total >= (target.requiredRollToHit || 12);
            if (hit) {
                const dmg = this.rollDiceWithDetails(player.companion.damageDice);
                const totalDamage = dmg.total + (player.companion.damageBonus || 0);
                const result = this._applyDamage(room, target, totalDamage, { id: player.id, name: player.name });
                let logText = `Companion attacks ${target.name}! HIT for ${totalDamage}.`;
                if (result.logParts && result.logParts.length > 0) logText += ` ${result.logParts.join(' ')}`;
                room.chatLog.push({ type: 'combat-hit', playerName: player.name, text: logText, timestamp: Date.now() });
                room.gameState.lastAttackerId = player.id;
            } else {
                room.chatLog.push({ type: 'combat', playerName: player.name, text: `Companion attacks ${target.name}... Miss!`, timestamp: Date.now() });
            }
        };

        player.currentAp -= 1;
        performAttack();
        if (this._hasBeastMasterTier(player, 2) && target.currentHp > 0) {
            performAttack();
        }
        this.emitGameState(room.id);
    }
    // --- 3.2. Room & Player Management ---
    createPlayerObject(id, name, isNpc = false, accountUpgrades = {}, metaPerks = {}) {
        const playerId = `player_${Math.random().toString(36).substr(2, 9)}`;
        return {
            id,
            playerId,
            name,
            isNpc,
            level: 1,
            xp: 0,
            runXp: 0,
            xpToNextLevel: 25,
            enemiesDefeated: 0,
            accountUpgrades,
            metaPerks,
            inRunStatBonuses: { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 },
            isDowned: false,
            disconnected: false,
            hasTakenFirstTurn: false,
            pauseTimer: null,
            replacementTimer: null,
            role: null,
            class: null,
            stats: { maxHp: 0, currentHp: 0, damageBonus: 0, shieldBonus: 0, ap: 0, maxAP: 0, shieldHp: 0, str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0, spellPower: 0, healingPower: 0 },
            baseStats: {},
            statBonuses: {},
            currentAp: 0,
            hand: [],
            equipment: { weapon: null, armor: null },
            statusEffects: [],
            usedAbilityThisTurn: false,
            isResolvingDiscovery: false,
            discoveryItem: null,
            pendingAction: null,
            pendingDungeonEvent: null,
            accountData: { unlockedLegacyItems: [], savedLoadouts: [], preferences: {} },
        };
    }

    _applyMetaPerks(player) {
        const perks = player.metaPerks || {};
        if (perks.startingGold) player.gold = (player.gold || 0) + 50;
        if (perks.extraHp) player.inRunStatBonuses.con = (player.inRunStatBonuses.con || 0) + 1;
        if (perks.combatant) player.inRunStatBonuses.str = (player.inRunStatBonuses.str || 0) + 1;
    }

    _getMetaPerkMultipliers(player) {
        const perks = player.metaPerks || {};
        return {
            xpMultiplier: perks.fastLearner ? 1.1 : 1.0,
            lootRarityBonus: perks.luckyStart ? 0.05 : 0,
            synergyBonus: perks.masterTactician ? 0.5 : 0,
            critChanceBonus: perks.criticalExpert ? 0.05 : 0,
        };
    }

    createRoom(socket, { playerName, gameMode, customSettings, accountUpgrades, metaPerks, runModifiers, seed }) {
        const newPlayer = this.createPlayerObject(socket.id, playerName, false, accountUpgrades, metaPerks || {});
        const newRoomId = this.generateRoomId();
    
        console.log(`[CreateRoom] Creating room ${newRoomId} for player ${playerName} (socket: ${socket.id}, isNpc: ${newPlayer.isNpc})`);
    
        const defaultSettings = {
            startWithWeapon: true, startWithArmor: true, startingItems: 2, 
            startingSpells: 2, lootDropRate: 80, maxHandSize: 7, discoveryRolls: true,
            enforceWeaponRanges: gameMode === 'Advanced', // Enable weapon range enforcement in Advanced mode
            pathChoiceInterval: 2 // Offer path choices at most every N rounds
        };
    
        const newRoom = {
            id: newRoomId,
            hostId: socket.id,
            players: { [socket.id]: newPlayer },
            settings: { ...defaultSettings, ...(customSettings || {}) },
            gameState: {
                phase: 'class_selection',
                gameMode: gameMode || 'Beginner',
                winner: null,
                runScore: 0,
                enemiesDefeatedThisRun: 0,
                decks: {},
                discardPiles: { item: [], spell: [], weapon: [], armor: [], worldEvent: [], environmental: [], partyEvent: [] },
                turnOrder: [],
                currentPlayerIndex: -1,
                board: { monsters: [], environment: [] },
                grid: {
                    width: gameData.gridConfig.width,
                    height: gameData.gridConfig.height,
                    entities: {} // Maps entity ID to {x, y, type}
                },
                lootPool: [],
                turnCount: 0,
                partyHope: 5, // Starts at neutral
                worldEvents: { currentEvent: null, duration: 0 },
                currentPartyEvent: null,
                skillChallenge: { isActive: false, details: null, currentStage: 0, targetId: null },
                isPaused: false,
                pauseReason: '',
                seed: seed || null,
                runModifiers: runModifiers || {},
                nextRooms: [],
                pathChooserId: null,
                /** Set when path "shop" room opens — end-turn already ran, so advance turn after MP shop closes. */
                pendingTurnAfterPathShop: false,
                lastPathChoiceRound: -999,
                recentRoomTypes: [],
                roomsCleared: 0,
                depth: 1,
                bossDefeatedThisDepth: false,
            },
            chatLog: [],
            savedPlayers: {}, // For storing data of disconnected players
            voiceChatters: [], // List of socket IDs in voice chat
        };
    
        newPlayer.role = 'Explorer';
        this.rooms[newRoomId] = newRoom;
        socket.join(newRoomId);
        this.socketToRoom[socket.id] = newRoomId;

        this.createNpcs(newRoom, 3); // Fill the remaining 3 slots with NPCs initially
    
        console.log(`[CreateRoom] Room ${newRoomId} created. Players:`, Object.keys(newRoom.players).map(id => ({
            id, name: newRoom.players[id].name, isNpc: newRoom.players[id].isNpc
        })));
    
        socket.emit('playerIdentity', { playerId: newPlayer.playerId, roomId: newRoomId });
        this.emitGameState(newRoomId);
    }
    
    rejoinRoom(socket, { roomId, playerId }) {
        const room = this.rooms[roomId];
        if (!room) return socket.emit('actionError', 'Room not found.');
    
        // Find player by their persistent playerId
        const existingPlayer = Object.values(room.players).find(p => 
            p.playerId === playerId && !p.isNpc
        );
        
        if (!existingPlayer) {
            return socket.emit('actionError', 'Your saved game session was not found in this room.');
        }
        
        console.log(`[Rejoin] Player ${existingPlayer.name} (${playerId}) rejoining room ${roomId}`);
        
        // Clear old socket mapping
        const oldSocketId = existingPlayer.id;
        if (this.socketToRoom[oldSocketId]) {
            delete this.socketToRoom[oldSocketId];
        }
        
        // Update player with new socket ID
        delete room.players[oldSocketId];
        existingPlayer.id = socket.id;
        existingPlayer.disconnected = false;
        room.players[socket.id] = existingPlayer;

        // Migrate grid entity mapping to new socket id so movement works
        const grid = room.gameState?.grid;
        if (grid && grid.entities) {
            // Player entity
            if (grid.entities[oldSocketId]) {
                grid.entities[socket.id] = { ...grid.entities[oldSocketId] };
                delete grid.entities[oldSocketId];
            }
            // Companion entity (keyed by `companion-<socketId>`)
            const oldCompanionKey = `companion-${oldSocketId}`;
            const newCompanionKey = `companion-${socket.id}`;
            if (grid.entities[oldCompanionKey]) {
                grid.entities[newCompanionKey] = { ...grid.entities[oldCompanionKey] };
                delete grid.entities[oldCompanionKey];
            }
        }
        
        // Clear timers
        if (existingPlayer.pauseTimer) {
            clearTimeout(existingPlayer.pauseTimer);
            existingPlayer.pauseTimer = null;
        }
        if (existingPlayer.replacementTimer) {
            clearTimeout(existingPlayer.replacementTimer);
            existingPlayer.replacementTimer = null;
        }
        
        // Update socket mappings
        socket.join(roomId);
        this.socketToRoom[socket.id] = roomId;
        
        // Send player identity and current game state
        socket.emit('playerIdentity', { playerId: existingPlayer.playerId, roomId: roomId });
        this.emitGameState(roomId);
        
        room.chatLog.push({ 
            type: 'system-good', 
            text: `${existingPlayer.name} returned to the game!`, 
            timestamp: Date.now() 
        });
    }

    joinRoom(socket, { roomId, playerName, accountUpgrades }) {
        const room = this.rooms[roomId];
        if (!room) return socket.emit('actionError', 'Room not found.');
    
        // MOBILE FIX: Check if player is reconnecting (same name, game in progress)
        const existingPlayer = Object.values(room.players).find(p => 
            p.name === playerName && !p.isNpc && p.disconnected
        );
        
        if (existingPlayer && room.gameState.phase === 'started') {
            // Reconnecting player - restore their session
            console.log(`[Reconnect] Player ${playerName} rejoining room ${roomId}`);
            
            // Clear old socket mapping
            const oldSocketId = existingPlayer.id;
            
            // Update player with new socket ID
            delete room.players[oldSocketId];
            existingPlayer.id = socket.id;
            existingPlayer.disconnected = false;
            room.players[socket.id] = existingPlayer;

            // Migrate grid entity mapping to new socket id so movement works
            const grid = room.gameState?.grid;
            if (grid && grid.entities) {
                // Player entity
                if (grid.entities[oldSocketId]) {
                    grid.entities[socket.id] = { ...grid.entities[oldSocketId] };
                    delete grid.entities[oldSocketId];
                }
                // Companion entity (keyed by `companion-<socketId>`)
                const oldCompanionKey = `companion-${oldSocketId}`;
                const newCompanionKey = `companion-${socket.id}`;
                if (grid.entities[oldCompanionKey]) {
                    grid.entities[newCompanionKey] = { ...grid.entities[oldCompanionKey] };
                    delete grid.entities[oldCompanionKey];
                }
            }
            
            // Clear timers
            if (existingPlayer.pauseTimer) {
                clearTimeout(existingPlayer.pauseTimer);
                existingPlayer.pauseTimer = null;
            }
            if (existingPlayer.replacementTimer) {
                clearTimeout(existingPlayer.replacementTimer);
                existingPlayer.replacementTimer = null;
            }
            
            // Update socket mappings
            socket.join(roomId);
            this.socketToRoom[socket.id] = roomId;
            
            // Send player identity and current game state
            socket.emit('playerIdentity', { playerId: existingPlayer.playerId, roomId: roomId });
            this.emitGameState(roomId);
            
            room.chatLog.push({ 
                type: 'system-good', 
                text: `${playerName} reconnected to the game!`, 
                timestamp: Date.now() 
            });
            
            return;
        }
    
        // Original join logic for new players
        if (room.gameState.phase !== 'class_selection') {
            return socket.emit('actionError', 'Game is already in progress.');
        }
    
        // Find an NPC explorer to replace
        const npcToReplace = Object.values(room.players).find(p => p.isNpc && p.role === 'Explorer');
    
        if (!npcToReplace) {
            return socket.emit('actionError', 'This game lobby is full of human players.');
        }
    
        // Remove the NPC
        console.log(`[JoinRoom] Replacing NPC ${npcToReplace.name} with human player ${playerName}`);
        delete room.players[npcToReplace.id];

        // Add the new human player
        const newPlayer = this.createPlayerObject(socket.id, playerName, false, accountUpgrades);
        newPlayer.role = 'Explorer';
        room.players[socket.id] = newPlayer;
        socket.join(roomId);
        this.socketToRoom[socket.id] = roomId;
        
        console.log(`[JoinRoom] Player ${playerName} joined room ${roomId} (socket: ${socket.id}, isNpc: ${newPlayer.isNpc})`);
        console.log(`[JoinRoom] Room ${roomId} now has players:`, Object.keys(room.players).map(id => ({
            id, name: room.players[id].name, isNpc: room.players[id].isNpc
        })));
        
        socket.emit('playerIdentity', { playerId: newPlayer.playerId, roomId: roomId });
        this.emitGameState(roomId);
    }

    // --- 3.3. Game Lifecycle ---
    startGame(socket) {
        const room = this.findRoomBySocket(socket);
        if (!room || socket.id !== room.hostId || room.gameState.phase === 'started') {
            return;
        }

        const humanPlayers = Object.values(room.players).filter(p => !p.isNpc);
        if (!humanPlayers.every(p => p.class)) {
            return socket.emit('actionError', 'All players must select a class before starting.');
        }

        // Initialize seed and run modifiers (Phase 3)
        // Daily Challenge: deterministic seed based on UTC date and default modifiers
        if (String(room.gameState.gameMode).toLowerCase() === 'daily') {
            if (!room.gameState.seed) {
                const now = new Date();
                room.gameState.seed = parseInt(`${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, '0')}${String(now.getUTCDate()).padStart(2, '0')}`, 10);
            }
            room.gameState.runModifiers = room.gameState.runModifiers || {};
            room.gameState.runModifiers.daily = true;
            if (!Array.isArray(room.gameState.runModifiers.modifiers) || room.gameState.runModifiers.modifiers.length === 0) {
                room.gameState.runModifiers.modifiers = ['Enemies +25% HP', 'No shops', 'Double XP'];
            }
        } else {
            room.gameState.seed = room.gameState.seed || Math.floor(Math.random() * 1e9);
            room.gameState.runModifiers = room.gameState.runModifiers || {};
        }
        // Init RNG for Daily
        if (room.gameState.runModifiers?.daily) {
            room._dailyRandCounters = {};
        }
        this.initializeDecks(room);

        // Initialize each player fully, apply meta-perks, calculate stats for initiative.
        Object.values(room.players).forEach(p => {
            if (p.role === 'Explorer' && !p.isNpc) {
                this._applyMetaPerks(p);
            }
            p.stats = this.calculatePlayerStats(p, room.gameState.partyHope);
            if (p.role === 'Explorer') {
                this.dealStartingLoadout(room, p);
                if (typeof p.gold !== 'number') p.gold = 50;
            }
        });

        // Recalculate stats after handing out items.
        Object.values(room.players).forEach(p => {
            p.stats = this.calculatePlayerStats(p, room.gameState.partyHope);
            p.stats.currentHp = p.stats.maxHp;
            p.currentAp = p.stats.maxAP;
        });

        // --- Turn Order Logic (Initiative) ---
        const dmId = 'npc-dm';
        const explorers = Object.values(room.players).filter(p => p.role === 'Explorer');
        explorers.sort((a, b) => b.stats.dex - a.stats.dex); // Highest DEX goes first
        room.gameState.turnOrder = [dmId, ...explorers.map(p => p.id)];
        
        room.gameState.currentPlayerIndex = -1;
        room.gameState.phase = 'started';
        room.gameState.turnCount = 0;

        // Initialize grid positions
        this.initializeGridPositions(room);

        // Start the first turn sequence
        this.moveToNextTurn(room);
    }

    initializeGridPositions(room) {
        const explorers = Object.values(room.players).filter(p => p.role === 'Explorer');
        const gridWidth = gameData.gridConfig.width;
        const gridHeight = gameData.gridConfig.height;
        const entities = room.gameState.grid.entities;
        const isOccupied = (x, y) => Object.values(entities).some(e => e && e.x === x && e.y === y);
        const findOpen = () => {
            let tries = 0;
            while (tries++ < 200) {
                const x = Math.floor(nextDailyRandom(room, 'gridSpawnX') * gridWidth);
                const y = Math.floor(nextDailyRandom(room, 'gridSpawnY') * gridHeight);
                if (!isOccupied(x, y)) return { x, y };
            }
            return null;
        };
        // Randomize players/NPC spawns into open cells
        explorers.forEach((player) => {
            const spot = findOpen();
            const x = (spot?.x ?? 0);
            const y = (spot?.y ?? gridHeight - 1);
            entities[player.id] = { x, y, type: 'player' };
            player.gridPosition = { x, y };
            player.movementPoints = gameData.gridConfig.baseMovementPoints;
        });
        // Monsters placed randomly when spawned (see takeDmTurn spawn section)

        // --- Phase 2: seed basic terrain (cover/elevation) ---
        const grid = room.gameState.grid;
        const isOccupiedGrid = (x, y) => Object.values(grid.entities).some(e => e && e.x === x && e.y === y);
        const placeTerrain = (type, count) => {
            let placed = 0;
            while (placed < count) {
                const x = Math.floor(nextDailyRandom(room, `${type}-x`) * gridWidth);
                const y = Math.floor(nextDailyRandom(room, `${type}-y`) * gridHeight);
                // Prefer middle rows for cover, corners for elevation
                if (type === 'cover' && (y === 0 || y === gridHeight - 1)) continue;
                if (type === 'elevation' && !(x === 0 || x === gridWidth - 1)) continue;
                if (isOccupiedGrid(x, y)) continue;
                grid.entities[`${type}-${placed}`] = { x, y, type };
                placed++;
            }
        };
        placeTerrain('cover', 3);
        placeTerrain('elevation', 2);
    }
    
    chooseClass(socket, { classId }) {
        const room = this.findRoomBySocket(socket);
        const player = room?.players[socket.id];
        if (!room || !player || player.class || room.gameState.phase !== 'class_selection') return;

        this.assignClassToPlayer(player, classId);
        this.emitGameState(room.id);
    }
    
    createNpcs(room, count) {
        // Always create the DM
        if (!room.players['npc-dm']) {
            const dmNpc = this.createPlayerObject('npc-dm', 'DM', true);
            dmNpc.role = 'DM';
            room.players[dmNpc.id] = dmNpc;
        }

        const npcNames = ["Grok", "Lyra", "Finn"];
        const availableClasses = Object.keys(gameData.classes);
        for (let i = 0; i < count; i++) {
            const name = npcNames[i % npcNames.length];
            const npcId = `npc-${name.toLowerCase()}-${i}`;
            const npc = this.createPlayerObject(npcId, name, true);
            npc.role = 'Explorer';
            const randomClassId = availableClasses[Math.floor(nextDailyRandom(room, 'npc-class') * availableClasses.length)];
            this.assignClassToPlayer(npc, randomClassId);
            room.players[npc.id] = npc;
        }
    }

    initializeDecks(room) {
        // Helper to ensure all cards get a unique, server-assigned ID.
        const createDeck = (cardArray) => cardArray.map(c => ({ ...c, id: this.generateUniqueCardId() }));
        
        const useSeed = room.gameState.runModifiers?.daily ? (room.gameState.seed || 0) : null;
        const shuf = (arr, label) => useSeed != null ? seededShuffle(arr, deriveSeed(useSeed, label)) : shuffle(arr);

        room.gameState.decks = {
            item: shuf(createDeck(gameData.itemCards), 'deck-item'),
            spell: shuf(createDeck(gameData.spellCards), 'deck-spell'),
            weapon: shuf(createDeck(gameData.weaponCards), 'deck-weapon'),
            armor: shuf(createDeck(gameData.armorCards), 'deck-armor'),
            worldEvent: shuf(createDeck(gameData.worldEventCards), 'deck-worldEvent'),
            environmental: shuf(createDeck(gameData.environmentalCards), 'deck-environmental'),
            partyEvent: shuf(createDeck(gameData.partyEventCards), 'deck-partyEvent'),
            monster: {
                tier1: shuf(createDeck(gameData.monsterTiers.tier1), 'deck-monster-t1'),
                tier2: shuf(createDeck(gameData.monsterTiers.tier2), 'deck-monster-t2'),
                tier3: shuf(createDeck(gameData.monsterTiers.tier3), 'deck-monster-t3'),
            }
        };
        // The treasure deck is a combined pool for generating magical loot.
        room.gameState.decks.treasure = shuf([...gameData.weaponCards, ...gameData.armorCards].map(c => ({ ...c, id: this.generateUniqueCardId() })), 'deck-treasure');
    }
    
    _getDiscardPileForCard(room, card) {
        const type = (card.type || 'item').toLowerCase();
        if (type.includes('weapon')) return room.gameState.discardPiles.weapon;
        if (type.includes('armor')) return room.gameState.discardPiles.armor;
        if (type.includes('spell')) return room.gameState.discardPiles.spell;
        // Default to item for consumables, scrolls, etc.
        return room.gameState.discardPiles.item;
    }

    // Handles giving a card to a player, accounting for hand size limits.
    _giveCardToPlayer(room, player, card) {
        if (!card) return;
        const discardPile = this._getDiscardPileForCard(room, card);
    
        if (player.hand.length >= room.settings.maxHandSize) {
            if (player.isNpc) {
                // NPC LOGIC: Automatically discard the oldest card (at index 0) to make room.
                const discardedCard = player.hand.shift();
                const oldCardDiscardPile = this._getDiscardPileForCard(room, discardedCard);
                oldCardDiscardPile.push(discardedCard);
                player.hand.push(card);
                 room.chatLog.push({ type: 'system', text: `${player.name}'s hand was full. Discarded ${discardedCard.name} for ${card.name}.`, timestamp: Date.now() });

            } else {
                const playerSocket = io.sockets.sockets.get(player.id);
                if (playerSocket) {
                    // HUMAN LOGIC: Prompt connected player to choose.
                    playerSocket.emit('chooseToDiscard', { newCard: card, currentHand: player.hand });
                } else {
                    // Fallback for disconnected humans: Discard the new card to prevent game stall.
                    discardPile.push(card);
                    room.chatLog.push({ type: 'system', text: `${player.name}'s hand was full and they are disconnected. '${card.name}' was discarded.`, timestamp: Date.now() });
                }
            }
        } else {
            player.hand.push(card);
        }
    }

    dealStartingLoadout(room, player) {
        const { settings } = room;
        
        // Equips a weapon/armor directly from the class-appropriate deck.
        const dealAndEquip = (type) => {
            const card = this.drawCardFromDeck(room.id, type, player.class);
            if (card) player.equipment[type] = card;
        };
    
        if (settings.startWithWeapon) dealAndEquip('weapon');
        if (settings.startWithArmor) dealAndEquip('armor');
    
        // Give player starting items from the item deck based on settings
        for (let i = 0; i < (settings.startingItems || 0); i++) {
            const card = this.drawCardFromDeck(room.id, 'item');
            if (card) this._giveCardToPlayer(room, player, card);
        }
    
        // Give player starting spells from the spell deck based on settings
        for (let i = 0; i < (settings.startingSpells || 0); i++) {
            const card = this.drawCardFromDeck(room.id, 'spell');
            if (card) this._giveCardToPlayer(room, player, card);
        }
    }

    drawCardFromDeck(roomId, deckName, playerClass = null) {
        const room = this.rooms[roomId];
        if (!room) return null;
    
        let deck;
        let discardPile;
        let deckPath = deckName.split('.');
    
        // Navigate nested deck structure
        let currentDeckLevel = room.gameState.decks;
        for (const key of deckPath) {
            currentDeckLevel = currentDeckLevel?.[key];
        }
        deck = currentDeckLevel;
    
        // Find corresponding discard pile (simplified for now, assumes top-level discard piles)
        const discardKey = deckPath[0];
        discardPile = room.gameState.discardPiles[discardKey];
    
        if (!deck) {
            console.error(`[DECK ERROR] Deck not found: ${deckName}`);
            return null;
        }
    
        // BEST PRACTICE: Infinite Decks
        if (deck.length === 0) {
            if (discardPile && discardPile.length > 0) {
                room.chatLog.push({ type: 'system', text: `The ${deckName} deck ran out and is being reshuffled.`, timestamp: Date.now() });
                deck.push(...shuffle(discardPile));
                discardPile.length = 0; // Clear the discard pile
            } else {
                // If both are empty, there are no more cards of this type.
                return null;
            }
        }
        
        let cardToDraw;
        // For weapons/armor, try to find a class-appropriate item first.
        if (playerClass && (deckName === 'weapon' || deckName === 'armor' || deckName === 'treasure')) {
            const suitableCardIndex = deck.findIndex(card => !card.class || card.class.includes("Any") || card.class.includes(playerClass));
            if (suitableCardIndex !== -1) {
                cardToDraw = deck.splice(suitableCardIndex, 1)[0];
            } else {
                cardToDraw = deck.pop(); // Fallback to any card if no specific one is found
            }
        } else {
            cardToDraw = deck.pop();
        }
        
        return JSON.parse(JSON.stringify(cardToDraw)); // Return a deep copy
    }

    // --- 3.4. Player Setup ---
    assignClassToPlayer(player, classId) {
        const classData = gameData.classes[classId];
        if (!classData || !player) return;
        player.class = classId;
        player.stats = this.calculatePlayerStats(player, 5); // Start with neutral hope
    }
    
    _modifyPartyHope(room, amount) {
        const currentHope = room.gameState.partyHope;
        const newHope = Math.max(0, Math.min(10, currentHope + amount));
        if (newHope !== currentHope) {
            room.gameState.partyHope = newHope;
            let logText = amount > 0 ? `The party's hope swells!` : `A wave of despair washes over the party.`;
            room.chatLog.push({ type: 'system', text: logText, timestamp: Date.now() });
        }
    }

    calculatePlayerStats(player, partyHope) {
        const initialStats = { maxHp: 0, currentHp: player.stats.currentHp || 0, damageBonus: 0, shieldBonus: 0, ap: 0, maxAP: 0, shieldHp: player.stats.shieldHp || 0, str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0, hitBonus: 0, spellPower: 0, healingPower: 0 };
        if (!player.class) {
            player.baseStats = {};
            player.statBonuses = {};
            return initialStats;
        }
    
        const classData = gameData.classes[player.class];
        const baseStats = { ...classData.stats, maxHp: classData.baseHp, damageBonus: classData.baseDamageBonus, shieldBonus: classData.baseShieldBonus, ap: classData.baseAP, hitBonus: 0 };
        
        const accountBonuses = player.accountUpgrades?.[player.class] || {};
        Object.keys(accountBonuses).forEach(stat => {
            baseStats[stat] = (baseStats[stat] || 0) + accountBonuses[stat];
        });
        player.baseStats = { ...baseStats };
    
        const bonuses = { maxHp: 0, damageBonus: 0, shieldBonus: 0, ap: 0, str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0, hitBonus: 0 };
    
        for (const item of Object.values(player.equipment)) {
            if (item?.effect?.bonuses) {
                Object.keys(item.effect.bonuses).forEach(key => {
                    bonuses[key] = (bonuses[key] || 0) + item.effect.bonuses[key];
                });
            }
        }
        
        for (const effect of player.statusEffects) {
            if (effect.bonuses) {
                Object.keys(effect.bonuses).forEach(key => {
                    bonuses[key] = (bonuses[key] || 0) + effect.bonuses[key];
                });
            }
        }
        player.statBonuses = { ...bonuses };
    
        const totalStats = {};
        const allStatKeys = new Set([...Object.keys(baseStats), ...Object.keys(bonuses), ...Object.keys(player.inRunStatBonuses)]);
        
        allStatKeys.forEach(key => {
            totalStats[key] = (baseStats[key] || 0) + (bonuses[key] || 0) + (player.inRunStatBonuses[key] || 0);
        });

        // --- NEW STAT MECHANICS ---
        const primaryStatValue = totalStats[classData.primaryStat] || 0;
        totalStats.maxHp = baseStats.maxHp + bonuses.maxHp + (totalStats.con * 2 * player.level);
        totalStats.hitBonus = baseStats.hitBonus + bonuses.hitBonus + primaryStatValue;
        totalStats.damageBonus = baseStats.damageBonus + bonuses.damageBonus + totalStats.str;
        totalStats.shieldBonus = baseStats.shieldBonus + bonuses.shieldBonus + totalStats.dex;
        totalStats.spellPower = totalStats.int;
        totalStats.healingPower = totalStats.wis;
        
        if (partyHope >= 9) totalStats.hitBonus += 1;
        else if (partyHope <= 2) totalStats.hitBonus -= 1;
    
        totalStats.maxAP = totalStats.ap;
        totalStats.currentHp = player.stats.currentHp > 0 ? Math.min(player.stats.currentHp, totalStats.maxHp) : totalStats.maxHp;
        totalStats.shieldHp = player.stats.shieldHp || 0;
    
        return totalStats;
    }

    equipItem(socket, { cardId }) {
        const room = this.findRoomBySocket(socket);
        const player = room?.players[socket.id];
        if (!room || !player) return;
        const currentTurnPlayerId = room.gameState.turnOrder[room.gameState.currentPlayerIndex];
        if (player.id !== currentTurnPlayerId) {
            return socket.emit('actionError', 'Equip only on your turn.');
        }
        if (player.currentAp < 1) {
            if (player.currentAp === 0) {
                socket.emit('actionError', 'NO_AP_END_TURN');
            } else {
                socket.emit('actionError', `Not enough AP to equip item. Need 1 AP, have ${player.currentAp}.`);
            }
            return;
        }

        const cardIndex = player.hand.findIndex((c) => c.id === cardId);
        if (cardIndex === -1) {
            return socket.emit('actionError', 'That card is not in your hand — select it in your hand, then Equip (1 AP).');
        }

        const cardToEquip = player.hand[cardIndex];
        const itemType = (cardToEquip.type || '').toLowerCase();
        if (itemType !== 'weapon' && itemType !== 'armor') {
            return socket.emit('actionError', 'Only weapons and armor can be equipped from hand.');
        }

        player.currentAp -= 1;

        const currentlyEquipped = player.equipment[itemType];
        player.equipment[itemType] = player.hand.splice(cardIndex, 1)[0];

        if (currentlyEquipped) {
            this._giveCardToPlayer(room, player, currentlyEquipped);
        }

        if (cardToEquip.name === 'Wyrmscale Mail' && !player.wyrmscaleImmunityType) {
            player.wyrmscaleImmunityType = 'fire';
            room.chatLog.push({
                type: 'system',
                text: `${player.name}'s Wyrmscale Mail attunes to Fire immunity (change with armor action if needed).`,
                timestamp: Date.now()
            });
        }

        player.stats = this.calculatePlayerStats(player, room.gameState.partyHope);
        room.chatLog.push({
            type: 'action-good',
            playerName: player.name,
            text: `${player.name} equipped ${cardToEquip.name}.`,
            timestamp: Date.now()
        });
        this.emitGameState(room.id);
    }

    discardCard(socket, { cardId }) {
        const room = this.findRoomBySocket(socket);
        const player = room?.players[socket.id];
        if (!room || !player) return;
    
        const cardIndex = player.hand.findIndex(c => c.id === cardId);
        if (cardIndex === -1) return;
    
        const card = player.hand.splice(cardIndex, 1)[0];
        const discardPile = this._getDiscardPileForCard(room, card);
        discardPile.push(card);
    
        room.chatLog.push({ type: 'system', text: `${player.name} discarded ${card.name}.`, timestamp: Date.now() });
        this.emitGameState(room.id);
    }
    
    _addXpToPlayer(room, player, xpAmount) {
        if (!player || player.isDowned) return;
        const xpBonus = Math.floor(xpAmount * (player.stats.int * 0.05));
        let totalXpGained = xpAmount + xpBonus;
        if (room?.gameState?.runModifiers?.daily && room.gameState.runModifiers.modifiers?.includes('Double XP')) {
            totalXpGained *= 2;
        }
        const perkMults = this._getMetaPerkMultipliers(player);
        if (perkMults.xpMultiplier > 1.0) {
            totalXpGained = Math.floor(totalXpGained * perkMults.xpMultiplier);
        }
        player.xp += totalXpGained;
        player.runXp += totalXpGained;

        // Instantly notify the client to save their new Account XP total.
        const playerSocket = io.sockets.sockets.get(player.id);
        if (playerSocket) {
            playerSocket.emit('accountXpGained', { amount: totalXpGained });
        }

        if (xpAmount > 0) {
            let logText = `${player.name} gained ${xpAmount} XP.`;
            if (xpBonus > 0) logText += ` (including ${xpBonus} bonus from INT!)`;
            room.chatLog.push({ type: 'system-good', text: logText, timestamp: Date.now() });
        }
        
        if (player.xp >= player.xpToNextLevel && !player.pendingAction) {
            player.pendingAction = { actionType: 'levelUp' };
            room.gameState.isPaused = true;
            room.gameState.pauseReason = `${player.name} is leveling up!`;
            
            if (playerSocket && !player.isNpc) {
                playerSocket.emit('levelUpPrompt', {
                    level: player.level + 1,
                    class: player.class,
                    currentStats: player.stats,
                });
            } else {
                // Auto-level up for disconnected players or NPCs
                const primaryStat = gameData.classes[player.class]?.primaryStat || 'str';
                this.resolveLevelUpChoice(null, { player, room, payload: { stat: primaryStat }});
            }
        }
    }

    // --- 3.5. Turn Management ---
    beginEndOfTurnPhase(room, player) {
        console.log(`[BeginEndOfTurnPhase] Called for ${player.name} (role: ${player.role})`);
        
        // CRITICAL FIX: Unlock turn processing for NPCs when their turn ends
        if (player.isNpc) {
            console.log(`[BeginEndOfTurnPhase] UNLOCKING turn processing for NPC ${player.name}`);
            room.isProcessingTurn = false;
        }
        
        const effectsToSaveAgainst = player.statusEffects.filter(e => e.trigger === 'end' && e.saveDC);
        
        if (effectsToSaveAgainst.length > 0) {
            console.log(`[BeginEndOfTurnPhase] ${player.name} has status saves to make`);
            player.pendingAction = {
                actionType: 'statusSaves',
                saves: effectsToSaveAgainst
            };
            this._startOrContinueStatusSaveSequence(room, player);
        } else {
            // If combat cleared and interval reached, present room choices before next turn
            if (room.gameState.board.monsters.length === 0) {
                const round = room.gameState.turnCount;
                const interval = room.settings.pathChoiceInterval || 2;
                const isChooserTurn = player.id === room.gameState.turnOrder[room.gameState.currentPlayerIndex];
                const isHumanExplorer = !player.isNpc && player.role === 'Explorer';
                const intervalOk = round - room.gameState.lastPathChoiceRound >= interval;
                // Only gate on a human Explorer's turn to avoid DM-caused stalls
                if (isChooserTurn && isHumanExplorer && intervalOk) {
                    console.log(`[BeginEndOfTurnPhase] Generating room choices for ${player.name}`);
                    this._generateNextRooms(room, player);
                    return; // Wait for choice before advancing turn
                }
            }
            console.log(`[BeginEndOfTurnPhase] Calling moveToNextTurn for ${player.name}`);
            this.moveToNextTurn(room);
        }
    }

    _generateNextRooms(room, chooserPlayer) {
        room.gameState.roomsCleared = (room.gameState.roomsCleared || 0) + 1;
        const depth = room.gameState.roomsCleared;
        room.gameState.depth = depth;

        // Boss room every 5 rooms cleared (forced, no choice)
        if (depth > 0 && depth % 5 === 0 && !room.gameState.bossDefeatedThisDepth) {
            const bossRoom = {
                id: `room_${Date.now()}_boss`,
                type: 'boss',
                preview: this._getRoomPreview(room, 'boss')
            };
            room.gameState.nextRooms = [bossRoom];
            const humanExplorers = Object.values(room.players).filter(p => p.role === 'Explorer' && !p.isNpc);
            const chooser = (chooserPlayer && !chooserPlayer.isNpc) ? chooserPlayer : humanExplorers[0];
            room.gameState.pathChooserId = chooser?.id || null;
            room.chatLog.push({ type: 'system', text: `A powerful presence blocks the way forward... Boss encounter!`, timestamp: Date.now() });
            this.emitGameState(room.id);
            return;
        }
        room.gameState.bossDefeatedThisDepth = false;

        // Weight room types based on depth for strategic variety
        const baseTypes = [
            { type: 'combat',   weight: 30 },
            { type: 'event',    weight: 20 },
            { type: 'treasure', weight: 15 },
            { type: 'shop',     weight: 15 },
            { type: 'rest',     weight: 15 },
            { type: 'ambush',   weight: Math.min(15, depth * 2) },
        ];
        const noShops = room.gameState.runModifiers?.daily && room.gameState.runModifiers.modifiers?.includes('No shops');
        const recent = room.gameState.recentRoomTypes || [];

        const pickWeightedType = () => {
            const pool = baseTypes.filter(t => {
                if (noShops && t.type === 'shop') return false;
                return true;
            });
            // Reduce weight of recently visited types
            const adjusted = pool.map(t => ({
                ...t,
                weight: recent.includes(t.type) ? t.weight * 0.3 : t.weight
            }));
            const totalWeight = adjusted.reduce((s, t) => s + t.weight, 0);
            let r = nextDailyRandom(room, 'path-type') * totalWeight;
            for (const t of adjusted) {
                r -= t.weight;
                if (r <= 0) return t.type;
            }
            return 'combat';
        };

        const options = [];
        const usedTypes = new Set();
        while (options.length < 3) {
            const t = pickWeightedType();
            if (usedTypes.has(t) && options.length < 2) continue;
            usedTypes.add(t);
            const preview = this._getRoomPreview(room, t);
            options.push({ id: `room_${Date.now()}_${options.length}`, type: t, preview });
        }

        room.gameState.nextRooms = options;
        const humanExplorers = Object.values(room.players).filter(p => p.role === 'Explorer' && !p.isNpc);
        const chooser = (chooserPlayer && !chooserPlayer.isNpc && chooserPlayer.role === 'Explorer') ? chooserPlayer : humanExplorers[0];
        room.gameState.pathChooserId = chooser?.id || null;
        room.chatLog.push({ type: 'system', text: `${chooser?.name || 'Player'} will choose the next path (Depth ${depth}): ${room.gameState.nextRooms.map(o => o.type).join(' / ')}`, timestamp: Date.now() });
        this.emitGameState(room.id);
    }

    _getRoomPreview(room, type) {
        const depth = room?.gameState?.depth || 1;
        const dangerScale = depth <= 3 ? 'Low' : depth <= 7 ? 'Medium' : depth <= 12 ? 'High' : 'Extreme';
        switch(type) {
            case 'combat':   return { danger: dangerScale, reward: 'Loot + XP', description: 'Battle awaits in the next chamber.' };
            case 'treasure':  return { danger: `Trap DC ${12 + Math.floor(depth / 3)}`, reward: 'Rare item chance', description: 'A glittering cache, possibly trapped.' };
            case 'event':     return { danger: 'Variable', reward: 'Random boon or challenge', description: 'Something stirs in the darkness...' };
            case 'shop':      return { danger: 'Safe', reward: 'Buy/Reroll items', description: 'A wandering merchant offers wares.' };
            case 'rest':      return { danger: 'Safe', reward: `Heal party (+${5 + depth} HP)`, description: 'A moment of respite by a campfire.' };
            case 'ambush':    return { danger: 'High', reward: 'Bonus XP + loot', description: 'The shadows feel... hostile.' };
            case 'boss':      return { danger: 'BOSS', reward: 'Epic loot + major XP', description: 'A fearsome guardian blocks your path!' };
        }
        return { danger: 'Unknown', reward: 'Unknown', description: '' };
    }

    _spawnBossForRoom(room) {
        const depth = room.gameState.depth || 1;
        const bossKeys = Object.keys(gameData.bosses);
        // Pick boss tier based on depth: 1-5=tier1, 6-10=tier2, 11+=tier3
        const bossPool = bossKeys.filter(k => {
            const b = gameData.bosses[k];
            if (depth <= 5) return b.tier === 1;
            if (depth <= 10) return b.tier <= 2;
            return true;
        });
        const bossKey = bossPool[Math.floor(nextDailyRandom(room, 'boss-pick') * bossPool.length)] || bossKeys[0];
        const bossData = gameData.bosses[bossKey];

        // Scale boss with depth
        const scaleMult = 1 + (Math.floor(depth / 5) * 0.25);
        const avgLevel = this._getAvgExplorerLevel(room);
        const levelScale = 1 + (Math.floor(avgLevel / 3) * 0.15);

        const boss = {
            id: `boss-${this.generateUniqueCardId()}`,
            name: bossData.name,
            type: 'Monster',
            isBoss: true,
            maxHp: Math.floor(bossData.hp * scaleMult * levelScale),
            currentHp: Math.floor(bossData.hp * scaleMult * levelScale),
            attackBonus: 6 + Math.floor(depth / 3),
            requiredRollToHit: 14 + Math.floor(depth / 5),
            effect: { dice: bossData.damage },
            xpValue: bossData.essence || 100,
            abilities: (bossData.abilities || []).map(a => ({ name: a })),
            statusEffects: [],
            stats: { str: 4, dex: 2, con: 4, int: 2, wis: 2, cha: 2 }
        };

        room.gameState.board.monsters.push(boss);

        // Place boss on grid
        const grid = room.gameState.grid;
        const w = grid.width || 5;
        const h = grid.height || 5;
        const isOccupied = (x, y) => Object.values(grid.entities).some(e => e && e.x === x && e.y === y);
        // Boss prefers center of grid
        const centerX = Math.floor(w / 2);
        const centerY = Math.floor(h / 2);
        if (!isOccupied(centerX, centerY)) {
            grid.entities[boss.id] = { x: centerX, y: centerY, type: 'monster' };
        } else {
            for (let tries = 0; tries < 100; tries++) {
                const x = Math.floor(nextDailyRandom(room, 'boss-x') * w);
                const y = Math.floor(nextDailyRandom(room, 'boss-y') * h);
                if (!isOccupied(x, y)) {
                    grid.entities[boss.id] = { x, y, type: 'monster' };
                    break;
                }
            }
        }

        room.chatLog.push({ type: 'dm', text: `${bossData.name} emerges! Prepare for battle!`, timestamp: Date.now() });
        return boss;
    }

    _spawnAmbush(room) {
        const depth = room.gameState.depth || 1;
        const ambushPool = gameData.dungeonEvents.ambushes;
        const ambush = ambushPool[Math.floor(nextDailyRandom(room, 'ambush-pick') * ambushPool.length)];

        room.chatLog.push({ type: 'dm', text: `${ambush.description}`, timestamp: Date.now() });

        const monstersToSpawn = ambush.enemies || [];
        for (const enemyName of monstersToSpawn) {
            const template = gameData.allMonsters.find(m => m.name === enemyName);
            if (!template) continue;

            const scaleMult = 1 + (Math.floor(depth / 4) * 0.3);
            const monster = {
                id: `monster-${this.generateUniqueCardId()}`,
                name: template.name,
                type: 'Monster',
                maxHp: Math.floor(template.maxHp * scaleMult),
                currentHp: Math.floor(template.maxHp * scaleMult),
                attackBonus: template.attackBonus + Math.floor(depth / 5),
                requiredRollToHit: template.requiredRollToHit,
                effect: { dice: template.effect?.dice || '1d6' },
                xpValue: Math.floor((template.xpValue || 10) * scaleMult),
                stats: { ...(template.stats || {}) },
                statusEffects: []
            };

            room.gameState.board.monsters.push(monster);

            const grid = room.gameState.grid;
            const w = grid.width || 5;
            const h = grid.height || 5;
            for (let tries = 0; tries < 100; tries++) {
                const x = Math.floor(nextDailyRandom(room, 'ambush-x') * w);
                const y = Math.floor(nextDailyRandom(room, 'ambush-y') * Math.min(2, h));
                const isOcc = Object.values(grid.entities).some(e => e && e.x === x && e.y === y);
                if (!isOcc) {
                    grid.entities[monster.id] = { x, y, type: 'monster' };
                    break;
                }
            }
        }

        if (ambush.surprise) {
            room.chatLog.push({ type: 'system', text: `Ambush! The enemies get a free attack round!`, timestamp: Date.now() });
        }
    }

    _getAvgExplorerLevel(room) {
        const explorers = Object.values(room.players).filter(p => p.role === 'Explorer' && !p.isDowned);
        if (explorers.length === 0) return 1;
        return Math.floor(explorers.reduce((sum, p) => sum + (p.level || 1), 0) / explorers.length);
    }
    
    openShop(room, options = {}) {
        const priceModifier = typeof options.priceModifier === 'number' ? options.priceModifier : 1;
        // Check if there are any real (non-NPC) players
        const realPlayers = Object.values(room.players).filter(p => !p.isNpc);
        const hasRealPlayers = realPlayers.length > 0;
        
        if (hasRealPlayers) {
            // Multiplayer mode: pause game and track individual shop states
            room.gameState.isPaused = true;
            room.gameState.pauseReason = 'Shopping...';
            room.gameState.shopPlayerStates = {};
            
            // Initialize shop state for each real player
            realPlayers.forEach(player => {
                room.gameState.shopPlayerStates[player.id] = {
                    isShopping: true,
                    hasFinished: false
                };
            });
        } else {
            // NPC-only mode: don't pause game, let individual players shop at their own pace
            room.gameState.isPaused = false;
            room.gameState.shopPlayerStates = {};
        }

        // Generate a small inventory biased to class needs
        const explorers = Object.values(room.players).filter(p => p.role === 'Explorer' && !p.isNpc);
        const biasClass = explorers[0]?.class;
        const pick = (deck, count = 4) => {
            const items = [];
            const pool = [...deck];
            while (items.length < count && pool.length > 0) {
                const idx = Math.floor(nextDailyRandom(room, 'shop-pick') * pool.length);
                const base = pool.splice(idx, 1)[0];
                // Chance to offer a magical/rare variant with affixes
                let offered = { ...base };
                const rareRand = nextDailyRandom(room, 'shop-rare');
                if (rareRand < 0.35) {
                    try {
                        // Use a low tier so shop has some rares without being overpowered
                        offered = this.generateMagicalItem(base, 1, null);
                    } catch (_) {
                        offered = { ...base };
                    }
                }
                offered.price = this._priceForCard(offered);
                items.push(offered);
            }
            return items;
        };
        const inv = [
            ...pick(room.gameState.decks.weapon, 2),
            ...pick(room.gameState.decks.armor, 2),
            ...pick(room.gameState.decks.item, 2),
            ...pick(room.gameState.decks.spell, 2)
        ];
        if (priceModifier !== 1 && inv.length > 0) {
            inv.forEach((c) => {
                const base = typeof c.price === 'number' ? c.price : this._priceForCard(c);
                c.price = Math.max(1, Math.round(base * priceModifier));
            });
        }
        room.gameState.shop = { id: `shop_${Date.now()}`, inventory: inv };
        
        // Send shop opened event with player-specific information
        realPlayers.forEach(player => {
            io.to(player.id).emit('shopOpened', { 
                inventory: inv, 
                shopId: room.gameState.shop.id,
                isMultiplayer: hasRealPlayers,
                totalPlayers: realPlayers.length,
                playerId: player.id
            });
        });
    }

    /**
     * Mark one player finished shopping; when all real players are done, unpause and clear shop.
     * Used by `closeShop` (all paths: path room, NPC trade, solo). Legacy `playerShopComplete` kept as alias.
     */
    markPlayerShopFinished(room, player) {
        if (!room?.gameState?.shop || !player || player.isNpc) return;
        const states = room.gameState.shopPlayerStates;
        const realPlayers = Object.values(room.players).filter((p) => !p.isNpc);
        if (states && realPlayers.length > 0) {
            if (!states[player.id]) {
                states[player.id] = { isShopping: false, hasFinished: false };
            }
            states[player.id].hasFinished = true;
            states[player.id].isShopping = false;
        }
        const allDone =
            realPlayers.length > 0 &&
            realPlayers.every((p) => states?.[p.id]?.hasFinished === true);
        let advanceTurnAfterPathShop = false;
        if (allDone) {
            room.gameState.isPaused = false;
            room.gameState.pauseReason = '';
            room.gameState.shop = null;
            room.gameState.shopPlayerStates = {};
            advanceTurnAfterPathShop = room.gameState.pendingTurnAfterPathShop === true;
            room.gameState.pendingTurnAfterPathShop = false;
            console.log('[ShopClose] All players finished shopping, game resumed');
        } else {
            console.log(`[ShopClose] Player ${player.name} finished shopping, waiting for others`);
        }
        this.emitGameState(room.id);
        // Path choice after endTurn: turn was never advanced (beginEndOfTurnPhase returned early for path UI).
        // Without this, currentPlayerIndex still points at the player who ended — they get another turn and skip others.
        if (advanceTurnAfterPathShop) {
            this.moveToNextTurn(room);
        }
    }

    _priceForCard(card) {
        const base = 10;
        const rarity = card.rarityKey || 'common';
        const rarityMult = { common: 1, uncommon: 2, rare: 4, epic: 8, legendary: 16, mythic: 24 }[rarity] || 1;
        const type = (card.type || '').toLowerCase();
        const typeMult = { weapon: 1.6, armor: 1.5, spell: 1.3, item: 1.0 }[type] || 1.1;
        const levelMult = card.level ? (1 + Math.min(3, Number(card.level)) * 0.25) : 1;
        const price = Math.round(base * rarityMult * typeMult * levelMult);
        return Math.max(1, price);
    }
    resolveBuy(room, player, cardId, price, shopId) {
        if (!room.gameState.shop || room.gameState.shop.id !== shopId) return;
        const index = room.gameState.shop.inventory.findIndex(c => c.id === cardId);
        if (index === -1) return;
        const card = room.gameState.shop.inventory[index];
        const finalPrice = price || card.price || this._priceForCard(card);
        if ((player.gold || 0) < finalPrice) {
            const sock = io.sockets.sockets.get(player.id);
            return sock && sock.emit('actionError', 'Not enough gold.');
        }
        player.gold = (player.gold || 0) - finalPrice;
        // Give a fresh copy with a unique id to avoid deck collisions
        const purchased = { ...card, id: this.generateUniqueCardId() };
        this._giveCardToPlayer(room, player, purchased);
        // Remove from shop
        room.gameState.shop.inventory.splice(index, 1);
        room.chatLog.push({ type: 'system-good', playerName: player.name, text: `${player.name} bought ${card.name} for ${finalPrice} gold.`, timestamp: Date.now() });
        this.emitGameState(room.id);
    }
    

    /** After level-up / specialization UI, snap turn pointer back to this explorer (interrupt-safe). */
    _resumeTurnAfterInterrupt(room, player) {
        if (!player || !room?.gameState?.turnOrder?.length) return;
        const idx = room.gameState.turnOrder.indexOf(player.id);
        if (idx !== -1) {
            room.gameState.currentPlayerIndex = idx;
        }
    }

    moveToNextTurn(room) {
        if (room.gameState.winner) return;

        // Do not advance while paused (level-up, shop, modals) — timers may fire mid-interrupt.
        if (room.gameState.isPaused) {
            console.log('[Turn] moveToNextTurn skipped — game is paused');
            return;
        }
        
        // CRITICAL FIX: Prevent race conditions with turn progression
        if (room.isProcessingTurn) {
            console.log(`[Turn] Turn progression already in progress, queuing next turn`);
            room.pendingTurnAdvance = true;
            return;
        }
        room.isProcessingTurn = true;
        console.log(`[Turn] LOCKED turn processing - starting turn progression`);
        
        // CRITICAL FIX: Safety timeout to prevent permanent lock
        setTimeout(() => {
            if (room.isProcessingTurn) {
                console.log(`[Turn] SAFETY: Releasing turn lock after 10s timeout`);
                room.isProcessingTurn = false;
                if (room.pendingTurnAdvance) {
                    room.pendingTurnAdvance = false;
                    console.log(`[Turn] SAFETY: Processing queued turn advance after timeout`);
                    setTimeout(() => this.moveToNextTurn(room), 100);
                }
            }
        }, 10000); // 10 second safety timeout
        
        // CRITICAL FIX: Check for pending animation delay before proceeding
        if (room.pendingAnimationDelay && room.pendingAnimationDelay > 0) {
            console.log(`[Turn] Waiting ${room.pendingAnimationDelay}ms for animations to complete`);
            setTimeout(() => {
                room.pendingAnimationDelay = 0; // Clear the delay
                this.moveToNextTurn(room); // Recursive call after delay
            }, room.pendingAnimationDelay);
            return;
        }
        
        const explorers = Object.values(room.players).filter(p => p.role === 'Explorer');
        
        const handleGameOver = (winner) => {
            room.gameState.winner = winner;
            this._modifyPartyHope(room, winner === 'Explorers' ? 10 : -10);
            
            explorers.forEach(p => {
                const bonusXp = Math.floor((p.level * 50) + (room.gameState.turnCount * 10) + (p.enemiesDefeated * 5));
                const playerSocket = io.sockets.sockets.get(p.id);
                if (playerSocket) {
                    playerSocket.emit('gameOver', { 
                        winner: winner, 
                        runXp: p.runXp,
                        bonusXp: bonusXp
                    });
                    // Also emit the final xp gain to be saved to localStorage
                    playerSocket.emit('accountXpGained', { amount: bonusXp });
                }
            });
        };
        
        if (explorers.every(p => p.isDowned)) {
            handleGameOver('DM');
            room.isProcessingTurn = false; // Unlock on early return
            return;
        }
        
        // Boss defeated = checkpoint, not game over. Mark depth cleared and continue.
        const defeatedBosses = room.gameState.board.monsters.filter(m => m.isBoss && m.currentHp <= 0);
        if (defeatedBosses.length > 0) {
            room.gameState.bossDefeatedThisDepth = true;
            room.gameState.board.monsters = room.gameState.board.monsters.filter(m => !(m.isBoss && m.currentHp <= 0));
            defeatedBosses.forEach(boss => {
                if (room.gameState.grid?.entities[boss.id]) delete room.gameState.grid.entities[boss.id];
            });
            room.chatLog.push({ type: 'system-good', text: `Boss defeated! The path forward opens. The dungeon grows darker...`, timestamp: Date.now() });
            // Heal party partially as a boss reward
            Object.values(room.players).forEach(p => {
                if (p.class && !p.isDowned) {
                    p.stats.currentHp = Math.min(p.stats.maxHp, p.stats.currentHp + Math.floor(p.stats.maxHp * 0.3));
                }
            });
            this._modifyPartyHope(room, 3);
        }

        let nextPlayerIndex = (room.gameState.currentPlayerIndex + 1) % room.gameState.turnOrder.length;
        let nextPlayer = room.players[room.gameState.turnOrder[nextPlayerIndex]];
        console.log(`[MoveToNextTurn] Next player index: ${nextPlayerIndex}, turn order: ${JSON.stringify(room.gameState.turnOrder)}`);
        console.log(`[MoveToNextTurn] Next player: ${nextPlayer ? nextPlayer.name : 'NOT FOUND'} (ID: ${room.gameState.turnOrder[nextPlayerIndex]})`);
        
        let attempts = 0;
        // FIXED: Only skip players if they're downed OR (disconnected AND not an NPC replacement pending)
        while ((nextPlayer.isDowned || (nextPlayer.disconnected && !nextPlayer.isNpc)) && attempts < room.gameState.turnOrder.length) {
            console.log(`[Turn] Skipping ${nextPlayer.name} - isDowned: ${nextPlayer.isDowned}, disconnected: ${nextPlayer.disconnected}`);
            nextPlayerIndex = (nextPlayerIndex + 1) % room.gameState.turnOrder.length;
            nextPlayer = room.players[room.gameState.turnOrder[nextPlayerIndex]];
            attempts++;
        }
        if (attempts >= room.gameState.turnOrder.length) {
            handleGameOver('DM');
            room.isProcessingTurn = false; // Unlock on early return
            return;
        }

        room.gameState.currentPlayerIndex = nextPlayerIndex;
        if (nextPlayer.id === 'npc-dm') {
            room.gameState.turnCount++;
             // Grant survival XP at the start of each new round
            const survivalXp = 5 + room.gameState.turnCount;
            Object.values(room.players).forEach(p => {
                if(p.role === 'Explorer' && !p.isDowned) {
                    this._addXpToPlayer(room, p, survivalXp);
                }
            });
            // World events tick per full round (DM slot indicates new round)
            const we = room.gameState.worldEvents;
            if (we && we.duration > 0) {
                we.duration--;
                if (we.duration === 0) {
                    room.chatLog.push({ type: 'system', text: `The world event '${we.currentEvent?.name || 'Unknown'}' has ended.`, timestamp: Date.now() });
                    we.currentEvent = null;
                }
            }
             if(explorers.some(p => p.pendingAction?.actionType === 'levelUp')) {
                this.emitGameState(room.id);
                room.isProcessingTurn = false; // Unlock on early return
                return; // Halt turn progression if someone is leveling up. It will be resumed by resolveLevelUpChoice.
            }
        }
        nextPlayer.hasTakenFirstTurn = true;

        this.startNewTurn(room, nextPlayer);
        
        // CRITICAL FIX: Only unlock turn processing for human players
        // NPCs will unlock when their turn actually completes
        if (!nextPlayer.isNpc) {
            console.log(`[Turn] Unlocking turn processing for human player ${nextPlayer.name}`);
            room.isProcessingTurn = false;
            if (room.pendingTurnAdvance) {
                room.pendingTurnAdvance = false;
                console.log(`[Turn] Processing queued turn advance`);
                setTimeout(() => this.moveToNextTurn(room), 100);
            }
        } else {
            console.log(`[Turn] Keeping turn lock for NPC ${nextPlayer.name} - will unlock when turn completes`);
        }
    }
    
    startNewTurn(room, player) {
        console.log(`[StartNewTurn] Starting turn for ${player.name} (ID: ${player.id}, isNpc: ${player.isNpc}, role: ${player.role})`);
        player.currentAp = player.stats.maxAP;
        player.usedAbilityThisTurn = false;
        if (player.class && !player.isNpc) {
            player._duelistOpeningUsed = false;
            player._farstrikePiercingUsed = false;
            player._quickBladeAttacks = 0;
            player._quickBladeRetreatUsed = false;
            player._phaseShroudUsedThisTurn = false;
            player.wayfinderDeflectReady = false;
        }
        
        // CRITICAL FIX: Reset movement points each turn (separate from AP!)
        const dashingBonus = player.statusEffects?.find(e => e.name === 'Dashing')?.bonuses?.movementBonus || 0;
        player.movementPoints = gameData.gridConfig.baseMovementPoints + dashingBonus;
        
        // FIXED: Clear NPC action flags at start of turn
        if (player.isNpc) {
            player.hasGuardedThisTurn = false;
            player.hasBuffedThisTurn = false;
        }
        
        if (player.stats.shieldHp > 0) {
            player.stats.shieldHp = 0;
        }

        player.statusEffects.forEach(effect => {
            if (effect.trigger === 'start' && effect.damage) {
                const damage = this.rollDiceWithDetails(effect.damage).total;
                const { logParts } = this._applyDamage(room, player, damage, { name: effect.name });
                room.chatLog.push({ type: 'combat', text: `${player.name} takes ${damage} damage from ${effect.name}. ${logParts.join(' ')}`, timestamp: Date.now() });
            }
            effect.duration--;
        });
        player.statusEffects = player.statusEffects.filter(e => e.duration > 0);
        
        player.stats = this.calculatePlayerStats(player, room.gameState.partyHope);
        
        // World events tick per full round (handled in turn-cycle logic)

        // Random dungeon event chance (15% per turn for players)
        if (!player.isNpc && Math.random() < 0.15) {
            this._triggerDungeonEvent(room, player);
        }
        
        // Random world event chance (10% per turn if no world event active)
        if (!room.gameState.worldEvents.currentEvent && Math.random() < 0.10) {
            this._triggerWorldEvent(room);
        }
        
        // Random environmental card spawn (10% per turn if space on board)
        if (room.gameState.board.environment.length < 2 && Math.random() < 0.10) {
            this._spawnEnvironmentalCard(room);
        }
        
        // Emit full state first so clients never show "your turn" while the board is still on the previous snapshot.
        this.emitGameState(room.id);
        io.to(room.id).emit('turnStarted', { playerId: player.id });
        
        if (player.isNpc) {
            // Delay NPC turns to ensure player sees the turn change
            console.log(`[StartNewTurn] Scheduling NPC turn for ${player.name} in 1500ms`);
            setTimeout(() => this.takeNpcTurn(room, player), 1500);
        }
    }

    _triggerDungeonEvent(room, player) {
        const depth = room.gameState.depth || 1;
        // Filter event types based on depth for progressive challenge
        const eventTypes = ['traps', 'puzzles', 'npcs', 'hazards'];
        const randomType = eventTypes[Math.floor(nextDailyRandom(room, 'event-type') * eventTypes.length)];
        const eventPool = gameData.dungeonEvents[randomType] || [];
        if (eventPool.length === 0) return;
        const event = eventPool[Math.floor(nextDailyRandom(room, 'event-pick') * eventPool.length)];

        if (randomType === 'traps' || randomType === 'hazards') {
            const scaledDC = (event.saveDC || 12) + Math.floor(depth / 4);
            const scaledDamage = depth > 8 ? event.damage.replace(/(\d+)d/, (m, n) => `${Math.min(6, parseInt(n) + 1)}d`) : event.damage;
            
            const risk = {
                skill: event.saveStat || 'dex',
                dc: scaledDC,
                description: `${event.description} (DC ${scaledDC})`,
                success: { type: 'none', text: `You avoid the ${event.name}!` },
                failure: { type: 'self_damage', value: scaledDamage, text: `${event.description} You take damage!` },
                sourceTag: 'dungeonEvent'
            };
            if (event.status) {
                risk.failure.status = event.status;
                risk.failure.statusDuration = event.duration || 2;
            }

            room.gameState.skillChallenge = { isActive: true, details: risk, currentStage: 0, targetId: null };
            room.chatLog.push({ type: 'system', text: `${event.name}: ${event.description}`, timestamp: Date.now() });
            io.to(room.id).emit('promptSkillCheckRoll', {
                rollerId: player.id,
                rollerName: player.name,
                title: event.name,
                description: risk.description,
                dice: 'd20',
                bonus: player.stats?.[event.saveStat] || 0,
                targetAC: scaledDC,
                hasAdvantage: false
            });

        } else if (randomType === 'puzzles') {
            const scaledDC = (event.solveDC || 13) + Math.floor(depth / 5);
            const risk = {
                skill: event.solveStat || 'int',
                dc: scaledDC,
                description: `${event.description} (DC ${scaledDC})`,
                success: { type: 'loot', text: `You solved the ${event.name} and found treasure!` },
                failure: { type: 'none', text: `The puzzle eludes you. Perhaps another time.` },
                sourceTag: 'dungeonEvent'
            };
            room.gameState.skillChallenge = { isActive: true, details: risk, currentStage: 0, targetId: null };
            room.chatLog.push({ type: 'system', text: `${event.name}: ${event.description}`, timestamp: Date.now() });
            io.to(room.id).emit('promptSkillCheckRoll', {
                rollerId: player.id,
                rollerName: player.name,
                title: event.name,
                description: risk.description,
                dice: 'd20',
                bonus: player.stats?.[event.solveStat] || 0,
                targetAC: scaledDC,
                hasAdvantage: false
            });

        } else if (randomType === 'npcs') {
            const eventData = {
                id: `event_${Date.now()}`,
                type: 'npc',
                name: event.name,
                description: event.description,
                choices: []
            };
            if (event.interaction === 'trade') {
                eventData.choices = [
                    { label: 'Trade', description: `Browse wares (${Math.round((event.priceModifier || 1) * 100)}% prices)` },
                    { label: 'Pass', description: 'Continue onward' }
                ];
            } else if (event.interaction === 'rescue') {
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
            player.pendingDungeonEvent = {
                id: eventData.id,
                interaction: event.interaction,
                name: event.name,
                priceModifier: event.priceModifier != null ? event.priceModifier : 1,
                reward: event.reward || null
            };
            const playerSocket = io.sockets.sockets.get(player.id);
            if (playerSocket) {
                playerSocket.emit('dungeonEvent', eventData);
            }
        }
    }
    
    _triggerWorldEvent(room) {
        // Select a random world event
        if (room.gameState.runModifiers?.daily && room.gameState.runModifiers.modifiers?.includes('No shops')) {
            // Skip shop-related world events if we add them later
        }
        const worldEvents = gameData.worldEventCards;
        const event = worldEvents[Math.floor(nextDailyRandom(room, 'world-event') * worldEvents.length)];
        
        // Set it as the current world event
        room.gameState.worldEvents.currentEvent = { ...event };
        room.gameState.worldEvents.duration = event.duration;
        
        // Log to chat
        room.chatLog.push({ 
            type: 'system', 
            text: `🌍 World Event: ${event.name} - ${event.description}`, 
            timestamp: Date.now() 
        });
        
        // If it's a skill challenge event, start it
        if (event.eventType === 'skill_challenge') {
            room.gameState.skillChallenge.isActive = true;
            room.gameState.skillChallenge.details = event;
            room.gameState.skillChallenge.currentStage = 0;
        }
        
        console.log(`[WorldEvent] Triggered '${event.name}' in room ${room.code}`);
    }
    
    _spawnEnvironmentalCard(room) {
        // Select a random environmental card
        const envCards = gameData.environmentalCards;
        const card = envCards[Math.floor(nextDailyRandom(room, 'environment') * envCards.length)];
        
        // Add it to the board with a unique ID
        const envCard = {
            ...card,
            id: `env_${Date.now()}`,
            type: 'Environmental'
        };
        
        room.gameState.board.environment.push(envCard);
        
        // Log to chat
        room.chatLog.push({ 
            type: 'system', 
            text: `🗺️ Discovery: ${card.name} appears on the board!`, 
            timestamp: Date.now() 
        });
        
        console.log(`[Environmental] Spawned '${card.name}' in room ${room.code}`);
    }

    resolveEventChoice(room, player, eventId, choiceIndex) {
        const pending = player.pendingDungeonEvent;
        const idx = Math.max(0, parseInt(choiceIndex, 10) || 0);

        if (!pending || pending.id !== eventId) {
            room.chatLog.push({
                type: 'system-bad',
                playerName: player.name,
                text: `${player.name}'s encounter choice could not be applied (stale or unknown event).`,
                timestamp: Date.now()
            });
            player.pendingDungeonEvent = null;
            this.emitGameState(room.id);
            this.moveToNextTurn(room);
            return;
        }
        player.pendingDungeonEvent = null;

        let advanceTurn = true;

        const logGood = (text) => room.chatLog.push({
            type: 'action-good',
            playerName: player.name,
            text,
            timestamp: Date.now()
        });
        const logNeutral = (text) => room.chatLog.push({
            type: 'action',
            playerName: player.name,
            text,
            timestamp: Date.now()
        });

        if (pending.interaction === 'trade') {
            if (idx === 0) {
                logGood(`${player.name} visits ${pending.name || 'the merchant'}.`);
                this.openShop(room, { priceModifier: pending.priceModifier });
                advanceTurn = false;
            } else {
                logNeutral(`${player.name} declines the offer and moves on.`);
            }
        } else if (pending.interaction === 'rescue') {
            if (idx === 0) {
                const potionTemplate = gameData.itemCards.find((c) => c.name === 'Healing Potion');
                if (potionTemplate) {
                    const card = { ...potionTemplate, id: this.generateUniqueCardId() };
                    this._giveCardToPlayer(room, player, card);
                    this._modifyPartyHope(room, 3);
                    player.gold = (player.gold || 0) + 8;
                    logGood(`${player.name} helps the stranded adventurer — gains a Healing Potion, 8 gold, and party hope rises.`);
                } else {
                    const heal = this.rollDiceWithDetails('1d8+2').total;
                    player.stats.currentHp = Math.min(player.stats.maxHp, (player.stats.currentHp || 0) + heal);
                    this._modifyPartyHope(room, 2);
                    player.gold = (player.gold || 0) + 5;
                    logGood(`${player.name} helps the stranded adventurer. (+${heal} HP, 5 gold, party hope up.)`);
                }
            } else {
                logNeutral(`${player.name} leaves the injured traveler behind.`);
            }
        } else {
            if (idx === 0) {
                const dmg = this.rollDiceWithDetails('1d4').total;
                this._applyDamage(room, player, dmg, { name: pending.name || 'Stranger' });
                const goldFound = this.rollDiceWithDetails('2d6').total;
                player.gold = (player.gold || 0) + goldFound;
                logGood(`${player.name} investigates — it's a trap! ${dmg} damage, but ${goldFound} gold is recovered.`);
            } else {
                logNeutral(`${player.name} keeps their distance and avoids trouble.`);
            }
        }

        this.emitGameState(room.id);
        if (advanceTurn) this.moveToNextTurn(room);
    }

    // --- SYNERGY SYSTEM (Phase 3) ---
    _checkForSynergies(room, player, actionType, targetData = {}) {
        if (!player.recentActions) player.recentActions = [];
        
        // Add current action
        player.recentActions.push({ type: actionType, timestamp: Date.now(), ...targetData });
        
        // Keep only last 5 actions
        if (player.recentActions.length > 5) player.recentActions.shift();
        
        // Check for synergies
        const recentTypes = player.recentActions.map(a => a.type);
        
        // Charge (Dash + Attack)
        if (recentTypes.includes('dash') && actionType === 'attack') {
            this._triggerSynergy(room, player, 'charge', { damageBonus: 2 });
        }
        
        // Coordinated Strike (Help + Attack)
        if (player.statusEffects?.some(e => e.name === 'Helped') && actionType === 'attack') {
            this._triggerSynergy(room, player, 'coordinatedStrike', { damageBonus: 3 });
        }
        
        // Fortified Rest (Guard + Respite in same turn)
        if (recentTypes.includes('guard') && actionType === 'respite') {
            this._triggerSynergy(room, player, 'fortifiedRest', { healingMultiplier: 2 });
            return true; // Signal to double healing
        }
        
        // Devastating Blow (Flanking + Crit)
        if (player.stats.flankingBonus > 0 && targetData.isCritical) {
            this._triggerSynergy(room, player, 'devastatingBlow', { critMultiplier: 3 });
        }

        // Phase 3: element interaction examples
        if (actionType === 'castSpell' && targetData.elementCombo === 'fire+oil') {
            this._triggerSynergy(room, player, 'elementCombustion', { damageBonus: 4 });
        }
        if (actionType === 'castSpell' && targetData.elementCombo === 'lightning+water') {
            this._triggerSynergy(room, player, 'electrocute', { damageBonus: 3 });
        }
        
        return false;
    }
    
    _triggerSynergy(room, player, synergyKey, bonuses) {
        const synergy = gameData.synergies[synergyKey];
        if (!synergy) return;
        
        const playerSocket = io.sockets.sockets.get(player.id);
        if (playerSocket) {
            playerSocket.emit('synergyTriggered', {
                name: synergy.name,
                description: synergy.description,
                bonus: bonuses,
                icon: synergy.icon
            });
        }
        
        room.chatLog.push({
            type: 'system-good',
            playerName: player.name,
            text: `🌟 ${player.name} triggered ${synergy.name}!`,
            timestamp: Date.now()
        });
        
        // Apply bonuses
        if (bonuses.damageBonus) {
            player.synergyDamageBonus = (player.synergyDamageBonus || 0) + bonuses.damageBonus;
        }
    }

    // --- 3.6. AI Logic ---
    takeNpcTurn(room, npc) {
        console.log(`[TakeNpcTurn] Processing NPC turn for ${npc.name} (role: ${npc.role})`);
        if (npc.role === 'DM') {
            console.log(`[TakeNpcTurn] Calling takeDmTurn for ${npc.name}`);
            this.takeDmTurn(room, npc);
            // CRITICAL FIX: DM turn ending is now handled inside takeDmTurn
            // to ensure proper coordination with monster actions
        } else if (npc.role === 'Explorer') {
            console.log(`[TakeNpcTurn] Calling takeExplorerNpcTurn for ${npc.name}`);
            this.takeExplorerNpcTurn(room, npc);
        }
    }
    
    takeDmTurn(room, dm) {
        console.log(`[DM Turn] Starting DM turn - monsters on board: ${room.gameState.board.monsters.length}`);
        const baseMax = 4;
        const maxMonstersOnBoard = baseMax + (room.gameState.runModifiers?.daily ? 0 : 0);
        const currentMonsterCount = room.gameState.board.monsters.length;
        let spawnChance = 0.5; // Base 50% chance to consider spawning.

        if (currentMonsterCount < 2) {
            spawnChance = 0.75; // Increased to 75% if board is sparse
        }

        if (currentMonsterCount < maxMonstersOnBoard && nextDailyRandom(room, 'dm-spawn-chance') < spawnChance) {
            const numToSpawn = nextDailyRandom(room, 'dm-spawn-count') > 0.8 ? 2 : 1; // 20% chance to spawn two
            
            for (let i = 0; i < numToSpawn; i++) {
                if (room.gameState.board.monsters.length >= maxMonstersOnBoard) break;

                const depth = room.gameState.depth || 1;
                const tier = depth <= 4 ? 'tier1' : (depth <= 9 ? 'tier2' : 'tier3');
                const monsterCard = this.drawCardFromDeck(room.id, `monster.${tier}`);
                if (monsterCard) {
                    const avgLevel = this._getAvgExplorerLevel(room);
                    const levelTier = Math.floor(avgLevel / 5);
                    // Depth-based scaling: monsters get tougher the deeper you go
                    const depthScale = 1 + (Math.floor(depth / 3) * 0.15);
                    
                    if (levelTier > 0 || depth > 5) {
                        const scalingMultiplier = Math.max(depthScale, 1 + (levelTier * 0.5));
                        if (scalingMultiplier >= 2.0) {
                            monsterCard.name = `Dread ${monsterCard.name}`;
                        } else if (scalingMultiplier >= 1.3) {
                            monsterCard.name = `Elite ${monsterCard.name}`;
                        }
                        monsterCard.maxHp = Math.floor(monsterCard.maxHp * scalingMultiplier);
                        monsterCard.attackBonus = Math.floor((monsterCard.attackBonus || 0) + Math.floor(depth / 4));
                        monsterCard.xpValue = Math.floor(monsterCard.xpValue * scalingMultiplier);
                    }
                    // Daily challenge modifiers
                    if (room.gameState.runModifiers?.daily) {
                        if (room.gameState.runModifiers.modifiers?.includes('Enemies +25% HP')) {
                            monsterCard.maxHp = Math.floor(monsterCard.maxHp * 1.25);
                        }
                    }
                    monsterCard.currentHp = monsterCard.maxHp;
                    monsterCard.id = `monster-${this.generateUniqueCardId()}`;
                    monsterCard.statusEffects = [];
                    room.gameState.board.monsters.push(monsterCard);
                    
                    // CRITICAL FIX: Place monster on grid!
                    // Random open position
                    const grid = room.gameState.grid;
                    const w = grid.width || gameData.gridConfig.width;
                    const h = grid.height || gameData.gridConfig.height;
                    const isOccupied = (x, y) => Object.values(grid.entities).some(e => e && e.x === x && e.y === y);
                    let placed = false;
                    for (let tries = 0; tries < 200 && !placed; tries++) {
                        const x = Math.floor(nextDailyRandom(room, 'monster-x') * w);
                        const y = Math.floor(nextDailyRandom(room, 'monster-y') * h);
                        if (!isOccupied(x, y)) {
                            grid.entities[monsterCard.id] = { x, y, type: 'monster' };
                            placed = true;
                            console.log(`[Grid] Placed ${monsterCard.name} at (${x}, ${y})`);
                        }
                    }
                    
                    const spawnMessage = gameData.npcDialogue.dm.playMonster[Math.floor(nextDailyRandom(room, 'dm-spawn-msg') * gameData.npcDialogue.dm.playMonster.length)];
                    room.chatLog.push({ type: 'dm', text: `${spawnMessage} A ${monsterCard.name} appears!`, timestamp: Date.now() });
                    console.log(`[DM Turn] Spawned ${monsterCard.name} - total monsters: ${room.gameState.board.monsters.length}`);
                }
            }
        } else if (room.gameState.board.monsters.length === 0) {
            room.chatLog.push({ type: 'dm', text: "An eerie silence fills the air... for now.", timestamp: Date.now() });
        }

        // FIXED: Delay monster actions to let UI render first (prevents attacks before visible)
        this.emitGameState(room.id); // Send state update FIRST so UI shows monsters
        
        setTimeout(() => {
            // Monsters take their actions (after UI has rendered)
            const monsters = room.gameState.board.monsters.filter(m => m.currentHp > 0);
            let actionsCompleted = 0;
            
            if (monsters.length === 0) {
                // No monsters to act, end turn immediately
                console.log(`[DM Turn] No monsters to act, ending turn immediately`);
                this.endDmTurn(room, dm);
                return;
            }
            
            console.log(`[DM Turn] ${monsters.length} monsters will take actions`);
            
            monsters.forEach((monster, index) => {
                setTimeout(() => {
                    const candidates = [];
                    Object.values(room.players).forEach(p => {
                        if (p.role === 'Explorer' && !p.isDowned) {
                            const pos = room.gameState.grid.entities[p.id];
                            const cover = p.positioning?.cover || 0;
                            const elevation = p.positioning?.elevation || 0;
                            const score = (p.stats.currentHp || 1) + cover * 3 - elevation * 2; // prefer low cover targets
                            candidates.push({ entity: p, score });
                            if (p.companion && p.companion.currentHp > 0) {
                                const cs = (p.companion.currentHp || 1) + (p.positioning?.cover || 0) * 3;
                                candidates.push({ entity: p.companion, score: cs });
                            }
                        }
                    });
                    if (candidates.length > 0) {
                        candidates.sort((a,b) => a.score - b.score);
                        const target = candidates[0].entity;
                        
                        // CRITICAL FIX: Wait for the attack to complete before marking action as done
                        console.log(`[DM Turn] Starting attack for ${monster.name} against ${target.name}`);
                        this.resolveAttackAndWait(room, monster, target, monster, () => {
                            // Attack completed callback
                            console.log(`[DM Turn] Monster ${monster.name} attack completed - callback fired`);
                            
                            // If target is a player and has Riposte ready, queue a reaction
                            if (target && target.class && room.players[target.id]?.reactionReady === 'Riposte') {
                                setTimeout(() => {
                                    this._triggerRiposte(room, room.players[target.id], monster);
                                    room.players[target.id].reactionReady = null;
                                }, 800);
                            }
                            
                            // Check if all monster actions are complete
                            actionsCompleted++;
                            console.log(`[DM Turn] Monster action ${actionsCompleted}/${monsters.length} completed`);
                            if (actionsCompleted >= monsters.length) {
                                // All monster actions complete, end the turn
                                console.log(`[DM Turn] All monster actions complete, ending turn`);
                                setTimeout(() => {
                                    this.endDmTurn(room, dm);
                                }, 1000); // Small delay to let final animations complete
                            }
                        });
                    } else {
                        // No targets available, mark action as complete immediately
                        actionsCompleted++;
                        console.log(`[DM Turn] Monster ${monster.name} has no targets, action complete`);
                        if (actionsCompleted >= monsters.length) {
                            console.log(`[DM Turn] All monster actions complete, ending turn`);
                            setTimeout(() => {
                                this.endDmTurn(room, dm);
                            }, 1000);
                        }
                    }
                }, index * 1500); // Stagger monster attacks by 1.5s each
            });
        }, 1000); // Initial 1s delay to let UI render
    }
    
    endDmTurn(room, dm) {
        console.log(`[DM Turn] Ending DM turn`);
        if (!room.gameState.isPaused) {
            // Set animation delay for next turn
            room.pendingAnimationDelay = 1000; // Extra 1s before next player's turn
            console.log(`[DM Turn] Calling beginEndOfTurnPhase for DM`);
            this.beginEndOfTurnPhase(room, dm);
        } else {
            console.log(`[DM Turn] Game is paused, not ending turn`);
            // CRITICAL FIX: Unlock turn processing even if game is paused
            room.isProcessingTurn = false;
        }
    }
    
    takeExplorerNpcTurn(room, npc) {
        // FIXED: Process NPC actions quickly, use ALL AP, summarize in log
        let actionsLog = [];
        
        const actionLoop = () => {
            const currentNpc = room.players[npc.id]; // Get the most up-to-date state
            if (!currentNpc || currentNpc.isDowned || currentNpc.currentAp <= 0) {
                // Turn done - show summary if any actions taken
                if (actionsLog.length > 0) {
                    room.chatLog.push({ 
                        type: 'npc-action', 
                        playerName: currentNpc.name,
                        text: `${currentNpc.name}'s turn: ${actionsLog.join(', ')}`, 
                        timestamp: Date.now() 
                    });
                }
                this.beginEndOfTurnPhase(room, npc);
                return;
            }
    
            const monsters = room.gameState.board.monsters.filter(m => m.currentHp > 0);
            const needsHealing = currentNpc.stats.currentHp < currentNpc.stats.maxHp / 2;
            const healingPotion = currentNpc.hand.find(c => c.name.includes("Healing Potion"));
            const weapon = currentNpc.equipment.weapon || { name: 'Unarmed Strike', type: 'Weapon', apCost: 1, effect: { dice: '1d4' } };
            
            let actionTaken = false;
            
            // Priority 1: Heal if needed
            if (needsHealing && healingPotion && currentNpc.currentAp >= healingPotion.apCost) {
                this.resolveUseConsumable(room, currentNpc, healingPotion, currentNpc);
                actionsLog.push(`Used ${healingPotion.name}`);
                actionTaken = true;
            } 
            // Priority 2: Attack enemies (use ALL AP on this!)
            else if (monsters.length > 0 && currentNpc.currentAp >= (weapon.apCost || 1)) {
                const target = monsters[Math.floor(Math.random() * monsters.length)];
                this.resolveAttack(room, currentNpc, target, weapon);
                actionsLog.push(`Attacked ${target.name}`);
                actionTaken = true;
            }
            // Priority 3: Guard ONCE as fallback (if at least 2 AP left)
            else if (currentNpc.currentAp >= 2 && !currentNpc.hasGuardedThisTurn) {
                currentNpc.hasGuardedThisTurn = true;
                this.resolveGuard(room, currentNpc);
                actionsLog.push('Guarded');
                actionTaken = true;
            }
            
            if (!actionTaken) {
                // No useful actions possible, end turn
                if (actionsLog.length > 0) {
                    room.chatLog.push({ 
                        type: 'npc-action', 
                        playerName: currentNpc.name,
                        text: `${currentNpc.name}'s turn: ${actionsLog.join(', ')}`, 
                        timestamp: Date.now() 
                    });
                }
                this.beginEndOfTurnPhase(room, npc);
                return;
            }
    
            // IMPROVED: Slower delay (600ms) - gives time for animations to play
            setTimeout(actionLoop, 600); 
        };
        // Start the first action after a brief delay
        setTimeout(actionLoop, 1000);
    }
    
    // NPC targeting helpers
    _selectBestTarget(monsters) {
        if (!monsters || monsters.length === 0) return null;
        // Target lowest HP enemy to finish them off
        return monsters.reduce((best, m) => m.currentHp < best.currentHp ? m : best);
    }
    
    _selectWeakestTarget(monsters) {
        if (!monsters || monsters.length === 0) return null;
        // Same as best target for now
        return this._selectBestTarget(monsters);
    }
    
    // Weapon range checking
    _checkWeaponRange(room, attacker, target, weaponCard) {
        const grid = room.gameState.grid;
        if (!grid) return { valid: true }; // No grid = no range check
        
        const attackerPos = grid.entities[attacker.id];
        const targetPos = grid.entities[target.id];
        
        if (!attackerPos || !targetPos) return { valid: true }; // Can't check if not on grid
        
        // Calculate distance (Manhattan/grid distance)
        const distance = Math.abs(targetPos.x - attackerPos.x) + Math.abs(targetPos.y - attackerPos.y);
        
        // Determine weapon type and range
        const weaponName = (weaponCard.name || '').toLowerCase();
        const weaponType = this._getWeaponType(weaponName, weaponCard);
        
        // Range rules by type
        switch (weaponType) {
            case 'melee':
                if (distance > 1) {
                    return { valid: false, reason: `${weaponCard.name} is a melee weapon. You must be adjacent (1 cell away) to attack!` };
                }
                break;
            case 'reach':
                if (distance > 2) {
                    return { valid: false, reason: `${weaponCard.name} has reach. Maximum range is 2 cells!` };
                }
                break;
            case 'ranged':
                if (distance < 2) {
                    return { valid: false, reason: `${weaponCard.name} is a ranged weapon. Target is too close! Minimum range: 2 cells.` };
                }
                break;
            case 'magic':
                // Magic has no range restrictions
                break;
        }
        
        return { valid: true };
    }
    
    // Dev Tools Methods
    devGainXp(room, player, amount) {
        if (!room || !player) return;
        
        const currentXp = player.stats.xp || 0;
        const newXp = currentXp + amount;
        player.stats.xp = newXp;
        
        // Check for level up
        const requiredXp = this.getRequiredXpForLevel(player.stats.level || 1);
        if (newXp >= requiredXp) {
            this.devLevelUp(room, player);
        }
        
        this.emitGameState(room.id);
    }
    
    devLevelUp(room, player) {
        if (!room || !player) return;
        
        const currentLevel = player.stats.level || 1;
        const newLevel = currentLevel + 1;
        
        player.stats.level = newLevel;
        player.stats.xp = 0; // Reset XP after level up
        
        // Increase max HP
        const hpIncrease = 2;
        player.stats.maxHp = (player.stats.maxHp || 20) + hpIncrease;
        player.stats.currentHp = player.stats.maxHp; // Full heal on level up
        
        // Add to chat log
        room.gameState.chatLog.push({
            type: 'system',
            text: `${player.name} leveled up to level ${newLevel}!`,
            timestamp: Date.now()
        });
        
        this.emitGameState(room.id);
    }
    
    devSetMaxLevel(room, player) {
        if (!room || !player) return;
        
        player.stats.level = 10;
        player.stats.xp = 0;
        player.stats.maxHp = 40; // Max level HP
        player.stats.currentHp = player.stats.maxHp;
        
        room.gameState.chatLog.push({
            type: 'system',
            text: `${player.name} reached maximum level!`,
            timestamp: Date.now()
        });
        
        this.emitGameState(room.id);
    }
    
    devAddGold(room, player, amount) {
        if (!room || !player) return;
        
        player.gold = (player.gold || 0) + amount;
        
        room.gameState.chatLog.push({
            type: 'system',
            text: `${player.name} gained ${amount} gold!`,
            timestamp: Date.now()
        });
        
        this.emitGameState(room.id);
    }
    
    devSpawnMonster(room) {
        if (!room) return;
        
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
        
        room.gameState.board.monsters.push(monster);
        
        room.gameState.chatLog.push({
            type: 'system',
            text: `A ${randomType} appeared!`,
            timestamp: Date.now()
        });
        
        this.emitGameState(room.id);
    }
    
    devHealPlayer(room, player) {
        if (!room || !player) return;
        
        player.stats.currentHp = player.stats.maxHp;
        player.isDowned = false;
        
        room.gameState.chatLog.push({
            type: 'system',
            text: `${player.name} was fully healed!`,
            timestamp: Date.now()
        });
        
        this.emitGameState(room.id);
    }
    
    devTriggerSpecialization(room, player) {
        if (!room || !player) return;
        
        if (player.stats.level >= 3 && !player.specialization) {
            room.gameState.chatLog.push({
                type: 'system',
                text: `${player.name} can now choose a specialization!`,
                timestamp: Date.now()
            });
            
            this.emitGameState(room.id);
        }
    }
    
    devToggleGodMode(room, player) {
        if (!room || !player) return;
        
        player.godMode = !player.godMode;
        
        room.gameState.chatLog.push({
            type: 'system',
            text: `God mode ${player.godMode ? 'enabled' : 'disabled'} for ${player.name}!`,
            timestamp: Date.now()
        });
        
        this.emitGameState(room.id);
    }
    
    getRequiredXpForLevel(level) {
        // Simple XP curve: 100 * level
        return level * 100;
    }
    
    _getWeaponType(weaponName, weaponCard) {
        // Check for ranged keywords
        if (weaponName.includes('bow') || weaponName.includes('crossbow') || 
            weaponName.includes('sling') || weaponCard.effect?.description?.toLowerCase().includes('ranged') ||
            weaponCard.effect?.description?.toLowerCase().includes('ammunition')) {
            return 'ranged';
        }
        
        // Check for reach keywords
        if (weaponName.includes('spear') || weaponName.includes('pike') || 
            weaponName.includes('halberd') || weaponName.includes('glaive') ||
            weaponCard.effect?.description?.toLowerCase().includes('reach')) {
            return 'reach';
        }
        
        // Check if it's a spell
        if (weaponCard.type === 'Spell' || weaponCard.category === 'Spell') {
            return 'magic';
        }
        
        // Default to melee
        return 'melee';
    }
    
    // Grid placement helper
    _findEmptyGridPosition(grid, entityType = 'monster') {
        const gridSize = 5;
        const occupiedPositions = new Set(
            Object.values(grid.entities).map(pos => `${pos.x},${pos.y}`)
        );
        
        // Monsters spawn in front rows (0-2), players in back rows (3-4)
        const rowRange = entityType === 'monster' ? [0, 1, 2] : [3, 4];
        
        // Try to find empty spot in preferred rows
        for (const y of rowRange) {
            for (let x = 0; x < gridSize; x++) {
                const key = `${x},${y}`;
                if (!occupiedPositions.has(key)) {
                    return { x, y, type: entityType };
                }
            }
        }
        
        // Fallback: use any empty spot
        for (let y = 0; y < gridSize; y++) {
            for (let x = 0; x < gridSize; x++) {
                const key = `${x},${y}`;
                if (!occupiedPositions.has(key)) {
                    return { x, y, type: entityType };
                }
            }
        }
        
        return null; // Grid is full!
    }
    
    _inferSpellDamageType(effect) {
        if (effect?.damageType) return String(effect.damageType).toLowerCase();
        const d = (effect?.description || '').toLowerCase();
        if (d.includes('fire') || d.includes('flame') || d.includes('inferno')) return 'fire';
        if (d.includes('cold') || d.includes('frost') || d.includes('ice')) return 'cold';
        if (d.includes('thunder') && !d.includes('lightning')) return 'thunder';
        if (d.includes('lightning') || d.includes('shock')) return 'lightning';
        if (d.includes('acid')) return 'acid';
        if (d.includes('poison') || d.includes('toxic')) return 'poison';
        if (d.includes('necrotic')) return 'necrotic';
        if (d.includes('radiant')) return 'radiant';
        if (d.includes('force')) return 'force';
        return '';
    }

    _applyPlayerArmorDamageReduction(target, dmg, meta) {
        const t = meta.damageType || '';
        const an = target.equipment?.armor?.name || '';
        if (t === 'fire' && an === 'Wyrmscale Mail' && target.wyrmscaleImmunityType === 'fire' && dmg > 0) {
            return { dmg: 0, note: 'Wyrmscale Mail — immunity to Fire.' };
        }
        if (t === 'necrotic' && an === "Spiritweave Robes" && dmg > 0) {
            return { dmg: Math.floor(dmg * 0.5), note: "Spiritweave Robes — resist Necrotic (-50%)." };
        }
        if (t === 'piercing' && an === 'Toughened Hides' && dmg > 0) {
            return { dmg: Math.floor(dmg * 0.5), note: 'Toughened Hides — resist Piercing (-50%).' };
        }
        if (t === 'bludgeoning' && an === 'Earth-Forged Mail' && dmg > 0) {
            return { dmg: Math.floor(dmg * 0.5), note: 'Earth-Forged Mail — resist Bludgeoning (-50%).' };
        }
        return { dmg, note: '' };
    }

    _bastionCoverBonus(room, defender, monsterId) {
        const grid = room.gameState.grid;
        if (!grid?.entities || !monsterId) return 0;
        const mp = grid.entities[monsterId];
        const dp = grid.entities[defender.id];
        if (!mp || !dp) return 0;
        const dist = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
        const explorers = Object.values(room.players).filter((p) => p.role === 'Explorer' && !p.isNpc && p.id !== defender.id && p.equipment?.armor?.name === 'Bastion Shield');
        for (const ally of explorers) {
            const ap = grid.entities[ally.id];
            if (!ap) continue;
            if (dist(ap, mp) <= 1 && dist(ap, dp) <= 1) return 1;
        }
        return 0;
    }

    _lichRandomSpellOnHit(room, lich, targetPlayer) {
        const pool = gameData.spellCards.filter(
            (s) => s.level === 1 && s.effect?.type === 'damage' && s.effect?.target === 'any-monster'
        );
        if (pool.length === 0) return;
        const card = pool[Math.floor(nextDailyRandom(room, 'lich-spell') * pool.length)];
        const eff = card.effect;
        const rolled = this.rollDiceWithDetails(eff.dice);
        const spellPow = lich.stats?.int || 0;
        const total = rolled.total + spellPow;
        const dtype = this._inferSpellDamageType(eff);
        room.chatLog.push({
            type: 'combat',
            text: `${lich.name} channels ${card.name}! (${dtype || 'arcane'} surge)`,
            timestamp: Date.now()
        });
        this._applyDamage(room, targetPlayer, total, { id: lich.id, name: lich.name }, { damageType: dtype });
        if (eff.status && targetPlayer.class) {
            this._applyStatusEffect(room, targetPlayer, eff.status, eff.duration || 2);
        }
    }

    // --- 3.7. Action Resolution ---
    _applyDamage(room, target, damage, sourceAttacker, meta = {}) {
        let logParts = [];
        let wasDefeated = false;
        const isPlayer = !!target.class;
        const isCompanion = target && target.type === 'Companion';
        const fromMonsterHit = !!(sourceAttacker?.id && room.gameState.board.monsters?.some((m) => m.id === sourceAttacker.id));

        if (isPlayer) {
            let dmg = damage;
            if (target.equipment?.armor?.name === 'Indomitable Plating' && dmg > 0) {
                dmg = Math.max(0, dmg - 1);
                logParts.push(`Indomitable Plating ignores 1 damage.`);
            }
            const phys = new Set(['piercing', 'slashing', 'bludgeoning']);
            const isNonMagicalHit = fromMonsterHit && (!meta.damageType || phys.has(meta.damageType));
            if (isNonMagicalHit && target.equipment?.armor?.name === 'Crystal Hide' && dmg > 0) {
                dmg = Math.floor(dmg * 0.85);
                logParts.push(`Crystal Hide softens non-magical blows (-15%).`);
            }
            if (fromMonsterHit && target.equipment?.armor?.name === 'Phase Shroud' && dmg > 0 && !target._phaseShroudUsedThisTurn) {
                const r = this.rollDie('d20');
                if (r >= 11) {
                    target._phaseShroudUsedThisTurn = true;
                    dmg = 0;
                    logParts.push(`Phase Shroud phases the strike away!`);
                }
            }
            if (fromMonsterHit && target.wayfinderDeflectReady && target.currentAp >= 1 && dmg > 0) {
                target.currentAp -= 1;
                target.wayfinderDeflectReady = false;
                const reduced = Math.max(0, dmg - 2);
                room.chatLog.push({
                    type: 'system-good',
                    text: `${target.name} Deflects with Wayfinder's Staff (-2 damage, 1 AP).`,
                    timestamp: Date.now()
                });
                dmg = reduced;
            }
            const magTypes = new Set(['fire', 'cold', 'lightning', 'thunder', 'acid', 'poison', 'necrotic', 'radiant', 'force']);
            if (isPlayer && magTypes.has(meta.damageType) && target.equipment?.armor?.name === "Arcanist's Weave" && dmg > 0) {
                dmg = Math.max(0, dmg - 1);
                logParts.push(`Arcanist's Weave dulls magical harm (-1).`);
            }
            const armRed = this._applyPlayerArmorDamageReduction(target, dmg, meta);
            if (armRed.note) logParts.push(armRed.note);
            dmg = armRed.dmg;

            const damageAfterShield = dmg - (target.stats.shieldHp || 0);
            if (damageAfterShield <= 0) {
                target.stats.shieldHp -= damage;
                logParts.push(`attack was absorbed by ${target.name}'s shield!`);
            } else {
                if (target.stats.shieldHp > 0) logParts.push(`${target.name}'s shield shatters!`);
                target.stats.shieldHp = 0;
                target.stats.currentHp -= damageAfterShield;
            }
    
            if (target.stats.currentHp <= 0) {
                target.stats.currentHp = 0;
                target.isDowned = true;
                wasDefeated = true;
                logParts.push(`${target.name} is Downed!`);
                this._modifyPartyHope(room, -2);
            }
            if (fromMonsterHit && meta.isCrit && target.equipment?.armor?.name === 'Thornmail') {
                const mon = room.gameState.board.monsters.find((m) => m.id === sourceAttacker.id);
                if (mon && mon.currentHp > 0) {
                    mon.currentHp = Math.max(0, mon.currentHp - 1);
                    room.chatLog.push({
                        type: 'combat',
                        text: `${target.name}'s Thornmail spines sting ${mon.name} for 1!`,
                        timestamp: Date.now()
                    });
                }
            }
        } else if (isCompanion) {
            target.currentHp -= damage;
            if (target.currentHp <= 0) {
                target.currentHp = 0;
                wasDefeated = true;
                logParts.push(`${target.name || 'Companion'} falls!`);
                const owner = room.players[target.ownerId];
                if (owner) {
                    const grid = room.gameState.grid;
                    if (grid?.entities[target.id]) delete grid.entities[target.id];
                    owner.companion = null;
                }
            }
        } else { // Target is a monster
            target.currentHp -= damage;
            if (target.currentHp <= 0) {
                target.currentHp = 0;
                wasDefeated = true;
                logParts.push(`${target.name} is defeated!`);
                
                const attacker = room.players[sourceAttacker.id];
                room.gameState.lastAttackerId = attacker?.id || room.gameState.lastAttackerId;
                if (attacker && attacker.class) {
                    this._grantXpForKill(room, attacker, target);
                }
                room.gameState.board.monsters = room.gameState.board.monsters.filter(m => m.id !== target.id);
                this.checkForLootDrop(room, target);
            }
        }
        
        return { wasDefeated, logParts };
    }

    /**
     * Weapon card "Special" lines in game-data: apply a small subset as real combat math.
     * (Descriptions remain on the card; this makes key bonuses visible in the log.)
     */
    _applyMonsterHitSpecials(room, monster, target, weaponCard) {
        const desc = (weaponCard?.effect?.description || '').toLowerCase();
        if (!desc || !target.class) return;
        if (desc.includes('poisoned')) {
            const con = target.stats?.con || 0;
            const roll = this.rollDie('d20');
            const total = roll + con;
            const dc = 11;
            if (total < dc) {
                this._applyStatusEffect(room, target, 'Poisoned', 3);
                room.chatLog.push({
                    type: 'combat',
                    text: `${monster.name}'s venom sickens ${target.name}! (${roll}+${con} vs DC ${dc}) Poisoned.`,
                    timestamp: Date.now()
                });
            } else {
                room.chatLog.push({
                    type: 'combat',
                    text: `${target.name} shrugs off ${monster.name}'s poison (${roll}+${con} vs DC ${dc}).`,
                    timestamp: Date.now()
                });
            }
        }
        if (desc.includes('engulfed')) {
            this._applyStatusEffect(room, target, 'Engulfed', 2);
            room.chatLog.push({
                type: 'combat',
                text: `${monster.name} engulfs ${target.name}! ${target.name} is Engulfed — escape on STR save at turn start.`,
                timestamp: Date.now()
            });
        }
    }

    _applyWeaponDamageModifiers(room, attacker, weapon, target, diceString, staticBonus) {
        let dice = diceString;
        let bonus = staticBonus;
        const wname = (weapon.name || '').toLowerCase();
        const tgtShield = (target.stats?.shieldBonus || 0) > 0;
        const monsterArmorShield = !target.class && (target.stats?.shieldBonus || 0) > 0;

        if (wname.includes('balanced steel') && tgtShield) {
            bonus += 2;
            room.chatLog.push({ type: 'system-good', rollerName: attacker.name, text: `${weapon.name} — Guard Breaker: +2 damage vs shielded foe.`, timestamp: Date.now() });
        }
        if (wname.includes('bone thumper') && (tgtShield || monsterArmorShield)) {
            bonus += 1;
            room.chatLog.push({ type: 'system-good', rollerName: attacker.name, text: `${weapon.name} — Solid Strike: +1 vs armored foe.`, timestamp: Date.now() });
        }
        if (wname.includes('impact cleaver')) {
            const versatile = (weapon.effect?.description || '').toLowerCase().includes('versatile');
            if (versatile) {
                attacker.movementPoints = (attacker.movementPoints || 0) + 1;
                room.chatLog.push({ type: 'system-good', rollerName: attacker.name, text: `${weapon.name} — Momentum Swing: +1 movement this turn.`, timestamp: Date.now() });
            }
        }
        if (wname.includes('swiftflight bow')) {
            const grid = room.gameState.grid;
            const ap = grid?.entities?.[attacker.id];
            const tp = grid?.entities?.[target.id];
            if (ap && tp) {
                const dist = Math.abs(ap.x - tp.x) + Math.abs(ap.y - tp.y);
                if (dist <= 1) {
                    const pen = this.rollDiceWithDetails('1d4').total;
                    bonus -= pen;
                    room.chatLog.push({ type: 'system-good', rollerName: attacker.name, text: `${weapon.name} — Close-range penalty: -${pen} damage.`, timestamp: Date.now() });
                }
            }
        }
        if (wname.includes("duelist's point") && attacker.class && !attacker.isNpc && !attacker._duelistOpeningUsed) {
            const ex = this.rollDiceWithDetails('1d4').total;
            bonus += ex;
            attacker._duelistOpeningUsed = true;
            room.chatLog.push({ type: 'system-good', rollerName: attacker.name, text: `${weapon.name} — Opening Flourish: +${ex} damage (first hit this turn).`, timestamp: Date.now() });
        }
        if (wname.includes('axechuck') && attacker.class && !attacker.isNpc) {
            const handCount = (attacker.hand || []).length;
            if (handCount < 5) {
                const tpl = gameData.weaponCards.find((c) => c.name === 'Axechuck');
                const copy = {
                    ...(tpl || { name: 'Axechuck', type: 'Weapon', apCost: 1, effect: { dice: '1d6' } }),
                    id: `axechuck_return_${Date.now()}`,
                    name: 'Axechuck'
                };
                this._giveCardToPlayer(room, attacker, copy);
                room.chatLog.push({ type: 'system-good', rollerName: attacker.name, text: `${weapon.name} — Returning Edge: caught in hand!`, timestamp: Date.now() });
            }
        }
        return { dice, staticBonus: bonus };
    }

    resolvePlayerAction(socket, payload) {
        try {
            const room = this.findRoomBySocket(socket);
            const player = room?.players[socket.id];
            if (!room || !player) return;
            
            // Allow level up choices even if it's not the player's turn or game is paused
            if (payload.action === 'resolveLevelUpChoice') {
                 this.resolveLevelUpChoice(socket, { player, room, payload });
                 return;
            }

            if (payload.action === 'selectSpecialization' && payload.branch != null && payload.tier != null) {
                this.resolveSpecializationChoice(room, player, payload.branch, payload.tier);
                return;
            }

            // Pending dungeon encounter (NPC trade/rescue/etc.) must work even if turn order advanced
            if (payload.action === 'resolveEvent') {
                if (!player.pendingDungeonEvent) {
                    return socket.emit('actionError', 'No active encounter to resolve.');
                }
                this.resolveEventChoice(room, player, payload.eventId, payload.choiceIndex);
                return;
            }

            // Shopping can happen while paused / not "your combat turn" for every explorer
            if (payload.action === 'buyItem' && room.gameState.shop) {
                this.resolveBuy(room, player, payload.cardId, payload.price, payload.shopId);
                return;
            }

            // CRITICAL FIX: Check if it's the player's turn before allowing actions
            const currentTurnPlayerId = room.gameState.turnOrder[room.gameState.currentPlayerIndex];
            if (player.id !== currentTurnPlayerId) {
                console.log(`[Action] ${player.name} tried to act out of turn (current: ${currentTurnPlayerId})`);
                return socket.emit('actionError', 'It\'s not your turn yet!');
            }

            if (player.pendingAction && payload.action !== 'resolveAttackRoll' && payload.action !== 'resolveDiceSequenceRoll') {
                return socket.emit('actionError', 'You must resolve your current action first.');
            }

            switch (payload.action) {
                case 'attack':
                    // CRITICAL FIX: Accept both cardId and weaponId for compatibility
                    const weaponCardId = payload.weaponId || payload.cardId;
                    
                    // Find weapon in equipment OR hand
                    let weaponCard = null;
                    if (player.equipment) {
                        weaponCard = Object.values(player.equipment).find(c => c && c.id === weaponCardId);
                    }
                    if (!weaponCard && player.hand) {
                        weaponCard = player.hand.find(c => c.id === weaponCardId);
                    }
                    if (!weaponCard && weaponCardId === 'unarmed') {
                        weaponCard = { id: 'unarmed', name: 'Unarmed Strike', type: 'Weapon', apCost: 1, effect: { dice: '1d4' } };
                    }
                    
                    const target = room.gameState.board.monsters.find(m => m.id === payload.targetId);
                    
                    console.log('[Server Attack] Received attack request');
                    console.log('[Server Attack] weaponCardId:', weaponCardId);
                    console.log('[Server Attack] weaponCard:', weaponCard ? weaponCard.name : 'NOT FOUND');
                    console.log('[Server Attack] target:', target ? target.name : 'NOT FOUND');
                    console.log('[Server Attack] player equipment:', player.equipment);
                    
                    if (weaponCard && target) {
                        // Check weapon range if enforcement is enabled
                        if (room.settings.enforceWeaponRanges) {
                            const rangeCheck = this._checkWeaponRange(room, player, target, weaponCard);
                            if (!rangeCheck.valid) {
                                console.log(`[Server Attack] ❌ Weapon range check failed: ${rangeCheck.reason}`);
                                const playerSocket = io.sockets.sockets.get(player.id);
                                if (playerSocket) {
                                    playerSocket.emit('actionError', rangeCheck.reason);
                                }
                                return;
                            }
                        }
                        
                        console.log('[Server Attack] ✅ Calling resolveAttack');
                        this.resolveAttack(room, player, target, weaponCard, payload.narrative);
                    } else {
                        console.error('[Server Attack] ❌ Missing weapon or target!');
                        const playerSocket = io.sockets.sockets.get(player.id);
                        if (playerSocket) {
                            playerSocket.emit('actionError', `Attack failed: ${!weaponCard ? 'No weapon found' : 'No target found'}`);
                        }
                    }
                    break;
                case 'summonCompanion':
                    this.resolveSummonCompanion(room, player, payload.companionType);
                    break;
                case 'companionAttack':
                    // Check weapon range for companion attacks if enforcement is enabled
                    if (room.settings.enforceWeaponRanges && player.companion) {
                        const target = room.gameState.board.monsters.find(m => m.id === payload.targetId);
                        if (target) {
                            const companionWeapon = { name: 'Companion Attack', type: 'Weapon' }; // Default companion weapon
                            const rangeCheck = this._checkWeaponRange(room, player.companion, target, companionWeapon);
                            if (!rangeCheck.valid) {
                                console.log(`[Companion Attack] ❌ Weapon range check failed: ${rangeCheck.reason}`);
                                const playerSocket = io.sockets.sockets.get(player.id);
                                if (playerSocket) {
                                    playerSocket.emit('actionError', rangeCheck.reason);
                                }
                                return;
                            }
                        }
                    }
                    this.resolveCompanionAttack(room, player, payload.targetId);
                    break;
                case 'resolveAttackRoll':
                    this.resolveAttackRoll(room, player, payload.weaponId, payload.targetId);
                    break;
                case 'resolveDiceSequenceRoll':
                    this.resolveDiceSequenceRoll(room, player);
                    break;
                case 'resolveStatusSaveRoll':
                    this.resolveStatusSaveRoll(room, player, payload);
                    break;
                case 'useConsumable':
                     const consumable = player.hand.find(c => c.id === payload.cardId);
                     const consumeTarget = room.players[payload.targetId] || room.gameState.board.monsters.find(m => m.id === payload.targetId);
                     if(consumable && consumeTarget) this.resolveUseConsumable(room, player, consumable, consumeTarget);
                     break;
                case 'castSpell':
                     const spell = player.hand.find(c => c.id === payload.cardId);
                     const spellTarget = room.players[payload.targetId] || room.gameState.board.monsters.find(m => m.id === payload.targetId);
                     if(spell) this.resolveCastSpell(room, player, spell, spellTarget);
                     break;
                case 'guard': this.resolveGuard(room, player); break;
                case 'respite': this.resolveRespite(room, player); break;
                case 'rest': this.resolveRest(room, player); break;
                case 'dash': this.resolveDash(room, player); break;
                case 'dodge': this.resolveDodge(room, player); break;
                case 'help': this.resolveHelp(room, player, payload.targetPlayerId); break;
                case 'search': this.resolveSearch(room, player); break;
                case 'takeCover': this.resolveTakeCover(room, player); break;
                case 'advance': this.resolveAdvance(room, player); break;
                case 'retreat': this.resolveRetreat(room, player); break;
                case 'intimidate': this.resolveIntimidate(room, player, payload.targetId); break;
                case 'persuade': this.resolvePersuade(room, player, payload.targetId); break;
                case 'move': this.resolveMove(room, player, payload.targetX, payload.targetY, payload.movementCost); break;
                case 'setWyrmscaleImmunity': {
                    const curId = room.gameState.turnOrder[room.gameState.currentPlayerIndex];
                    if (player.id !== curId) {
                        const sock = io.sockets.sockets.get(player.id);
                        if (sock) sock.emit('actionError', 'You can only change Wyrmscale immunity on your turn.');
                        break;
                    }
                    if (player.equipment?.armor?.name === 'Wyrmscale Mail' && typeof payload.element === 'string') {
                        const allowed = new Set(['fire', 'cold', 'lightning', 'acid', 'thunder']);
                        const el = String(payload.element).toLowerCase();
                        if (allowed.has(el)) {
                            player.wyrmscaleImmunityType = el;
                            room.chatLog.push({
                                type: 'system-good',
                                playerName: player.name,
                                text: `${player.name}'s Wyrmscale Mail now wards against ${el} damage.`,
                                timestamp: Date.now()
                            });
                            this.emitGameState(room.id);
                        }
                    }
                    break;
                }
                case 'selectSpecialization':
                    break;
                case 'useAbility':
                    const classData = gameData.classes[player.class];
                    if (classData && classData.ability.name === payload.abilityName) this.resolveUseAbility(room, player, classData.ability);
                    break;
                case 'claimLoot':
                     const lootItem = room.gameState.lootPool.find(c => c.id === payload.itemId);
                     const targetPlayer = room.players[payload.targetPlayerId];
                     if (lootItem && targetPlayer) this.resolveClaimLoot(room, player, lootItem, targetPlayer);
                     break;
                case 'discardCard':
                    this.discardCard(socket, { cardId: payload.cardId });
                    break;
                case 'buyItem':
                    this.resolveBuy(room, player, payload.cardId, payload.price, payload.shopId);
                    break;
                case 'chooseNewCardDiscard':
                    this.resolveChooseNewCardDiscard(room, player, payload.newCard, payload.cardToDiscardId);
                    break;
                case 'resolveDiscovery':
                    this.resolveDiscoveryChoice(room, player, payload.keptItemId);
                    break;
                case 'resolveDiscoveryRoll':
                    this.resolveDiscoveryRoll(room, player);
                    break;
                case 'resolveSkillCheck':
                    this.resolveSkillCheck(room, player);
                    break;
                case 'resolveSkillCheckRoll':
                    this.resolveSkillCheckRoll(room, player, payload);
                    break;
                case 'resolveSkillInteraction':
                    this.resolveSkillInteraction(room, player, payload.cardId, payload.interactionName);
                    break;
                // Dev tools actions
                case 'devGainXp':
                    this.devGainXp(room, player, payload.amount);
                    break;
                case 'devLevelUp':
                    this.devLevelUp(room, player);
                    break;
                case 'devTriggerSpecialization':
                    this.devTriggerSpecialization(room, player);
                    break;
                case 'devAddGold':
                    this.devAddGold(room, player, payload.amount);
                    break;
                case 'devSpawnMonster':
                    this.devSpawnMonster(room);
                    break;
                case 'devHealPlayer':
                    this.devHealPlayer(room, player);
                    break;
                case 'devSetMaxLevel':
                    this.devSetMaxLevel(room, player);
                    break;
                case 'devToggleGodMode':
                    this.devToggleGodMode(room, player);
                    break;
            }
        } catch (error) {
            console.error(`[ACTION FAILED] Error in resolvePlayerAction for ${socket.id}:`, error);
            
            // CRITICAL FIX: Clear pending actions on error to prevent stuck states
            if (player && player.pendingAction) {
                console.log(`[ACTION FAILED] Clearing pending action for ${player.name}:`, player.pendingAction.actionType);
                player.pendingAction = null;
            }
            
            socket.emit('actionError', 'An unexpected server error occurred.');
            socket.emit('diceRollError'); // Also clear any pending dice rolls on the client
            
            // Emit updated game state to clear any UI inconsistencies
            this.emitGameState(room.id);
        }
    }
    
    resolveAttack(room, attacker, target, weaponCard, narrative = null) {
        const isHumanPlayer = !!attacker.class && !attacker.isNpc;
        const apCost = weaponCard.apCost || 1;
    
        // Universal checks
        if (!target) return; // Can't attack nothing
        if (attacker.class && attacker.currentAp < apCost) {
            // CRITICAL FIX: Send specific AP error for attacks
            const playerSocket = io.sockets.sockets.get(attacker.id);
            if (playerSocket) {
                if (attacker.currentAp === 0) {
                    playerSocket.emit('actionError', 'NO_AP_END_TURN');
                } else {
                    playerSocket.emit('actionError', `Not enough AP to attack. Need ${apCost} AP, have ${attacker.currentAp}.`);
                }
            }
            return;
        }
    
        // Universal AP deduction for players/NPCs
        if (attacker.class) {
            attacker.currentAp -= apCost;
        }
    
        // Check for Restrained status effect
        const restrainedPenalty = (attacker.statusEffects && attacker.statusEffects.some(e => e.name === 'Restrained')) ? -2 : 0;
    
        if (isHumanPlayer) {
            if (narrative) {
                room.chatLog.push({ type: 'narrative', playerName: attacker.name, playerId: attacker.id, text: escapeHtml(narrative), timestamp: Date.now() });
            }
            
            io.to(room.id).emit('promptAttackRoll', {
                rollerId: attacker.id,
                rollerName: attacker.name,
                title: `Attack Roll: ${attacker.name} vs ${target.name}`,
                description: `Using ${weaponCard.name}${restrainedPenalty < 0 ? ' (Restrained: -2)' : ''}.`,
                dice: 'd20',
                bonus: attacker.stats.hitBonus + restrainedPenalty,
                targetAC: target.requiredRollToHit,
                weaponId: weaponCard.id,
                targetId: target.id
            });
        } else {
             // Monster or NPC explorer attack is handled instantly
            this._resolveNpcOrMonsterAttack(room, attacker, target, weaponCard);
        }
    }

    _resolveNpcOrMonsterAttack(room, attacker, target, weaponCard) {
        const isPlayerTarget = !!target.class;
    
        const attackBonus = attacker.attackBonus ?? attacker.stats.hitBonus;
        let targetAC = isPlayerTarget ? (target.stats.shieldBonus + 10) : target.requiredRollToHit;
        if (isPlayerTarget) targetAC += this._bastionCoverBonus(room, target, attacker.id);
    
        io.to(room.id).emit('promptAttackRoll', {
            rollerId: 'npc-dm', // The DM is the one rolling for the monster/npc
            rollerName: attacker.name,
            title: `Attack Roll: ${attacker.name} vs ${target.name}`,
            description: `Using ${weaponCard.name}.`,
            dice: 'd20',
            bonus: attackBonus,
            targetAC: targetAC,
        });
    
        setTimeout(() => {
            const roll = this.rollDie('d20');
            const total = roll + attackBonus;
            const outcome = total >= targetAC ? "Hit" : "Miss";
    
            room.chatLog.push({ type: 'combat', rollerName: attacker.name, rollerId: 'npc-dm', text: `${attacker.name} attacks ${target.name} with ${weaponCard.name}... It's a ${outcome}! (Rolled ${roll} + ${attackBonus} vs AC ${targetAC})`, timestamp: Date.now() });
    
            const attackResolvedPayload = {
                rollerId: 'npc-dm',
                rollerName: attacker.name,
                roll, bonus: attackBonus, total, targetAC, outcome 
            };
            io.to(room.id).emit('attackResolved', attackResolvedPayload);
            
            if (outcome === "Hit") {
                setTimeout(() => {
                    // Correctly calculate damage for either monster (bonus in dice string) or NPC (stat bonus)
                    const damageDetails = this.rollDiceWithDetails(weaponCard.effect.dice);
                    const attackerDamageBonus = !attacker.attackBonus ? (attacker.stats?.damageBonus || 0) : 0;
                    const totalDamage = damageDetails.total + attackerDamageBonus;
                    const mdType = weaponCard.effect?.damageType || 'slashing';

                    const { wasDefeated, logParts } = this._applyDamage(room, target, totalDamage, { id: attacker.id, name: attacker.name }, { isCrit: roll === 20, damageType: mdType });
                    let logText = `${attacker.name} deals ${totalDamage} damage to ${target.name}! ${logParts.join(' ')}`;
                    room.chatLog.push({ type: 'combat-hit', rollerName: attacker.name, text: logText, timestamp: Date.now() });
                    if (isPlayerTarget) {
                        this._applyMonsterHitSpecials(room, attacker, target, weaponCard);
                        if (attacker.name === 'Lich Apprentice') {
                            this._lichRandomSpellOnHit(room, attacker, target);
                        }
                    }
                    
                    const damageResolvedPayload = {
                        rollerId: 'npc-dm',
                        rollerName: attacker.name,
                        rolls: damageDetails.rolls,
                        damageRoll: damageDetails.rollSum,
                        damageBonus: damageDetails.bonus + attackerDamageBonus,
                        totalDamage,
                        wasDefeated
                    };
                    io.to(room.id).emit('damageResolved', damageResolvedPayload);
                    this.emitGameState(room.id);
                }, 1500);
            } else {
                this.emitGameState(room.id);
            }
        }, 1500); // Slower delay for DM rolls
    }
    
    resolveAttackAndWait(room, attacker, target, weaponCard, onComplete) {
        console.log(`[ResolveAttackAndWait] ${attacker.name} attacking ${target.name}`);
        const isPlayerTarget = !!target.class;
        const attackBonus = attacker.attackBonus ?? attacker.stats.hitBonus;
        let targetAC = isPlayerTarget ? (target.stats.shieldBonus + 10) : target.requiredRollToHit;
        if (isPlayerTarget) targetAC += this._bastionCoverBonus(room, target, attacker.id);
    
        io.to(room.id).emit('promptAttackRoll', {
            rollerId: 'npc-dm',
            rollerName: attacker.name,
            title: `Attack Roll: ${attacker.name} vs ${target.name}`,
            description: `Using ${weaponCard.name}.`,
            dice: 'd20',
            bonus: attackBonus,
            targetAC: targetAC,
        });
    
        setTimeout(() => {
            const roll = this.rollDie('d20');
            const total = roll + attackBonus;
            const outcome = total >= targetAC ? "Hit" : "Miss";
    
            room.chatLog.push({ type: 'combat', rollerName: attacker.name, rollerId: 'npc-dm', text: `${attacker.name} attacks ${target.name} with ${weaponCard.name}... It's a ${outcome}! (Rolled ${roll} + ${attackBonus} vs AC ${targetAC})`, timestamp: Date.now() });
    
            const attackResolvedPayload = {
                rollerId: 'npc-dm',
                rollerName: attacker.name,
                roll, bonus: attackBonus, total, targetAC, outcome 
            };
            io.to(room.id).emit('attackResolved', attackResolvedPayload);
            
            if (outcome === "Hit") {
                setTimeout(() => {
                    // Correctly calculate damage for either monster (bonus in dice string) or NPC (stat bonus)
                    const damageDetails = this.rollDiceWithDetails(weaponCard.effect.dice);
                    const attackerDamageBonus = !attacker.attackBonus ? (attacker.stats?.damageBonus || 0) : 0;
                    const totalDamage = damageDetails.total + attackerDamageBonus;
                    const mdType = weaponCard.effect?.damageType || 'slashing';

                    const { wasDefeated, logParts } = this._applyDamage(room, target, totalDamage, { id: attacker.id, name: attacker.name }, { isCrit: roll === 20, damageType: mdType });
                    let logText = `${attacker.name} deals ${totalDamage} damage to ${target.name}! ${logParts.join(' ')}`;
                    room.chatLog.push({ type: 'combat-hit', rollerName: attacker.name, text: logText, timestamp: Date.now() });
                    if (isPlayerTarget) {
                        this._applyMonsterHitSpecials(room, attacker, target, weaponCard);
                        if (attacker.name === 'Lich Apprentice') {
                            this._lichRandomSpellOnHit(room, attacker, target);
                        }
                    }
                    
                    const damageResolvedPayload = {
                        rollerId: 'npc-dm',
                        rollerName: attacker.name,
                        rolls: damageDetails.rolls,
                        damageRoll: damageDetails.rollSum,
                        damageBonus: damageDetails.bonus + attackerDamageBonus,
                        totalDamage,
                        wasDefeated
                    };
                    io.to(room.id).emit('damageResolved', damageResolvedPayload);
                    this.emitGameState(room.id);
                    
                    // CRITICAL FIX: Call completion callback after damage is resolved
                    console.log(`[ResolveAttackAndWait] ${attacker.name} attack completed (hit)`);
                    if (onComplete) onComplete();
                }, 1500);
            } else {
                this.emitGameState(room.id);
                // CRITICAL FIX: Call completion callback even on miss
                console.log(`[ResolveAttackAndWait] ${attacker.name} attack completed (miss)`);
                if (onComplete) onComplete();
            }
        }, 1500); // Slower delay for DM rolls
    }

    _consumeAndApplyAttackBuffs(player, logParts) {
        const consumedBonuses = { hitBonus: 0, damageBonus: 0, extraDamageDice: '' };
        const effectsToRemove = [];
    
        player.statusEffects.forEach(effect => {
            if (effect.consumesOn === 'attack') {
                if(effect.bonuses) {
                    consumedBonuses.hitBonus += effect.bonuses.hitBonus || 0;
                    consumedBonuses.damageBonus += effect.bonuses.damageBonus || 0;
                }
                if(effect.extraDamageDice) {
                    if (consumedBonuses.extraDamageDice) {
                        consumedBonuses.extraDamageDice += `+${effect.extraDamageDice}`;
                    } else {
                        consumedBonuses.extraDamageDice = effect.extraDamageDice;
                    }
                }
                logParts.push(`empowered by ${effect.name}`);
                effectsToRemove.push(effect.name);
            }
        });
    
        if (effectsToRemove.length > 0) {
            player.statusEffects = player.statusEffects.filter(e => !effectsToRemove.includes(e.name));
        }
        
        return consumedBonuses;
    }

    resolveAttackRoll(room, player, weaponId, targetId) {
        try {
            const attacker = player;
            const target = room.gameState.board.monsters.find(m => m.id === targetId);
            const weapon = Object.values(attacker.equipment).find(c => c && c.id === weaponId) || (weaponId === 'unarmed' ? { id: 'unarmed', name: 'Unarmed Strike', apCost: 1, effect: { dice: '1d4' } } : null);
            if (!attacker || !target || !weapon) return io.to(room.id).emit('diceRollError');
    
            const logParts = [];
            const consumedBonuses = this._consumeAndApplyAttackBuffs(attacker, logParts);
            const wnameLower = (weapon.name || '').toLowerCase();
            if (wnameLower.includes('quick blade')) {
                attacker._quickBladeAttacks = (attacker._quickBladeAttacks || 0) + 1;
            }
    
            // Advantage/disadvantage
            const rollA = this.rollDie('d20');
            const rollB = this.rollDie('d20');
            let roll = rollA;
            // Advantage if flanking or high ground
            let hasAdv = (attacker.stats.flankingBonus > 0) || (attacker.positioning?.elevation || 0) > 0;
            if (wnameLower.includes('shadowtooth') && target.statusEffects?.some((e) => e.name === 'Poisoned')) {
                hasAdv = true;
            }
            // Disadvantage if target has cover
            const hasDis = (target.positioning?.cover || 0) >= 2;
            if (hasAdv && !hasDis) roll = Math.max(rollA, rollB);
            if (hasDis && !hasAdv) roll = Math.min(rollA, rollB);
            // CRITICAL FIX: Include flanking bonus in attack roll calculation
            const flankingBonus = attacker.stats.flankingBonus || 0;
            let bonus = attacker.stats.hitBonus + consumedBonuses.hitBonus + flankingBonus - (target.positioning?.cover || 0);
            if (attacker.equipment?.armor?.name === 'Fury Cuirass' && attacker.stats.currentHp * 2 <= attacker.stats.maxHp) {
                bonus += 1;
            }
            // Elemental statuses for combos
            if (target.statusEffects?.some(e => e.name === 'Oiled') && weapon.name?.toLowerCase().includes('flame')) {
                this._triggerSynergy(room, attacker, 'elementCombustion', { damageBonus: 4 });
                bonus += 1;
            }
            if (target.statusEffects?.some(e => e.name === 'Wet')) {
                const wname = (weapon.name || '').toLowerCase();
                const looksLightning = wname.includes('lightning') || wname.includes('shock') || wname.includes('thunder');
                if (looksLightning) {
                    this._triggerSynergy(room, attacker, 'electrocute', { damageBonus: 3 });
                }
            }
            let targetAC = target.requiredRollToHit;
            targetAC += this._bastionCoverBonus(room, attacker, target.id);
            if (wnameLower.includes('farstrike bow') && !attacker._farstrikePiercingUsed) {
                targetAC = Math.max(1, targetAC - 1);
                attacker._farstrikePiercingUsed = true;
                room.chatLog.push({
                    type: 'action',
                    rollerName: attacker.name,
                    text: `${weapon.name} — Piercing Shot: treat AC as ${targetAC} for this hit (1/turn).`,
                    timestamp: Date.now()
                });
            }
            const total = roll + bonus;
            // Meta-perk: Critical Expert gives 5% extra crit chance (crit on 19-20)
            const perkMults = this._getMetaPerkMultipliers(attacker);
            const critThreshold = perkMults.critChanceBonus > 0 ? 19 : 20;
            const isCriticalHit = roll >= critThreshold;
            const outcome = (total >= targetAC || isCriticalHit) ? "Hit" : "Miss";
    
            let outcomeText = logParts.length > 0 ? `, ${logParts.join(', ')}` : '';
            room.chatLog.push({ type: 'combat', rollerName: attacker.name, rollerId: attacker.id, text: `${attacker.name} attacks ${target.name} with ${weapon.name}${outcomeText}... It's a ${outcome}! (Rolled ${roll} + ${bonus} vs AC ${targetAC})`, timestamp: Date.now() });
    
            io.to(room.id).emit('attackResolved', { rollerId: attacker.id, rollerName: attacker.name, roll, bonus, total, targetAC, outcome });
    
        if (outcome === 'Hit') {
            room.gameState.lastAttackerId = attacker.id;
                if (isCriticalHit && weapon.name === 'Doomcleaver') {
                    const apCost = weapon.apCost || 2;
                    attacker.currentAp = Math.min(attacker.stats.maxAP, attacker.currentAp + apCost);
                    room.chatLog.push({ type: 'system-good', rollerName: attacker.name, text: `${attacker.name}'s Doomcleaver lands a savage chop! They regain ${apCost} AP and can attack again!`, timestamp: Date.now() });
                }

                const combinedDice = [weapon.effect.dice, consumedBonuses.extraDamageDice].filter(Boolean).join('+');
                const parsed = this.parseDiceString(combinedDice);
                const baseStatic = parsed.bonus + attacker.stats.damageBonus + consumedBonuses.damageBonus + (attacker.stats.flankingBonus || 0);
                const mod = this._applyWeaponDamageModifiers(room, attacker, weapon, target, combinedDice, baseStatic);
                const parsed2 = this.parseDiceString(mod.dice);

                const wDmgType = (weapon.effect?.damageType || (weapon.name?.toLowerCase().includes('staff') ? 'bludgeoning' : '')) || 'slashing';
                attacker.pendingAction = { 
                    actionType: 'damageRoll',
                    weaponId, 
                    weaponName: weapon.name,
                    targetId, 
                    rolls: [],
                    diceToRoll: parsed2.dice,
                    // CRITICAL FIX: Include flanking bonus in damage calculation
                    staticBonus: mod.staticBonus,
                    totalDice: parsed2.dice.length,
                    title: weapon.name,
                    damageType: wDmgType,
                    sourceAttacker: { id: attacker.id, name: attacker.name, isPlayer: true }
                };

                setTimeout(() => {
                    const currentRoom = this.rooms[room.id];
                    const currentPlayer = currentRoom?.players[attacker.id];
                    if (currentRoom && currentPlayer && currentPlayer.pendingAction?.actionType === 'damageRoll') {
                        this._startOrContinueDiceSequence(currentRoom, currentPlayer);
                    }
                }, 1500);

            } else {
                attacker.stats = this.calculatePlayerStats(attacker, room.gameState.partyHope);
                this.emitGameState(room.id);
            }
        } catch(e) {
            console.error("Error in resolveAttackRoll", e);
            io.to(room.id).emit('diceRollError');
        }
    }

    resolveUseConsumable(room, player, card, target) {
        if (player.currentAp < (card.apCost || 1)) {
            // CRITICAL FIX: Send specific AP error for consumable
            const playerSocket = io.sockets.sockets.get(player.id);
            if (playerSocket) {
                if (player.currentAp === 0) {
                    playerSocket.emit('actionError', 'NO_AP_END_TURN');
                } else {
                    playerSocket.emit('actionError', `Not enough AP to use ${card.name}. Need ${card.apCost || 1} AP, have ${player.currentAp}.`);
                }
            }
            return;
        }
    
        const effect = card.effect;
        const cardIndex = player.hand.findIndex(c => c.id === card.id);

        if (effect.dice && (effect.type === 'heal' || effect.type === 'damage')) {
            player.currentAp -= (card.apCost || 1);
            if (cardIndex !== -1) {
                const discardedCard = player.hand.splice(cardIndex, 1)[0];
                this._getDiscardPileForCard(room, discardedCard).push(discardedCard);
            }
            
            const parsed = this.parseDiceString(effect.dice);
            let staticBonus = parsed.bonus;
            if (effect.type === 'heal') staticBonus += player.stats.healingPower;

            player.pendingAction = {
                actionType: 'cardEffectRoll',
                card,
                targetId: target.id,
                rolls: [],
                diceToRoll: parsed.dice,
                staticBonus: staticBonus,
                totalDice: parsed.dice.length,
                title: card.name,
                sourceAttacker: { id: player.id, name: player.name, isPlayer: true }
            };

            this._startOrContinueDiceSequence(room, player);
            this.emitGameState(room.id);
            return;
        }
    
        player.currentAp -= (card.apCost || 1);
        room.gameState.lastAttackerId = player.id;
        if (cardIndex !== -1) {
            player.hand.splice(cardIndex, 1);
            this._getDiscardPileForCard(room, card).push(card);
        }
    
        let logText = `${player.name} uses ${card.name}`;
        if (target.id !== player.id) logText += ` on ${target.name}`;
        logText += '.';
    
        if (effect.type === 'buff') {
            this._applyStatusEffect(room, target, effect.status, effect.duration);
            logText += ` ${target.name} becomes ${effect.status}.`;
        }
        if (effect.type === 'utility' && effect.utilityType === 'add_shield_hp') {
            target.stats.shieldHp = (target.stats.shieldHp || 0) + effect.value;
            logText += ` ${target.name} gains ${effect.value} Shield HP.`;
        }
        // Single-target status utility (e.g., Oil Flask, Drench as consumable)
        if ((effect.type === 'utility' || effect.type === 'control') && effect.status && effect.target !== 'aoe') {
            this._applyStatusEffect(room, target, effect.status, effect.duration || 2);
            logText += ` ${target.name} is ${effect.status}.`;
        }
        // AOE status consumables (e.g., Grease Bomb)
        if ((effect.type === 'utility' || effect.type === 'control') && effect.status && effect.target === 'aoe') {
            const monsters = room.gameState.board.monsters.filter(m => m.currentHp > 0);
            let applied = 0;
            monsters.forEach(monster => {
                this._applyStatusEffect(room, monster, effect.status, effect.duration || 2);
                applied++;
            });
            logText += ` Affected ${applied} target(s).`;
        }
    
        room.chatLog.push({ type: 'action-good', playerName: player.name, text: logText, timestamp: Date.now() });
        if (target.class) {
            target.stats = this.calculatePlayerStats(target, room.gameState.partyHope);
        }
        this.emitGameState(room.id);
    }
    
    resolveCastSpell(room, player, card, target) {
        // AOE SPELL: Handle multi-target spells
        if (card.effect.target === 'aoe' || card.effect.target === 'multi-monster') {
            return this.resolveAOESpell(room, player, card);
        }

        if (card.name === 'Life Transfer' && target && player.currentAp >= (card.apCost || 3)) {
            player.currentAp -= card.apCost || 3;
            const nec = this.rollDiceWithDetails('4d8').total;
            this._applyDamage(room, player, nec, { name: 'Life Transfer' }, { damageType: 'necrotic' });
            const healAmt = nec * 2;
            target.stats.currentHp = Math.min(target.stats.maxHp, (target.stats.currentHp || 0) + healAmt);
            room.chatLog.push({
                type: 'action-good',
                playerName: player.name,
                text: `${player.name} casts Life Transfer, taking ${nec} necrotic damage and healing ${target.name} for ${healAmt} HP.`,
                timestamp: Date.now()
            });
            player.hand = player.hand.filter((c) => c.id !== card.id);
            this.emitGameState(room.id);
            return;
        }
        
        if (player.currentAp < (card.apCost || 1)) {
            // CRITICAL FIX: Send specific AP error for spell
            const playerSocket = io.sockets.sockets.get(player.id);
            if (playerSocket) {
                if (player.currentAp === 0) {
                    playerSocket.emit('actionError', 'NO_AP_END_TURN');
                } else {
                    playerSocket.emit('actionError', `Not enough AP to cast ${card.name}. Need ${card.apCost || 1} AP, have ${player.currentAp}.`);
                }
            }
            return;
        }
    
        const effect = card.effect;
        const isUtility = effect.type === 'utility' || card.category === 'Utility';
        
        if (effect.dice && (effect.type === 'heal' || effect.type === 'damage')) {
            player.currentAp -= (card.apCost || 1);
            const parsed = this.parseDiceString(effect.dice);
            let staticBonus = parsed.bonus;
            if (effect.type === 'heal') staticBonus += player.stats.healingPower;
            if (effect.type === 'damage') {
                staticBonus += player.stats.spellPower;
                if (player.equipment?.armor?.name === "Arcanist's Weave") staticBonus += 1;
            }

            player.pendingAction = {
                actionType: 'cardEffectRoll',
                card,
                targetId: target?.id,
                rolls: [],
                diceToRoll: parsed.dice,
                staticBonus: staticBonus,
                totalDice: parsed.dice.length,
                title: card.name,
                sourceAttacker: { id: player.id, name: player.name, isPlayer: true }
            };
            this._startOrContinueDiceSequence(room, player);
            
            // UTILITY FIX: Remove utility spells from hand after casting
            if (isUtility) {
                player.hand = player.hand.filter(c => c.id !== card.id);
                console.log(`[Server] Consumed utility spell: ${card.name}`);
            }
            
            this.emitGameState(room.id);
            return;
        }
    
        player.currentAp -= (card.apCost || 1);
        let logText = `${player.name} casts ${card.name}`;
        if (target) logText += ` on ${target.name}`;
        logText += '.';
        
        // UTILITY FIX: Remove utility spells from hand after casting (non-dice)
        if (isUtility) {
            player.hand = player.hand.filter(c => c.id !== card.id);
            console.log(`[Server] Consumed utility spell: ${card.name}`);
        }
        
        room.chatLog.push({ type: 'action-good', playerName: player.name, text: logText, timestamp: Date.now() });
        this.emitGameState(room.id);
    }
    
    _startOrContinueDiceSequence(room, player) {
        const pa = player.pendingAction;
        if (!pa || !pa.diceToRoll) return;

        if (pa.diceToRoll.length > 0) {
            const dieToRoll = pa.diceToRoll[0];
            io.to(room.id).emit('promptDiceSequenceRoll', {
                rollerId: player.id,
                rollerName: player.name,
                title: pa.title || 'Rolling',
                description: `Rolling for ${pa.actionType === 'damageRoll' ? 'damage' : 'effect'}.`,
                dice: dieToRoll,
                sequenceInfo: {
                    current: pa.rolls.length + 1,
                    total: pa.totalDice
                }
            });
        } else {
            this._resolveDiceSequence(room, player);
        }
    }

    resolveDiceSequenceRoll(room, player) {
        const pa = player.pendingAction;
        if (!pa || pa.diceToRoll.length === 0) return io.to(room.id).emit('diceRollError');

        const dieType = pa.diceToRoll.shift(); // Remove the die from the queue
        const rollValue = this.rollDie(dieType);
        pa.rolls.push(rollValue);

        io.to(room.id).emit('diceSequenceRollResult', {
            rollerId: player.id,
            rollerName: player.name,
            rollValue,
            sequenceInfo: {
                current: pa.rolls.length,
                total: pa.totalDice
            }
        });
        
        // Use a short delay before continuing to allow players to see the result
        setTimeout(() => this._startOrContinueDiceSequence(room, player), 1500);
    }

    _resolveDiceSequence(room, player) {
        const pa = player.pendingAction;
        if (!pa) return;
    
            const totalRollValue = pa.rolls.reduce((sum, r) => sum + r, 0);
            // CRITICAL FIX: Include synergy damage bonus in damage calculation
            const synergyBonus = player.synergyDamageBonus || 0;
            const totalValue = totalRollValue + pa.staticBonus + synergyBonus;
            const sourceAttacker = pa.sourceAttacker || player;
    
        if (pa.actionType === 'damageRoll') {
            const target = room.gameState.board.monsters.find(m => m.id === pa.targetId);
            if (!target) {
                player.pendingAction = null;
                io.to(player.id).emit('actionError', `Target ${pa.targetId} no longer valid.`);
                io.to(player.id).emit('diceRollError');
                this.emitGameState(room.id);
                return;
            }
            
            const dmgMeta = { damageType: pa.damageType || 'slashing' };
            const { wasDefeated, logParts } = this._applyDamage(room, target, totalValue, sourceAttacker, dmgMeta);
            let logText = `${sourceAttacker.name} deals ${totalValue} damage to ${target.name}! ${logParts.join(' ')}`;
            
            room.chatLog.push({ type: 'combat-hit', rollerName: sourceAttacker.name, rollerId: sourceAttacker.id, text: logText, timestamp: Date.now() });
            const wn = (pa.weaponName || '').toLowerCase();
            if (wn.includes('shadowtooth') && target.currentHp > 0) {
                this._applyStatusEffect(room, target, 'Poisoned', 3);
                room.chatLog.push({
                    type: 'combat',
                    text: `${sourceAttacker.name}'s Shadowtooth — Poison Ready: ${target.name} is Poisoned!`,
                    timestamp: Date.now()
                });
            }
            io.to(room.id).emit('damageResolved', { rollerId: player.id, rollerName: sourceAttacker.name, rolls: pa.rolls, damageRoll: totalRollValue, damageBonus: pa.staticBonus + synergyBonus, totalDamage: totalValue, wasDefeated });
        
        } else if (pa.actionType === 'cardEffectRoll' || pa.actionType === 'abilityEffectRoll') {
            const effectSource = pa.card || pa.ability;
            const effect = effectSource.effect;
            const effectType = effect.type;
    
            if (effect.target === 'aoe') {
                const monsters = [...room.gameState.board.monsters]; // Clone array to prevent modification issues
                let targetsHit = 0;
                let defeatedMonsters = [];
    
                const spellDtype = this._inferSpellDamageType(effect);
                monsters.forEach(monster => {
                    const { wasDefeated } = this._applyDamage(room, monster, totalValue, sourceAttacker, { damageType: spellDtype });
                    targetsHit++;
                    if (wasDefeated) {
                        defeatedMonsters.push(monster.name);
                    }
                });
                
                let logText = `${sourceAttacker.name}'s ${effectSource.name} hits ${targetsHit} target(s) for ${totalValue} damage each!`;
                if (defeatedMonsters.length > 0) {
                    logText += ` ${defeatedMonsters.join(', ')} defeated!`;
                }
                room.chatLog.push({ type: 'action-good', rollerName: sourceAttacker.name, rollerId: sourceAttacker.id, text: logText, timestamp: Date.now() });
                io.to(room.id).emit('cardEffectRollResolved', { rollerId: player.id, rollerName: sourceAttacker.name, rolls: pa.rolls, rollValue: totalRollValue, bonus: pa.staticBonus, totalValue: totalValue, effectType, cardName: effectSource.name, targetName: 'Multiple Targets', wasDefeated: defeatedMonsters.length > 0 });
            } else {
                const target = room.players[pa.targetId] || room.gameState.board.monsters.find(m => m.id === pa.targetId);
                
                if (!target) {
                    const errorMessage = `${effectSource.name} fizzles! Target is no longer valid.`;
                    room.chatLog.push({ type: 'system-bad', rollerName: sourceAttacker.name, rollerId: sourceAttacker.id, text: errorMessage, timestamp: Date.now() });
                    io.to(player.id).emit('actionError', errorMessage);
                    io.to(player.id).emit('diceRollError');
                    player.pendingAction = null;
                    this.emitGameState(room.id);
                    return;
                }
    
                let logText = '';
                let wasDefeated = false;
                if (effectType === 'heal') {
                    target.stats.currentHp = Math.min(target.stats.maxHp, target.stats.currentHp + totalValue);
                    logText = `${sourceAttacker.name} uses ${effectSource.name} to heal ${target.name} for ${totalValue} HP!`;
                } else if (effectType === 'damage') {
                    let dmgVal = totalValue;
                    if (target.class) {
                        const dc = 13;
                        const isDex = ['acid', 'fire', 'lightning', 'cold'].includes(this._inferSpellDamageType(effect));
                        let saveRoll = this.rollDie('d20');
                        if (target.equipment?.armor?.name === 'Sylvan Shroud' && isDex) {
                            saveRoll = Math.max(saveRoll, this.rollDie('d20'));
                        }
                        const saveStat = isDex ? (target.stats?.dex || 0) : (target.stats?.wis || 0);
                        let saveBonus = saveStat;
                        if (target.equipment?.armor?.name === 'Spellward Plate') saveBonus += 1;
                        const saved = saveRoll + saveBonus >= dc;
                        if (saved) {
                            dmgVal = Math.floor(dmgVal / 2);
                            room.chatLog.push({
                                type: 'action',
                                text: `${target.name} partially resists ${effectSource.name} (${saveRoll}+${saveBonus} vs DC ${dc}) — half damage.`,
                                timestamp: Date.now()
                            });
                        }
                    }
                    const result = this._applyDamage(room, target, dmgVal, sourceAttacker, { damageType: this._inferSpellDamageType(effect) });
                    wasDefeated = result.wasDefeated;
                    logText = `${sourceAttacker.name}'s ${effectSource.name} deals ${dmgVal} damage to ${target.name}! ${result.logParts.join(' ')}`;
                }
                room.chatLog.push({ type: 'action-good', rollerName: sourceAttacker.name, rollerId: sourceAttacker.id, text: logText, timestamp: Date.now() });
                io.to(room.id).emit('cardEffectRollResolved', { rollerId: player.id, rollerName: sourceAttacker.name, rolls: pa.rolls, rollValue: totalRollValue, bonus: pa.staticBonus, totalValue, effectType, cardName: effectSource.name, targetName: target.name, wasDefeated });
            }
        }
        
        player.pendingAction = null;
        if (!Object.values(room.players).some(p => p.pendingAction?.actionType === 'levelUp')) {
            Object.values(room.players).forEach(p => {
                p.stats = this.calculatePlayerStats(p, room.gameState.partyHope);
            });
            this.emitGameState(room.id);
        }
    }
    
    _applyStatusEffect(room, target, statusName, duration) {
        const statusDef = gameData.statusEffectDefinitions[statusName];
        if (!statusDef) return;

        const existingEffect = target.statusEffects?.find(e => e.name === statusName);
        if (existingEffect) {
            existingEffect.duration = Math.max(existingEffect.duration, duration);
        } else {
             if (!target.statusEffects) target.statusEffects = [];
            target.statusEffects.push({
                name: statusName,
                duration: duration,
                ...statusDef
            });
        }
        
        if (target.class) {
            target.stats = this.calculatePlayerStats(target, room.gameState.partyHope);
        }
    }
    
    // AOE Spell Resolution
    resolveAOESpell(room, player, spell) {
        const apCost = spell.apCost || 2;
        if (player.currentAp < apCost) {
            // CRITICAL FIX: Send specific AP error for AOE spell
            const playerSocket = io.sockets.sockets.get(player.id);
            if (playerSocket) {
                if (player.currentAp === 0) {
                    playerSocket.emit('actionError', 'NO_AP_END_TURN');
                } else {
                    playerSocket.emit('actionError', `Not enough AP to cast ${spell.name}. Need ${apCost} AP, have ${player.currentAp}.`);
                }
            }
            return;
        }
        
        player.currentAp -= apCost;
        const effect = spell.effect || {};
        const monsters = room.gameState.board.monsters.filter(m => m.currentHp > 0);

        if (effect.dice && effect.type === 'damage') {
            let totalDamage = 0;
            let defeatedCount = 0;
            const spellDtype = this._inferSpellDamageType(effect);
            let spellBonus = player.stats.spellPower || 0;
            if (player.equipment?.armor?.name === "Arcanist's Weave") spellBonus += 1;
            monsters.forEach(monster => {
                const damageRoll = this.rollDiceWithDetails(effect.dice);
                const damage = damageRoll.total + spellBonus;
                totalDamage += damage;
                const { wasDefeated } = this._applyDamage(room, monster, damage, player, { damageType: spellDtype });
                if (wasDefeated) {
                    defeatedCount++;
                    this._addXpToPlayer(room, player, monster.xpValue || 10);
                    this.checkForLootDrop(room, monster);
                }
            });
            room.chatLog.push({ 
                type: 'combat-hit', 
                playerName: player.name, 
                text: `${player.name} casts ${spell.name}! Hits ${monsters.length} targets for ${totalDamage} total damage!${defeatedCount > 0 ? ` ${defeatedCount} defeated!` : ''}`, 
                timestamp: Date.now() 
            });
        } else if ((effect.type === 'control' || effect.type === 'utility') && effect.status) {
            let applied = 0;
            monsters.forEach(monster => {
                this._applyStatusEffect(room, monster, effect.status, effect.duration || 2);
                applied++;
            });
            room.chatLog.push({ type: 'action-good', playerName: player.name, text: `${player.name} casts ${spell.name}, applying ${effect.status} to ${applied} target(s).`, timestamp: Date.now() });
        }

        // Remove utility/status spells used
        if (spell.category === 'Utility' || effect.type === 'control' || effect.type === 'utility') {
            player.hand = player.hand.filter(c => c.id !== spell.id);
        }

        this.emitGameState(room.id);
    }
    
    resolveGuard(room, player) {
        if (player.currentAp < gameData.actionCosts.guard) {
            // CRITICAL FIX: Send specific AP error for guard
            const playerSocket = io.sockets.sockets.get(player.id);
            if (playerSocket) {
                if (player.currentAp === 0) {
                    playerSocket.emit('actionError', 'NO_AP_END_TURN');
                } else {
                    playerSocket.emit('actionError', `Not enough AP to guard. Need ${gameData.actionCosts.guard} AP, have ${player.currentAp}.`);
                }
            }
            return;
        }
        player.currentAp -= gameData.actionCosts.guard;
        let shieldGain = player.stats.shieldBonus;
        if (player.equipment?.armor?.name === 'Round Shield') shieldGain += 1;
        player.stats.shieldHp += shieldGain;
        
        // Check for synergies
        this._checkForSynergies(room, player, 'guard');
        
        room.chatLog.push({ type: 'action', playerName: player.name, text: `${player.name} takes a guarded stance, gaining ${shieldGain} Shield HP.`, timestamp: Date.now() });
        this.emitGameState(room.id);
    }

    resolveRespite(room, player) {
        if (player.currentAp < gameData.actionCosts.briefRespite) {
            // CRITICAL FIX: Send specific AP error for respite
            const playerSocket = io.sockets.sockets.get(player.id);
            if (playerSocket) {
                if (player.currentAp === 0) {
                    playerSocket.emit('actionError', 'NO_AP_END_TURN');
                } else {
                    playerSocket.emit('actionError', `Not enough AP for respite. Need ${gameData.actionCosts.briefRespite} AP, have ${player.currentAp}.`);
                }
            }
            return;
        }
        player.currentAp -= gameData.actionCosts.briefRespite;
        
        // Check for synergies (Fortified Rest)
        const hasSynergy = this._checkForSynergies(room, player, 'respite');
        const multiplier = hasSynergy ? 2 : 1;
        
        const healing = this.rollDiceWithDetails('1d4').total * multiplier;
        player.stats.currentHp = Math.min(player.stats.maxHp, player.stats.currentHp + healing);
        room.chatLog.push({ type: 'action-good', playerName: player.name, text: `${player.name} takes a brief respite and heals for ${healing} HP.`, timestamp: Date.now() });
        this.emitGameState(room.id);
    }

    resolveRest(room, player) {
        if (player.currentAp < gameData.actionCosts.fullRest) {
            // CRITICAL FIX: Send specific AP error for rest
            const playerSocket = io.sockets.sockets.get(player.id);
            if (playerSocket) {
                if (player.currentAp === 0) {
                    playerSocket.emit('actionError', 'NO_AP_END_TURN');
                } else {
                    playerSocket.emit('actionError', `Not enough AP for full rest. Need ${gameData.actionCosts.fullRest} AP, have ${player.currentAp}.`);
                }
            }
            return;
        }
        player.currentAp -= gameData.actionCosts.fullRest;
        const classData = gameData.classes[player.class];
        const healing = classData ? this.rollDiceWithDetails(`${classData.healthDice}d4`).total : 0;
        player.stats.currentHp = Math.min(player.stats.maxHp, player.stats.currentHp + healing);
        room.chatLog.push({ type: 'action-good', playerName: player.name, text: `${player.name} takes a full rest and heals for ${healing} HP.`, timestamp: Date.now() });
        this.emitGameState(room.id);
    }

    resolveDash(room, player) {
        // Dash: Spend AP to get extra movement points
        
        if (player.currentAp < gameData.actionCosts.dash) {
            // CRITICAL FIX: Send specific AP error for dash
            const playerSocket = io.sockets.sockets.get(player.id);
            if (playerSocket) {
                if (player.currentAp === 0) {
                    playerSocket.emit('actionError', 'NO_AP_END_TURN');
                } else {
                    playerSocket.emit('actionError', `Not enough AP to dash. Need ${gameData.actionCosts.dash} AP, have ${player.currentAp}.`);
                }
            }
            return;
        }
        player.currentAp -= gameData.actionCosts.dash;
        
        // Apply Dashing status effect
        if (!player.statusEffects) player.statusEffects = [];
        player.statusEffects.push({ name: 'Dashing', duration: 1, bonuses: { movementBonus: 2 } });
        
        // Check for synergies
        this._checkForSynergies(room, player, 'dash');
        
        room.chatLog.push({ type: 'action', playerName: player.name, text: `${player.name} dashes forward with increased speed!`, timestamp: Date.now() });
        this.emitGameState(room.id);
    }

    resolveDodge(room, player) {
        if (player.currentAp < gameData.actionCosts.dodge) {
            // CRITICAL FIX: Send specific AP error for dodge
            const playerSocket = io.sockets.sockets.get(player.id);
            if (playerSocket) {
                if (player.currentAp === 0) {
                    playerSocket.emit('actionError', 'NO_AP_END_TURN');
                } else {
                    playerSocket.emit('actionError', `Not enough AP to dodge. Need ${gameData.actionCosts.dodge} AP, have ${player.currentAp}.`);
                }
            }
            return;
        }
        player.currentAp -= gameData.actionCosts.dodge;
        
        // Apply Dodging status effect
        if (!player.statusEffects) player.statusEffects = [];
        player.statusEffects.push({ name: 'Dodging', duration: 1, bonuses: { shieldBonus: 2 } });
        player.stats.shieldBonus += 2; // Immediate shield bonus

        const wn = (player.equipment?.weapon?.name || '').toLowerCase();
        if (wn.includes('bolt sprinter')) {
            this._applyStatusEffect(room, player, 'Steady Aim', 2);
            room.chatLog.push({
                type: 'action-good',
                playerName: player.name,
                text: `${player.name} Braces — next weapon attack gains +1d4 (Steady Aim).`,
                timestamp: Date.now()
            });
        }
        if (wn.includes("wayfinder's staff")) {
            player.wayfinderDeflectReady = true;
            room.chatLog.push({
                type: 'action-good',
                playerName: player.name,
                text: `${player.name} readies Deflect (+2 vs next hit, spend 1 AP when struck).`,
                timestamp: Date.now()
            });
        }
        
        room.chatLog.push({ type: 'action', playerName: player.name, text: `${player.name} takes a defensive stance, dodging incoming attacks!`, timestamp: Date.now() });
        this.emitGameState(room.id);
    }

    resolveHelp(room, player, targetPlayerId) {
        if (player.currentAp < gameData.actionCosts.help) {
            // CRITICAL FIX: Send specific AP error for help
            const playerSocket = io.sockets.sockets.get(player.id);
            if (playerSocket) {
                if (player.currentAp === 0) {
                    playerSocket.emit('actionError', 'NO_AP_END_TURN');
                } else {
                    playerSocket.emit('actionError', `Not enough AP to help. Need ${gameData.actionCosts.help} AP, have ${player.currentAp}.`);
                }
            }
            return;
        }
        const targetPlayer = room.players[targetPlayerId];
        if (!targetPlayer || targetPlayer.id === player.id) {
            const playerSocket = io.sockets.sockets.get(player.id);
            if (playerSocket) playerSocket.emit('actionError', 'You must select a different player to help.');
            return;
        }
        player.currentAp -= gameData.actionCosts.help;
        
        // Apply Helped status effect
        if (!targetPlayer.statusEffects) targetPlayer.statusEffects = [];
        targetPlayer.statusEffects.push({ name: 'Helped', duration: 2, grantsAdvantageToNextAction: true });
        
        room.chatLog.push({ type: 'action', playerName: player.name, text: `${player.name} helps ${targetPlayer.name}, granting them advantage on their next action!`, timestamp: Date.now() });
        this.emitGameState(room.id);
    }

    resolveSearch(room, player) {
        if (player.currentAp < gameData.actionCosts.search) {
            // CRITICAL FIX: Send specific AP error for search
            const playerSocket = io.sockets.sockets.get(player.id);
            if (playerSocket) {
                if (player.currentAp === 0) {
                    playerSocket.emit('actionError', 'NO_AP_END_TURN');
                } else {
                    playerSocket.emit('actionError', `Not enough AP to search. Need ${gameData.actionCosts.search} AP, have ${player.currentAp}.`);
                }
            }
            return;
        }
        player.currentAp -= gameData.actionCosts.search;
        
        // Perception check (1d20 + WIS modifier)
        const wisBonus = Math.floor((player.stats.wis - 10) / 2);
        const roll = this.rollDiceWithDetails('1d20');
        const total = roll.total + wisBonus;
        
        room.chatLog.push({ type: 'roll', playerName: player.name, text: `${player.name} searches the area... (Rolled ${roll.total} + ${wisBonus} WIS = ${total})`, timestamp: Date.now() });
        
        // DC 12 to find something
        if (total >= 12) {
            // Success! Award a random consumable item
            const potentialItems = gameData.itemCards.filter(c => c.type === 'Item' && c.effect && c.effect.type);
            if (potentialItems.length > 0) {
                const foundItem = potentialItems[Math.floor(Math.random() * potentialItems.length)];
                const card = { ...foundItem, id: this.generateUniqueCardId() };
                player.hand.push(card);
                room.chatLog.push({ type: 'action-good', playerName: player.name, text: `${player.name} found a hidden ${card.name}!`, timestamp: Date.now() });
            }
        } else {
            room.chatLog.push({ type: 'action', playerName: player.name, text: `${player.name} searches but finds nothing of value.`, timestamp: Date.now() });
        }
        
        this.emitGameState(room.id);
    }

    // --- Phase 1: New tactical actions ---
    resolveTakeCover(room, player) {
        if (player.currentAp < 1) {
            // CRITICAL FIX: Send specific AP error for take cover
            const playerSocket = io.sockets.sockets.get(player.id);
            if (playerSocket) {
                if (player.currentAp === 0) {
                    playerSocket.emit('actionError', 'NO_AP_END_TURN');
                } else {
                    playerSocket.emit('actionError', `Not enough AP to take cover. Need 1 AP, have ${player.currentAp}.`);
                }
            }
            return;
        }
        player.currentAp -= 1;
        player.positioning = player.positioning || { range: 'close', cover: 0, elevation: 0 };
        player.positioning.cover = Math.min(2, (player.positioning.cover || 0) + 2);
        room.chatLog.push({ type: 'action', playerName: player.name, text: `${player.name} takes cover (+2 cover).`, timestamp: Date.now() });
        this.emitGameState(room.id);
    }
    resolveAdvance(room, player) {
        if (player.currentAp < 1) {
            // CRITICAL FIX: Send specific AP error for advance
            const playerSocket = io.sockets.sockets.get(player.id);
            if (playerSocket) {
                if (player.currentAp === 0) {
                    playerSocket.emit('actionError', 'NO_AP_END_TURN');
                } else {
                    playerSocket.emit('actionError', `Not enough AP to advance. Need 1 AP, have ${player.currentAp}.`);
                }
            }
            return;
        }
        const grid = room.gameState.grid;
        const turnId = room.gameState.turnOrder[room.gameState.currentPlayerIndex];
        if (!grid || player.id !== turnId) return;
        player.currentAp -= 1;
        player.positioning = player.positioning || { range: 'close', cover: 0, elevation: 0 };
        player.positioning.range = 'close';

        const playerPos = grid.entities[player.id];
        const monsters = room.gameState.board.monsters || [];
        const monsterWithPos = monsters
            .map(m => ({ m, pos: grid.entities[m.id] }))
            .filter(x => !!x.pos);
        if (playerPos && monsterWithPos.length > 0) {
            // Find nearest monster
            monsterWithPos.sort((a,b)=> (Math.abs(a.pos.x-playerPos.x)+Math.abs(a.pos.y-playerPos.y)) - (Math.abs(b.pos.x-playerPos.x)+Math.abs(b.pos.y-playerPos.y)));
            const targetPos = monsterWithPos[0].pos;
            const stepX = Math.sign(targetPos.x - playerPos.x);
            const stepY = Math.sign(targetPos.y - playerPos.y);
            const candidates = [
                { x: playerPos.x + stepX, y: playerPos.y },
                { x: playerPos.x, y: playerPos.y + stepY }
            ];
            const inBounds = (x,y)=> x>=0 && y>=0 && x < (grid.width||5) && y < (grid.height||5);
            const occupied = (x,y)=> Object.values(grid.entities).some(p=> p && p.x===x && p.y===y);
            const next = candidates.find(c=> inBounds(c.x,c.y) && !occupied(c.x,c.y));
            if (next) {
                grid.entities[player.id] = { ...playerPos, x: next.x, y: next.y };
                room.chatLog.push({ type: 'action', playerName: player.name, text: `${player.name} advances to (${next.x}, ${next.y}).`, timestamp: Date.now() });
                this._updateFlankingBonuses(room);
            } else {
                room.chatLog.push({ type: 'action', playerName: player.name, text: `${player.name} advances (no space to step).`, timestamp: Date.now() });
            }
        } else {
            room.chatLog.push({ type: 'action', playerName: player.name, text: `${player.name} advances.`, timestamp: Date.now() });
        }
        this.emitGameState(room.id);
    }
    resolveRetreat(room, player) {
        if (player.currentAp < 1) {
            // CRITICAL FIX: Send specific AP error for retreat
            const playerSocket = io.sockets.sockets.get(player.id);
            if (playerSocket) {
                if (player.currentAp === 0) {
                    playerSocket.emit('actionError', 'NO_AP_END_TURN');
                } else {
                    playerSocket.emit('actionError', `Not enough AP to retreat. Need 1 AP, have ${player.currentAp}.`);
                }
            }
            return;
        }
        const grid = room.gameState.grid;
        const turnId = room.gameState.turnOrder[room.gameState.currentPlayerIndex];
        if (!grid || player.id !== turnId) return;
        player.currentAp -= 1;
        player.positioning = player.positioning || { range: 'close', cover: 0, elevation: 0 };
        player.positioning.range = 'far';

        const playerPos = grid.entities[player.id];
        const monsters = room.gameState.board.monsters || [];
        const monsterWithPos = monsters
            .map(m => ({ m, pos: grid.entities[m.id] }))
            .filter(x => !!x.pos);
        if (playerPos && monsterWithPos.length > 0) {
            // Find nearest monster
            monsterWithPos.sort((a,b)=> (Math.abs(a.pos.x-playerPos.x)+Math.abs(a.pos.y-playerPos.y)) - (Math.abs(b.pos.x-playerPos.x)+Math.abs(b.pos.y-playerPos.y)));
            const threat = monsterWithPos[0].pos;
            const stepX = -Math.sign(threat.x - playerPos.x);
            const stepY = -Math.sign(threat.y - playerPos.y);
            const candidates = [
                { x: playerPos.x + stepX, y: playerPos.y },
                { x: playerPos.x, y: playerPos.y + stepY }
            ];
            const inBounds = (x,y)=> x>=0 && y>=0 && x < (grid.width||5) && y < (grid.height||5);
            const occupied = (x,y)=> Object.values(grid.entities).some(p=> p && p.x===x && p.y===y);
            const next = candidates.find(c=> inBounds(c.x,c.y) && !occupied(c.x,c.y));
            if (next) {
                grid.entities[player.id] = { ...playerPos, x: next.x, y: next.y };
                room.chatLog.push({ type: 'action', playerName: player.name, text: `${player.name} retreats to (${next.x}, ${next.y}).`, timestamp: Date.now() });
                this._updateFlankingBonuses(room);
                const qwn = (player.equipment?.weapon?.name || '').toLowerCase();
                if (qwn.includes('quick blade') && (player._quickBladeAttacks || 0) >= 2 && !player._quickBladeRetreatUsed) {
                    player._quickBladeRetreatUsed = true;
                    player.currentAp += 1;
                    room.chatLog.push({
                        type: 'system-good',
                        playerName: player.name,
                        text: `${player.name} — Quick Blade Fluid Motion: Break Away refunds 1 AP.`,
                        timestamp: Date.now()
                    });
                }
            } else {
                room.chatLog.push({ type: 'action', playerName: player.name, text: `${player.name} retreats (no space to step).`, timestamp: Date.now() });
            }
        } else {
            room.chatLog.push({ type: 'action', playerName: player.name, text: `${player.name} retreats.`, timestamp: Date.now() });
        }
        this.emitGameState(room.id);
    }
    resolveIntimidate(room, player, targetId) {
        if (player.currentAp < 1) {
            // CRITICAL FIX: Send specific AP error for intimidate
            const playerSocket = io.sockets.sockets.get(player.id);
            if (playerSocket) {
                if (player.currentAp === 0) {
                    playerSocket.emit('actionError', 'NO_AP_END_TURN');
                } else {
                    playerSocket.emit('actionError', `Not enough AP to intimidate. Need 1 AP, have ${player.currentAp}.`);
                }
            }
            return;
        }
        const target = room.gameState.board.monsters.find(m => m.id === targetId);
        if (!target) return;
        player.currentAp -= 1;
        const bonus = Math.floor((player.stats.cha || 0) / 2);
        const roll = this.rollDiceWithDetails('1d20').total + bonus;
        const dc = 12 + Math.floor((target.stats?.wis || 0) / 2);
        const success = roll >= dc;
        if (success) target.requiredRollToHit += 1;
        room.chatLog.push({ type: success ? 'action-good' : 'action', playerName: player.name, text: `${player.name} attempts to intimidate ${target.name} (${roll} vs DC ${dc})${success ? ' - success!' : ' - failed.'}`, timestamp: Date.now() });
        this.emitGameState(room.id);
    }
    resolvePersuade(room, player, targetId) {
        if (player.currentAp < 1) {
            // CRITICAL FIX: Send specific AP error for persuade
            const playerSocket = io.sockets.sockets.get(player.id);
            if (playerSocket) {
                if (player.currentAp === 0) {
                    playerSocket.emit('actionError', 'NO_AP_END_TURN');
                } else {
                    playerSocket.emit('actionError', `Not enough AP to persuade. Need 1 AP, have ${player.currentAp}.`);
                }
            }
            return;
        }
        const target = room.gameState.board.monsters.find(m => m.id === targetId);
        if (!target) return;
        player.currentAp -= 1;
        const bonus = Math.floor((player.stats.cha || 0) / 2);
        const roll = this.rollDiceWithDetails('1d20').total + bonus;
        const dc = 14;
        const success = roll >= dc;
        if (success) {
            target.currentHp = Math.max(1, target.currentHp - 0); // Placeholder; could apply pacified
            target.pacifiedForTurns = 1;
        }
        room.chatLog.push({ type: success ? 'action-good' : 'action', playerName: player.name, text: `${player.name} tries to persuade ${target.name} (${roll} vs DC ${dc})${success ? ' - pacified briefly.' : ' - failed.'}`, timestamp: Date.now() });
        this.emitGameState(room.id);
    }

    resolveMove(room, player, targetX, targetY, movementCost) {
        console.log(`[Move] Player ${player.name} attempting move to (${targetX}, ${targetY}), cost: ${movementCost}`);
        const grid = room.gameState.grid;
        if (!grid) {
            console.error('[Move] No grid found!');
            return;
        }
        
        // CRITICAL FIX: Verify it's the player's turn
        const currentTurnPlayerId = room.gameState.turnOrder[room.gameState.currentPlayerIndex];
        if (player.id !== currentTurnPlayerId) {
            console.log(`[Move] Not player's turn: ${player.id} vs ${currentTurnPlayerId}`);
            const playerSocket = io.sockets.sockets.get(player.id);
            if (playerSocket) playerSocket.emit('actionError', 'You can only move on your turn!');
            return;
        }
        
        // STATUS EFFECT: Restrained - can't move
        if (player.statusEffects && player.statusEffects.some(e => e.name === 'Restrained')) {
            const playerSocket = io.sockets.sockets.get(player.id);
            if (playerSocket) playerSocket.emit('actionError', 'You are Restrained and cannot move!');
            return;
        }
        
        // Validate movement
        const playerPos = grid.entities[player.id];
        if (!playerPos) return;
        
        // Check if enough movement points
        if (player.movementPoints < movementCost) {
            const playerSocket = io.sockets.sockets.get(player.id);
            if (playerSocket) playerSocket.emit('actionError', 'Not enough movement points.');
            return;
        }

        if (player.equipment?.armor?.name === 'Ironclad Harness' && movementCost > 1) {
            const playerSocket = io.sockets.sockets.get(player.id);
            if (playerSocket) playerSocket.emit('actionError', 'Ironclad Harness: heavy armor limits you to 1 tile per move.');
            return;
        }
        
        // Check if target is occupied
        const isOccupied = Object.values(grid.entities).some(pos => 
            pos && pos.x === targetX && pos.y === targetY
        );
        if (isOccupied) {
            const playerSocket = io.sockets.sockets.get(player.id);
            if (playerSocket) playerSocket.emit('actionError', 'Target position is occupied.');
            return;
        }
        
        // Move the player
        playerPos.x = targetX;
        playerPos.y = targetY;
        player.movementPoints -= movementCost;
        // Update positional modifiers from terrain
        const terrainHere = Object.entries(grid.entities)
            .filter(([id, pos]) => pos && pos.x === targetX && pos.y === targetY && (pos.type === 'cover' || pos.type === 'elevation'))
            .map(([id, pos]) => pos.type);
        player.positioning = player.positioning || { range: 'close', cover: 0, elevation: 0 };
        const tileCover = terrainHere.includes('cover') ? 2 : 0;
        const tileElevation = terrainHere.includes('elevation') ? 1 : 0;
        player.positioning.cover = Math.max(player.positioning.cover || 0, tileCover);
        player.positioning.elevation = Math.max(player.positioning.elevation || 0, tileElevation);
        
        console.log(`[Move] ✅ ${player.name} moved to (${targetX}, ${targetY}), remaining MP: ${player.movementPoints}`);
        
        // Check for flanking bonuses
        this._updateFlankingBonuses(room);
        
        room.chatLog.push({ 
            type: 'action', 
            playerName: player.name, 
            text: `${player.name} moves to position (${targetX}, ${targetY})`, 
            timestamp: Date.now() 
        });
        
        console.log('[Move] Emitting game state update...');
        this.emitGameState(room.id);
    }

    _updateFlankingBonuses(room) {
        const grid = room.gameState.grid;
        if (!grid) return;

        // Clear all flanking bonuses
        Object.values(room.players).forEach(player => {
            if (player.stats.flankingBonus) {
                player.stats.flankingBonus = 0;
                player.stats = this.calculatePlayerStats(player, room.gameState.partyHope);
            }
        });

        // Use the authoritative monster list
        const monsters = room.gameState?.board?.monsters || [];

        // Calculate new flanking bonuses
        Object.values(room.players).forEach(player => {
            const playerPos = grid.entities[player.id];
            if (!playerPos) return;

            // Check each monster
            monsters.forEach(monster => {
                const monsterPos = grid.entities[monster.id];
                if (!monsterPos) return;

                // Check if player is adjacent to monster
                if (this._isAdjacent(playerPos.x, playerPos.y, monsterPos.x, monsterPos.y)) {
                    // Check if another player is also adjacent to this monster on opposite side
                    Object.values(room.players).forEach(ally => {
                        if (ally.id === player.id) return;

                        const allyPos = grid.entities[ally.id];
                        if (!allyPos) return;

                        if (this._isAdjacent(allyPos.x, allyPos.y, monsterPos.x, monsterPos.y)) {
                            // Simple flanking: if on opposite sides (different x or y)
                            const playerSide = { x: playerPos.x - monsterPos.x, y: playerPos.y - monsterPos.y };
                            const allySide = { x: allyPos.x - monsterPos.x, y: allyPos.y - monsterPos.y };

                            // Opposite sides check
                            if ((playerSide.x * allySide.x < 0) || (playerSide.y * allySide.y < 0)) {
                                if (!player.stats.flankingBonus) player.stats.flankingBonus = 0;
                                player.stats.flankingBonus = Math.max(player.stats.flankingBonus || 0, 2);
                            }
                        }
                    });
                }
            });

            // Recalculate stats with flanking bonus
            if (player.stats.flankingBonus) {
                player.stats = this.calculatePlayerStats(player, room.gameState.partyHope);
                // CRITICAL FIX: Ensure flanking bonus is preserved after stat recalculation
                player.stats.flankingBonus = Math.max(player.stats.flankingBonus || 0, 2);
            }
        });
    }

    _isAdjacent(x1, y1, x2, y2) {
        const dx = Math.abs(x2 - x1);
        const dy = Math.abs(y2 - y1);
        return (dx <= 1 && dy <= 1) && !(dx === 0 && dy === 0);
    }
    
    resolveUseAbility(room, player, ability) {
        if (player.currentAp < ability.apCost) {
            // CRITICAL FIX: Send specific AP error for ability
            const playerSocket = io.sockets.sockets.get(player.id);
            if (playerSocket) {
                if (player.currentAp === 0) {
                    playerSocket.emit('actionError', 'NO_AP_END_TURN');
                } else {
                    playerSocket.emit('actionError', `Not enough AP to use ${ability.name}. Need ${ability.apCost} AP, have ${player.currentAp}.`);
                }
            }
            return;
        }
        
        if (player.usedAbilityThisTurn && ability.apCost === 0) {
             const playerSocket = io.sockets.sockets.get(player.id);
             if (playerSocket) playerSocket.emit('actionError', 'You can only use that ability once per turn.');
            return;
        }

        player.currentAp -= ability.apCost;
        if (ability.apCost === 0) {
            player.usedAbilityThisTurn = true;
        }

        const effect = ability.effect;
        if (!effect) {
             this.emitGameState(room.id);
             return;
        }

        let logText = `${player.name} uses ${ability.name}!`;

        switch (effect.type) {
            case 'buff': // For Barbarian, Ranger, Rogue, Warrior
                this._applyStatusEffect(room, player, effect.status, effect.duration);
                logText += ` ${gameData.statusEffectDefinitions[effect.status]?.description || ''}`;
                room.chatLog.push({ type: 'action-good', playerName: player.name, text: logText, timestamp: Date.now() });
                player.stats = this.calculatePlayerStats(player, room.gameState.partyHope);
                this.emitGameState(room.id);
                break;
            case 'reaction':
                // Placeholder: mark reaction ready
                player.reactionReady = ability.name;
                room.chatLog.push({ type: 'action', playerName: player.name, text: `${player.name} prepares ${ability.name}.`, timestamp: Date.now() });
                this.emitGameState(room.id);
                break;

            case 'heal': // For Cleric
                const parsed = this.parseDiceString(effect.dice);
                const statBonus = effect.statBonus ? (player.stats[effect.statBonus] || 0) : 0;
                const staticBonus = parsed.bonus + statBonus + player.stats.healingPower;

                player.pendingAction = {
                    actionType: 'abilityEffectRoll',
                    ability: ability,
                    effect: effect,
                    targetId: player.id, // self-target
                    rolls: [],
                    diceToRoll: parsed.dice,
                    staticBonus: staticBonus,
                    totalDice: parsed.dice.length,
                    title: ability.name,
                    sourceAttacker: { id: player.id, name: player.name, isPlayer: true }
                };

                room.chatLog.push({ type: 'action', playerName: player.name, text: logText, timestamp: Date.now() });
                this._startOrContinueDiceSequence(room, player);
                this.emitGameState(room.id);
                break;
                
            case 'resource': // For Mage
                if (effect.resource === 'ap') {
                    player.currentAp = Math.min(player.stats.maxAP, player.currentAp + effect.amount);
                    logText += ` They recover ${effect.amount} AP.`;
                }
                room.chatLog.push({ type: 'action-good', playerName: player.name, text: logText, timestamp: Date.now() });
                this.emitGameState(room.id);
                break;
        }
    }
    
    // --- 3.8. Loot & Item Generation ---
    _grantXpForKill(room, killer, monster) {
        if (!monster.xpValue || !killer || !killer.class) return;

        room.gameState.enemiesDefeatedThisRun = (room.gameState.enemiesDefeatedThisRun || 0) + 1;
        killer.enemiesDefeated = (killer.enemiesDefeated || 0) + 1;

        const explorers = Object.values(room.players).filter(p => p.role === 'Explorer' && !p.isDowned);
        if (explorers.length === 0) return;

        const xpPerPlayer = Math.floor(monster.xpValue / explorers.length);
        room.chatLog.push({ type: 'system-good', text: `The party gains ${monster.xpValue} XP for defeating the ${monster.name}!`, timestamp: Date.now() });
        
        explorers.forEach(p => this._addXpToPlayer(room, p, xpPerPlayer));

        if (!explorers.some(p => p.pendingAction?.actionType === 'levelUp')) {
            this.emitGameState(room.id);
        }
    }

    checkForLootDrop(room, monster) {
        if (Math.random() * 100 < room.settings.lootDropRate) {
            const tier = monster.tier || 1; // Assume tier 1 if not specified
            const baseItem = this.drawCardFromDeck(room.id, 'treasure');
            if (baseItem) {
                const lastAttacker = room.players[room.gameState.lastAttackerId];
                const magicalItem = this.generateMagicalItem(baseItem, tier, lastAttacker || null);
                room.gameState.lootPool.push(magicalItem);
                const rarityText = magicalItem.rarityColor ? `<span style="color: ${magicalItem.rarityColor}">${magicalItem.rarity}</span>` : magicalItem.rarity;
                room.chatLog.push({ type: 'system-good', text: `${monster.name} dropped a ${rarityText} item: ${magicalItem.name}!`, timestamp: Date.now() });
                if (lastAttacker) {
                    if (magicalItem.rarityKey === 'legendary' || magicalItem.rarityKey === 'mythic') {
                        lastAttacker.runsSinceLegendary = 0;
                    } else {
                        lastAttacker.runsSinceLegendary = (lastAttacker.runsSinceLegendary || 0);
                    }
                }
            }
        }
    }
    
    // Determine rarity tier based on weighted random selection
    determineRarity(monsterTier, player = null) {
        const weights = Object.entries(gameData.rarityTiers).map(([key, data]) => ({
            key,
            weight: data.weight * (monsterTier || 1) // Higher tier monsters have better odds
        }));

        // Pity bias: small boost for legendary/mythic if player has long drought
        if (player && typeof player.runsSinceLegendary === 'number') {
            const pityBoost = Math.min(0.5, player.runsSinceLegendary * 0.02);
            const leg = weights.find(w => w.key === 'legendary');
            const myth = weights.find(w => w.key === 'mythic');
            if (leg) leg.weight *= (1 + pityBoost);
            if (myth) myth.weight *= (1 + pityBoost / 2);
        }
        // Meta-perk: Lucky Charm gives +5% loot rarity (shift weight from common to higher tiers)
        if (player) {
            const perkMults = this._getMetaPerkMultipliers(player);
            if (perkMults.lootRarityBonus > 0) {
                const common = weights.find(w => w.key === 'common');
                const uncommon = weights.find(w => w.key === 'uncommon');
                const rare = weights.find(w => w.key === 'rare');
                const shift = (common?.weight || 0) * perkMults.lootRarityBonus;
                if (common) common.weight -= shift;
                if (uncommon) uncommon.weight += shift * 0.5;
                if (rare) rare.weight += shift * 0.5;
            }
        }
        
        const totalWeight = weights.reduce((sum, item) => sum + item.weight, 0);
        let random = Math.random() * totalWeight;
        
        for (const item of weights) {
            random -= item.weight;
            if (random <= 0) return item.key;
        }
        return 'common';
    }
    
    generateMagicalItem(baseItem, monsterTier, player = null) {
        const newItem = { 
            ...baseItem, 
            id: this.generateUniqueCardId(), 
            bonuses: { ...(baseItem.bonuses || {}) } 
        };
        
        // Determine rarity
        const rarityKey = this.determineRarity(monsterTier, player);
        const rarityData = gameData.rarityTiers[rarityKey];
        newItem.rarity = rarityData.name;
        newItem.rarityColor = rarityData.color;
        newItem.rarityKey = rarityKey;
        
        // Apply affixes based on rarity
        const affixCount = rarityData.affixCount;
        if (affixCount > 0) {
            const itemType = baseItem.type.toLowerCase();
            const possibleAffixes = gameData.magicalAffixes.filter(affix => 
                affix.types.includes(itemType)
            );
            
            if (!newItem.effect) newItem.effect = { bonuses: {} };
            if (!newItem.effect.bonuses) newItem.effect.bonuses = {};
            
            // Apply multiple affixes for higher rarities
            const selectedAffixes = [];
            for (let i = 0; i < affixCount && possibleAffixes.length > 0; i++) {
                const affix = possibleAffixes[Math.floor(Math.random() * possibleAffixes.length)];
                selectedAffixes.push(affix);
                
                // Apply bonuses
                for (const [bonus, value] of Object.entries(affix.bonuses)) {
                    newItem.effect.bonuses[bonus] = (newItem.effect.bonuses[bonus] || 0) + value;
                    newItem.bonuses[bonus] = (newItem.bonuses[bonus] || 0) + value;
                }
                
                // Remove to avoid duplicate affixes
                const index = possibleAffixes.indexOf(affix);
                possibleAffixes.splice(index, 1);
            }
            
            // Update name with affixes
            if (selectedAffixes.length > 0) {
                const prefix = selectedAffixes.filter(a => !a.name.startsWith('of')).map(a => a.name);
                const suffix = selectedAffixes.filter(a => a.name.startsWith('of')).map(a => a.name);
                newItem.name = `${prefix.join(' ')} ${newItem.name} ${suffix.join(' ')}`.trim();
            }
        }
        
        return newItem;
    }

    resolveClaimLoot(room, claimingPlayer, item, targetPlayer) {
        const itemIndex = room.gameState.lootPool.findIndex(i => i.id === item.id);
        if (itemIndex === -1) return;
    
        room.gameState.lootPool.splice(itemIndex, 1);
        room.chatLog.push({ type: 'system-good', playerName: claimingPlayer.name, text: `${claimingPlayer.name} gives ${item.name} to ${targetPlayer.name}.`, timestamp: Date.now() });
    
        this._giveCardToPlayer(room, targetPlayer, item);
        this.emitGameState(room.id);
    }
    
    resolveChooseNewCardDiscard(room, player, newCard, cardToDiscardId) {
        const discardFromHand = player.hand.find(c => c.id === cardToDiscardId);

        if (discardFromHand) {
            const cardIndex = player.hand.findIndex(c => c.id === cardToDiscardId);
            const discardedCard = player.hand.splice(cardIndex, 1)[0];
            const discardPile = this._getDiscardPileForCard(room, discardedCard);
            discardPile.push(discardedCard);
            player.hand.push(newCard);
        } else { // The card to discard must be the new card
            const discardPile = this._getDiscardPileForCard(room, newCard);
            discardPile.push(newCard);
        }
        
        this.emitGameState(room.id);
    }
    
    resolveDiscoveryChoice(room, player, keptItemId) {
        if (!player.isResolvingDiscovery || !player.discoveryItem) return;

        const newCard = player.discoveryItem;
        const itemType = newCard.type.toLowerCase();
        const oldCard = player.equipment[itemType];

        const keptCard = keptItemId === newCard.id ? newCard : oldCard;
        const returnedCard = keptItemId === newCard.id ? oldCard : newCard;

        player.equipment[itemType] = keptCard;
        if (returnedCard) {
            // BEST PRACTICE: Return the unkept item to the player's hand.
            this._giveCardToPlayer(room, player, returnedCard);
        }

        player.isResolvingDiscovery = false;
        player.discoveryItem = null;
        player.stats = this.calculatePlayerStats(player, room.gameState.partyHope);
        this.emitGameState(room.id);
    }

    // --- 3.9. Event & Challenge Handling ---
    resolveLevelUpChoice(socket, { player, room, payload }) {
        if (!player.pendingAction || player.pendingAction.actionType !== 'levelUp') return;

        // Apply level up benefits
        player.level++;
        
        // CRITICAL FIX: Reset XP to 0 after leveling (keep excess for chained level ups)
        const excessXp = player.xp - player.xpToNextLevel;
        player.xp = Math.max(0, excessXp); // Reset to 0, but keep any excess XP
        
        // Scale XP: 25, 38, 57, 86, 129, etc. (1.5x multiplier)
        player.xpToNextLevel = Math.floor(player.xpToNextLevel * 1.5);
        player.inRunStatBonuses[payload.stat]++;
        
        player.stats = this.calculatePlayerStats(player, room.gameState.partyHope);
        player.stats.currentHp = player.stats.maxHp; // Full heal

        room.chatLog.push({ type: 'system-good', playerName: player.name, text: `${player.name} reached Level ${player.level} and increased their ${payload.stat.toUpperCase()}!`, timestamp: Date.now() });
        player.pendingAction = null; // Clear this player's action first

        // Check for specialization unlock at levels 3, 5, 7
        if ([3, 5, 7].includes(player.level)) {
            this._promptSpecializationChoice(room, player);
            return; // Keep game paused for specialization choice
        }

        // Check for chained level up for THIS player
        if (player.xp >= player.xpToNextLevel) {
            this._addXpToPlayer(room, player, 0); // Re-trigger the prompt for the same player.
            this.emitGameState(room.id); // Update UI
            return;
        }

        // Now, check if anyone else is still pending a level up.
        const anotherPlayerIsLeveling = Object.values(room.players).some(p => p.pendingAction?.actionType === 'levelUp');

        if (!anotherPlayerIsLeveling) {
            room.gameState.isPaused = false;
            room.gameState.pauseReason = '';
            this._resumeTurnAfterInterrupt(room, player);
            console.log(`[Level Up] ${player.name} completed level up — resume`);
            this.emitGameState(room.id);
            io.to(room.id).emit('turnStarted', { playerId: player.id });
        } else {
            // Someone else is still leveling up. The game remains paused. Just update the UI.
            this.emitGameState(room.id);
        }
    }

    _promptSpecializationChoice(room, player) {
        const playerSocket = io.sockets.sockets.get(player.id);
        if (!playerSocket || player.isNpc) {
            // Auto-select for NPCs
            const classSpecs = gameData.specializations[player.class];
            if (classSpecs) {
                const branches = Object.keys(classSpecs);
                const randomBranch = branches[Math.floor(Math.random() * branches.length)];
                const tier = player.level === 3 ? 1 : player.level === 5 ? 2 : 3;
                this.resolveSpecializationChoice(room, player, randomBranch, tier);
            }
            return;
        }

        playerSocket.emit('specializationPrompt', {
            playerClass: player.class,
            level: player.level,
            availableSpecs: Object.keys(gameData.specializations[player.class] || {})
        });
    }

    resolveSpecializationChoice(room, player, branch, tier) {
        if (!player.specializations) player.specializations = {};
        
        // Save specialization choice
        player.specializations[tier] = { branch, tier };
        
        // Apply bonuses
        const classSpecs = gameData.specializations[player.class];
        let specData = null;
        if (classSpecs && classSpecs[branch]) {
            const branchObj = classSpecs[branch];
            if (branchObj.tiers && Array.isArray(branchObj.tiers)) {
                specData = branchObj.tiers[tier - 1] || null;
            } else {
                specData = branchObj[`tier${tier}`] || null;
            }
        }
            if (specData && specData.bonuses) {
            Object.entries(specData.bonuses).forEach(([stat, value]) => {
                if (!player.specializationBonuses) player.specializationBonuses = {};
                if (!player.specializationBonuses[stat]) player.specializationBonuses[stat] = 0;
                player.specializationBonuses[stat] += value;
            });
            
            // Recalculate stats
            player.stats = this.calculatePlayerStats(player, room.gameState.partyHope);
            // Apply specialization effects (Phase 2: basic hooks)
            if (specData && specData.effect) {
                if (specData.effect.counterattack) {
                    player.reactionReady = 'Riposte';
                }
                if (typeof specData.effect.executeThreshold === 'number') {
                    player.executeThreshold = specData.effect.executeThreshold;
                }
                if (specData.effect.ambushAdvantage) {
                    player.hasAmbushAdvantage = true;
                }
            }
        }
        
        room.chatLog.push({ 
            type: 'system-good', 
            playerName: player.name, 
            text: `${player.name} specialized in ${branch} (Tier ${tier})!`, 
            timestamp: Date.now() 
        });
        
        // Check for chained level up
        if (player.xp >= player.xpToNextLevel) {
            this._addXpToPlayer(room, player, 0);
            this.emitGameState(room.id);
            return;
        }

        // Resume game if no one else is pending
        const anotherPlayerIsLeveling = Object.values(room.players).some(p => 
            p.pendingAction?.actionType === 'levelUp'
        );

        if (!anotherPlayerIsLeveling) {
            room.gameState.isPaused = false;
            room.gameState.pauseReason = '';
            this._resumeTurnAfterInterrupt(room, player);
            console.log(`[Specialization] ${player.name} completed specialization — resume`);
            this.emitGameState(room.id);
            io.to(room.id).emit('turnStarted', { playerId: player.id });
        } else {
            this.emitGameState(room.id);
        }
    }

    resolveDiscoveryRoll(room, player) {
        const roll = this.rollDiceWithDetails('1d20').total;
        io.to(room.id).emit('discoveryRollResolved', { rollerId: player.id, rollerName: player.name, roll });

        // Beta tuning: slightly easier discoveries and guaranteed consolation prize
        if (roll >= 13) { // Success
            const newItem = this.generateMagicalItem(this.drawCardFromDeck(room.id, 'treasure'), 2);
            if (newItem) {
                player.isResolvingDiscovery = true;
                player.discoveryItem = newItem;
                io.sockets.sockets.get(player.id)?.emit('promptIndividualDiscovery', { newCard: newItem });
                room.chatLog.push({ type: 'system-good', playerName: player.name, text: `${player.name} discovers a powerful item: ${newItem.name}!`, timestamp: Date.now() });
            }
        } else if (roll >= 9) { // Partial success
            const item = this.drawCardFromDeck(room.id, 'item');
            this._giveCardToPlayer(room, player, item);
            room.chatLog.push({ type: 'system-good', playerName: player.name, text: `${player.name} finds a useful item: ${item.name}!`, timestamp: Date.now() });
        } else { // Failure – grant small gold consolation to reduce feel-bad
            const gold = 5;
            player.gold = (player.gold || 0) + gold;
            room.chatLog.push({ type: 'system', playerName: player.name, text: `${player.name} finds a few coins (+${gold}g).`, timestamp: Date.now() });
        }
        this.emitGameState(room.id);
    }

    _getSkillCheckContext(room, player, interactionData) {
        // ROBUSTNESS: This function centralizes finding the source of a skill check.
        if (interactionData) { // From a card interaction
            const card = room.gameState.board.environment.find(c => c.id === interactionData.cardId) ||
                         room.gameState.board.monsters.find(c => c.id === interactionData.cardId);
            const interaction = card?.skillInteractions.find(i => i.name === interactionData.interactionName);
            if (!interaction) return { source: null, type: null };
            const sc = room.gameState.skillChallenge;
            if (interaction.eventType === 'multi_stage_skill_challenge' && Array.isArray(interaction.stages) && interaction.stages.length > 0) {
                const idx = (sc?.isActive && sc.targetId === interactionData.cardId) ? (sc.currentStage || 0) : 0;
                const stage = interaction.stages[idx] || interaction.stages[0];
                return { source: stage, type: 'card' };
            }
            return { source: interaction, type: 'card' };
        } else if (room.gameState.skillChallenge.isActive) {
            const challenge = room.gameState.skillChallenge.details;
            const stage = challenge.stages ? challenge.stages[room.gameState.skillChallenge.currentStage] : challenge;
            // Card/board challenges set targetId (environmental chest, etc.); world events use targetId null.
            const isCard = room.gameState.skillChallenge.targetId != null;
            return { source: stage, type: isCard ? 'card' : 'event' };
        }
        return { source: null, type: null };
    }
    
    resolveSkillCheck(room, player) {
        const { source, type } = this._getSkillCheckContext(room, player);
        if (!source) return;

        // Check for items that grant advantage
        const advantageItem = player.hand.find(c => c.effect?.grantsAdvantage && c.relevantSkill === source.skill);
        const hasAdvantage = !!advantageItem;


        io.to(room.id).emit('promptSkillCheckRoll', {
            rollerId: player.id,
            rollerName: player.name,
            title: `Skill Check: ${source.description}`,
            description: `Rolling a ${source.skill.toUpperCase()} check against a DC of ${source.dc}.`,
            dice: 'd20',
            bonus: player.stats[source.skill] || 0,
            targetAC: source.dc,
            hasAdvantage: hasAdvantage,
            relevantItemName: advantageItem ? advantageItem.name : null
        });
    }

    resolveSkillCheckRoll(room, player, payload) {
        try {
            const { source, type } = this._getSkillCheckContext(room, player, payload.interactionData);
            if (!source) return io.to(room.id).emit('diceRollError');
    
            const roll1 = this.rollDie('d20');
            const roll2 = payload.hasAdvantage ? this.rollDie('d20') : roll1;
            const roll = Math.max(roll1, roll2);

            let bonus = player.stats[source.skill] || 0;
            if (player.equipment?.armor?.name === 'Nightfall Shroud' && String(source.skill).toLowerCase() === 'dex') {
                bonus += 1;
            }
            const total = roll + bonus;
            const outcome = total >= source.dc ? "Success" : "Failure";
    
            let resultText = `${player.name} attempts the check... It's a ${outcome}! (Rolled ${roll} + ${bonus} vs DC ${source.dc})`;
            if(payload.hasAdvantage) resultText += ` with advantage (rolls: ${roll1}, ${roll2})`;
            room.chatLog.push({ type: outcome === 'Success' ? 'action-good' : 'system-bad', rollerName: player.name, text: resultText, timestamp: Date.now() });
            io.to(room.id).emit('skillCheckResolved', {
                rollerId: player.id,
                roll,
                bonus,
                total,
                targetAC: source.dc,
                outcome
            });
    
            if (outcome === 'Success') {
                this._addXpToPlayer(room, player, 10);
            }

            const resultAction = outcome === 'Success' ? source.success : source.failure;
    
            if (resultAction) {
                switch (resultAction.type) {
                    case 'aoe_damage':
                        room.gameState.board.monsters.forEach(m => {
                            const damage = this.rollDiceWithDetails(resultAction.value).total;
                            this._applyDamage(room, m, damage, player);
                        });
                        break;
                    case 'self_damage':
                        this._applyDamage(room, player, this.rollDiceWithDetails(resultAction.value).total, { name: "Trap" });
                        break;
                    case 'loot':
                        this.checkForLootDrop(room, { tier: 2 }); // Give a decent item
                        break;
                }
                 room.chatLog.push({ type: 'system', text: resultAction.text, timestamp: Date.now() });
                 room.gameState.runScore += (outcome === 'Success' ? 5 : -2);
            }
    
            const sc = room.gameState.skillChallenge;
            const details = sc?.details;
            const isMultiStageCard = sc?.targetId != null &&
                details?.eventType === 'multi_stage_skill_challenge' &&
                Array.isArray(details.stages) &&
                details.stages.length > 1;

            if (isMultiStageCard) {
                if (outcome === 'Success' && sc.currentStage < details.stages.length - 1) {
                    sc.currentStage++;
                    const nextStage = details.stages[sc.currentStage];
                    const advantageItem = player.hand.find(c =>
                        c.effect?.grantsAdvantage && c.relevantSkill && nextStage.skill &&
                        c.relevantSkill.toLowerCase() === String(nextStage.skill).toLowerCase()
                    );
                    io.to(room.id).emit('promptSkillCheckRoll', {
                        rollerId: player.id,
                        rollerName: player.name,
                        title: `Skill Check: ${details.name || 'Challenge'}`,
                        description: nextStage.description || `Rolling a ${String(nextStage.skill || '').toUpperCase()} check against DC ${nextStage.dc}.`,
                        dice: 'd20',
                        bonus: player.stats[nextStage.skill] || 0,
                        targetAC: nextStage.dc,
                        hasAdvantage: !!advantageItem,
                        relevantItemName: advantageItem ? advantageItem.name : null,
                        interactionData: { cardId: sc.targetId, interactionName: details.name }
                    });
                } else {
                    sc.isActive = false;
                }
            } else if (type === 'event') {
                if (outcome === 'Success' && details?.stages && sc.currentStage < details.stages.length - 1) {
                    sc.currentStage++;
                } else {
                    sc.isActive = false;
                    if (details?.sourceTag === 'pathRisk') {
                        this.moveToNextTurn(room);
                    }
                }
            } else {
                if (sc) sc.isActive = false;
                if (source?.sourceTag === 'pathRisk') {
                    this.moveToNextTurn(room);
                }
            }
            
            // CRITICAL FIX: Always emit game state after skill challenge resolution
            this.emitGameState(room.id);
    
            if (!player.pendingAction) this.emitGameState(room.id);
        } catch(e) {
             console.error("Error resolving skill check:", e);
             io.to(room.id).emit('diceRollError');
        }
    }
    
    resolveSkillInteraction(room, player, cardId, interactionName) {
        const card = room.gameState.board.environment.find(c => c.id === cardId) || room.gameState.board.monsters.find(c => c.id === cardId);
        if (!card || !card.skillInteractions) {
            console.error('[SkillInteraction] Card not found or no interactions:', cardId);
            return;
        }
        const interaction = card.skillInteractions.find(i => i.name === interactionName);
        if (!interaction) {
            console.error('[SkillInteraction] Interaction not found:', interactionName);
            return;
        }
        if (player.currentAp < interaction.apCost) {
            const playerSocket = io.sockets.sockets.get(player.id);
            if (playerSocket) playerSocket.emit('actionError', `Not enough AP. Need ${interaction.apCost} AP.`);
            return;
        }

        player.currentAp -= interaction.apCost;
        
        console.log(`[SkillInteraction] ${player.name} interacting with ${card.name}: ${interactionName}`);
        
        // CRITICAL FIX: For simple interactions (like chests), don't set skill challenge as active
        // This prevents the skill challenge modal from appearing alongside the dice roll modal
        // Only set skill challenge for complex multi-stage interactions
        if (interaction.stages && interaction.stages.length > 1) {
            room.gameState.skillChallenge = {
                isActive: true,
                details: interaction,
                currentStage: 0,
                targetId: cardId,
            };
        } else {
            // For simple interactions, just clear any existing skill challenge
            room.gameState.skillChallenge = { isActive: false };
        }

        const firstStage = interaction.stages ? interaction.stages[0] : interaction;
        
        // CRITICAL FIX: Check for lockpick that matches skill
        const advantageItem = player.hand.find(c => 
            c.effect?.grantsAdvantage && 
            c.relevantSkill && 
            c.relevantSkill.toLowerCase() === firstStage.skill.toLowerCase()
        );
        const hasAdvantage = !!advantageItem;
        
        console.log(`[SkillInteraction] Skill: ${firstStage.skill}, DC: ${firstStage.dc}, Has advantage: ${hasAdvantage}`);

        io.to(room.id).emit('promptSkillCheckRoll', {
            rollerId: player.id,
            rollerName: player.name,
            title: `Skill Check: ${interactionName}`,
            description: firstStage.description || `Rolling a ${firstStage.skill.toUpperCase()} check against DC ${firstStage.dc}.`,
            dice: 'd20',
            bonus: player.stats[firstStage.skill] || 0,
            targetAC: firstStage.dc,
            hasAdvantage: hasAdvantage,
            relevantItemName: advantageItem ? advantageItem.name : null,
            interactionData: { cardId, interactionName }
        });

        this.emitGameState(room.id);
    }

    handlePlayerDisconnect(socket, reason) {
        const room = this.findRoomBySocket(socket);
        if (!room) return;
        
        const player = room.players[socket.id];
        if (!player || player.isNpc) return;
        
        console.log(`[Disconnect] Player ${player.name} disconnected from room ${room.id}. Reason: ${reason}`);
        
        // Mark player as disconnected (don't remove them yet)
        player.disconnected = true;
        
        // Remove from voice chat
        room.voiceChatters = room.voiceChatters.filter(id => id !== socket.id);
        
        // Notify other players
        room.chatLog.push({ 
            type: 'system-bad', 
            text: `${player.name} disconnected. They can reconnect by rejoining the room.`, 
            timestamp: Date.now() 
        });
        
        // Set a timer to replace with NPC if they don't reconnect (5 minutes)
        player.replacementTimer = setTimeout(() => {
            if (player.disconnected) {
                console.log(`[Disconnect] Player ${player.name} timeout - replacing with NPC`);
                player.isNpc = true;
                player.disconnected = false;
                room.chatLog.push({ 
                    type: 'system', 
                    text: `${player.name} has been replaced by an AI player.`, 
                    timestamp: Date.now() 
                });
                this.emitGameState(room.id);
            }
        }, 300000); // 5 minutes
        
        this.emitGameState(room.id);
    }
}

// --- 4. SOCKET.IO CONNECTION HANDLING ---
const gameManager = new GameManager();

io.on('connection', (socket) => {
    socket.on('createRoom', (data) => gameManager.createRoom(socket, data));
    socket.on('joinRoom', (data) => gameManager.joinRoom(socket, data));
    socket.on('rejoinRoom', (data) => gameManager.rejoinRoom(socket, data));
    socket.on('startGame', () => gameManager.startGame(socket));
    socket.on('chooseClass', (data) => gameManager.chooseClass(socket, data));
    socket.on('equipItem', (data) => gameManager.equipItem(socket, data));
    socket.on('endTurn', () => {
        const room = gameManager.findRoomBySocket(socket);
        const player = room?.players[socket.id];
        if (room && player && !player.pendingAction) {
            gameManager.beginEndOfTurnPhase(room, player);
        }
    });
    socket.on('playerAction', (payload) => gameManager.resolvePlayerAction(socket, payload));
    
    // CRITICAL FIX: Handle modal-based game pausing to prevent overlapping prompts
    socket.on('pauseGameForModal', (data) => {
        const room = gameManager.findRoomBySocket(socket);
        if (room && !room.gameState.isPaused) {
            room.gameState.isPaused = true;
            room.gameState.pauseReason = `Player is in ${data.modalType} modal`;
            console.log(`[ModalPause] Game paused for ${data.modalType} modal`);
            gameManager.emitGameState(room.id);
        }
    });
    
    socket.on('resumeGameFromModal', (data) => {
        const room = gameManager.findRoomBySocket(socket);
        const modalType = typeof data?.modalType === 'string' ? data.modalType : '';
        // Must match pauseGameForModal exactly — do NOT use .includes(modalType): "Shopping..." contains "shop"
        // and would wrongly unpause multiplayer shop while the server pause is still active.
        const expected = modalType ? `Player is in ${modalType} modal` : '';
        if (
            room &&
            room.gameState.isPaused &&
            modalType &&
            room.gameState.pauseReason === expected
        ) {
            room.gameState.isPaused = false;
            room.gameState.pauseReason = '';
            console.log(`[ModalResume] Game resumed from ${modalType} modal`);
            gameManager.emitGameState(room.id);
        }
    });
    
    // CRITICAL FIX: Handle shop close with new multiplayer system
    socket.on('closeShop', () => {
        const room = gameManager.findRoomBySocket(socket);
        if (!room || !room.gameState.shop) return;
        const player = room.players[socket.id];
        if (!player || player.isNpc) return;
        gameManager.markPlayerShopFinished(room, player);
    });

    // Legacy alias — prefer `closeShop` from client (same handler)
    socket.on('playerShopComplete', () => {
        const room = gameManager.findRoomBySocket(socket);
        if (!room || !room.gameState.shop) return;
        const player = room.players[socket.id];
        if (!player || player.isNpc) return;
        gameManager.markPlayerShopFinished(room, player);
    });
    
    // Phase 3: room choice selection
    socket.on('chooseNextRoom', (roomId, roomChoiceId) => {
        const room = gameManager.rooms[roomId];
        const choice = room?.gameState?.nextRooms?.find(r => r.id === roomChoiceId);
        if (!room || !choice) return;
        // Only the designated chooser can confirm the next room
        if (room.gameState.pathChooserId && socket.id !== room.gameState.pathChooserId) return;
        const pathChooserId = room.gameState.pathChooserId || socket.id;
        const depth = room.gameState.depth || 1;
        room.chatLog.push({ type: 'system', text: `Next room: ${choice.type.toUpperCase()} (Depth ${depth})`, timestamp: Date.now() });
        room.gameState.nextRooms = [];
        room.gameState.pathChooserId = null;
        room.gameState.lastPathChoiceRound = room.gameState.turnCount;
        const rt = room.gameState.recentRoomTypes || [];
        rt.push(choice.type);
        if (rt.length > 4) rt.shift();
        room.gameState.recentRoomTypes = rt;

        if (choice.type === 'boss') {
            gameManager._spawnBossForRoom(room);
            gameManager.emitGameState(room.id);
            gameManager.moveToNextTurn(room);
        } else if (choice.type === 'ambush') {
            gameManager._spawnAmbush(room);
            gameManager.emitGameState(room.id);
            gameManager.moveToNextTurn(room);
        } else if (choice.type === 'combat') {
            // Combat rooms just advance turns - DM will spawn monsters
            gameManager.moveToNextTurn(room);
        } else if (choice.type === 'event') {
            const chooser = room.players[pathChooserId];
            if (chooser) {
                gameManager._triggerDungeonEvent(room, chooser);
                setTimeout(() => {
                    if (!room.gameState.skillChallenge?.isActive && !room.gameState.isPaused) {
                        gameManager.moveToNextTurn(room);
                    }
                }, 1000);
            } else {
                gameManager.moveToNextTurn(room);
            }
        } else if (choice.type === 'rest') {
            const healAmount = 5 + (depth || 0);
            Object.values(room.players).forEach(p => {
                if (p.class) {
                    p.stats.currentHp = Math.min(p.stats.maxHp, p.stats.currentHp + healAmount);
                }
            });
            room.chatLog.push({ type: 'system-good', text: `The party rests and heals ${healAmount} HP each.`, timestamp: Date.now() });
            gameManager.emitGameState(room.id);
            gameManager.moveToNextTurn(room);
        } else if (choice.type === 'shop') {
            room.gameState.pendingTurnAfterPathShop = true;
            gameManager.openShop(room);
        } else if (choice.type === 'treasure') {
            const chooser = room.players[socket.id];
            if (room.gameState.skillChallenge?.isActive) {
                console.log(`[ChoosePath] Skill challenge already active, skipping duplicate`);
                return;
            }
            const dc = 12 + Math.floor(depth / 3);
            const risk = {
                skill: 'dex',
                dc,
                description: `Navigate subtle traps to reach hidden treasure. (DC ${dc})`,
                success: { type: 'loot', text: 'You deftly evade traps and find treasure!' },
                failure: { type: 'self_damage', value: depth > 8 ? '2d6' : '1d6', text: 'A trap springs! You are hurt.' },
                sourceTag: 'pathRisk'
            };
            room.gameState.skillChallenge = { isActive: true, details: risk, currentStage: 0, targetId: null };
            io.to(room.id).emit('promptSkillCheckRoll', {
                rollerId: chooser.id,
                rollerName: chooser.name,
                title: 'Risky Treasure Path',
                description: risk.description,
                dice: 'd20',
                bonus: chooser.stats?.dex || 0,
                targetAC: dc,
                hasAdvantage: false
            });
        }
    });
    socket.on('chatMessage', (data) => {
         const room = gameManager.findRoomBySocket(socket);
         if(room && room.players[socket.id]) {
             const message = escapeHtml(data.message).substring(0, 150); // Sanitize and cap length
             room.chatLog.push({ type: 'chat', channel: data.channel, playerId: socket.id, playerName: room.players[socket.id].name, text: message, timestamp: Date.now() });
             gameManager.emitGameState(room.id);
         }
    });

    // Voice Chat Signaling
    socket.on('join-voice-chat', () => {
        const room = gameManager.findRoomBySocket(socket);
        if (room) {
            socket.emit('existing-voice-chatters', room.voiceChatters);
            room.voiceChatters.push(socket.id);
            socket.to(room.id).emit('new-voice-chatter', socket.id);
        }
    });
    socket.on('leave-voice-chat', () => {
        const room = gameManager.findRoomBySocket(socket);
        if (room) {
            room.voiceChatters = room.voiceChatters.filter(id => id !== socket.id);
            socket.to(room.id).emit('voice-chatter-left', socket.id);
        }
    });
    socket.on('webrtc-signal', (payload) => {
        io.to(payload.to).emit('webrtc-signal', { from: socket.id, signal: payload.signal });
    });

    socket.on('disconnect', (reason) => {
        console.log(`[Disconnect] Socket ${socket.id} disconnected. Reason: ${reason}`);
        gameManager.handlePlayerDisconnect(socket, reason);
    });
});

server.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
