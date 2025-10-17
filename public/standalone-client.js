// Quest & Chronicle - Standalone Offline Client
// Fully functional single-player game - no server required
// Works on all platforms: Windows, macOS, Linux, mobile

// --- MOCK SOCKET FOR COMPATIBILITY ---
// This allows the existing code to work without Socket.IO
const socket = {
    connected: false,
    emit: function() {},
    on: function() {},
    off: function() {}
};

// --- GLOBAL SETUP & STATE ---
let myId = 'offline-player';
let myPlayerName = '';
let currentRoomState = {};
let gameUIInitialized = false;
let offlineEngine = null;

// Consolidated client-side state
const clientState = {
    selectedGameMode: null,
    selectedWeaponId: null,
    selectedHandCardId: null,
    currentRollData: null,
    activeItem: null,
    diceAnimationInterval: null,
    rollModalCloseTimeout: null,
    rollResponseTimeout: null,
    activeSpectatorToast: null,
    spectatorToastTimeout: null,
    helpModalPage: 0,
    isFirstTurnTutorialActive: false,
    hasSeenSkillChallengePrompt: false,
    lastLogLength: 0,
    activeLegacyClassTab: 'Barbarian',
    selectedLevelUpStat: null,
    selectedClass: null,
    gameStarted: false
};

// --- HELPERS ---
const get = (id) => document.getElementById(id);
const queryAll = (selector) => document.querySelectorAll(selector);
const escapeHtml = (unsafe) => {
    if (typeof unsafe !== 'string') return '';
    return unsafe.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
};

// --- ACCOUNT MANAGER (Persistent Progression) ---
const accountManager = {
    data: {
        xp: 0,
        upgrades: {},
        gamesPlayed: 0,
        highestRound: 0,
        monstersDefeated: 0
    },

    load() {
        try {
            const savedData = localStorage.getItem('qc_accountData');
            if (savedData) {
                this.data = JSON.parse(savedData);
            }
        } catch (e) {
            console.error("Failed to load account data:", e);
            this.data = { xp: 0, upgrades: {}, gamesPlayed: 0, highestRound: 0, monstersDefeated: 0 };
        }
    },

    save() {
        try {
            localStorage.setItem('qc_accountData', JSON.stringify(this.data));
        } catch (e) {
            console.error("Failed to save account data:", e);
        }
    },
    
    addXp(amount) {
        this.data.xp += amount;
        this.save();
    },

    recordGameEnd(rounds, monstersKilled, victory) {
        this.data.gamesPlayed++;
        if (rounds > this.data.highestRound) {
            this.data.highestRound = rounds;
        }
        this.data.monstersDefeated += monstersKilled;
        this.save();
    }
};

// --- GAME SAVE MANAGER ---
const gameSaveManager = {
    save(gameState) {
        try {
            localStorage.setItem('qc_currentGame', JSON.stringify({
                state: gameState,
                timestamp: Date.now()
            }));
        } catch (e) {
            console.error("Failed to save game:", e);
        }
    },

    load() {
        try {
            const saved = localStorage.getItem('qc_currentGame');
            if (saved) {
                const data = JSON.parse(saved);
                // Only load if less than 24 hours old
                if (Date.now() - data.timestamp < 24 * 60 * 60 * 1000) {
                    return data.state;
                }
            }
        } catch (e) {
            console.error("Failed to load game:", e);
        }
        return null;
    },

    clear() {
        localStorage.removeItem('qc_currentGame');
    }
};

// --- TOAST NOTIFICATIONS ---
function showToast(message, type = 'info', duration = 3000) {
    const container = get('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    container.appendChild(toast);
    
    setTimeout(() => toast.classList.add('show'), 10);
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 300);
    }, duration);
}

// --- MENU SCREEN LOGIC ---
function initMenuScreen() {
    accountManager.load();
    
    const playerNameInput = get('player-name-input');
    const createRoomBtn = get('create-room-btn');
    const joinRoomBtn = get('join-room-btn');
    const roomCodeInput = get('room-code-input');
    const modeButtons = queryAll('.mode-btn');
    
    // Disable multiplayer
    joinRoomBtn.disabled = true;
    joinRoomBtn.textContent = 'Multiplayer Coming Soon';
    roomCodeInput.disabled = true;
    roomCodeInput.placeholder = 'Single Player Only';
    
    // Enable create button when name is entered
    playerNameInput.addEventListener('input', () => {
        const hasName = playerNameInput.value.trim().length > 0;
        createRoomBtn.disabled = !hasName || !clientState.selectedGameMode;
    });
    
    // Mode selection
    modeButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            modeButtons.forEach(b => b.classList.remove('selected'));
            btn.classList.add('selected');
            clientState.selectedGameMode = btn.dataset.mode;
            
            // Show/hide custom settings
            const customSettings = get('custom-settings');
            if (clientState.selectedGameMode === 'Custom') {
                customSettings.classList.remove('hidden');
            } else {
                customSettings.classList.add('hidden');
            }
            
            createRoomBtn.disabled = !playerNameInput.value.trim();
        });
    });
    
    // Create game
    createRoomBtn.addEventListener('click', () => {
        const name = playerNameInput.value.trim();
        if (!name || !clientState.selectedGameMode) return;
        
        myPlayerName = name;
        localStorage.setItem('qc_playerName', name);
        
        showToast('Starting offline adventure...', 'success');
        setTimeout(() => {
            switchScreen('menu-screen', 'game-screen');
            initializeClassSelection();
        }, 500);
    });
    
    // Legacy/achievements button
    get('goto-legacy-btn').addEventListener('click', () => {
        switchScreen('menu-screen', 'legacy-screen');
        renderLegacyScreen();
    });
    
    get('legacy-back-btn').addEventListener('click', () => {
        switchScreen('legacy-screen', 'menu-screen');
    });
}

// --- CLASS SELECTION ---
function initializeClassSelection() {
    const classes = [
        {
            name: 'Warrior',
            icon: '🗡️',
            description: 'Master of melee combat with high defense',
            stats: { str: 5, dex: 1, con: 4, int: 0, wis: 1, cha: 1 }
        },
        {
            name: 'Mage',
            icon: '🔮',
            description: 'Powerful spellcaster with arcane knowledge',
            stats: { str: 0, dex: 2, con: 2, int: 5, wis: 2, cha: 1 }
        },
        {
            name: 'Ranger',
            icon: '🏹',
            description: 'Expert marksman and tracker',
            stats: { str: 1, dex: 4, con: 3, int: 1, wis: 3, cha: 0 }
        },
        {
            name: 'Rogue',
            icon: '🗡',
            description: 'Agile and cunning, master of stealth',
            stats: { str: 1, dex: 5, con: 2, int: 2, wis: 0, cha: 3 }
        },
        {
            name: 'Cleric',
            icon: '✝️',
            description: 'Divine healer and support',
            stats: { str: 2, dex: 0, con: 3, int: 1, wis: 4, cha: 2 }
        },
        {
            name: 'Barbarian',
            icon: '⚔️',
            description: 'Fierce warrior with primal rage',
            stats: { str: 4, dex: 2, con: 4, int: 0, wis: 0, cha: 1 }
        }
    ];
    
    const container = get('character-sheet-block');
    container.innerHTML = `
        <div class="class-selection-container">
            <h2>Choose Your Hero</h2>
            <div class="class-grid">
                ${classes.map(cls => `
                    <div class="class-card" data-class="${cls.name}">
                        <div class="class-icon">${cls.icon}</div>
                        <h3>${cls.name}</h3>
                        <p>${cls.description}</p>
                        <div class="class-stats">
                            <span>STR: ${cls.stats.str}</span>
                            <span>DEX: ${cls.stats.dex}</span>
                            <span>CON: ${cls.stats.con}</span>
                            <span>INT: ${cls.stats.int}</span>
                            <span>WIS: ${cls.stats.wis}</span>
                            <span>CHA: ${cls.stats.cha}</span>
                        </div>
                    </div>
                `).join('')}
            </div>
            <button id="confirm-class-btn" class="btn btn-primary" disabled>Begin Adventure</button>
        </div>
    `;
    
    // Class selection handlers
    const classCards = container.querySelectorAll('.class-card');
    classCards.forEach(card => {
        card.addEventListener('click', () => {
            classCards.forEach(c => c.classList.remove('selected'));
            card.classList.add('selected');
            clientState.selectedClass = card.dataset.class;
            get('confirm-class-btn').disabled = false;
        });
    });
    
    get('confirm-class-btn').addEventListener('click', () => {
        if (!clientState.selectedClass) return;
        startOfflineGame();
    });
}

// --- START OFFLINE GAME ---
function startOfflineGame() {
    offlineEngine = new OfflineGameEngine();
    currentRoomState = offlineEngine.startOfflineGame(
        myPlayerName,
        clientState.selectedGameMode,
        clientState.selectedClass
    );
    
    // Basic telemetry events (no-op if disabled)
    if (window.telemetry && typeof window.telemetry.track === 'function') {
        window.telemetry.track('offline_game_started', {
            mode: clientState.selectedGameMode,
            cls: clientState.selectedClass
        });
    }

    clientState.gameStarted = true;
    showToast(`Welcome, ${myPlayerName} the ${clientState.selectedClass}!`, 'success');
    
    // Initialize game UI if not already done
    if (!gameUIInitialized) {
        initializeGameUI();
        gameUIInitialized = true;
    }
    
    // Render initial state
    renderGameState();
    
    // Auto-save every 30 seconds
    setInterval(() => {
        if (currentRoomState && currentRoomState.phase === 'playing') {
            gameSaveManager.save(currentRoomState);
        }
    }, 30000);
}

// --- INITIALIZE GAME UI ---
function initializeGameUI() {
    // Mobile navigation
    const navButtons = queryAll('.nav-btn');
    navButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            const screen = btn.dataset.screen;
            navButtons.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            
            queryAll('.mobile-screen').forEach(s => s.classList.remove('active'));
            get(`mobile-screen-${screen}`).classList.add('active');
        });
    });
    
    // Action buttons
    setupActionButton('action-guard-btn', () => performAction('guard'));
    setupActionButton('action-dodge-btn', () => performAction('dodge'));
    setupActionButton('action-dash-btn', () => performAction('dash'));
    setupActionButton('action-search-btn', () => performAction('search'));
    setupActionButton('action-brief-respite-btn', () => performAction('respite'));
    setupActionButton('action-full-rest-btn', () => performAction('rest'));
    setupActionButton('action-end-turn-btn', () => endTurn());
    
    // Leave game button
    setupClickHandler('leave-game-btn', leaveGame);
    setupClickHandler('mobile-leave-game-btn', leaveGame);
    
    // Help button
    setupClickHandler('help-btn', () => openModal('help-modal'));
    setupClickHandler('mobile-help-btn', () => openModal('help-modal'));
    setupClickHandler('help-close-btn', () => closeModal('help-modal'));
    
    // Menu toggle
    get('menu-toggle-btn').addEventListener('click', () => {
        get('menu-dropdown').classList.toggle('hidden');
    });
    
    get('mobile-menu-toggle-btn').addEventListener('click', () => {
        get('mobile-menu-dropdown').classList.toggle('hidden');
    });
}

function setupActionButton(btnId, callback) {
    const desktopBtn = document.querySelector(`[data-container="${btnId}"]`);
    if (desktopBtn) {
        desktopBtn.addEventListener('click', callback);
    }
}

function setupClickHandler(id, callback) {
    const elem = get(id);
    if (elem) elem.addEventListener('click', callback);
}

// --- GAME ACTIONS ---
function performAction(action) {
    if (!offlineEngine || !currentRoomState) return;
    
    if (window.telemetry && typeof window.telemetry.track === 'function') {
        window.telemetry.track('action', { name: action });
    }

    offlineEngine.performAction(action);
    currentRoomState = offlineEngine.getGameState();
    renderGameState();
}

function endTurn() {
    if (!offlineEngine || !currentRoomState) return;
    
    if (window.telemetry && typeof window.telemetry.track === 'function') {
        window.telemetry.track('end_turn', { turn: currentRoomState.turnCount || 0 });
    }

    offlineEngine.endTurn();
    currentRoomState = offlineEngine.getGameState();
    renderGameState();
    
    // Check for game over
    if (currentRoomState.phase === 'game_over') {
        showGameOver();
    }
}

function useItem(itemId) {
    if (!offlineEngine || !currentRoomState) return;
    
    offlineEngine.useItem(itemId);
    currentRoomState = offlineEngine.getGameState();
    renderGameState();
}

function attackMonster(monsterId) {
    if (!offlineEngine || !currentRoomState) return;
    
    const player = currentRoomState.players[myId];
    offlineEngine.performAttack(player.equippedWeapon?.id, monsterId);
    currentRoomState = offlineEngine.getGameState();
    renderGameState();
}

// --- RENDER GAME STATE ---
function renderGameState() {
    if (!currentRoomState || !currentRoomState.players) return;
    
    const player = currentRoomState.players[myId];
    if (!player) return;
    
    // Update player stats
    updatePlayerStats(player);
    
    // Update board (monsters)
    updateBoard();
    
    // Update hand
    updateHand(player);
    
    // Update equipment
    updateEquipment(player);
    
    // Update game log
    updateGameLog();
    
    // Update turn indicator
    updateTurnIndicator();
}

function updatePlayerStats(player) {
    const stats = player.stats;
    
    // Health bar
    const healthPct = (stats.currentHp / stats.maxHp) * 100;
    queryAll('[data-container="player-health-bar"]').forEach(bar => {
        bar.style.width = `${healthPct}%`;
    });
    queryAll('[data-container="player-health-text"]').forEach(text => {
        text.textContent = `${stats.currentHp} / ${stats.maxHp}`;
    });
    
    // AP bar
    const apPct = (player.currentAp / 3) * 100;
    queryAll('[data-container="player-ap-bar"]').forEach(bar => {
        bar.style.width = `${apPct}%`;
    });
    queryAll('[data-container="player-ap-text"]').forEach(text => {
        text.textContent = `${player.currentAp} / 3`;
    });
    
    // XP bar
    const xpPct = (stats.xp % 100) / 100 * 100;
    queryAll('[data-container="player-xp-bar"]').forEach(bar => {
        bar.style.width = `${xpPct}%`;
    });
    queryAll('[data-container="player-xp-text"]').forEach(text => {
        text.textContent = `Level ${stats.level} (${stats.xp % 100}/100)`;
    });
    
    // Show resource containers
    queryAll('[data-container="player-resources"]').forEach(el => {
        el.classList.remove('hidden');
    });
}

function updateBoard() {
    const monsters = currentRoomState.board.monsters;
    const container = document.querySelector('[data-container="board-cards"]');
    if (!container) return;
    
    container.innerHTML = monsters.map(monster => `
        <div class="card monster-card" data-monster-id="${monster.id}" onclick="attackMonster('${monster.id}')">
            <div class="card-header">
                <h3>${monster.name}</h3>
            </div>
            <div class="card-body">
                <div class="monster-stats">
                    <div class="stat-line">HP: ${monster.currentHp}/${monster.maxHp}</div>
                    <div class="stat-line">AC: ${monster.ac}</div>
                    <div class="stat-line">DMG: ${monster.damage}</div>
                </div>
            </div>
            <div class="card-footer">
                <button class="btn btn-sm btn-danger">Attack</button>
            </div>
        </div>
    `).join('');
}

function updateHand(player) {
    const containers = queryAll('[data-container="player-hand"]');
    containers.forEach(container => {
        container.innerHTML = player.hand.map(card => `
            <div class="card item-card" data-card-id="${card.id}" onclick="useItem('${card.id}')">
                <div class="card-header">
                    <h3>${card.name}</h3>
                    <span class="card-type">${card.type}</span>
                </div>
                <div class="card-body">
                    <p>${card.effect.description}</p>
                </div>
                <div class="card-footer">
                    <button class="btn btn-sm btn-primary">Use (1 AP)</button>
                </div>
            </div>
        `).join('');
    });
}

function updateEquipment(player) {
    const containers = queryAll('[data-container="equipped-items"]');
    const equipment = [player.equippedWeapon, player.equippedArmor].filter(Boolean);
    
    containers.forEach(container => {
        container.innerHTML = equipment.map(item => `
            <div class="card equipment-card">
                <div class="card-header">
                    <h3>${item.name}</h3>
                    <span class="card-type">${item.type}</span>
                </div>
                <div class="card-body">
                    <p>${item.effect.description}</p>
                </div>
            </div>
        `).join('');
    });
}

function updateGameLog() {
    const logs = currentRoomState.chatLog || [];
    const containers = queryAll('[data-container="game-log"]');
    
    containers.forEach(container => {
        container.innerHTML = logs.slice(-20).reverse().map(log => `
            <div class="log-entry log-${log.type}">
                ${log.playerName ? `<strong>${escapeHtml(log.playerName)}:</strong> ` : ''}
                ${escapeHtml(log.text)}
            </div>
        `).join('');
    });
}

function updateTurnIndicator() {
    const text = `Your Turn`;
    queryAll('[data-container="turn-indicator"]').forEach(el => {
        el.textContent = text;
    });
    
    queryAll('[data-container="turn-counter"]').forEach(el => {
        el.textContent = currentRoomState.turnCount || 0;
    });
}

// --- GAME OVER ---
function showGameOver() {
    const player = currentRoomState.players[myId];
    const xpEarned = player.stats.xp;
    const monstersKilled = currentRoomState.monstersKilled || 0;
    
    if (window.telemetry && typeof window.telemetry.track === 'function') {
        window.telemetry.track('game_over', {
            turns: currentRoomState.turnCount || 0,
            monstersKilled,
            xpEarned
        });
        window.telemetry.flush('post_game_over');
    }

    accountManager.addXp(xpEarned);
    accountManager.recordGameEnd(currentRoomState.turnCount, monstersKilled, false);
    
    get('game-over-message').textContent = 'You have fallen in battle!';
    get('game-over-run-xp').textContent = xpEarned;
    get('game-over-bonus-xp').textContent = Math.floor(currentRoomState.turnCount / 2);
    get('game-over-total-xp').textContent = xpEarned + Math.floor(currentRoomState.turnCount / 2);
    
    openModal('game-over-modal');
    
    get('game-over-leave-btn').onclick = () => {
        gameSaveManager.clear();
        switchScreen('game-screen', 'menu-screen');
        closeModal('game-over-modal');
    };
}

function leaveGame() {
    if (confirm('Are you sure you want to leave? Your progress will be saved.')) {
        if (currentRoomState) {
            gameSaveManager.save(currentRoomState);
        }
        switchScreen('game-screen', 'menu-screen');
    }
}

// --- UTILITY FUNCTIONS ---
function switchScreen(fromScreen, toScreen) {
    const screens = queryAll('.screen');
    screens.forEach(s => s.classList.remove('active'));
    get(toScreen).classList.add('active');
}

function openModal(modalId) {
    const modal = get(modalId);
    if (modal) modal.classList.remove('hidden');
}

function closeModal(modalId) {
    const modal = get(modalId);
    if (modal) modal.classList.add('hidden');
}

function renderLegacyScreen() {
    get('legacy-xp-total').textContent = accountManager.data.xp;
    // Add more legacy rendering here
}

// --- INITIALIZATION ---
document.addEventListener('DOMContentLoaded', () => {
    console.log('[Offline Game] Initializing...');
    accountManager.load();
    initMenuScreen();
    
    // Check for saved game
    const savedGame = gameSaveManager.load();
    if (savedGame) {
        // TODO: Implement resume functionality
        console.log('[Offline Game] Found saved game');
    }
    
    // Hide connection status
    const connStatus = get('connection-status');
    if (connStatus) connStatus.style.display = 'none';
    
    console.log('[Offline Game] Ready to play!');
    // Show onboarding once for offline standalone
    try {
        const overlay = document.getElementById('onboarding-overlay');
        const closeBtn = document.getElementById('onboarding-close-btn');
        const dontShowChk = document.getElementById('onboarding-dont-show');
        const hasSeen = localStorage.getItem('qc_onboarding_seen_v1') === 'true';
        if (overlay && closeBtn && dontShowChk && !hasSeen) {
            overlay.classList.remove('hidden');
            closeBtn.addEventListener('click', () => {
                overlay.classList.add('hidden');
                if (dontShowChk.checked) localStorage.setItem('qc_onboarding_seen_v1', 'true');
                if (window.telemetry?.track) window.telemetry.track('onboarding_dismissed', { offline: true, dontShow: !!dontShowChk.checked });
            });
        }
    } catch (_) {}
});

