/** Client build label — bump with package.json / README. */
const QC_VERSION = '4.2.4';

/**
 * Verbose client logs (voice, socket, grid, load game, etc.).
 * Enable: `localStorage.setItem('qc_debug','1')` then refresh; disable: removeItem.
 */
function qcDebug(...args) {
    try {
        if (typeof localStorage !== 'undefined' && localStorage.getItem('qc_debug') === '1') {
            console.log(...args);
        }
    } catch (_) { /* ignore */ }
}

function initQcAboutLines() {
    const label = `Quest & Chronicle · v${QC_VERSION}`;
    try {
        document.querySelectorAll('.qc-about-line').forEach((el) => { el.textContent = label; });
    } catch (_) { /* ignore */ }
}

// --- SHOP UI HANDLERS ---
function renderShopInventory(inventory, shopId, stateOverride = null) {
    const inv = get('shop-inventory');
    if (!inv) return;
    inv.dataset.shopId = shopId || inv.dataset.shopId || '';
    inv.innerHTML = '';
    const state = stateOverride || currentRoomState;
    const myPlayer = state?.players?.[myId];

    const goldLine = document.createElement('div');
    goldLine.className = 'shop-gold';
    goldLine.textContent = `Gold: ${myPlayer?.gold ?? 0}`;
    inv.appendChild(goldLine);

    inventory.forEach((card) => {
        const row = document.createElement('div');
        row.className = 'shop-row';
        if (card.rarityKey) row.classList.add(`rarity-${(card.rarityKey || '').toLowerCase()}`);

        const rarityTag = card.rarity || (card.rarityKey ? card.rarityKey.charAt(0).toUpperCase() + card.rarityKey.slice(1) : 'Common');
        const safeType = escapeHtml(card.type || 'Item');
        const safeName = escapeHtml(card.name || 'Unknown');

        // CRITICAL FIX: Show more item details directly in the shop
        const effectText = card.effect?.description || card.effect?.dice || '';
        const apCostText = card.apCost ? ` • ${card.apCost} AP` : '';
        const damageText = card.effect?.dice ? ` • ${card.effect.dice} damage` : '';
        
        row.innerHTML = `
            <div class="shop-item">
                <span class="rarity-badge rarity-${(card.rarityKey || 'common').toLowerCase()}" title="${escapeHtml(rarityTag)}"></span>
                <div class="shop-item-text">
                    <div class="shop-item-name">${safeName}</div>
                    <div class="shop-item-meta">${safeType}${card.level ? ` • L${card.level}` : ''}${apCostText}${damageText}</div>
                    ${effectText ? `<div class="shop-item-effect">${escapeHtml(effectText)}</div>` : ''}
                </div>
            </div>
            <div class="shop-price">${card.price}g</div>
            <div class="shop-actions">
                <button class="btn btn-icon btn-sm shop-inspect-btn" title="Full Details" aria-label="Item details"><span class="material-symbols-outlined">search</span></button>
                <button class="btn btn-secondary btn-sm shop-buy-btn">Buy</button>
            </div>
        `;

        const buyBtn = row.querySelector('.shop-buy-btn');
        const inspectBtn = row.querySelector('.shop-inspect-btn');

        // Disable buy if insufficient gold
        const price = Number(card.price) || 0;
        const canAfford = (myPlayer?.gold ?? 0) >= price;
        if (!canAfford) buyBtn.setAttribute('disabled', 'true');

        buyBtn.addEventListener('click', () => {
            const sid = inv.dataset.shopId;
            buyBtn.setAttribute('disabled', 'true');
            try { SoundManager.play('buttonClick'); } catch (_) {}
            if (typeof OfflineActionHandler !== 'undefined' && OfflineActionHandler.isOffline()) {
                OfflineActionHandler.handleAction('buyItem', { cardId: card.id, price: card.price, shopId: sid });
                buyBtn.removeAttribute('disabled');
            } else {
                socket.emit('playerAction', { action: 'buyItem', cardId: card.id, price: card.price, shopId: sid });
            }
        });
        inspectBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            try { SoundManager.play('buttonClick'); } catch (_) {}
            showCardInspectorModal(card.id);
        });

        inv.appendChild(row);
    });
}

// NOTE: Shop socket handlers are registered after socket initialization below
// REFACTORED: Quest & Chronicle Client-Side Logic (v8.0.0)
// This file has been refactored for stability, maintainability, and clarity.
// The core unidirectional data flow model remains, but with significant code cleanup.

// --- 1. GLOBAL SETUP & STATE ---
// Socket.IO - gracefully handle offline mode
let socket;
try {
    socket = io({ 
        timeout: 5000,
        reconnection: true,
        reconnectionDelay: 1000,
        reconnectionAttempts: 3
    });
} catch (e) {
    qcDebug('[Socket] Failed to initialize, running in offline mode');
    socket = { 
        emit: () => {}, 
        on: () => {},
        connected: false 
    };
}
let myId = '';
let myPlayerName = '';
let currentRoomState = {}; // The single, authoritative copy of the game state.
let gameUIInitialized = false; // Flag to ensure game listeners are only attached once.
let offlineMode = {
    enabled: false,
    userChoice: null,
    enable() { this.enabled = true; },
    disable() { this.enabled = false; },
    setUserChoice(choice) { this.userChoice = choice; },
    isEnabled() { return this.enabled; }
};

// Sprite manifest loaded at runtime for DPR-aware resolution
let spriteManifest = null;
async function loadSpriteManifest() {
    try {
        const res = await fetch('/assets/sprites/sprite-manifest.json', { cache: 'no-store' });
        if (!res.ok) return;
        spriteManifest = await res.json();
    } catch (_) {
        spriteManifest = null;
    }
}

// Consolidated client-side state to prevent bugs from scattered global variables.
const clientState = {
    selectedGameMode: null, // For the menu screen
    selectedWeaponId: null, // For targeting UI
    selectedHandCardId: null, // For mobile card selection
    currentRollData: null,  // Holds data for an active roll modal
    activeItem: null,       // For modals needing item context (e.g., claiming loot)
    diceAnimationInterval: null,
    rollModalCloseTimeout: null,
    rollResponseTimeout: null,
    activeSpectatorToast: null, // Holds the element for the animated spectator toast
    spectatorToastTimeout: null, // For the new spectator roll toast
    helpModalPage: 0,
    isFirstTurnTutorialActive: false,
    hasSeenSkillChallengePrompt: false, // Prevents re-opening the modal
    lastLogLength: 0, // For tracking new log entries for toasts
    activeLegacyClassTab: 'Barbarian', // Default tab for the legacy screen
    turnPopupReady: false, // Mirrored from game state in renderGameplayState (your turn + not paused)
    selectedLevelUpStat: null,
    hasShownEndTurnPrompt: false,
    toastQueue: [],
    toastQueueTimer: null,
    endTurnPromptTimer: null,
};

// --- HELPERS ---
const get = (id) => document.getElementById(id);
const queryAll = (selector) => document.querySelectorAll(selector);

/** Parse die face count from notation: d20, D20, 1d8, 3d6 (uses first dN). Defaults to 20. Keep rules aligned with lib/qc-dice.cjs `parseDiceSides`. */
function parseDiceSides(diceString) {
    if (diceString == null || diceString === '') return 20;
    const m = String(diceString).trim().match(/d(\d+)/i);
    if (m) {
        const n = parseInt(m[1], 10);
        return Number.isFinite(n) && n > 0 ? n : 20;
    }
    const plain = parseInt(String(diceString), 10);
    return Number.isFinite(plain) && plain > 0 ? plain : 20;
}

function clearDiceRollAnimationAndPendingTimeout() {
    if (clientState.diceAnimationInterval != null) {
        clearInterval(clientState.diceAnimationInterval);
        clientState.diceAnimationInterval = null;
    }
    if (clientState.rollResponseTimeout != null) {
        clearTimeout(clientState.rollResponseTimeout);
        clientState.rollResponseTimeout = null;
    }
}

/** Full teardown when closing the dice modal (timers, pending roll payload). */
function dismissDiceRollModal() {
    if (clientState.rollModalCloseTimeout != null) {
        clearTimeout(clientState.rollModalCloseTimeout);
        clientState.rollModalCloseTimeout = null;
    }
    clearDiceRollAnimationAndPendingTimeout();
    const modal = get('dice-roll-modal');
    if (modal) modal.classList.add('hidden');
    clientState.currentRollData = null;
}

/** Auto-hide after showing a resolved roll; replaces any previous scheduled hide. */
function scheduleDiceRollModalHide(delayMs) {
    if (clientState.rollModalCloseTimeout != null) {
        clearTimeout(clientState.rollModalCloseTimeout);
        clientState.rollModalCloseTimeout = null;
    }
    clientState.rollModalCloseTimeout = setTimeout(() => {
        clientState.rollModalCloseTimeout = null;
        dismissDiceRollModal();
    }, delayMs);
}

const escapeHtml = (unsafe) => {
    if (typeof unsafe !== 'string') return '';
    return unsafe.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
};

// --- NOTIFICATION MANAGER (Best-Practice Orchestrator) ---
const NOTIFICATION_PRIORITY = { normal: 1, important: 2, critical: 3 };

/** Visible `.modal-overlay` IDs that must NOT block turn unlock / toast queue (reference UI only). */
const NON_BLOCKING_UI_IDS = new Set(['combat-grid-modal']);

/** Max wait for blocking UI to clear before forcing turn banners / prompts (prevents infinite stall). */
const UI_GATE_MAX_WAIT_MS = 15000;

/**
 * Runs callback when NotificationManager reports UI is ungated.
 * If still gated after maxWaitMs, calls onForcedRun (optional) then callback anyway.
 */
function runWhenUngated(callback, options = {}) {
    const intervalMs = options.intervalMs ?? 200;
    const maxWaitMs = options.maxWaitMs ?? UI_GATE_MAX_WAIT_MS;
    const onForcedRun = options.onForcedRun;
    const deadline = Date.now() + maxWaitMs;
    const tick = () => {
        if (!NotificationManager.isGated()) {
            callback();
            return;
        }
        if (Date.now() >= deadline) {
            console.warn('[UIGate] Timed out waiting for clear UI; continuing.');
            if (typeof onForcedRun === 'function') onForcedRun();
            callback();
            return;
        }
        setTimeout(tick, intervalMs);
    };
    tick();
}

const NotificationManager = {
    queue: [],
    maxQueue: 6,
    recentMap: new Map(), // key -> expiresAt
    dedupWindowMs: 5000,
    processing: false,
    gatingState: {
        diceOpen: false,
        yourTurnVisible: false,
        spectatorActive: false,
    },
    init() {
        // Observe dice modal visibility
        const dice = get('dice-roll-modal');
        if (dice) {
            const obs = new MutationObserver(() => {
                this.gatingState.diceOpen = !dice.classList.contains('hidden');
                this.process();
            });
            obs.observe(dice, { attributes: true, attributeFilter: ['class'] });
            this.gatingState.diceOpen = !dice.classList.contains('hidden');
        }
        // Observe YOUR TURN popup
        const yt = get('your-turn-popup');
        if (yt) {
            const obs = new MutationObserver(() => {
                this.gatingState.yourTurnVisible = !yt.classList.contains('hidden');
                this.process();
            });
            obs.observe(yt, { attributes: true, attributeFilter: ['class'] });
            this.gatingState.yourTurnVisible = !yt.classList.contains('hidden');
        }
        // Observe spectator roll toast container
        const spec = get('spectator-roll-toast-container');
        if (spec) {
            const obs = new MutationObserver(() => {
                this.gatingState.spectatorActive = spec.querySelector('.spectator-roll-toast') != null;
                this.process();
            });
            obs.observe(spec, { childList: true, subtree: true });
            this.gatingState.spectatorActive = spec.querySelector('.spectator-roll-toast') != null;
        }
        // Kick processing in case items queued early
        setTimeout(() => this.process(), 0);
    },
    /** True if a blocking modal/backdrop is visible (excludes NON_BLOCKING_UI_IDS overlays). */
    isBlockingModalOpen() {
        for (const el of document.querySelectorAll('.modal-overlay:not(.hidden)')) {
            if (NON_BLOCKING_UI_IDS.has(el.id)) continue;
            qcDebug('ModalCheck blocking overlay:', el.id || '(no id)');
            return true;
        }
        if (document.querySelector('.modal-backdrop:not(.hidden)')) {
            qcDebug('ModalCheck blocking: .modal-backdrop');
            return true;
        }
        return false;
    },
    
    // CRITICAL FIX: Pause game when modals open to prevent overlapping prompts
    pauseGameForModal(modalType) {
        if (typeof socket !== 'undefined' && socket.connected) {
            qcDebug('ModalPause:', modalType);
            socket.emit('pauseGameForModal', { modalType });
        }
    },
    
    resumeGameFromModal(modalType) {
        if (typeof socket !== 'undefined' && socket.connected) {
            qcDebug('ModalResume:', modalType);
            socket.emit('resumeGameFromModal', { modalType });
        }
    },
    typeToPriority(type) {
        if (type === 'error' || type === 'warning') return NOTIFICATION_PRIORITY.critical;
        if (type === 'success') return NOTIFICATION_PRIORITY.important;
        return NOTIFICATION_PRIORITY.normal;
    },
    makeKey(message, type) {
        return `${type}::${message}`;
    },
    notify(message, type = 'info', duration = 3000, options = {}) {
        const priority = options.priority || this.typeToPriority(type);
        const key = this.makeKey(String(message).trim(), type);
        const now = Date.now();
        const existingExpiry = this.recentMap.get(key);
        if (existingExpiry && existingExpiry > now) {
            // Coalesce duplicates
            qcDebug('NotificationManager duplicate blocked:', message);
            return;
        }
        this.recentMap.set(key, now + this.dedupWindowMs);
        // Trim expired recent keys occasionally
        if (this.recentMap.size > 64) {
            for (const [k, exp] of this.recentMap.entries()) if (exp <= now) this.recentMap.delete(k);
        }
        // Backpressure: drop lowest-priority item if over capacity
        if (this.queue.length >= this.maxQueue) {
            let idxToDrop = -1;
            let minPriority = Infinity;
            for (let i = this.queue.length - 1; i >= 0; i--) {
                if (this.queue[i].priority < minPriority) {
                    minPriority = this.queue[i].priority;
                    idxToDrop = i;
                }
            }
            if (idxToDrop >= 0 && priority >= minPriority) {
                qcDebug('NotificationManager drop low-priority:', this.queue[idxToDrop].message);
                this.queue.splice(idxToDrop, 1);
            } else if (idxToDrop >= 0) {
                qcDebug('NotificationManager new dropped (lower priority):', message);
                return; // New item is lower, drop it
            }
        }
        this.queue.push({ message, type, duration, priority, createdAt: now, key });
        // Sort: higher priority first, FIFO within same priority
        this.queue.sort((a, b) => b.priority - a.priority || a.createdAt - b.createdAt);
        qcDebug('NotificationManager queued:', message, 'priority', priority, 'qlen', this.queue.length);
        // Preempt: critical can show even if gated
        if (priority === NOTIFICATION_PRIORITY.critical) {
            qcDebug('NotificationManager critical bypass:', message);
            this.showNow({ message, type, duration });
            return;
        }
        this.process();
    },
    isGated() {
        // Gate NORMAL/IMPORTANT toasts while modals/rolls/your-turn/spectator are active
        // CRITICAL FIX: Allow critical notifications to bypass gating
        return this.isBlockingModalOpen() || this.gatingState.diceOpen || this.gatingState.yourTurnVisible || this.gatingState.spectatorActive;
    },
    
    isGatedForPriority(priority) {
        // CRITICAL FIX: Only gate normal/important notifications, allow critical through
        if (priority === NOTIFICATION_PRIORITY.critical) {
            return false;
        }
        return this.isGated();
    },
    process() {
        if (this.processing) {
            qcDebug('NotificationManager already processing, skip');
            return;
        }
        if (this.queue.length === 0) {
            qcDebug('NotificationManager queue empty');
            return;
        }
        
        // CRITICAL FIX: Check gating based on priority
        const next = this.queue[0]; // Peek at next item without removing
        if (this.isGatedForPriority(next.priority)) {
            qcDebug('NotificationManager gated priority', next.priority, 'retry 200ms');
            // Try again soon after UI changes
            this.processing = true;
            setTimeout(() => { this.processing = false; this.process(); }, 200);
            return;
        }
        
        this.queue.shift(); // Now remove the item
        qcDebug('NotificationManager show:', next.message, 'p', next.priority);
        this.showNow(next);
    },
    showNow({ message, type, duration }) {
        const container = get('toast-container');
        if (!container) return;
        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;
        // A11y: assertive for errors/warnings, polite otherwise
        const assertive = (type === 'error' || type === 'warning');
        toast.setAttribute('role', assertive ? 'alert' : 'status');
        toast.setAttribute('aria-live', assertive ? 'assertive' : 'polite');
        toast.setAttribute('aria-atomic', 'true');
        const cleanMessage = String(message)
            .replace(/<[^>]*>/g, '')
            .replace(/&[a-z]+;/gi, ' ')
            .replace(/[\uD800-\uDFFF]./g, '')
            .replace(/\s+/g, ' ')
            .trim();
        toast.textContent = cleanMessage;
        container.appendChild(toast);
        // When this toast leaves, resume processing
        const finish = () => {
            toast.classList.remove('visible');
            toast.addEventListener('transitionend', () => {
                if (toast.parentElement) toast.remove();
                this.processing = false;
                this.process();
            }, { once: true });
        };
        setTimeout(() => toast.classList.add('visible'), 10);
        // Longer durations for success/info when queue is light, otherwise keep requested
        const dur = duration;
        this.processing = true;
        setTimeout(finish, dur);
    }
};

// --- ACCOUNT MANAGER (Persistent Progression) ---
const accountManager = {
    data: {
        xp: 0,
        essence: 0,
        upgrades: {},
        unlockedLegacyItems: [],
        savedLoadouts: [],
        achievements: {},
        metaPerks: {},
        stats: {
            monstersDefeated: 0,
            bossesDefeated: 0,
            dungeonsCompleted: 0,
            multiplayerRuns: 0,
            legendaryItemsFound: 0,
            synergiesTriggered: 0,
            flankingBonuses: 0,
            gamesPlayed: 0,
            highestRound: 0,
            fastestRun: Infinity
        }
    },

    achievementDefs: {
        firstBlood:    { name: 'First Blood',       description: 'Defeat your first monster',        icon: 'swords',        reward: 10,  check: s => s.monstersDefeated >= 1 },
        slayer:        { name: 'Monster Slayer',     description: 'Defeat 50 monsters',              icon: 'skull',         reward: 50,  check: s => s.monstersDefeated >= 50 },
        legendary:     { name: 'Legendary Hunter',   description: 'Find 5 legendary items',          icon: 'diamond',       reward: 100, check: s => s.legendaryItemsFound >= 5 },
        tactician:     { name: 'Tactician',          description: 'Trigger 10 synergies',            icon: 'auto_awesome',  reward: 25,  check: s => s.synergiesTriggered >= 10 },
        masterFlanker: { name: 'Master Flanker',     description: 'Get 50 flanking bonuses',         icon: 'target',        reward: 75,  check: s => s.flankingBonuses >= 50 },
        survivor:      { name: 'Survivor',           description: 'Complete 10 dungeons',            icon: 'shield_person', reward: 100, check: s => s.dungeonsCompleted >= 10 },
        bossSlayer:    { name: 'Boss Slayer',        description: 'Defeat your first boss',          icon: 'castle',        reward: 200, check: s => s.bossesDefeated >= 1 },
        teamPlayer:    { name: 'Team Player',        description: 'Complete 5 multiplayer runs',     icon: 'groups',        reward: 75,  check: s => s.multiplayerRuns >= 5 },
        veteran:       { name: 'Veteran',            description: 'Play 25 games',                   icon: 'military_tech', reward: 50,  check: s => s.gamesPlayed >= 25 },
    },

    metaPerkDefs: {
        startingGold:    { name: 'Wealthy Start',     description: 'Start with +50 gold',       icon: 'paid',       cost: 50,  tier: 1 },
        extraHp:         { name: 'Vitality',           description: 'Start with +5 max HP',      icon: 'favorite',   cost: 50,  tier: 1 },
        luckyStart:      { name: 'Lucky Charm',        description: '+5% loot rarity',           icon: 'casino',     cost: 50,  tier: 1 },
        fastLearner:     { name: 'Fast Learner',       description: '+10% XP gain',              icon: 'school',     cost: 100, tier: 2 },
        combatant:       { name: 'Combat Training',    description: '+1 damage',                 icon: 'swords',     cost: 100, tier: 2 },
        masterTactician: { name: 'Master Tactician',   description: 'Synergies +50% stronger',   icon: 'psychology', cost: 200, tier: 3 },
        criticalExpert:  { name: 'Critical Expert',    description: '+5% crit chance',           icon: 'emergency',  cost: 200, tier: 3 },
    },

    load() {
        try {
            const savedData = localStorage.getItem('qc_accountData');
            if (savedData) {
                const parsed = JSON.parse(savedData);
                this.data = {
                    ...this.data,
                    ...parsed,
                    stats: { ...this.data.stats, ...(parsed.stats || {}) },
                    achievements: parsed.achievements || {},
                    metaPerks: parsed.metaPerks || {},
                };
                this.data.unlockedLegacyItems = this.data.unlockedLegacyItems || [];
                this.data.savedLoadouts = this.data.savedLoadouts || [];
            }
        } catch (e) {
            console.error("Failed to load account data:", e);
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

    getUpgradeCost(className, stat) {
        const currentLevel = this.data.upgrades[className]?.[stat] || 0;
        return 25 * (currentLevel + 1); // e.g., 25, 50, 75...
    },

    purchaseUpgrade(className, stat) {
        const cost = this.getUpgradeCost(className, stat);
        if (this.data.xp >= cost) {
            this.data.xp -= cost;
            if (!this.data.upgrades[className]) {
                this.data.upgrades[className] = {};
            }
            this.data.upgrades[className][stat] = (this.data.upgrades[className][stat] || 0) + 1;
            this.save();
            showToast(`Upgraded ${className} ${stat.toUpperCase()}!`, 'success');
            return true;
        }
        showToast("Not enough XP for that upgrade.", 'error');
        return false;
    },

    saveLoadout(currentPlayer) {
        if (!currentPlayer) return;
        const loadout = {
            class: currentPlayer.class,
            equipment: currentPlayer.equipment,
            timestamp: Date.now()
        };
        this.data.savedLoadouts.push(loadout);
        this.save();
        showToast('Loadout saved to account.', 'success');
    },
    applyLoadout(slotIndex) {
        const loadout = this.data.savedLoadouts[slotIndex];
        if (!loadout) {
            showToast('No loadout in that slot.', 'error');
            return false;
        }
        showToast(`Applied loadout for ${loadout.class}.`, 'info');
        return true;
    },

    trackStat(statName, amount = 1) {
        if (!this.data.stats) this.data.stats = {};
        this.data.stats[statName] = (this.data.stats[statName] || 0) + amount;
        this.checkAchievements();
        this.save();
    },

    recordRunEnd(turnCount, monstersKilled, victory, isMultiplayer) {
        this.data.stats.gamesPlayed = (this.data.stats.gamesPlayed || 0) + 1;
        this.data.stats.monstersDefeated = (this.data.stats.monstersDefeated || 0) + monstersKilled;
        if (turnCount > (this.data.stats.highestRound || 0)) {
            this.data.stats.highestRound = turnCount;
        }
        if (victory) {
            this.data.stats.dungeonsCompleted = (this.data.stats.dungeonsCompleted || 0) + 1;
        }
        if (isMultiplayer) {
            this.data.stats.multiplayerRuns = (this.data.stats.multiplayerRuns || 0) + 1;
        }
        this.checkAchievements();
        this.save();
    },

    checkAchievements() {
        const newlyUnlocked = [];
        for (const [id, def] of Object.entries(this.achievementDefs)) {
            if (this.data.achievements[id]) continue;
            if (def.check(this.data.stats)) {
                this.data.achievements[id] = { unlockedAt: Date.now() };
                this.data.essence = (this.data.essence || 0) + def.reward;
                newlyUnlocked.push(def);
            }
        }
        if (newlyUnlocked.length > 0) {
            this.save();
            for (const ach of newlyUnlocked) {
                showToast(`Achievement Unlocked: ${ach.name}! (+${ach.reward} Essence)`, 'success', 5000);
            }
        }
        return newlyUnlocked;
    },

    purchaseMetaPerk(perkId) {
        const def = this.metaPerkDefs[perkId];
        if (!def) return false;
        if (this.data.metaPerks[perkId]) {
            showToast('Already unlocked!', 'info');
            return false;
        }
        if ((this.data.essence || 0) < def.cost) {
            showToast(`Not enough Essence. Need ${def.cost}, have ${this.data.essence || 0}.`, 'error');
            return false;
        }
        this.data.essence -= def.cost;
        this.data.metaPerks[perkId] = { unlockedAt: Date.now() };
        this.save();
        showToast(`Unlocked: ${def.name}!`, 'success');
        return true;
    },

    getActiveMetaPerks() {
        const active = {};
        for (const [id, perkData] of Object.entries(this.data.metaPerks || {})) {
            if (perkData && this.metaPerkDefs[id]) {
                active[id] = this.metaPerkDefs[id];
            }
        }
        return active;
    }
};

// --- VOICE CHAT MANAGER ---
const voiceChatManager = {
    localStream: null,
    peers: {}, // { socketId: RTCPeerConnection }
    audioContainer: null,

    async join() {
        if (this.localStream) return;
        try {
            qcDebug('[VC] Attempting to join voice chat...');
            this.localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
            qcDebug('[VC] Microphone access granted.');
            get('join-voice-btn').classList.add('hidden');
            get('mobile-join-voice-btn').classList.add('hidden');
            get('mute-voice-btn').classList.remove('hidden');
            get('leave-voice-btn').classList.remove('hidden');
            get('mobile-mute-voice-btn').classList.remove('hidden');
            get('mobile-leave-voice-btn').classList.remove('hidden');

            this.audioContainer = get('voice-chat-audio-container');
            socket.emit('join-voice-chat');
            qcDebug('[VC] Emitted join-voice-chat.');
        } catch (err) {
            showToast('Microphone access denied.', 'error');
            console.error('[VC] Error accessing microphone:', err);
        }
    },

    leave() {
        if (!this.localStream) return;
        qcDebug('[VC] Leaving voice chat.');
        socket.emit('leave-voice-chat');

        this.localStream.getTracks().forEach(track => track.stop());
        this.localStream = null;

        for (const peerId in this.peers) {
            this.peers[peerId].close();
        }
        this.peers = {};
        if (this.audioContainer) this.audioContainer.innerHTML = '';
        qcDebug('[VC] Local stream and peer connections closed.');

        get('join-voice-btn').classList.remove('hidden');
        get('mobile-join-voice-btn').classList.remove('hidden');
        get('mute-voice-btn').classList.add('hidden');
        get('leave-voice-btn').classList.add('hidden');
        get('mobile-mute-voice-btn').classList.add('hidden');
        get('mobile-leave-voice-btn').classList.add('hidden');
    },

    toggleMute() {
        if (!this.localStream) return;
        const enabled = !this.localStream.getAudioTracks()[0].enabled;
        this.localStream.getAudioTracks()[0].enabled = enabled;
        qcDebug(`[VC] Toggled mute. Mic enabled: ${enabled}`);
        const muteBtn = get('mute-voice-btn');
        const mobileMuteBtn = get('mobile-mute-voice-btn');
        muteBtn.innerHTML = enabled ? `<span class="material-symbols-outlined">mic_off</span>Mute` : `<span class="material-symbols-outlined">mic</span>Unmute`;
        mobileMuteBtn.innerHTML = enabled ? `<span class="material-symbols-outlined">mic_off</span>Mute` : `<span class="material-symbols-outlined">mic</span>Unmute`;
    },

    addPeer(peerId, isInitiator) {
        if (this.peers[peerId]) {
            qcDebug(`[VC] Peer connection already exists for ${peerId}.`);
            return;
        }
        qcDebug(`[VC] Adding peer ${peerId}. Initiator: ${isInitiator}`);
        const peer = new RTCPeerConnection({
            iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
        });
        this.peers[peerId] = peer;

        this.localStream.getTracks().forEach(track => {
            peer.addTrack(track, this.localStream);
        });
        qcDebug(`[VC] Added local stream tracks to peer ${peerId}.`);

        peer.onicecandidate = (event) => {
            if (event.candidate) {
                qcDebug(`[VC] Sending ICE candidate to ${peerId}.`);
                socket.emit('webrtc-signal', { to: peerId, signal: { candidate: event.candidate } });
            }
        };

        peer.ontrack = (event) => {
            qcDebug(`[VC] Received remote track from ${peerId}.`);
            let audioEl = get(`audio-${peerId}`);
            if (!audioEl) {
                audioEl = document.createElement('audio');
                audioEl.id = `audio-${peerId}`;
                audioEl.autoplay = true;
                this.audioContainer.appendChild(audioEl);
                qcDebug(`[VC] Created audio element for ${peerId}.`);
            }
            audioEl.srcObject = event.streams[0];
        };

        if (isInitiator) {
            peer.onnegotiationneeded = async () => {
                try {
                    qcDebug(`[VC] Negotiation needed for ${peerId}. Creating offer...`);
                    const offer = await peer.createOffer();
                    await peer.setLocalDescription(offer);
                    qcDebug(`[VC] Sending offer to ${peerId}.`);
                    socket.emit('webrtc-signal', { to: peerId, signal: { sdp: peer.localDescription } });
                } catch (err) { console.error(`[VC] Error creating offer for ${peerId}:`, err); }
            };
        }
    },

    removePeer(peerId) {
        if (this.peers[peerId]) {
            qcDebug(`[VC] Removing peer ${peerId}.`);
            this.peers[peerId].close();
            delete this.peers[peerId];
        }
        const audioEl = get(`audio-${peerId}`);
        if (audioEl) audioEl.remove();
    },

    async handleSignal({ from, signal }) {
        qcDebug(`[VC] Received signal from ${from}.`);
        let peer = this.peers[from];
        if (!peer) {
            qcDebug(`[VC] Peer for ${from} not found, creating new peer connection.`);
            this.addPeer(from, false);
            peer = this.peers[from];
        }
        
        try {
            if (signal.sdp) {
                qcDebug(`[VC] Setting remote description for ${from}.`);
                await peer.setRemoteDescription(new RTCSessionDescription(signal.sdp));
                if (signal.sdp.type === 'offer') {
                    qcDebug(`[VC] Signal from ${from} was an offer. Creating answer...`);
                    const answer = await peer.createAnswer();
                    await peer.setLocalDescription(answer);
                    qcDebug(`[VC] Sending answer to ${from}.`);
                    socket.emit('webrtc-signal', { to: from, signal: { sdp: peer.localDescription } });
                }
            } else if (signal.candidate) {
                qcDebug(`[VC] Adding ICE candidate from ${from}.`);
                await peer.addIceCandidate(new RTCIceCandidate(signal.candidate));
            }
        } catch (err) {
            console.error(`[VC] Error handling signal from ${from}:`, err);
        }
    }
};


// A minimal set of class data needed for the Legacy screen, since we don't have
// server data until we're in a room.
const staticClassData = {
    Barbarian: { stats: { str: 4, dex: 2, con: 4, int: 0, wis: 0, cha: 1 }, primaryStat: 'str' },
    Cleric:    { stats: { str: 2, dex: 0, con: 3, int: 1, wis: 4, cha: 2 }, primaryStat: 'wis' },
    Mage:      { stats: { str: 0, dex: 2, con: 2, int: 5, wis: 2, cha: 1 }, primaryStat: 'int' },
    Ranger:    { stats: { str: 1, dex: 4, con: 3, int: 1, wis: 3, cha: 0 }, primaryStat: 'dex' },
    Rogue:     { stats: { str: 1, dex: 5, con: 2, int: 2, wis: 0, cha: 3 }, primaryStat: 'dex' },
    Warrior:   { stats: { str: 5, dex: 1, con: 4, int: 0, wis: 1, cha: 1 }, primaryStat: 'str' },
};


// --- 2. CORE RENDERING ENGINE ---

/**
 * Checks if the current viewport is considered desktop size.
 * @returns {boolean} True if the window width is 1024px or greater.
 */
function isDesktop() {
    return window.innerWidth >= 1024;
}

/**
 * Creates a single action button for a card, with separate icon and text elements.
 * @param {string} action - The action name (e.g., 'equip', 'discardCard').
 * @param {string} text - The text to display on the button on desktop.
 * @param {string} btnClass - Additional CSS classes for the button.
 * @returns {HTMLElement} The button element.
 */
function createActionButton(action, text, btnClass) {
    const actionIconMap = {
        equip: 'checkroom',
        useConsumable: 'science',
        castSpell: 'auto_awesome',
        claimLoot: 'redeem',
        interact: 'touch_app',
        discardCard: 'delete'
    };

    const btn = document.createElement('button');
    btn.className = `btn btn-sm ${btnClass}`;
    btn.dataset.action = action;
    
    const iconHTML = `<span class="material-symbols-outlined">${actionIconMap[action] || 'touch_app'}</span>`;
    const textHTML = `<span class="btn-text">${text}</span>`;
    
    btn.innerHTML = iconHTML + textHTML;
    return btn;
}


/**
 * Creates an HTML element for a game card with interactive options.
 * @param {object} card - The card data object.
 * @param {object} options - Configuration for card interactivity.
 * @returns {HTMLElement} The fully constructed card element.
 */
function createCardElement(card, options = {}) {
    if (!card) { // Gracefully handle null/undefined card data
        const emptyCardDiv = document.createElement('div');
        emptyCardDiv.className = 'card empty';
        emptyCardDiv.innerHTML = `<div class="card-content"><p class="empty-slot-text">Nothing Equipped</p></div>`;
        return emptyCardDiv;
    }

    const { isEquippable = false, isAttackable = false, isTargetable = false, isDiscardable = false, isConsumable = false, isClaimable = false, isInteractable = false, isCastable = false } = options;
    const cardDiv = document.createElement('div');
    cardDiv.className = 'card';
    cardDiv.dataset.cardId = card.id;

    if (card.rarity) {
        cardDiv.classList.add(`rarity-${card.rarity.toLowerCase()}`);
    }

    if (card.type === 'Spell' && card.level) {
        cardDiv.classList.add(`spell-level-${card.level}`);
    }

    if (card.type === 'Monster') {
        cardDiv.dataset.monsterId = card.id;
        if (isTargetable) cardDiv.classList.add('targetable');
    }
    if (isAttackable) {
        cardDiv.classList.add('attackable-weapon');
        // CRITICAL FIX: Only show weapon selection highlighting after turn popup is ready
        if (card.id === clientState.selectedWeaponId && clientState.turnPopupReady) {
            cardDiv.classList.add('selected-weapon');
        }
    }

    const typeInfo = card.category && card.category !== 'General' ? `${card.type} / ${card.category}` : card.type;
    const monsterHpHTML = card.type === 'Monster' ? `<div class="monster-hp">HP: ${card.currentHp}/${card.maxHp}</div>` : '';
    const monsterStatsHTML = card.type === 'Monster' ? `
        <div class="card-bonus" title="Attack Bonus"><span class="material-symbols-outlined icon-damage">colorize</span>+${card.attackBonus || 0}</div>
        <div class="card-bonus" title="Armor Class"><span class="material-symbols-outlined icon-shield">security</span>${card.requiredRollToHit || 10}</div>
    ` : '';
    const damageDiceHTML = card.effect?.dice ? `<div class="card-bonus" title="Damage Dice"><span class="material-symbols-outlined icon-damage">casino</span>${card.effect.dice}</div>` : '';
    const apCostHTML = card.apCost ? `<div class="card-bonus" title="AP Cost"><span class="material-symbols-outlined icon-ap">bolt</span>${card.apCost}</div>` : '';
    
    let monsterAbilitiesHTML = '';
    if (card.type === 'Monster' && card.abilities && card.abilities.length > 0) {
        monsterAbilitiesHTML = `
            <div class="card-abilities">
                ${card.abilities.map(ability => `
                    <div class="card-ability-item">
                        <strong>${ability.name}:</strong> ${ability.description}
                    </div>
                `).join('')}
            </div>
        `;
    }

    const bonuses = card.effect?.bonuses;
    let bonusesHTML = '';
    if (bonuses) {
        const bonusIconMap = {
            ap: { icon: 'bolt', color: 'ap' }, 
            damageBonus: { icon: 'swords', color: 'damage' }, 
            shieldBonus: { icon: 'security', color: 'shield' }, 
            maxHp: { icon: 'favorite', color: 'hp' },
            hitBonus: { icon: 'colorize', color: 'int' },
            str: { icon: 'fitness_center', color: 'str' }, 
            dex: { icon: 'sprint', color: 'dex' }, 
            con: { icon: 'shield_person', color: 'con' },
            int: { icon: 'school', color: 'int' },
            wis: { icon: 'self_improvement', color: 'wis' }, 
            cha: { icon: 'star', color: 'cha' }
        };
        bonusesHTML = Object.entries(bonuses).map(([key, value]) => {
            if (value === 0) return '';
            const mapEntry = bonusIconMap[key];
            if (!mapEntry) return '';
            const sign = value > 0 ? '+' : '';
            return `<div class="card-bonus" title="${key}"><span class="material-symbols-outlined icon-${mapEntry.color}">${mapEntry.icon}</span>${sign}${value}</div>`;
        }).join('');
    }

    cardDiv.innerHTML = `
        <div class="card-header">
             <h3 class="card-title">${card.name}</h3>
             ${monsterHpHTML}
        </div>
        <div class="card-content">
            <p class="card-effect">${card.effect?.description || card.description || ''}</p>
            ${monsterAbilitiesHTML}
        </div>
        <div class="card-footer">
            <div class="card-bonuses-grid">
                ${monsterStatsHTML}
                ${damageDiceHTML}
                ${bonusesHTML}
                ${apCostHTML}
            </div>
            <p class="card-type">${typeInfo}</p>
        </div>
    `;

    // Add info button to inspect the card
    const infoBtn = document.createElement('button');
    infoBtn.className = 'card-info-btn';
    infoBtn.innerHTML = `<span class="material-symbols-outlined">search</span>`;
    cardDiv.appendChild(infoBtn);

    const actionContainer = document.createElement('div');
    actionContainer.className = 'card-action-buttons';

    if (isEquippable) {
        actionContainer.appendChild(createActionButton('equip', 'Equip (1AP)', 'btn-success'));
    }
    if (isConsumable) {
        actionContainer.appendChild(createActionButton('useConsumable', 'Use', 'btn-special'));
    }
    if (isCastable) {
        actionContainer.appendChild(createActionButton('castSpell', `Cast (${card.apCost}AP)`, 'btn-special'));
    }
    if (isClaimable) {
        actionContainer.appendChild(createActionButton('claimLoot', 'Claim', 'btn-primary'));
    }
    if (isInteractable && card.skillInteractions) {
        card.skillInteractions.forEach(interaction => {
            const btn = createActionButton('interact', `${interaction.name} (${interaction.apCost} AP)`, 'btn-interaction');
            btn.dataset.interactionName = interaction.name;
            actionContainer.appendChild(btn);
        });
    }
    if (isDiscardable) {
        actionContainer.appendChild(createActionButton('discardCard', 'Discard', 'btn-danger'));
    }

    if (actionContainer.hasChildNodes()) {
        cardDiv.appendChild(actionContainer);
    }

    return cardDiv;
}


/**
 * The master rendering function. Wipes and redraws the UI based on the current state.
 */
function renderUI() {
    if (!currentRoomState || !currentRoomState.id) return;
    const myPlayer = currentRoomState.players[myId];
    if (!myPlayer) {
        if (sessionStorage.getItem('qc_playerId')) {
            sessionStorage.removeItem('qc_roomId');
            sessionStorage.removeItem('qc_playerId');
            window.location.reload();
        }
        return;
    }

    const { players, gameState, chatLog, hostId } = currentRoomState;
    const { phase, isPaused, pauseReason } = gameState;
    
    // --- Toasts for new actions (after paint so board/grid match the toast) ---
    const logSliceStart = clientState.lastLogLength;
    clientState.lastLogLength = chatLog.length;
    const newLogEntries = chatLog.slice(logSliceStart);
    if (newLogEntries.length > 0) {
        requestAnimationFrame(() => {
            newLogEntries.forEach(entry => {
                const isMyAction = entry.playerId === myId || entry.rollerId === myId;
                const isToastable = !['chat', 'narrative', 'system', 'combat', 'combat-hit', 'action', 'action-good'].includes(entry.type);
                if (isToastable && !isMyAction) {
                    showToast(entry.text, 'info');
                }
            });
        });
    }

    // Game Paused Overlay - Context-Aware Logic
    const pauseModal = get('game-paused-modal');
    // We only want to show the generic "Game Paused" modal for reasons that DON'T have their own UI.
    // Leveling up has its own modal, so we'll check if any player is currently in that state.
    const aPlayerIsLevelingUp = Object.values(players).some(p => p.pendingAction?.actionType === 'levelUp');

    if (isPaused && !aPlayerIsLevelingUp) {
        get('game-paused-reason').textContent = pauseReason;
        pauseModal.classList.remove('hidden');
    } else {
        // Hide the generic pause modal if the game isn't paused, OR if it's paused for a level-up.
        pauseModal.classList.add('hidden');
    }

    // --- Phase 1: Show/Hide Major Screens ---
    if (phase === 'class_selection' || phase === 'started' || phase === 'game_over') {
        get('menu-screen').classList.remove('active');
        get('legacy-screen').classList.remove('active');
        get('game-screen').classList.add('active');
        if (!gameUIInitialized) {
            initializeGameUIListeners();
            gameUIInitialized = true;
        }
    }
    // Game over is handled by a separate event, not the main update loop.

    // --- Phase 2: Render Common Game Elements ---
    queryAll('[data-container="room-code"]').forEach(el => el.textContent = currentRoomState.id);
    queryAll('[data-container="turn-counter"]').forEach(el => el.textContent = gameState.turnCount);
    renderGameLog(chatLog, phase === 'started');

    const playerListContainers = queryAll('[data-container="player-list"]');
    playerListContainers.forEach(c => c.innerHTML = '');
    const currentPlayerId = gameState.turnOrder[gameState.currentPlayerIndex];
    
    const playerArray = Object.values(players).sort((a,b) => {
        if (a.role === 'DM') return -1;
        if (b.role === 'DM') return 1;
        return a.name.localeCompare(b.name);
    });

    playerArray.forEach(p => {
        if (!p.role) return;
        const isCurrentTurn = p.id === currentPlayerId;
        const li = document.createElement('li');
        li.className = `player-list-item ${isCurrentTurn ? 'active' : ''} ${p.isDowned ? 'downed' : ''} ${p.role.toLowerCase()}`;
        const npcTag = p.isNpc ? '<span class="npc-tag">[NPC]</span> ' : '';
        const roleText = p.role === 'DM' ? `<span class="player-role dm">DM</span>` : '';
        let classText;
        if (phase === 'class_selection') {
            classText = p.class ? `<span class="player-class-ready"> - Ready!</span>` : `<span class="player-class-waiting"> - Choosing...</span>`;
        } else {
            classText = p.class ? `<span class="player-class"> - ${p.class}</span>` : '';
        }
        const levelDisplay = p.role === 'Explorer' && p.level > 0 ? `<span class="player-level">Lvl ${p.level}</span>` : '';
        const hpDisplay = phase === 'started' && p.role === 'Explorer' ? `<div class="player-hp">${p.stats.currentHp} / ${p.stats.maxHp} HP</div>` : '';
        const downedText = p.isDowned ? '<span class="downed-text">[DOWNED]</span> ' : '';
        const disconnectedText = p.disconnected ? '<span class="disconnected-text">[OFFLINE]</span> ' : '';
        
        // Status effects display
        let statusEffectsHTML = '';
        if (phase === 'started' && p.role === 'Explorer' && p.statusEffects && p.statusEffects.length > 0) {
            const statusBadges = p.statusEffects.map(eff => {
                const effectType = eff.type || 'buff';
                const icon = effectType === 'buff' ? '✨' : '💀';
                return `<span class="status-badge-mini status-${effectType}" title="${eff.name}: ${eff.description || 'Active'}">${icon}${eff.duration}</span>`;
            }).join('');
            statusEffectsHTML = `<div class="player-status-effects">${statusBadges}</div>`;
        }
        
        const inspectButton = (p.id !== myId && p.role === 'Explorer')
            ? `<button class="btn-icon btn-inspect-player" data-player-id="${p.id}" aria-label="Inspect ${p.name}"><span class="material-symbols-outlined">search</span></button>` 
            : '';

        li.innerHTML = `<div class="player-info"><span>${levelDisplay}${disconnectedText}${downedText}${npcTag}${p.name}${classText}${roleText}</span>${statusEffectsHTML}</div><div class="player-hp-and-actions">${hpDisplay}${inspectButton}</div>`;
        playerListContainers.forEach(c => c.appendChild(li.cloneNode(true)));
    });
    
    if (isDesktop()) {
        const activePlayerListItem = document.querySelector('#player-list-display .player-list-item.active');
        if (activePlayerListItem) activePlayerListItem.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    // --- Phase 3: Phase-Specific Rendering ---
    const desktopCharacterPanel = get('character-sheet-block');
    const mobileCharacterPanel = get('mobile-screen-character');
    
    queryAll('[data-container="lobby-controls"]').forEach(c => c.classList.add('hidden'));

    if (phase === 'class_selection') {
        if (myPlayer.class) {
            let waitingHTML = `<h2 class="panel-header">Class Chosen!</h2><p class="panel-content">Waiting for the host to start the game...</p>`;
            
            if (myId === hostId) {
                const allReady = Object.values(players).filter(p => !p.isNpc).every(p => p.class);
                const disabledAttr = allReady ? '' : 'disabled';
                const buttonHTML = `<div class="lobby-controls-character-panel">
                    <button id="character-sheet-start-game-btn" class="btn btn-primary" ${disabledAttr}>Start Game</button>
                    ${!allReady ? '<p class="waiting-text">Waiting for other players to choose a class...</p>' : ''}
                </div>`;
                waitingHTML += buttonHTML;
            }

            desktopCharacterPanel.innerHTML = waitingHTML;
            mobileCharacterPanel.innerHTML = `<div class="panel mobile-panel">${waitingHTML}</div>`;
            get('class-selection-modal').classList.add('hidden');
        } else {
            renderClassSelection(desktopCharacterPanel, mobileCharacterPanel);
        }
    } else if (phase === 'started') {
        get('class-selection-modal').classList.add('hidden');
        renderGameplayState(myPlayer, gameState);
    }
    
    // Only show skill challenge modal for world/path events or multi-stage interactions.
    // Single-step card interactions will go straight to dice roll and should not open this modal.
    const challengeDetails = gameState.skillChallenge.details;
    const isMultiStage = !!(challengeDetails && challengeDetails.stages && challengeDetails.stages.length > 1);
    const skillChallengeIsActiveForMe = gameState.skillChallenge.isActive && isMultiStage && gameState.turnOrder[gameState.currentPlayerIndex] === myId;
    const skillChallengeModal = get('skill-challenge-modal');

    if (skillChallengeIsActiveForMe && !clientState.hasSeenSkillChallengePrompt) {
        const details = gameState.skillChallenge.details;
        const stage = details.stages ? details.stages[gameState.skillChallenge.currentStage] : details;
        showSkillChallengeModal(stage, details.name);
        clientState.hasSeenSkillChallengePrompt = true;
    } else if (!skillChallengeIsActiveForMe) {
        // Always hide if not active to avoid getting stuck open
        if (skillChallengeModal && !skillChallengeModal.classList.contains('hidden')) {
            skillChallengeModal.classList.add('hidden');
        }
        // Reset prompt gate when challenge fully ends so it can open next time
        if (!gameState.skillChallenge.isActive) {
            clientState.hasSeenSkillChallengePrompt = false;
            if (clientState.rollResponseTimeout) {
                clearTimeout(clientState.rollResponseTimeout);
                clientState.rollResponseTimeout = null;
            }
        }
    }
}

function createClassCardElement(id, data, forMobile = false) {
    const cardDiv = document.createElement('div');
    cardDiv.className = 'class-card';
    cardDiv.dataset.classId = id;

    const statsHTML = `
        <div class="class-stat-item" title="Health Points"><span class="material-symbols-outlined icon-hp">favorite</span> ${data.baseHp}</div>
        <div class="class-stat-item" title="Action Points"><span class="material-symbols-outlined icon-ap">bolt</span> ${data.baseAP}</div>
        <div class="class-stat-item" title="Damage Bonus"><span class="material-symbols-outlined icon-damage">swords</span> +${data.baseDamageBonus}</div>
        <div class="class-stat-item" title="Shield Bonus"><span class="material-symbols-outlined icon-shield">security</span> +${data.baseShieldBonus}</div>
    `;

    const buttonHTML = forMobile ? `<button class="select-class-btn btn btn-primary btn-sm" data-class-id="${id}">Select ${id}</button>` : '';

    cardDiv.innerHTML = `
        <div class="class-card-header">
            <h3>${id}</h3>
        </div>
        <div class="class-card-body">
            <div class="class-stats">
                ${statsHTML}
            </div>
            <div class="class-ability">
                <p><strong>${data.ability.name}</strong></p>
                <p class="ability-desc">${data.ability.description}</p>
            </div>
        </div>
        <div class="class-card-footer">
             ${buttonHTML}
        </div>
    `;
    return cardDiv;
}

function showClassSelectionModal() {
    const classData = currentRoomState.staticData.classes;
    const modal = get('class-selection-modal');
    const displayContainer = get('desktop-class-card-display');
    const confirmBtn = get('confirm-class-selection-btn');

    displayContainer.innerHTML = '';
    let selectedClassId = null;

    Object.entries(classData).forEach(([id, data]) => {
        const cardElement = createClassCardElement(id, data, false);
        cardElement.addEventListener('click', () => {
            displayContainer.querySelectorAll('.class-card').forEach(c => c.classList.remove('selected-item'));
            cardElement.classList.add('selected-item');
            selectedClassId = id;
            confirmBtn.disabled = false;
        });
        displayContainer.appendChild(cardElement);
    });

    confirmBtn.onclick = () => {
        if (selectedClassId) {
            if (offlineMode.isEnabled() && typeof OfflineActionHandler !== 'undefined' && OfflineActionHandler.isOffline()) {
                OfflineActionHandler.handleAction('chooseClass', { classId: selectedClassId });
            } else {
                socket.emit('chooseClass', { classId: selectedClassId });
                modal.classList.add('hidden');
            }
        }
    };
    
    modal.classList.remove('hidden');
}

function renderClassSelection(desktopContainer, mobileContainer) {
    if (isDesktop()) {
        desktopContainer.innerHTML = `<h2 class="panel-header">Choose Your Class</h2><p class="panel-content">Please make your selection from the popup...</p>`;
        mobileContainer.innerHTML = '';
        showClassSelectionModal();
    } else {
        const classData = currentRoomState.staticData.classes;
        const classSelectionHTML = `
            <h2 class="panel-header">Choose Your Class</h2>
            <div class="panel-content class-grid">
                ${Object.entries(classData).map(([id, data]) => createClassCardElement(id, data, true).outerHTML).join('')}
            </div>`;
        
        switchMobileScreen('character');
        desktopContainer.innerHTML = '';
        mobileContainer.innerHTML = `<div class="panel mobile-panel">${classSelectionHTML}</div>`;
    }
}


/**
 * Renders all elements related to the active gameplay loop.
 */
function renderGameplayState(myPlayer, gameState) {
    const isMyTurn = gameState.turnOrder[gameState.currentPlayerIndex] === myPlayer.id && !myPlayer.isDowned;
    const canAct = isMyTurn && !gameState.isPaused;
    // Authoritative: derived from state (not socket timing) — fixes hidden action bar + turn banner desync.
    clientState.turnPopupReady = canAct;

    renderPartyHope(gameState.partyHope);

    const playerResources = queryAll('[data-container="player-resources"]');
    if (myPlayer.stats.maxHp > 0) {
        const healthPercent = myPlayer.stats.maxHp > 0 ? (myPlayer.stats.currentHp / myPlayer.stats.maxHp) * 100 : 0;
        queryAll('[data-container="player-health-bar"]').forEach(el => el.style.width = `${healthPercent}%`);
        queryAll('[data-container="player-health-text"]').forEach(el => el.textContent = `${myPlayer.stats.currentHp} / ${myPlayer.stats.maxHp}`);

        const apPercent = myPlayer.stats.maxAP > 0 ? (myPlayer.currentAp / myPlayer.stats.maxAP) * 100 : 0;
        queryAll('[data-container="player-ap-bar"]').forEach(el => el.style.width = `${apPercent}%`);
        queryAll('[data-container="player-ap-text"]').forEach(el => el.textContent = `${myPlayer.currentAp} / ${myPlayer.stats.maxAP}`);
        
        // FEATURE: Prompt to end turn when out of AP
        if (myPlayer.currentAp === 0 && !clientState.hasShownEndTurnPrompt && canAct) {
            clientState.hasShownEndTurnPrompt = true;
            // Gate end-turn prompt behind roll modal/toast activity
            setTimeout(() => showEndTurnPrompt(), 300);
        }
        
        // ENHANCED: Show XP for current level and next 2-3 levels
        // Calculate current level XP (XP earned in current level)
        const currentLevelXp = myPlayer.xp % myPlayer.xpToNextLevel;
        const xpPercent = myPlayer.xpToNextLevel > 0 ? (currentLevelXp / myPlayer.xpToNextLevel) * 100 : 0;
        queryAll('[data-container="player-xp-bar"]').forEach(el => el.style.width = `${xpPercent}%`);
        
        // Show current level progress and next level requirements
        const nextLevelXp = myPlayer.xpToNextLevel;
        const levelAfterNextXp = Math.floor(nextLevelXp * 1.5);
        const levelAfterThatXp = Math.floor(levelAfterNextXp * 1.5);
        
        queryAll('[data-container="player-xp-text"]').forEach(el => {
            el.innerHTML = `
                <div>Level ${myPlayer.level}: ${currentLevelXp}/${nextLevelXp} XP</div>
                <div style="font-size: 0.8em; opacity: 0.7;">
                    Next: ${nextLevelXp} → ${levelAfterNextXp} → ${levelAfterThatXp}
                </div>
            `;
        });

        playerResources.forEach(el => el.classList.remove('hidden'));
    } else {
        playerResources.forEach(el => el.classList.add('hidden'));
    }

    const turnPlayer = currentRoomState.players[gameState.turnOrder[gameState.currentPlayerIndex]];
    const turnText = turnPlayer ? `${turnPlayer.name}'s Turn` : "Loading...";
    queryAll('[data-container="turn-indicator"]').forEach(el => el.textContent = turnText);
    
    const shouldShowActionBar = canAct;
    queryAll('[data-container="action-bar"]').forEach(el => el.classList.toggle('hidden', !shouldShowActionBar));
    queryAll('[data-container="action-skill-challenge-btn"]').forEach(el => el.classList.toggle('hidden', !gameState.skillChallenge.isActive));
    // Ensure companion-related action buttons exist and are correctly visible
    ensureCompanionButtons(myPlayer, shouldShowActionBar);
    
    const boardContainers = queryAll('[data-container="board-cards"]');
    boardContainers.forEach(c => c.innerHTML = '');
    [...gameState.board.monsters, ...gameState.board.environment].forEach(card => {
        const isInteractable = canAct && (card.type === 'Monster' || card.type === 'Environmental');
        const cardEl = createCardElement(card, { isTargetable: canAct, isInteractable });
        // CRITICAL FIX: Only append to the first container to prevent duplicate buttons
        if (boardContainers.length > 0) {
            boardContainers[0].appendChild(cardEl);
        }
    });

    // Update gold displays (desktop + mobile)
    queryAll('[data-container="player-gold"]').forEach(el => el.textContent = `Gold: ${myPlayer.gold ?? 0}`);
    queryAll('[data-container="player-gold-mobile"]').forEach(el => el.textContent = `Gold: ${myPlayer.gold ?? 0}`);

    const worldEventBanners = queryAll('[data-container="world-event-display"]');
    const event = gameState.worldEvents.currentEvent;
    if (event) {
        const eventDesc = event.stages ? event.stages[gameState.skillChallenge.currentStage]?.description : event.description;
        const bannerHTML = `
            <span class="material-symbols-outlined">public</span>
            <div class="world-event-text">
                <strong>${event.name}</strong>
                <span>${eventDesc || ''}</span>
            </div>
            <span class="world-event-duration">Rounds Left: ${gameState.worldEvents.duration}</span>
        `;
        worldEventBanners.forEach(banner => {
            banner.innerHTML = bannerHTML;
            banner.classList.remove('hidden');
        });
    } else {
        worldEventBanners.forEach(banner => banner.classList.add('hidden'));
    }

    renderCharacterPanel(get('character-sheet-block'), get('mobile-screen-character'), myPlayer, canAct);

    const lootContainers = queryAll('[data-container="party-loot"]');
    lootContainers.forEach(c => c.innerHTML = '');
    if (gameState.lootPool && gameState.lootPool.length > 0) {
        gameState.lootPool.forEach(lootItem => {
            const lootEl = createCardElement(lootItem, { isClaimable: true });
            lootContainers.forEach(container => container.appendChild(lootEl.cloneNode(true)));
        });
    } else {
         lootContainers.forEach(container => container.innerHTML = `<p class="empty-pool-text">No discoveries yet.</p>`);
    }

    renderHandAndEquipment(myPlayer, canAct);
}

function renderPartyHope(hope) {
    const hopePercent = (hope / 10) * 100;
    let hopeLabel = 'Neutral';
    let hopeClass = 'neutral';

    if (hope <= 2) { hopeLabel = 'Despairing (-1 Hit)'; hopeClass = 'despairing'; }
    else if (hope <= 4) { hopeLabel = 'Struggling'; hopeClass = 'struggling'; }
    else if (hope >= 9) { hopeLabel = 'Inspired (+1 Hit)'; hopeClass = 'inspired'; }
    else if (hope >= 7) { hopeLabel = 'Hopeful'; hopeClass = 'hopeful'; }

    queryAll('[data-container="party-hope-meter"]').forEach(container => {
        // The container is the resource bar
        container.className = container.className.replace(/despairing|struggling|neutral|hopeful|inspired/g, '').trim() + ` ${hopeClass}`;
        container.classList.remove('hidden');

        const barFill = container.querySelector('[data-container="party-hope-bar"]');
        if (barFill) barFill.style.width = `${hopePercent}%`;

        const textEl = container.querySelector('[data-container="party-hope-text"]');
        if (textEl) {
            textEl.textContent = `${hopeLabel} ${hope}/10`;
        }
    });
}

// Ensure Beast Master companion actions appear in the action bar (desktop & mobile)
function ensureCompanionButtons(player, isMyTurn) {
    const bars = queryAll('[data-container="action-bar"]');
    bars.forEach(bar => {
        if (!bar) return;

        let summonBtn = bar.querySelector('[data-container="action-companion-summon-btn"]');
        if (!summonBtn) {
            summonBtn = document.createElement('button');
            summonBtn.className = bar.classList.contains('mobile-action-bar') ? 'btn btn-secondary btn-sm' : 'btn btn-secondary';
            summonBtn.textContent = 'Summon (1AP)';
            summonBtn.dataset.container = 'action-companion-summon-btn';
            // Place before End Turn for visibility
            const endTurnBtn = [...bar.querySelectorAll('button')].find(b => (b.dataset.container || '').includes('action-end-turn-btn'));
            if (endTurnBtn && endTurnBtn.parentNode) {
                endTurnBtn.parentNode.insertBefore(summonBtn, endTurnBtn);
            } else {
                bar.appendChild(summonBtn);
            }
        }

        let attackBtn = bar.querySelector('[data-container="action-companion-attack-btn"]');
        if (!attackBtn) {
            attackBtn = document.createElement('button');
            attackBtn.className = bar.classList.contains('mobile-action-bar') ? 'btn btn-secondary btn-sm' : 'btn btn-secondary';
            attackBtn.textContent = 'Companion Attack (1AP)';
            attackBtn.dataset.container = 'action-companion-attack-btn';
            bar.appendChild(attackBtn);
        }

        const offlineBypass = (typeof OfflineActionHandler !== 'undefined') && OfflineActionHandler.isOffline();
        const hasTier1 = offlineBypass ? true : hasBeastMasterTier(player, 1);
        const canSummon = isMyTurn && player.class === 'Ranger' && hasTier1 && (!player.companion || player.companion.currentHp <= 0);
        summonBtn.classList.toggle('hidden', !canSummon);

        const hasCompanion = !!(player.companion && player.companion.currentHp > 0);
        const canAttack = isMyTurn && hasCompanion && (currentRoomState.gameState.board?.monsters?.length > 0);
        attackBtn.classList.toggle('hidden', !canAttack);
    });
}

function hasBeastMasterTier(player, tier) {
    // Legacy structure support
    if (player.specializationChoices) {
        if (tier === 1) return player.specializationChoices.tier1 === 'Animal Companion';
        if (tier === 2) return player.specializationChoices.tier2 === 'Command Attack';
        if (tier === 3) return player.specializationChoices.tier3 === 'Alpha Beast';
    }
    // New structure from server
    if (player.specializations) {
        const selected = player.specializations[tier];
        return !!(selected && selected.branch === 'BeastMaster');
    }
    return false;
}

function createPlayerSheetHTML(player, isMyTurn) {
    const { stats, class: className } = player;
    if (!stats || !className) return '';
    const classData = currentRoomState.staticData.classes[className];

    const renderCoreStatLine = (label, icon, iconColor, value) => `
        <div class="stat-line">
            <span class="material-symbols-outlined" style="color:var(--stat-color-${iconColor})">${icon}</span>
            <span class="stat-label">${label}</span>
            <span class="stat-value core-stat">${value}</span>
        </div>`;
    
    const renderDerivedStatLine = (label, icon, iconColor, currentValue, maxValue) => `
        <div class="stat-line">
            <span class="material-symbols-outlined" style="color:var(--stat-color-${iconColor})">${icon}</span>
            <span class="stat-label">${label}</span>
            <span class="stat-value derived-stat">${currentValue} / ${maxValue}</span>
        </div>`;

    const renderTotalBonusStatLine = (label, icon, iconColor, totalValue) => {
        const sign = totalValue >= 0 ? '+' : '';
        const valueClass = totalValue >= 0 ? 'positive' : 'negative';
        return `
            <div class="stat-line">
                <span class="material-symbols-outlined" style="color:var(--stat-color-${iconColor})">${icon}</span>
                <span class="stat-label">${label}</span>
                <span class="stat-value total-bonus ${valueClass}">${sign}${totalValue}</span>
            </div>`;
    };
    
    const xpPercent = player.xpToNextLevel > 0 ? (player.xp / player.xpToNextLevel) * 100 : 0;
    const xpBarHTML = `
        <div class="resource-bar xp-bar-character-panel">
            <span class="material-symbols-outlined resource-icon xp">workspace_premium</span>
            <div class="progress-bar-wrapper">
                <div class="progress-bar xp">
                    <div class="progress-bar-fill" style="width: ${xpPercent}%"></div>
                </div>
                <span class="progress-bar-text">${player.xp} / ${player.xpToNextLevel} XP</span>
            </div>
        </div>
    `;

    const useAbilityButton = (classData && isMyTurn) ? `
        <div class="class-ability-card">
            <p class="ability-title">${classData.ability.name} (${classData.ability.apCost} AP)</p>
            <p class="ability-desc">${classData.ability.description}</p>
            <button id="use-ability-btn" class="btn btn-special btn-sm ability-button">Use Ability</button>
        </div>
    ` : '';
    
    // Avatar with animations
    const spriteClass = className.toLowerCase();
    const spritePath = combatGrid.getSpritePath('player', className) || `/assets/sprites/${spriteClass}.png`;
    const avatarHTML = `
        <div class="character-avatar-display">
            <div class="avatar-sprite-container">
                <img src="${spritePath}" alt="${className}" class="avatar-sprite pixel-art animated" loading="lazy">
                <div class="avatar-sparkles">
                    <div class="sparkle"></div>
                    <div class="sparkle"></div>
                    <div class="sparkle"></div>
                </div>
            </div>
            <div class="avatar-name-level">
                <h3>${player.name}</h3>
                <p>Level ${player.level} ${className}</p>
            </div>
        </div>
    `;

    return `
        ${avatarHTML}
        <div class="panel-content">
            <div class="player-stats">
                 ${renderDerivedStatLine('Health', 'favorite', 'hp', stats.currentHp, stats.maxHp)}
                 <div class="stat-line shield-hp-line ${stats.shieldHp > 0 ? '' : 'hidden'}"><span class="material-symbols-outlined" style="color:var(--stat-color-shield-hp)">shield</span><span class="stat-label">Shield</span><span class="stat-value total-bonus positive">+${stats.shieldHp}</span></div>
                 ${renderDerivedStatLine('Action Points', 'bolt', 'ap', player.currentAp, stats.maxAP)}
                 ${xpBarHTML}
                 ${renderTotalBonusStatLine('Damage Bonus', 'swords', 'damage', stats.damageBonus)}
                 ${renderTotalBonusStatLine('Shield Bonus', 'security', 'shield', stats.shieldBonus)}
                 ${renderTotalBonusStatLine('Hit Bonus', 'colorize', 'int', stats.hitBonus)}
                 ${stats.flankingBonus ? renderTotalBonusStatLine('Flanking Bonus', 'swords', 'damage', stats.flankingBonus) : ''}
            </div>
            <div class="player-stats core-stats">
                 ${renderCoreStatLine('Strength', 'fitness_center', 'str', stats.str)}
                 ${renderCoreStatLine('Dexterity', 'sprint', 'dex', stats.dex)}
                 ${renderCoreStatLine('Constitution', 'shield_person', 'con', stats.con)}
                 ${renderCoreStatLine('Intelligence', 'school', 'int', stats.int)}
                 ${renderCoreStatLine('Wisdom', 'self_improvement', 'wis', stats.wis)}
                 ${renderCoreStatLine('Charisma', 'star', 'cha', stats.cha)}
            </div>
             ${useAbilityButton}
        </div>
    `;
}

function renderCharacterPanel(desktopContainer, mobileContainer, player, isMyTurn) {
    const statsHTML = createPlayerSheetHTML(player, isMyTurn);
    if (!statsHTML) {
        if(desktopContainer) desktopContainer.innerHTML = '';
        if(mobileContainer) mobileContainer.innerHTML = '';
        return;
    };

    if (isDesktop()) {
        if(desktopContainer) desktopContainer.innerHTML = statsHTML;
    } else {
        if(mobileContainer) mobileContainer.innerHTML = `<div class="panel mobile-panel">${statsHTML}</div>`;
    }
}


function renderHandAndEquipment(player, isMyTurn) {
    const handContainers = queryAll('[data-container="player-hand"]');
    const equippedContainers = queryAll('[data-container="equipped-items"]');
    
    handContainers.forEach(c => c.innerHTML = '');
    equippedContainers.forEach(c => c.innerHTML = '');

    player.hand.forEach(card => {
        const isEquippable = (card.type === 'Weapon' || card.type === 'Armor') && isMyTurn;
        // BUG FIX: Broaden the check for usable items to include more types.
        const isConsumable = (card.type === 'Consumable' || card.type === 'Potion' || card.type === 'Scroll') && card.apCost > 0 && isMyTurn;
        const isCastable = card.type === 'Spell' && isMyTurn;
        const cardEl = createCardElement(card, { isEquippable, isConsumable, isCastable, isDiscardable: isMyTurn });
        
        // Add selection class for mobile UI
        if (card.id === clientState.selectedHandCardId) {
            cardEl.classList.add('is-selected');
        }

        handContainers.forEach(container => container.appendChild(cardEl.cloneNode(true)));
    });

    Object.values(player.equipment).forEach(item => {
        if (item) {
            const isAttackable = item.type.toLowerCase() === 'weapon' && isMyTurn;
            const cardEl = createCardElement(item, { isAttackable });
            equippedContainers.forEach(container => container.appendChild(cardEl.cloneNode(true)));
        }
    });

    if (isMyTurn) {
        const unarmed = { id: 'unarmed', name: 'Unarmed Strike', type: 'Weapon', apCost: 1, effect: { dice: '1d4' } };
        const cardEl = createCardElement(unarmed, { isAttackable: true });
        equippedContainers.forEach(container => container.appendChild(cardEl.cloneNode(true)));
    }

    // Companion mini card in equipment area (UI display)
    const hasCompanion = player.companion && player.companion.currentHp > 0;
    if (hasCompanion) {
        const comp = player.companion;
        const compCard = {
            id: comp.id,
            name: comp.name,
            type: 'Companion',
            effect: { description: `${comp.damageDice}+${comp.damageBonus} | ATK +${comp.attackBonus}` },
            currentHp: comp.currentHp,
            maxHp: comp.maxHp
        };
        const el = createCardElement(compCard);
        // add HP badge
        const hpBadge = document.createElement('div');
        hpBadge.className = 'companion-hp-badge';
        hpBadge.textContent = `${comp.currentHp}/${comp.maxHp}`;
        el.appendChild(hpBadge);
        equippedContainers.forEach(container => container.appendChild(el.cloneNode(true)));
    }
}


function renderGameLog(log, gameStarted) {
    const logContainers = queryAll('[data-container="game-log"]');
    logContainers.forEach(container => {
        if (!container) return;

        // Auto-scroll if near bottom or new message from me
        const nearBottom = Math.abs(container.scrollHeight - container.clientHeight - container.scrollTop) < 5;

        const logHTML = log.map(entry => {
            const time = new Date(entry.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            const timeSpan = gameStarted ? `<span class="log-timestamp">${time}</span>` : '';
            
            let icon = 'info';
            let contentHTML = '';
            let attributedTo = entry.playerName || entry.rollerName || '';

            switch (entry.type) {
                case 'chat':
                    icon = 'chat';
                    const senderClass = entry.playerId === myId ? 'self' : '';
                    contentHTML = `<div class="log-sender ${senderClass}">${entry.playerName}:</div> <div class="log-text">${entry.text}</div>`;
                    if (entry.channel === 'party' && entry.playerId !== myId) {
                        showChatPreview(entry.playerName, entry.text);
                    }
                    break;
                case 'narrative':
                    icon = 'auto_stories';
                    contentHTML = `<div class="log-text narrative">"${entry.text}"</div>`;
                    break;
                case 'combat':
                case 'combat-hit':
                    icon = 'swords';
                    contentHTML = `<div class="log-text">${entry.text}</div>`;
                    break;
                case 'system-good':
                case 'action-good':
                    icon = 'star';
                    contentHTML = `<div class="log-text">${entry.text}</div>`;
                    break;
                 case 'system-bad':
                    icon = 'warning';
                    contentHTML = `<div class="log-text">${entry.text}</div>`;
                    break;
                default: // system, dm, action
                    icon = 'info';
                    contentHTML = `<div class="log-text">${entry.text}</div>`;
                    break;
            }

            const attributionSpan = attributedTo ? `<span class="log-attribution">${attributedTo}</span>` : '';
            
            return `<div class="log-entry ${entry.type}">
                        <div class="log-meta">
                            ${timeSpan}
                            ${attributionSpan}
                        </div>
                        <div class="log-content">
                            <span class="material-symbols-outlined log-icon">${icon}</span>
                            ${contentHTML}
                        </div>
                    </div>`;
        }).join('');

        container.innerHTML = logHTML;
        // Prefer forced scroll on my own messages; otherwise only if near bottom previously
        const last = log[log.length - 1];
        const isMine = last && (last.playerId === myId || last.rollerId === myId);
        if (isMine || nearBottom) {
            container.scrollTop = container.scrollHeight;
        }
    });
}


// --- 3. UI INITIALIZATION & EVENT LISTENERS ---
function initializeUI() {
    accountManager.load();
    renderLegacyScreen(); // Pre-render the legacy screen

    const playerNameInput = get('player-name-input');
    const roomCodeInput = get('room-code-input');
    const createBtn = get('create-room-btn');
    const joinBtn = get('join-room-btn');
    const dailyBtn = get('daily-challenge-btn');
    const offlineBtn = get('play-offline-btn');

    function validateMenu() {
        const hasName = playerNameInput.value.trim().length > 0;
        const hasMode = clientState.selectedGameMode !== null;
        createBtn.disabled = !hasName || !hasMode;
        joinBtn.disabled = !hasName || roomCodeInput.value.trim().length !== 4;
    }

    playerNameInput.addEventListener('input', validateMenu);
    roomCodeInput.addEventListener('input', validateMenu);
    
    document.querySelectorAll('.mode-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            clientState.selectedGameMode = btn.dataset.mode;
            get('custom-settings').classList.toggle('hidden', clientState.selectedGameMode !== 'Custom');
            validateMenu();
        });
    });

    createBtn.addEventListener('click', () => {
        myPlayerName = playerNameInput.value.trim();
        
        // OFFLINE MODE: Create solo game if explicitly offline or no connection
        if (!navigator.onLine) {
            qcDebug('[Offline] No network connection - creating solo game');
            createOfflineSoloGame();
            return;
        }
        
        // Check if user explicitly wants offline mode
        if (offlineMode.isEnabled()) {
            qcDebug('[Offline] Offline mode enabled - creating solo game');
            createOfflineSoloGame();
            return;
        }
        
        
        qcDebug('[Create] Attempting to create online room...');
        qcDebug('[Create] Socket connected:', isSocketConnected);
        qcDebug('[Create] Socket object:', socket);
        
        // Try to create room online first
        try {
            let payload = { 
                playerName: myPlayerName, 
                gameMode: clientState.selectedGameMode,
                accountUpgrades: accountManager.data.upgrades,
                metaPerks: accountManager.data.metaPerks || {}
            };
            if (clientState.selectedGameMode === 'Custom') {
                payload.customSettings = {
                    startWithWeapon: get('setting-weapon').checked,
                    startWithArmor: get('setting-armor').checked,
                    startingItems: parseInt(get('setting-items').value, 10),
                    startingSpells: parseInt(get('setting-spells').value, 10),
                    enforceWeaponRanges: get('setting-weapon-ranges').checked,
                    lootDropRate: parseInt(get('setting-loot-rate').value, 10),
                    maxHandSize: parseInt(get('setting-max-hand').value, 10),
                    discoveryRolls: get('setting-discovery-rolls').checked
                };
            }
            
            socket.emit('createRoom', payload);
            qcDebug('[Create] Room creation request sent');
        } catch (error) {
            qcDebug('[Create] Error creating room online, falling back to offline:', error);
            createOfflineSoloGame();
        }
    });

    if (dailyBtn) {
        dailyBtn.addEventListener('click', () => {
            myPlayerName = playerNameInput.value.trim() || 'Rogue Runner';
            const today = new Date();
            const seed = parseInt(`${today.getUTCFullYear()}${(today.getUTCMonth()+1).toString().padStart(2,'0')}${today.getUTCDate().toString().padStart(2,'0')}`, 10);
            const payload = {
                playerName: myPlayerName,
                gameMode: 'Daily',
                accountUpgrades: accountManager.data.upgrades,
                customSettings: {},
                runModifiers: { daily: true, modifiers: ['Enemies +25% HP', 'No shops', 'Double XP'], seed }
            };
            socket.emit('createRoom', payload);
        });
    }
    if (offlineBtn) {
        offlineBtn.addEventListener('click', () => {
            // Toggle offline mode
            if (offlineMode.isEnabled()) {
                offlineMode.disable();
                get('offline-mode-indicator').textContent = 'Offline Mode: Off';
                showToast('Online mode enabled.', 'info');
            } else {
                // Start offline solo flow
                get('offline-mode-indicator').textContent = 'Offline Mode: On';
                myPlayerName = (playerNameInput.value.trim() || 'Offline Hero');
                createOfflineSoloGame();
            }
        });
    }

    joinBtn.addEventListener('click', () => {
        myPlayerName = playerNameInput.value.trim();
        const roomId = roomCodeInput.value.trim().toUpperCase();
        socket.emit('joinRoom', { 
            playerName: myPlayerName, 
            roomId,
            accountUpgrades: accountManager.data.upgrades
        });
    });
    
    get('goto-legacy-btn').addEventListener('click', () => {
        get('menu-screen').classList.remove('active');
        get('legacy-screen').classList.add('active');
        renderLegacyScreen();
    });

    get('legacy-back-btn').addEventListener('click', () => {
        get('legacy-screen').classList.remove('active');
        get('menu-screen').classList.add('active');
    });
    const saveLoadoutBtn = get('save-loadout-btn');
    const applyLoadoutBtn = get('apply-loadout-btn');
    const loadoutSelect = get('loadout-slot-select');
    if (saveLoadoutBtn) saveLoadoutBtn.addEventListener('click', () => accountManager.saveLoadout(currentRoomState.players?.[myId]));
    if (applyLoadoutBtn) applyLoadoutBtn.addEventListener('click', () => {
        const list = get('loadout-list');
        const modal = get('loadout-modal');
        if (!list || !modal) return;
        const me = currentRoomState.players?.[myId];
        list.innerHTML = '';
        accountManager.data.savedLoadouts.forEach((l, idx) => {
            const row = document.createElement('div');
            const date = new Date(l.timestamp).toLocaleString();
            row.className = 'loadout-row';
            row.innerHTML = `<div>${idx}. ${l.class} — ${date}</div><button class="btn btn-secondary btn-sm">Apply</button>`;
            const btn = row.querySelector('button');
            btn.addEventListener('click', () => {
                if (!me || me.class !== l.class) return showToast(`Loadout class mismatch (${l.class}).`, 'error');
                accountManager.applyLoadout(idx);
                modal.classList.add('hidden');
            });
            list.appendChild(row);
        });
        get('loadout-close-btn').onclick = () => modal.classList.add('hidden');
        modal.classList.remove('hidden');
    });
    
    // Guide screen navigation
    get('goto-guide-btn').addEventListener('click', () => {
        get('menu-screen').classList.remove('active');
        get('guide-screen').classList.add('active');
        renderGuideScreen();
    });

    get('guide-back-btn').addEventListener('click', () => {
        get('guide-screen').classList.remove('active');
        get('menu-screen').classList.add('active');
    });

    get('legacy-class-content').addEventListener('click', e => {
        const button = e.target.closest('.account-upgrade-btn');
        if (button) {
            const { className, stat } = button.dataset;
            if (accountManager.purchaseUpgrade(className, stat)) {
                renderLegacyScreen(className); // Re-render with the same tab active
            }
        }
    });

    get('legacy-class-nav').addEventListener('click', e => {
        const button = e.target.closest('.legacy-nav-item');
        if (button) {
            const className = button.dataset.className;
            clientState.activeLegacyClassTab = className;
            renderLegacyScreen(className);
        }
    });

    // Check for saved game session (from "Save & Leave")
    const savedSession = localStorage.getItem('qc_game_session');
    if (savedSession) {
        try {
            const { roomId, playerId, timestamp } = JSON.parse(savedSession);
            
            // Check if save is less than 24 hours old
            const age = Date.now() - timestamp;
            if (age < 24 * 60 * 60 * 1000) {
                qcDebug('[SavedSession] Attempting to rejoin saved game...');
                socket.emit('rejoinRoom', { roomId, playerId });
                
                // Clear the saved session after attempting to rejoin
                localStorage.removeItem('qc_game_session');
            } else {
                qcDebug('[SavedSession] Saved session expired, clearing...');
                localStorage.removeItem('qc_game_session');
            }
        } catch (e) {
            console.error('[SavedSession] Error parsing saved session:', e);
            localStorage.removeItem('qc_game_session');
        }
    }
}

/**
 * Main handler for all clicks within the game area. Uses event delegation.
 * This function is refactored to prioritize specific button clicks over general card selections,
 * fixing issues on mobile where tapping buttons would be misinterpreted.
 */
function handleGameAreaClick(e) {
    const cardElement = e.target.closest('.card');
    if (!cardElement) return; // Exit if the click wasn't on a card at all

    const isMobile = !isDesktop();
    const button = e.target.closest('button');

    // 1. PRIORITIZE ALL BUTTON CLICKS WITHIN A CARD
    if (button) {
        // Stop propagation immediately to prevent the card selection logic from firing.
        e.stopPropagation(); 
        
        // A. Handle Info Button
        if (button.classList.contains('card-info-btn')) {
            showCardInspectorModal(cardElement.dataset.cardId);
            return; // Action handled
        }

        // B. Handle Action Buttons (Use, Discard, Equip, etc.)
        const action = button.dataset.action;
        if (action) {
            const cardId = cardElement.dataset.cardId;
            const myPlayer = currentRoomState.players[myId];
            if (!myPlayer) return;

            const cardInHand = myPlayer.hand.find(c => c.id === cardId);
            const lootItem = currentRoomState.gameState.lootPool.find(c => c.id === cardId);

            switch (action) {
                case 'equip':
                    if (cardInHand) {
                        showConfirmationModal({
                            title: 'Equip Item',
                            prompt: `Spend 1 AP to equip <strong>${cardInHand.name}</strong>?`,
                            onConfirm: () => {
                                if (OfflineActionHandler && OfflineActionHandler.isOffline()) {
                                    OfflineActionHandler.handleAction('equipItem', { cardId });
                                } else {
                                    socket.emit('equipItem', { cardId });
                                }
                            }
                        });
                    }
                    break;
                case 'useConsumable':
                    if (cardInHand) handleUseConsumable(cardInHand);
                    break;
                case 'castSpell':
                    if (cardInHand) handleCastSpell(cardInHand);
                    break;
                case 'claimLoot':
                    if (lootItem) showClaimLootModal(lootItem);
                    break;
                case 'interact':
                    if (cardElement) {
                        const interactionName = button.dataset.interactionName;
                        // Directly send interaction without redundant confirmation
                        qcDebug('[Interact] Sending interaction:', cardId, interactionName);
                        socket.emit('playerAction', {
                            action: 'resolveSkillInteraction',
                            cardId: cardId,
                            interactionName: interactionName
                        });
                    }
                    break;
                case 'discardCard':
                    if (cardInHand) {
                        showConfirmationModal({
                            title: 'Discard Card',
                            prompt: `Discard <strong>${cardInHand.name}</strong>? This cannot be undone.`,
                            onConfirm: () => socket.emit('playerAction', { action: 'discardCard', cardId })
                        });
                    }
                    return; // Exit early
                case 'discardCardOld':
                    if (cardInHand) {
                        showConfirmationModal({
                            title: 'Discard Card',
                            prompt: `Are you sure you want to discard <strong>${cardInHand.name}</strong>? This cannot be undone.`,
                            onConfirm: () => socket.emit('playerAction', { action: 'discardCard', cardId })
                        });
                    }
                    break;
            }
            clientState.selectedHandCardId = null; // Deselect card after an action is taken
            renderUI(); // Re-render to remove selection highlight/buttons
            return; // Action handled
        }
    }

    // 2. HANDLE MOBILE CARD SELECTION (only if no button was clicked)
    // This allows a tap-to-select, then tap-action-button flow on mobile.
    if (isMobile && cardElement.closest('.player-hand-container')) {
         const cardId = cardElement.dataset.cardId;
         // If clicking the already selected card, treat it as a deselect.
         clientState.selectedHandCardId = (clientState.selectedHandCardId === cardId) ? null : cardId;
         renderUI(); // Re-render to show/hide buttons
         return; // Action handled
    }

    // 3. HANDLE OTHER CARD CLICKS (ATTACKING, etc.)
    const myPlayer = currentRoomState.players[myId];
    if (!myPlayer) return;
    const isMyTurn = currentRoomState.gameState.turnOrder[currentRoomState.gameState.currentPlayerIndex] === myPlayer.id && !myPlayer.isDowned;
    if (!isMyTurn) return;

    if (cardElement.classList.contains('attackable-weapon')) {
        const cardId = cardElement.dataset.cardId;
        clientState.selectedWeaponId = clientState.selectedWeaponId === cardId ? null : cardId;
        if (clientState.selectedWeaponId && clientState.isFirstTurnTutorialActive) {
            showToast("Great! Now click a monster on the board to attack it.", "info");
        }
        renderUI(); // Re-render to show selection highlight
    } else if (cardElement.classList.contains('targetable')) {
        const monsterId = cardElement.dataset.monsterId;
        if (clientState.selectedWeaponId) {
            const weapon = Object.values(myPlayer.equipment).find(e => e?.id === clientState.selectedWeaponId) || { name: 'Unarmed Strike' };
            const monster = currentRoomState.gameState.board.monsters.find(m => m.id === monsterId);
            if (weapon && monster) {
                showConfirmationModal({
                    title: 'Confirm Attack',
                    prompt: `Attack <strong>${monster.name}</strong> with <strong>${weapon.name}</strong>?`,
                    onConfirm: () => {
                        if (clientState.isFirstTurnTutorialActive) {
                            clientState.isFirstTurnTutorialActive = false;
                        }
                        showNarrativeModal(clientState.selectedWeaponId, monsterId);
                        clientState.selectedWeaponId = null;
                        renderUI(); // Re-render to remove selection highlight
                    }
                });
            }
        }
    }
}


function initializeGameUIListeners() {
    get('game-area').addEventListener('click', handleGameAreaClick);
    
    // Player List Collapse/Expand Toggle (Desktop)
    const playerListHeader = get('player-list-header');
    if (playerListHeader) {
        playerListHeader.addEventListener('click', () => {
            get('player-list-display').classList.toggle('collapsed');
        });
    }
    
    document.body.addEventListener('click', (e) => {
        const target = e.target;
        
        // CRITICAL FIX: Check if turn popup is ready before allowing actions
        const isActionButton = target.closest('button[data-container]') || 
                              target.closest('.card') || 
                              target.id === 'use-ability-btn' ||
                              target.closest('[data-container="start-game-btn"]');
        
        if (isActionButton && !clientState.turnPopupReady) {
            qcDebug('[ActionBlock] Action blocked - turn popup not ready yet');
            showToast('Please wait for your turn to begin...', 'info', 2000);
            return;
        }
        
        const inspectBtn = target.closest('.btn-inspect-player');
        if (inspectBtn) {
            showPlayerInspectorModal(inspectBtn.dataset.playerId);
            return;
        }

        // Deselect card logic for mobile when clicking outside of the hand
        const cardInHand = e.target.closest('.player-hand-container .card');
        if (!isDesktop() && !cardInHand && clientState.selectedHandCardId) {
            clientState.selectedHandCardId = null;
            renderUI();
        }

        // Class selection on mobile (supports offline mode)
        const classBtn = target.closest('.select-class-btn');
        if (classBtn) {
            const selectedClassId = classBtn.dataset.classId;
            if (typeof OfflineActionHandler !== 'undefined' && OfflineActionHandler.isOffline()) {
                OfflineActionHandler.handleAction('chooseClass', { classId: selectedClassId });
            } else {
                socket.emit('chooseClass', { classId: selectedClassId });
            }
            return;
        }
        // Use class ability
        if (target.id === 'use-ability-btn') {
            const playerClass = currentRoomState.players[myId]?.class;
            if (playerClass) {
                const abilityName = currentRoomState.staticData.classes[playerClass].ability.name;
                socket.emit('playerAction', { action: 'useAbility', abilityName });
            }
            return;
        }
        // Start game button
        if (target.id === 'character-sheet-start-game-btn' || target.closest('[data-container="start-game-btn"]')) {
            if (typeof OfflineActionHandler !== 'undefined' && OfflineActionHandler.isOffline()) {
                // Ensure offline engine transitions state fully
                try { OfflineActionHandler.startGame(); } catch (_) {}
                currentRoomState.gameState.phase = 'started';
                // Ensure turn order exists and myId is placed on grid for immediate render
                if (!Array.isArray(currentRoomState.gameState.turnOrder) || currentRoomState.gameState.turnOrder.length === 0) {
                    currentRoomState.gameState.turnOrder = [myId];
                    currentRoomState.gameState.currentPlayerIndex = 0;
                }
                const grid = currentRoomState.gameState.grid || (currentRoomState.gameState.grid = { width: 5, height: 5, entities: {} });
                if (!grid.entities[myId]) grid.entities[myId] = { x: 2, y: 2, type: 'player' };
                renderUI();
                combatGrid.render();
            } else {
                socket.emit('startGame');
            }
            return;
        }

        // Action bar buttons
        const actionBar = target.closest('[data-container="action-bar"]');
        if (actionBar) {
            const btn = target.closest('button');
            if (!btn) return;
            const actionType = Object.keys(btn.dataset).find(key => key.startsWith('container'));
            if (!actionType) return;
            
            const action = btn.dataset[actionType];
            if (action.includes('end-turn-btn')) {
                if (OfflineActionHandler.isOffline()) {
                    OfflineActionHandler.handleAction('endTurn');
                } else {
                    socket.emit('endTurn');
                }
            }
            else if (action.includes('guard-btn')) {
                if (OfflineActionHandler.isOffline()) {
                    OfflineActionHandler.handleAction('guard');
                } else {
                    socket.emit('playerAction', { action: 'guard' });
                }
            }
            else if (action.includes('dodge-btn')) {
                if (OfflineActionHandler.isOffline()) {
                    OfflineActionHandler.handleAction('dodge');
                } else {
                    socket.emit('playerAction', { action: 'dodge' });
                }
            }
            else if (action.includes('dash-btn')) {
                if (OfflineActionHandler.isOffline()) {
                    OfflineActionHandler.handleAction('dash');
                } else {
                    socket.emit('playerAction', { action: 'dash' });
                }
            }
            else if (action.includes('help-btn')) {
                // Show player selection modal for Help action
                showTargetSelectionModal('Select a player to help', 'ally', (targetPlayerId) => {
                    socket.emit('playerAction', { action: 'help', targetPlayerId });
                });
            }
            else if (action.includes('search-btn')) socket.emit('playerAction', { action: 'search' });
            else if (action.includes('take-cover-btn')) socket.emit('playerAction', { action: 'takeCover' });
            else if (action.includes('advance-btn')) {
                const myPlayer = currentRoomState.players[myId];
                const mp = myPlayer?.movementPoints ?? 0;
                // Allow using advance even if out of MP (uses 1 AP and auto-step server-side)
                socket.emit('playerAction', { action: 'advance' });
            }
            else if (action.includes('retreat-btn')) {
                const myPlayer = currentRoomState.players[myId];
                const mp = myPlayer?.movementPoints ?? 0;
                socket.emit('playerAction', { action: 'retreat' });
            }
            else if (action.includes('brief-respite-btn')) {
                const myPlayer = currentRoomState.players[myId];
                if ((myPlayer.currentAp ?? 0) < 1) { showApError(1); return; }
                socket.emit('playerAction', { action: 'respite' });
            }
            else if (action.includes('full-rest-btn')) {
                const myPlayer = currentRoomState.players[myId];
                if ((myPlayer.currentAp ?? 0) < 2) { showApError(2); return; }
                socket.emit('playerAction', { action: 'rest' });
            }
            else if (action.includes('skill-challenge-btn')) {
                const challenge = currentRoomState.gameState.skillChallenge.details;
                if (challenge) {
                    const stage = challenge.stages ? challenge.stages[currentRoomState.gameState.skillChallenge.currentStage] : challenge;
                    showSkillChallengeModal(stage, challenge.name);
                }
            }
            else if (action.includes('action-companion-summon-btn')) {
                const myPlayer = currentRoomState.players[myId];
                if (!myPlayer) return;
                // Choose companion type (simple prompt for now)
                const availableTypes = Object.keys(CompanionSystem.companionTemplates || { wolf:1, bear:1, hawk:1 });
                const defaultType = myPlayer.level >= 5 ? 'bear' : 'wolf';
                const chosen = prompt(`Summon which companion? (${availableTypes.join(', ')})`, defaultType);
                const type = availableTypes.includes((chosen||'').toLowerCase()) ? chosen.toLowerCase() : defaultType;
                if (OfflineActionHandler.isOffline()) {
                    OfflineActionHandler.handleAction('summonCompanion', { companionType: type });
                } else {
                    socket.emit('playerAction', { action: 'summonCompanion', companionType: type });
                }
            }
            else if (action.includes('action-companion-attack-btn')) {
                const myPlayer = currentRoomState.players[myId];
                if (!myPlayer?.companion || myPlayer.companion.currentHp <= 0) return;
                if ((myPlayer.currentAp ?? 0) < 1) { showApError(1); return; }
                const monsters = currentRoomState.gameState.board?.monsters || [];
                if (monsters.length === 0) {
                    showToast('No monsters to target', 'error');
                    return;
                }
                // Use target modal for selection
                showTargetSelectionModal({
                    title: 'Command Companion',
                    prompt: 'Choose a monster to attack',
                    targets: monsters,
                    onSelect: (selectedMonster) => {
                        if (OfflineActionHandler.isOffline()) {
                            OfflineActionHandler.handleAction('companionAttack', { targetId: selectedMonster.id });
                        } else {
                            socket.emit('playerAction', { action: 'companionAttack', targetId: selectedMonster.id });
                        }
                    }
                });
            }
        }
    });

    ['chat-form', 'mobile-chat-form'].forEach(id => {
        const form = get(id);
        form.addEventListener('submit', (e) => {
            e.preventDefault();
            const input = get(id.replace('form', 'input'));
            const channel = get(id.replace('form', 'channel'));
            const message = input.value.trim();
            if (message) {
                socket.emit('chatMessage', { channel: channel.value, message });
                input.value = '';
            }
        });
    });

    get('chat-toggle-btn').addEventListener('click', () => get('chat-overlay').classList.toggle('hidden'));
    get('chat-close-btn').addEventListener('click', () => get('chat-overlay').classList.add('hidden'));

    get('menu-toggle-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        get('menu-dropdown').classList.toggle('hidden');
    });
    const dcBtn = get('daily-challenge-btn');
    if (dcBtn) {
        // Daily Challenge now creates an online room with deterministic seed and modifiers
        dcBtn.addEventListener('click', () => {
            const nameInput = get('player-name-input');
            myPlayerName = (nameInput?.value.trim()) || 'Daily Challenger';
            const today = new Date();
            const seed = parseInt(`${today.getUTCFullYear()}${(today.getUTCMonth()+1).toString().padStart(2,'0')}${today.getUTCDate().toString().padStart(2,'0')}`, 10);
            const payload = {
                playerName: myPlayerName,
                gameMode: 'Daily',
                accountUpgrades: accountManager.data.upgrades,
                customSettings: {},
                runModifiers: { daily: true, modifiers: ['Enemies +25% HP', 'No shops', 'Double XP'] },
                seed
            };
            try {
                socket.emit('createRoom', payload);
                showToast('Daily Challenge room created. Share your room code to compete!', 'success');
            } catch (e) {
                showToast('Unable to create Daily room. Check your connection.', 'error');
            }
        });
    }

    get('mobile-menu-toggle-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        get('mobile-menu-dropdown').classList.toggle('hidden');
    });

    get('mobile-drawer-handle').addEventListener('click', (e) => {
        e.stopPropagation();
        const handle = e.currentTarget;
        const drawer = get('mobile-top-drawer');
        handle.classList.toggle('toggled');
        drawer.classList.toggle('active');
    });

    document.addEventListener('click', (e) => {
        if (!e.target.closest('.header-menu')) {
            get('menu-dropdown').classList.add('hidden');
            get('mobile-menu-dropdown').classList.add('hidden');
        }
        if (!e.target.closest('.mobile-header') && !e.target.closest('#mobile-top-drawer')) {
            get('mobile-top-drawer').classList.remove('active');
            get('mobile-drawer-handle').classList.remove('toggled');
        }
    });

    const leaveGameAction = () => {
        // Reset offline flags so returning to menu is clean
        try {
            if (typeof offlineMode !== 'undefined') {
                offlineMode.disable();
                offlineMode.setUserChoice(null);
            }
            if (typeof clientState !== 'undefined') {
                clientState.offlineMode = false;
                clientState.soloPlayMode = false;
            }
            localStorage.removeItem('qc_currentGame');
        } catch (e) {
            console.warn('[leaveGame] Cleanup error:', e.message);
        }
        sessionStorage.removeItem('qc_roomId');
        sessionStorage.removeItem('qc_playerId');
        window.location.reload();
    };
    ['leave-game-btn', 'mobile-leave-game-btn'].forEach(id => get(id).addEventListener('click', leaveGameAction));
    
    ['join-voice-btn', 'mobile-join-voice-btn'].forEach(id => get(id).addEventListener('click', () => voiceChatManager.join()));
    
    // Settings button
    const settingsBtn = get('settings-btn');
    if (settingsBtn) {
        settingsBtn.addEventListener('click', () => {
            get('settings-modal').classList.remove('hidden');
            get('menu-dropdown').classList.add('hidden');
        });
    }
    
    // Settings modal close
    const settingsModal = get('settings-modal');
    if (settingsModal) {
        const closeBtn = settingsModal.querySelector('.modal-close-btn');
        if (closeBtn) {
            closeBtn.addEventListener('click', () => settingsModal.classList.add('hidden'));
        }
        
        // Dev tools functionality
        initializeDevTools();
        
        // Load saved settings
        const damageNumbersSetting = localStorage.getItem('setting_damageNumbers');
        const screenShakeSetting = localStorage.getItem('setting_screenShake');
        const animationSpeedSetting = localStorage.getItem('setting_animationSpeed');
        const synergyTrackerSetting = localStorage.getItem('setting_synergyTracker');
        
        if (damageNumbersSetting !== null) get('damage-numbers').checked = damageNumbersSetting === 'true';
        if (screenShakeSetting !== null) get('screen-shake').checked = screenShakeSetting === 'true';
        if (animationSpeedSetting) get('animation-speed').value = animationSpeedSetting;
        if (synergyTrackerSetting !== null) get('synergy-tracker-toggle').checked = synergyTrackerSetting === 'true';
        
        // Save settings on change
        get('damage-numbers').addEventListener('change', (e) => {
            localStorage.setItem('setting_damageNumbers', e.target.checked);
        });
        get('screen-shake').addEventListener('change', (e) => {
            localStorage.setItem('setting_screenShake', e.target.checked);
        });
        get('animation-speed').addEventListener('change', (e) => {
            localStorage.setItem('setting_animationSpeed', e.target.value);
            const valueDisplay = get('animation-speed-value');
            if (valueDisplay) valueDisplay.textContent = `${e.target.value}x`;
        });
        get('synergy-tracker-toggle').addEventListener('change', (e) => {
            localStorage.setItem('setting_synergyTracker', e.target.checked);
            const tracker = document.querySelector('.synergy-tracker');
            if (tracker) {
                tracker.style.display = e.target.checked ? 'block' : 'none';
            }
        });
        const pixelArtToggle = get('pixel-art-mode');
        if (pixelArtToggle) {
            pixelArtToggle.addEventListener('change', (e) => {
                localStorage.setItem('setting_pixelArtMode', e.target.checked);
                combatGrid.usePixelArt = e.target.checked;
                showToast('Pixel art mode ' + (e.target.checked ? 'enabled' : 'disabled') + '. Refresh to apply.', 'info');
            });
        }
    }
    ['leave-voice-btn', 'mobile-leave-voice-btn'].forEach(id => get(id).addEventListener('click', () => voiceChatManager.leave()));
    ['mute-voice-btn', 'mobile-mute-voice-btn'].forEach(id => get(id).addEventListener('click', () => voiceChatManager.toggleMute()));

    document.querySelector('.info-tabs-panel .tab-buttons').addEventListener('click', (e) => {
        if (e.target.classList.contains('tab-btn')) {
            const tabId = e.target.dataset.tab;
            document.querySelectorAll('.info-tabs-panel .tab-btn').forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');
            document.querySelectorAll('.info-tabs-panel .tab-content').forEach(c => c.classList.remove('active'));
            get(tabId).classList.add('active');
        }
    });

    document.querySelector('.mobile-bottom-nav').addEventListener('click', (e) => {
        const navBtn = e.target.closest('.nav-btn');
        if (navBtn) switchMobileScreen(navBtn.dataset.screen);
    });
    
    get('dice-roll-confirm-btn').addEventListener('click', handleDiceRoll);
    get('dice-roll-close-btn').addEventListener('click', () => dismissDiceRollModal());
    
    get('narrative-confirm-btn').addEventListener('click', () => {
        if (!clientState.activeItem) return;
        
        qcDebug('[Attack] Narrative confirmed, activeItem:', clientState.activeItem);
        qcDebug('[Attack] OfflineActionHandler exists:', typeof OfflineActionHandler);
        qcDebug('[Attack] Offline mode:', typeof OfflineActionHandler !== 'undefined' && OfflineActionHandler.isOffline());
        
        // Check offline mode
        if (typeof OfflineActionHandler !== 'undefined' && OfflineActionHandler.isOffline()) {
            qcDebug('[Attack] Using offline dice flow');
            // Show attack roll modal for parity
            showDiceRollModal({
                title: 'Attack Roll',
                description: 'Roll to hit your target',
                dice: 'd20',
                action: 'resolveAttackRoll',
                weaponId: clientState.activeItem.weaponId,
                targetId: clientState.activeItem.targetId
            });
        } else {
            qcDebug('[Attack] Using online socket.emit');
            qcDebug('[Attack] Sending to server:', {
                action: 'attack',
                weaponId: clientState.activeItem.weaponId,
                targetId: clientState.activeItem.targetId
            });
            
            // Set timeout in case server doesn't respond
            const attackTimeout = setTimeout(() => {
                showToast('Server not responding. Check if Render is deployed to v3.7.0+', 'error', 5000);
                console.error('[Attack] Server timeout - no response after 5 seconds');
                console.error('[Attack] Render may need redeployment or server is down');
            }, 5000);
            
            // Clear timeout when we get ANY response
            socket.once('promptAttackRoll', () => clearTimeout(attackTimeout));
            socket.once('actionError', () => clearTimeout(attackTimeout));
            
            socket.emit('playerAction', {
                action: 'attack',
                weaponId: clientState.activeItem.weaponId,
                targetId: clientState.activeItem.targetId,
                narrative: get('narrative-input').value.trim() || null
            });
        }
        get('narrative-modal').classList.add('hidden');
        clientState.activeItem = null;
    });
    get('narrative-cancel-btn').addEventListener('click', () => {
        get('narrative-modal').classList.add('hidden');
        clientState.activeItem = null;
    });
     
    get('confirm-discard-btn').addEventListener('click', () => {
        if (!clientState.activeItem || !clientState.activeItem.selectedCardId) return;
        socket.emit('playerAction', {
            action: 'chooseNewCardDiscard',
            cardToDiscardId: clientState.activeItem.selectedCardId,
            newCard: clientState.activeItem.newCard
        });
        get('choose-discard-modal').classList.add('hidden');
        clientState.activeItem = null;
    });
     
    get('game-over-leave-btn').addEventListener('click', leaveGameAction);
     
    get('discovery-confirm-btn').addEventListener('click', () => {
        if (!clientState.activeItem || !clientState.activeItem.keptItemId) return;
        socket.emit('playerAction', { action: 'resolveDiscovery', keptItemId: clientState.activeItem.keptItemId });
        get('discovery-modal').classList.add('hidden');
        clientState.activeItem = null;
    });
     
    ['help-btn', 'mobile-help-btn'].forEach(id => get(id).addEventListener('click', showHelpModal));
    get('help-close-btn').addEventListener('click', hideHelpModal);
    get('help-prev-btn').addEventListener('click', () => navigateHelpModal(-1));
    get('help-next-btn').addEventListener('click', () => navigateHelpModal(1));

    const skillResolveBtn = get('skill-challenge-resolve-btn');
    if (skillResolveBtn && !skillResolveBtn._bound) {
        skillResolveBtn.addEventListener('click', () => {
            socket.emit('playerAction', { action: 'resolveSkillCheck' });
            // Optimistically hide to prevent stuck UI; server will immediately update state
            const m = get('skill-challenge-modal');
            if (m) m.classList.add('hidden');
        });
        skillResolveBtn._bound = true;
    }
    const skillDeclineBtn = get('skill-challenge-decline-btn');
    if (skillDeclineBtn && !skillDeclineBtn._bound) {
        skillDeclineBtn.addEventListener('click', () => {
            const m = get('skill-challenge-modal');
            if (m) m.classList.add('hidden');
            // Reset prompt so it can show again if still applicable later
            clientState.hasSeenSkillChallengePrompt = false;
        });
        skillDeclineBtn._bound = true;
    }

    get('card-inspector-modal').addEventListener('click', (e) => {
        if (e.target.id === 'card-inspector-modal') {
             get('card-inspector-modal').classList.add('hidden');
        }
    });
    get('card-inspector-content').addEventListener('click', (e) => {
        if (e.target.closest('.modal-close-btn')) {
            get('card-inspector-modal').classList.add('hidden');
        } else {
            e.stopPropagation();
        }
    });

    get('player-inspector-modal').addEventListener('click', (e) => {
        if (e.target.id === 'player-inspector-modal' || e.target.closest('.modal-close-btn')) {
            get('player-inspector-modal').classList.add('hidden');
        }
    });
    get('player-inspector-content').addEventListener('click', e => e.stopPropagation());

    get('level-up-confirm-btn').addEventListener('click', () => {
        if (clientState.selectedLevelUpStat) {
            socket.emit('playerAction', {
                action: 'resolveLevelUpChoice',
                stat: clientState.selectedLevelUpStat
            });
            get('level-up-modal').classList.add('hidden');
            clientState.selectedLevelUpStat = null;
            // CRITICAL FIX: Resume game when level up modal closes
            NotificationManager.resumeGameFromModal('level-up');
        }
    });

    get('confirmation-cancel-btn').addEventListener('click', () => {
        get('confirmation-modal').classList.add('hidden');
    });
}

// --- 4. MODAL & POPUP LOGIC ---
function switchMobileScreen(screenName) {
    document.querySelectorAll('.mobile-screen').forEach(s => s.classList.remove('active'));
    get(`mobile-screen-${screenName}`).classList.add('active');
    document.querySelectorAll('.mobile-bottom-nav .nav-btn').forEach(b => b.classList.remove('active'));
    document.querySelector(`.mobile-bottom-nav .nav-btn[data-screen="${screenName}"]`).classList.add('active');
}

function isUiBusyWithRolls() {
    const diceModal = get('dice-roll-modal');
    const diceOpen = diceModal && !diceModal.classList.contains('hidden');
    const spectatorActive = !!document.querySelector('#spectator-roll-toast-container .spectator-roll-toast');
    return diceOpen || spectatorActive;
}

function isYourTurnPopupVisible() {
    const popup = get('your-turn-popup');
    return popup && !popup.classList.contains('hidden');
}

function processToastQueue() { /* replaced by NotificationManager */ }

function showToast(message, type = 'info', duration = 3000) {
    NotificationManager.notify(message, type, duration);
}

function showChatPreview(sender, message) {
    const container = get('chat-preview-container');
    const preview = document.createElement('div');
    preview.className = 'chat-preview-item';
    preview.innerHTML = `<span class="chat-preview-sender">${sender}:</span> ${message}`;
    container.appendChild(preview);

    setTimeout(() => preview.classList.add('visible'), 10);
    setTimeout(() => {
        preview.classList.remove('visible');
        preview.addEventListener('transitionend', () => preview.remove());
    }, 5000);
}

/** Show YOUR TURN banner (visual only; turnPopupReady is driven by game state in renderGameplayState). */
function revealYourTurnBanner() {
    const popup = get('your-turn-popup');
    if (!popup) return;
    popup.setAttribute('role', 'status');
    popup.setAttribute('aria-live', 'assertive');
    popup.setAttribute('aria-atomic', 'true');
    popup.style.zIndex = '10001';
    popup.classList.remove('hidden');

    setTimeout(() => popup.classList.add('hidden'), 2500);
}

/** Bounded wait for clear UI, then show turn banner (for future callers; turn flow uses revealYourTurnBanner + outer gate). */
function showYourTurnPopup() {
    runWhenUngated(() => revealYourTurnBanner(), {
        intervalMs: 150,
        maxWaitMs: UI_GATE_MAX_WAIT_MS,
        onForcedRun: () => {
            NotificationManager.notify(
                'Your turn — if actions stay locked, close open dialogs (Help, Shop, Settings, etc.).',
                'warning',
                6500,
                { priority: NOTIFICATION_PRIORITY.critical }
            );
        }
    });
}

function showConfirmationModal({ title, prompt, onConfirm }) {
    const modal = get('confirmation-modal');
    get('confirmation-title').textContent = title;
    get('confirmation-prompt').innerHTML = prompt;

    const confirmBtn = get('confirmation-confirm-btn');
    // Clone and replace to remove old event listeners
    const newConfirmBtn = confirmBtn.cloneNode(true);
    confirmBtn.parentNode.replaceChild(newConfirmBtn, confirmBtn);

    newConfirmBtn.onclick = () => {
        onConfirm();
        modal.classList.add('hidden');
    };

    modal.classList.remove('hidden');
}

// AP error helper: centralized modal/toast for insufficient AP
function showApError(requiredAp = 1) {
    const title = 'Not enough AP';
    const prompt = `You need at least ${requiredAp} AP to perform this action.`;
    // Use confirmation modal style for consistency and a11y
    showConfirmationModal({ title, prompt, onConfirm: () => {} });
}

// End Turn prompt modal helpers
function showEndTurnPrompt() {
    const modal = get('end-turn-prompt');
    if (!modal) return;
    const cancelBtn = get('end-turn-cancel-btn');
    const confirmBtn = get('end-turn-confirm-btn');
    cancelBtn.onclick = () => modal.classList.add('hidden');
    confirmBtn.onclick = () => {
        modal.classList.add('hidden');
        if (typeof OfflineActionHandler !== 'undefined' && OfflineActionHandler.isOffline()) {
            OfflineActionHandler.handleAction('endTurn');
        } else {
            socket.emit('endTurn');
        }
    };
    // A11y
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    runWhenUngated(
        () => {
            modal.classList.remove('hidden');
            clientState.endTurnPromptTimer = null;
        },
        {
            intervalMs: 200,
            maxWaitMs: UI_GATE_MAX_WAIT_MS,
            onForcedRun: () => {
                NotificationManager.notify(
                    'End turn prompt — close other windows if this dialog was slow to appear.',
                    'warning',
                    5000,
                    { priority: NOTIFICATION_PRIORITY.critical }
                );
            }
        }
    );
}

function showTargetSelectionModal({ title, prompt, targets, onSelect, onCancel }) {
    const modal = get('target-selection-modal');
    const targetList = get('target-selection-list');
    
    get('target-selection-title').textContent = title;
    get('target-selection-prompt').textContent = prompt;
    targetList.innerHTML = '';

    targets.forEach(target => {
        const btn = document.createElement('button');
        btn.className = 'btn btn-secondary';
        btn.textContent = target.name;
        btn.onclick = () => {
            onSelect(target);
            modal.classList.add('hidden');
        };
        targetList.appendChild(btn);
    });

    const cancelBtn = get('target-selection-cancel-btn');
    const newCancelBtn = cancelBtn.cloneNode(true);
    cancelBtn.parentNode.replaceChild(newCancelBtn, cancelBtn);
    
    newCancelBtn.onclick = () => {
        if (onCancel) onCancel();
        modal.classList.add('hidden');
    };
    
    modal.classList.remove('hidden');
}

function showNarrativeModal(weaponId, targetId) {
    clientState.activeItem = { weaponId, targetId };
    const weapon = Object.values(currentRoomState.players[myId].equipment).find(e => e?.id === weaponId) || { name: 'Unarmed Strike' };
    get('narrative-prompt').textContent = `How do you use your ${weapon.name}?`;
    get('narrative-input').value = '';
    get('narrative-modal').classList.remove('hidden');
}

function showGameOverModal({ winner, runXp, bonusXp }) {
    const title = get('game-over-title');
    const message = get('game-over-message');
    
    const isVictory = winner === 'Explorers';
    if (isVictory) {
        title.textContent = "Victory!";
        message.textContent = "You have overcome the challenges and completed your quest!";
    } else {
        title.textContent = "Your Run Has Ended...";
        message.textContent = "Your party has fallen. The darkness claims another victory. But your legend grows...";
    }
    
    const totalXp = runXp + bonusXp;
    get('game-over-run-xp').textContent = runXp;
    get('game-over-bonus-xp').textContent = bonusXp;
    get('game-over-total-xp').textContent = totalXp;
    
    const myPlayer = currentRoomState?.players?.[myId];
    const turnCount = currentRoomState?.gameState?.turnCount || 0;
    const monstersKilled = myPlayer?.enemiesDefeated || 0;
    const isMultiplayer = Object.keys(currentRoomState?.players || {}).filter(
        id => !currentRoomState.players[id].isNpc
    ).length > 1;

    accountManager.addXp(totalXp);
    accountManager.recordRunEnd(turnCount, monstersKilled, isVictory, isMultiplayer);
    
    get('game-over-modal').classList.remove('hidden');
}

function showClaimLootModal(item) {
    clientState.activeItem = item;
    const explorers = Object.values(currentRoomState.players).filter(p => p.role === 'Explorer');
    
    showTargetSelectionModal({
        title: `Claim ${item.name}`,
        prompt: 'Who should receive this item?',
        targets: explorers,
        onSelect: (selectedPlayer) => {
            socket.emit('playerAction', { 
                action: 'claimLoot', 
                itemId: clientState.activeItem.id, 
                targetPlayerId: selectedPlayer.id 
            });
            clientState.activeItem = null;
        },
        onCancel: () => {
            clientState.activeItem = null;
        }
    });
}

function showDiscoveryModal({ newCard }) {
    const modal = get('discovery-modal');
    const myPlayer = currentRoomState.players[myId];
    if (!myPlayer) return;

    const newItemContainer = get('discovery-new-item-container');
    const equippedContainer = get('discovery-equipped-container');
    const confirmBtn = get('discovery-confirm-btn');

    const itemType = newCard.type.toLowerCase();
    const equippedCard = myPlayer.equipment[itemType];

    clientState.activeItem = { newCard, equippedCard, keptItemId: null };
    confirmBtn.disabled = true;

    newItemContainer.innerHTML = '';
    equippedContainer.innerHTML = '';

    const handleCardSelection = (cardEl, cardId) => {
        modal.querySelectorAll('.card').forEach(c => c.classList.remove('selected-for-discard'));
        cardEl.classList.add('selected-for-discard');
        clientState.activeItem.keptItemId = cardId;
        confirmBtn.disabled = false;
    };

    const newCardEl = createCardElement(newCard);
    newCardEl.onclick = () => handleCardSelection(newCardEl, newCard.id);
    newItemContainer.appendChild(newCardEl);

    const equippedCardEl = createCardElement(equippedCard);
    if(equippedCard) {
        equippedCardEl.onclick = () => handleCardSelection(equippedCardEl, equippedCard.id);
    }
    equippedContainer.appendChild(equippedCardEl);

    modal.classList.remove('hidden');
}

function handleUseConsumable(card) {
    const effect = card.effect;
    clientState.activeItem = card;

    if (effect.target === 'any-player') {
        const explorers = Object.values(currentRoomState.players).filter(p => p.role === 'Explorer' && !p.isDowned);
        showTargetSelectionModal({
            title: `Use ${card.name} on...`,
            prompt: 'Select a player to target.',
            targets: explorers,
            onSelect: (selectedPlayer) => {
                socket.emit('playerAction', { 
                    action: 'useConsumable', 
                    cardId: clientState.activeItem.id, 
                    targetId: selectedPlayer.id 
                });
                clientState.activeItem = null;
            },
            onCancel: () => { clientState.activeItem = null; }
        });
    } else if (effect.target === 'any-monster') {
        const monsters = currentRoomState.gameState.board.monsters;
        if (monsters.length > 0) {
            showTargetSelectionModal({
                title: `Use ${card.name} on...`,
                prompt: 'Select a monster to target.',
                targets: monsters,
                onSelect: (selectedMonster) => {
                    socket.emit('playerAction', { action: 'useConsumable', cardId: card.id, targetId: selectedMonster.id });
                    clientState.activeItem = null;
                },
                onCancel: () => { clientState.activeItem = null; }
            });
        } else {
            showToast('No monsters to target!', 'error');
            clientState.activeItem = null;
        }
    } else {
        // Check offline mode
        if (OfflineActionHandler.isOffline()) {
            OfflineActionHandler.handleAction('useConsumable', { cardId: card.id, targetId: myId });
        } else {
            socket.emit('playerAction', { action: 'useConsumable', cardId: card.id, targetId: myId });
        }
        clientState.activeItem = null;
    }
}

function handleCastSpell(card) {
    const effect = card.effect;
    clientState.activeItem = card;

    const basePayload = { action: 'castSpell', cardId: clientState.activeItem.id };

    if (!effect.target || ['self', 'aoe', 'party'].includes(effect.target) || effect.type === 'utility') {
        if (OfflineActionHandler.isOffline()) {
            OfflineActionHandler.handleAction('castSpell', { cardId: card.id, targetId: myId });
        } else {
            socket.emit('playerAction', basePayload);
        }
        clientState.activeItem = null;
    } else if (effect.target === 'any-player') {
        const explorers = Object.values(currentRoomState.players).filter(p => p.role === 'Explorer');
        showTargetSelectionModal({
            title: `Cast ${card.name} on...`,
            prompt: 'Select a player to target.',
            targets: explorers,
            onSelect: (selectedPlayer) => {
                if (OfflineActionHandler.isOffline()) {
                    OfflineActionHandler.handleAction('castSpell', { cardId: card.id, targetId: selectedPlayer.id });
                } else {
                    socket.emit('playerAction', { ...basePayload, targetId: selectedPlayer.id });
                }
                clientState.activeItem = null;
            },
            onCancel: () => { clientState.activeItem = null; }
        });
    } else if (effect.target === 'any-monster' || effect.target === 'multi-monster') {
        const monsters = currentRoomState.gameState.board.monsters;
        if (monsters.length > 0) {
             showTargetSelectionModal({
                title: `Cast ${card.name} on...`,
                prompt: 'Select a monster to target.',
                targets: monsters,
                onSelect: (selectedMonster) => {
                    if (OfflineActionHandler.isOffline()) {
                        OfflineActionHandler.handleAction('castSpell', { cardId: card.id, targetId: selectedMonster.id });
                    } else {
                        socket.emit('playerAction', { ...basePayload, targetId: selectedMonster.id });
                    }
                    clientState.activeItem = null;
                },
                onCancel: () => { clientState.activeItem = null; }
            });
        } else {
            showToast('No monsters to target!', 'error');
            clientState.activeItem = null;
        }
    }
}

/**
 * Creates a detailed, stat-block style view for a card.
 * @param {object} card - The full card data object.
 * @returns {HTMLElement} The HTML element for the detailed view.
 */
function createDetailedCardView(card) {
    const container = document.createElement('div');
    container.className = 'detailed-card-view';

    const createStatLine = (label, value, icon, iconColor) => {
        if (value === undefined || value === null || value === '' || (value === 0 && (label.toLowerCase().includes('bonus') || ['str', 'dex', 'con', 'int', 'wis', 'cha'].includes(label.toLowerCase())))) return '';
        const iconHTML = icon ? `<span class="material-symbols-outlined icon-${iconColor || 'default'}">${icon}</span>` : '';
        const valueHTML = `<span class="stat-value">${value}</span>`;
        return `<div class="stat-line">
                    ${iconHTML}
                    <span class="stat-label">${label}</span>
                    ${valueHTML}
                </div>`;
    };

    const bonusIconMap = {
        ap: { icon: 'bolt', color: 'ap' }, 
        damageBonus: { icon: 'swords', color: 'damage' }, 
        shieldBonus: { icon: 'security', color: 'shield' }, 
        maxHp: { icon: 'favorite', color: 'hp' },
        hitBonus: { icon: 'colorize', color: 'int' },
        str: { icon: 'fitness_center', color: 'str' }, 
        dex: { icon: 'sprint', color: 'dex' }, 
        con: { icon: 'shield_person', color: 'con' },
        int: { icon: 'school', color: 'int' },
        wis: { icon: 'self_improvement', color: 'wis' }, 
        cha: { icon: 'star', color: 'cha' }
    };

    let headerHTML = `<h2 class="detailed-card-title">${card.name}</h2>`;
    let statsHTML = '<div class="detailed-stats-grid">';
    
    statsHTML += createStatLine('Type', card.type, 'category');
    if (card.category) statsHTML += createStatLine('Category', card.category, 'sell');
    if (card.apCost !== undefined) statsHTML += createStatLine('AP Cost', card.apCost, 'bolt', 'ap');
    if (card.level) statsHTML += createStatLine('Spell Level', card.level, 'stars', 'special');
    
    if (card.type === 'Monster') {
        statsHTML += createStatLine('Max HP', card.maxHp, 'favorite', 'hp');
        statsHTML += createStatLine('Attack Bonus', `+${card.attackBonus}`, 'colorize', 'int');
        statsHTML += createStatLine('Armor Class', card.requiredRollToHit, 'security', 'shield');
        if (card.effect?.dice) statsHTML += createStatLine('Damage', card.effect.dice, 'casino', 'damage');
        statsHTML += createStatLine('XP Value', card.xpValue, 'workspace_premium', 'xp');
        if (card.stats) {
            statsHTML += `</div><h3 class="detailed-card-subheader">Core Stats</h3><div class="detailed-stats-grid">`;
            Object.entries(card.stats).forEach(([stat, value]) => {
                const mapEntry = bonusIconMap[stat];
                if (mapEntry) {
                    statsHTML += createStatLine(stat.toUpperCase(), value, mapEntry.icon, mapEntry.color);
                }
            });
        }
    }

    if (card.effect?.dice && card.type !== 'Monster') {
         statsHTML += createStatLine('Effect Dice', card.effect.dice, 'casino', 'damage');
    }

    if (card.effect?.bonuses && Object.keys(card.effect.bonuses).length > 0) {
        statsHTML += `</div><h3 class="detailed-card-subheader">Bonuses</h3><div class="detailed-stats-grid">`;
        for (const [key, value] of Object.entries(card.effect.bonuses)) {
             if (value === 0) continue;
             const mapEntry = bonusIconMap[key];
             const sign = value > 0 ? '+' : '';
             const label = key.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase());
             statsHTML += createStatLine(label, `${sign}${value}`, mapEntry?.icon, mapEntry?.color);
        }
    }

    statsHTML += '</div>';

    let descriptionHTML = `<div class="detailed-card-description">
                             <h3 class="detailed-card-subheader">Description</h3>
                             <p>${card.effect?.description || card.description || 'No description available.'}</p>
                           </div>`;
    
    let abilitiesHTML = '';
    if (card.type === 'Monster' && card.abilities?.length > 0) {
        abilitiesHTML = `<div class="detailed-card-abilities">
                            <h3 class="detailed-card-subheader">Abilities</h3>
                            ${card.abilities.map(ability => `<div class="ability-item"><strong>${ability.name}:</strong> ${ability.description}</div>`).join('')}
                        </div>`;
    }

    container.innerHTML = headerHTML + statsHTML + descriptionHTML + abilitiesHTML;
    return container;
}


function showCardInspectorModal(cardId) {
    let cardData;
    if (cardId === 'unarmed') {
        cardData = { 
            id: 'unarmed', name: 'Unarmed Strike', type: 'Weapon', apCost: 1, 
            effect: { 
                dice: '1d4', 
                description: 'A basic melee attack that does not require a weapon. The damage bonus from Strength still applies.' 
            } 
        };
    } else {
        const shopInv = currentRoomState?.gameState?.shop?.inventory || [];
        const allCards = [
            ...shopInv,
            ...Object.values(currentRoomState.players).flatMap(p => [...p.hand, ...Object.values(p.equipment)]),
            ...currentRoomState.gameState.board.monsters,
            ...currentRoomState.gameState.board.environment,
            ...currentRoomState.gameState.lootPool,
        ];
        cardData = allCards.find(c => c && c.id === cardId);
    }

    if (!cardData) {
        console.error("Card data not found for inspector:", cardId);
        return;
    }

    const modal = get('card-inspector-modal');
    const viewContainer = get('card-inspector-view-container');
    
    const detailedView = createDetailedCardView(cardData);

    viewContainer.innerHTML = '';
    viewContainer.appendChild(detailedView);

    // Ensure inspector appears above shop/level-up by closing lower-priority modals
    try {
        // Close confirmation to avoid stacking
        get('confirmation-modal')?.classList.add('hidden');
    } catch (_) {}
    
    // CRITICAL FIX: Set high z-index to appear above shop modal
    modal.style.zIndex = '10002'; // Higher than shop modal
    modal.classList.remove('hidden');
}

function showPlayerInspectorModal(playerId) {
    const player = currentRoomState.players[playerId];
    if (!player) return;

    const modal = get('player-inspector-modal');
    get('player-inspector-title').textContent = `${player.name}'s Character Sheet`;
    const content = get('player-inspector-content');
    content.innerHTML = '';

    // --- Character Sheet Section ---
    const sheetContainer = document.createElement('div');
    sheetContainer.className = 'panel mobile-panel'; // FIX: Add panel classes for consistent layout
    sheetContainer.innerHTML = createPlayerSheetHTML(player, false);
    content.appendChild(sheetContainer);

    // --- Equipment Section ---
    const equipmentContainer = document.createElement('div');
    equipmentContainer.className = 'panel mobile-panel';
    equipmentContainer.innerHTML = `<h2 class="panel-header">Equipped Items</h2>`;
    const eqPanelContent = document.createElement('div');
    eqPanelContent.className = 'panel-content';
    const equippedItemsRow = document.createElement('div');
    equippedItemsRow.className = 'card-container-row';

    const equippedItems = Object.values(player.equipment).filter(item => item);
    if (equippedItems.length > 0) {
        equippedItems.forEach(item => {
            equippedItemsRow.appendChild(createCardElement(item));
        });
    } else {
        equippedItemsRow.innerHTML = `<p class="empty-pool-text">Nothing equipped.</p>`;
    }
    eqPanelContent.appendChild(equippedItemsRow);
    equipmentContainer.appendChild(eqPanelContent);
    content.appendChild(equipmentContainer);

    // --- Hand Section ---
    const handContainer = document.createElement('div');
    handContainer.className = 'panel mobile-panel';
    handContainer.innerHTML = `<h2 class="panel-header">Items in Hand (${player.hand.length})</h2>`;
    const handPanelContent = document.createElement('div');
    handPanelContent.className = 'panel-content';
    const handItemsRow = document.createElement('div');
    handItemsRow.className = 'card-container-row';

    if (player.hand.length > 0) {
        player.hand.forEach(card => {
            handItemsRow.appendChild(createCardElement(card));
        });
    } else {
        handItemsRow.innerHTML = `<p class="empty-pool-text">Hand is empty.</p>`;
    }
    handPanelContent.appendChild(handItemsRow);
    handContainer.appendChild(handPanelContent);
    content.appendChild(handContainer);

    modal.classList.remove('hidden');
}

function showChooseToDiscardModal({ newCard, currentHand }) {
    const modal = get('choose-discard-modal');
    const newCardContainer = get('new-card-to-discard-container');
    const handContainer = get('hand-cards-to-discard-container');
    const confirmBtn = get('confirm-discard-btn');

    clientState.activeItem = { newCard, currentHand, selectedCardId: null };
    confirmBtn.disabled = true;

    newCardContainer.innerHTML = '';
    handContainer.innerHTML = '';
    
    const handleCardSelection = (cardEl, cardId) => {
        modal.querySelectorAll('.card').forEach(c => c.classList.remove('selected-for-discard'));
        cardEl.classList.add('selected-for-discard');
        clientState.activeItem.selectedCardId = cardId;
        confirmBtn.disabled = false;
    };

    const newCardEl = createCardElement(newCard);
    newCardEl.onclick = () => handleCardSelection(newCardEl, newCard.id);
    newCardContainer.appendChild(newCardEl);

    currentHand.forEach(card => {
        const cardEl = createCardElement(card);
        cardEl.onclick = () => handleCardSelection(cardEl, card.id);
        handContainer.appendChild(cardEl);
    });

    modal.classList.remove('hidden');
}

function showSkillChallengeModal(stage, challengeName) {
     const modal = get('skill-challenge-modal');
     get('skill-challenge-title').textContent = challengeName || "A New Challenge!";
     get('skill-challenge-description').textContent = stage.description;
     // Add a light dice preview for risk flavor
     try {
         const desc = get('skill-challenge-description');
         const prev = document.createElement('div');
         prev.className = 'risk-roll-preview';
         prev.innerHTML = `<span class="material-symbols-outlined">casino</span> Roll a d20 vs DC shown.`;
         if (desc && !desc.nextSibling?.classList?.contains('risk-roll-preview')) {
             desc.parentNode.insertBefore(prev, desc.nextSibling);
         }
     } catch (e) {
         console.warn('[showSkillChallengeModal] Preview insertion failed:', e.message);
     }
     modal.classList.remove('hidden');
}

function showLevelUpModal({ level, class: className, currentStats }) {
    const modal = get('level-up-modal');
    const title = get('level-up-title');
    const description = get('level-up-description');
    const choicesContainer = get('level-up-stat-choices');
    const confirmBtn = get('level-up-confirm-btn');

    // CRITICAL FIX: Pause game when level up modal opens
    NotificationManager.pauseGameForModal('level-up');

    title.textContent = `Level ${level}!`;
    description.textContent = `You have grown stronger! As a ${className}, choose a stat to permanently increase for this run.`;
    choicesContainer.innerHTML = '';
    confirmBtn.disabled = true;
    clientState.selectedLevelUpStat = null;

    const coreStats = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
    const statIconMap = {
        str: 'fitness_center', dex: 'sprint', con: 'shield_person',
        int: 'school', wis: 'self_improvement', cha: 'star'
    };

    coreStats.forEach(stat => {
        const choiceEl = document.createElement('div');
        choiceEl.className = 'level-up-stat-choice';
        choiceEl.dataset.stat = stat;
        const currentVal = currentRoomState.players[myId].stats[stat] || 0;

        choiceEl.innerHTML = `
            <span class="material-symbols-outlined" style="color:var(--stat-color-${stat})">${statIconMap[stat]}</span>
            <div class="level-up-stat-info">
                <div class="level-up-stat-name">${stat.toUpperCase()}</div>
                <div class="level-up-stat-value">${currentVal} &rarr; ${currentVal + 1}</div>
            </div>
            <button class="btn-icon stat-detail-btn" data-stat="${stat}" title="View ${stat.toUpperCase()} details">
                <span class="material-symbols-outlined">info</span>
            </button>
        `;
        
        choiceEl.addEventListener('click', (e) => {
            // Don't trigger selection if clicking the detail button
            if (e.target.closest('.stat-detail-btn')) return;
            
            choicesContainer.querySelectorAll('.level-up-stat-choice').forEach(el => el.classList.remove('selected'));
            choiceEl.classList.add('selected');
            clientState.selectedLevelUpStat = stat;
            confirmBtn.disabled = false;
        });

        // Add detail button event listener
        const detailBtn = choiceEl.querySelector('.stat-detail-btn');
        detailBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            showStatDetailModal(stat);
        });

        choicesContainer.appendChild(choiceEl);
    });

    modal.classList.remove('hidden');
}

function showStatDetailModal(stat) {
    const modal = get('stat-detail-modal');
    const title = get('stat-detail-title');
    const description = get('stat-detail-description');
    const effects = get('stat-detail-effects');
    
    const statDetails = {
        str: {
            name: 'Strength',
            description: 'Physical power and muscle strength',
            effects: [
                'Increases damage dealt with melee weapons',
                'Improves carrying capacity',
                'Affects certain skill checks and interactions',
                'Higher STR = More damage with swords, axes, and clubs'
            ]
        },
        dex: {
            name: 'Dexterity',
            description: 'Agility, reflexes, and coordination',
            effects: [
                'Increases accuracy with ranged weapons',
                'Improves dodge chance and reflexes',
                'Affects initiative and movement speed',
                'Higher DEX = Better accuracy with bows, daggers, and darts'
            ]
        },
        con: {
            name: 'Constitution',
            description: 'Health, endurance, and vitality',
            effects: [
                'Increases maximum hit points',
                'Improves resistance to poison and disease',
                'Affects stamina and endurance checks',
                'Higher CON = More HP and better survival'
            ]
        },
        int: {
            name: 'Intelligence',
            description: 'Reasoning, memory, and analytical ability',
            effects: [
                'Improves spell effectiveness for mages',
                'Affects learning and knowledge checks',
                'Better problem-solving abilities',
                'Higher INT = More powerful spells and better magic'
            ]
        },
        wis: {
            name: 'Wisdom',
            description: 'Awareness, intuition, and insight',
            effects: [
                'Improves perception and awareness',
                'Better resistance to mental effects',
                'Affects insight and survival checks',
                'Higher WIS = Better perception and mental resistance'
            ]
        },
        cha: {
            name: 'Charisma',
            description: 'Force of personality, leadership, and social skills',
            effects: [
                'Improves social interactions and persuasion',
                'Better leadership and party coordination',
                'Affects intimidation and performance',
                'Higher CHA = Better social skills and party bonuses'
            ]
        }
    };
    
    const detail = statDetails[stat];
    if (!detail) return;
    
    title.textContent = detail.name;
    description.textContent = detail.description;
    
    effects.innerHTML = '';
    detail.effects.forEach(effect => {
        const li = document.createElement('li');
        li.textContent = effect;
        effects.appendChild(li);
    });
    
    modal.classList.remove('hidden');
}


function showHelpModal() {
    qcDebug('[Guide] showHelpModal() called');
    const modal = get('help-modal');
    if (!modal) {
        console.error('[Guide] help-modal element not found!');
        return;
    }
    clientState.helpModalPage = 0;
    renderHelpModalContent();
    modal.classList.remove('hidden');
    qcDebug('[Guide] Modal shown successfully');
}
function hideHelpModal() {
    get('help-modal').classList.add('hidden');
}
function navigateHelpModal(direction) {
    const totalPages = helpContent.length;
    clientState.helpModalPage = (clientState.helpModalPage + direction + totalPages) % totalPages;
    renderHelpModalContent();
}
function renderHelpModalContent() {
    const page = helpContent[clientState.helpModalPage];
    get('help-content').innerHTML = `
        <h3><span class="material-symbols-outlined help-icon">${page.icon}</span>${page.title}</h3>
        ${page.content}
    `;
    get('help-page-indicator').textContent = `Page ${clientState.helpModalPage + 1} / ${helpContent.length}`;
    get('help-prev-btn').disabled = clientState.helpModalPage === 0;
    get('help-next-btn').disabled = clientState.helpModalPage === helpContent.length - 1;
}

const helpContent = [
    {
        icon: 'menu_book',
        title: 'Welcome to Quest & Chronicle',
        content: `<p>This guide will walk you through the basics of playing the game. Use the "Next" and "Previous" buttons to navigate.</p><p><b>The Goal:</b> As a party of Explorers, your goal is to survive challenges, defeat monsters, and overcome the scenario set by the Dungeon Master (DM). Victory is often achieved by defeating a powerful boss or completing a multi-stage objective.</p>`
    },
    {
        icon: 'calendar_today',
        title: 'Daily Challenge',
        content: `
            <p>Each day features a <b>deterministic seeded run</b> with unique modifiers (e.g., Enemies +25% HP, No shops, Double XP). Compete on a level playing field!</p>
            <ul>
                <li><b>Seed:</b> Fixed per UTC day</li>
                <li><b>Modifiers:</b> Applied globally; shop rooms are skipped if 'No shops' is active</li>
                <li><b>Progress:</b> Earn XP and unlock loadouts as normal</li>
            </ul>
        `
    },
    {
        icon: 'store',
        title: 'Shops & Gold',
        content: `
            <p>Visit shops to purchase items, spells, weapons, and armor.</p>
            <ul>
                <li><b>Gold:</b> Earned during runs; displayed in the shop modal</li>
                <li><b>Inventory:</b> Biased to your class needs</li>
                <li><b>Daily:</b> If a daily modifier says 'No shops', shop rooms are not offered</li>
            </ul>
        `
    },
    {
        icon: 'save',
        title: 'Loadouts & Legacy',
        content: `
            <p>Save your favorite configurations and re-apply them easily.</p>
            <ul>
                <li><b>Save Loadout:</b> Saves your class and equipped items</li>
                <li><b>Apply Loadout:</b> Pick a saved loadout from the Legacy modal; class must match</li>
                <li><b>Persistence:</b> Loadouts are stored on your device (localStorage)</li>
            </ul>
        `
    },
    {
        icon: 'terrain',
        title: 'Terrain, Cover & Elevation',
        content: `
            <p>Combat is tactical: cover reduces hit chance; elevation grants advantage.</p>
            <ul>
                <li><b>Cover:</b> Reduces attacker bonus and can impose disadvantage</li>
                <li><b>High Ground:</b> Grants advantage to attacks</li>
                <li><b>Flanking:</b> Attacking from opposite sides adds bonuses and can trigger synergies</li>
            </ul>
        `
    },
    {
        icon: 'local_fire_department',
        title: 'Status Combos: Oil/Wet',
        content: `
            <p>Elemental combos add depth:</p>
            <ul>
                <li><b>Oiled + Fire:</b> Combustion synergy triggers extra damage</li>
                <li><b>Wet + Lightning:</b> Electrocute synergy shocks for bonus damage</li>
                <li><b>Sources:</b> Oil Flask, Grease Bomb (AOE Oiled), Drench, Water Jet (AOE Wet)</li>
            </ul>
        `
    },
    {
        icon: 'bolt',
        title: 'Your Turn & Core Stats',
        content: `
            <p>On your turn, you can spend <b class="help-keyword ap">Action Points (AP)</b> to perform actions. You regain all your AP at the start of your turn.</p>
            <ul>
                <li><b class="help-keyword hp">Health Points (HP):</b> If this reaches 0, you are Downed.</li>
                <li><b class="help-keyword ap">Action Points (AP):</b> The resource you spend to take actions like attacking or casting spells.</li>
                <li><b class="help-keyword damage">Damage Bonus:</b> Added to your damage rolls.</li>
                <li><b class="help-keyword shield">Shield Bonus:</b> Added to your Shield HP when you use the Guard action.</li>
                <li><b class="help-keyword hit">Hit Bonus:</b> Added to your attack rolls to see if you hit an enemy.</li>
            </ul>`
    },
    {
        icon: 'analytics',
        title: 'Attributes & Their Effects',
        content: `
            <p>Your six core attributes affect your capabilities in different ways:</p>
            <ul>
                <li><b class="help-keyword">STR (Strength):</b> Increases <b>melee damage</b> and helps with feats of physical power. Adds to melee weapon damage rolls and physical skill checks.</li>
                <li><b class="help-keyword">DEX (Dexterity):</b> Increases <b>ranged damage</b> and helps with agility. Adds to ranged weapon damage rolls, dodge attempts, and precision tasks.</li>
                <li><b class="help-keyword">CON (Constitution):</b> Increases <b>maximum HP</b> and helps resist poison/disease. Every point adds to your HP pool and endurance checks.</li>
                <li><b class="help-keyword">INT (Intelligence):</b> Increases <b>spell damage</b> and helps with knowledge. Adds to spell damage rolls and arcane skill checks.</li>
                <li><b class="help-keyword">WIS (Wisdom):</b> Increases <b>healing power</b> and helps with perception. Adds to healing spell effects and insight checks.</li>
                <li><b class="help-keyword">CHA (Charisma):</b> Helps with <b>social interactions</b> and party morale. Affects persuasion and can influence party hope in special events.</li>
            </ul>
            <p><b>Leveling Up:</b> When you level up, you choose ONE attribute to permanently increase by +1 for this run!</p>`
    },
    {
        icon: 'swords',
        title: 'Taking Actions',
        content: `
            <p>Most cards in your hand or equipped have an AP cost. You can also take standard actions:</p>
            <ul>
                <li><b class="help-keyword action">Attack:</b> Use an equipped weapon to attack a monster. This will prompt a dice roll.</li>
                <li><b class="help-keyword action">Cast Spell:</b> Use a spell from your hand. Some spells require a target.</li>
                <li><b class="help-keyword action">Guard (1 AP):</b> Gain temporary Shield HP equal to your Shield Bonus. This Shield HP is lost at the end of your next turn.</li>
                <li><b class="help-keyword action">Respite (1 AP):</b> Heal a small amount of HP (1d4).</li>
                 <li><b class="help-keyword action">Rest (2 AP):</b> Heal a larger amount of HP based on your class.</li>
                <li><b class="help-keyword action">End Turn:</b> Click this when you are finished with your actions.</li>
            </ul>`
    },
    {
        icon: 'casino',
        title: 'Rolling the Dice',
        content: `
            <p>Many actions, like attacking or resolving challenges, require a dice roll. The game will prompt you when a roll is needed.</p>
            <ul>
                <li><b>Attack Rolls:</b> You roll a 20-sided die (d20) and add your <b class="help-keyword hit">Hit Bonus</b>. If the total is greater than or equal to the monster's Armor Class (AC), you <b class="help-keyword success">hit</b>!</li>
                <li><b>Damage Rolls:</b> If you hit, you'll be prompted to roll for damage. This uses the dice shown on your weapon card, plus your <b class="help-keyword damage">Damage Bonus</b>.</li>
                <li><b>Skill Checks:</b> For challenges, you roll a d20 and add the relevant stat bonus (e.g., STR, DEX). If you meet or beat the Difficulty Class (DC), you <b class="help-keyword success">succeed</b>.</li>
            </ul>`
    },
    {
        icon: 'stars',
        title: 'Party Hope',
        content: `<p>The Party Hope meter represents the party's morale. It ranges from 0 to 10.</p>
            <ul>
                <li>Hope increases when you score critical hits or defeat powerful enemies.</li>
                <li>Hope decreases when a player is Downed.</li>
                <li><b>High Hope (Inspired):</b> At 9 or 10 Hope, the party gains a +1 bonus to all Hit rolls!</li>
                <li><b>Low Hope (Despairing):</b> At 2 or less Hope, the party suffers a -1 penalty to all Hit rolls.</li>
            </ul>`
    },
    {
        icon: 'redeem',
        title: 'Loot & Items',
        content: `
            <p>Defeating monsters has a chance to drop loot! This loot appears in the "Party Discoveries" panel. Any player can click "Claim" on an item to open a menu and decide who in the party receives it.</p>
            <p>Items have rarities, indicated by their border color:</p>
            <ul>
                <li><b class="help-keyword uncommon">Uncommon (Green):</b> A slight magical enhancement.</li>
                <li><b class="help-keyword rare">Rare (Blue):</b> A significant magical power.</li>
                <li><b class="help-keyword legendary">Legendary (Purple):</b> A powerful, game-changing artifact.</li>
            </ul>`
    },
     {
        icon: 'search',
        title: 'Card Details',
        content: `
            <p>Confused about what a card does? Click the small <span class="material-symbols-outlined help-icon">search</span> icon in the top-right corner of any card to open the Card Inspector. This will show you a detailed breakdown of all its stats and abilities.</p>`
    },
    {
        icon: 'trending_up',
        title: 'Infinite Runs & Leveling',
        content: `<p>The game no longer has a fixed end! Your goal is to survive as long as possible against increasingly difficult foes. Monsters will grow stronger every 10 rounds after round 20.</p>
            <p>To keep up, you can level up during your run!</p>
            <ul>
                <li>Defeating monsters grants you <b class="help-keyword xp">Experience Points (XP)</b>.</li>
                <li>When your XP bar is full, you'll <b class="help-keyword success">level up</b>!</li>
                <li>Leveling up grants you a <b class="help-keyword success">full heal</b> and a <b class="help-keyword success">permanent +1 bonus</b> to your class's primary stat for the rest of the current run.</li>
            </ul>`
    },
    {
        icon: 'account_circle',
        title: 'Account XP & Upgrades',
        content: `<p>Your performance in each run contributes to your permanent account progression, which is saved on your device.</p>
            <ul>
                <li>At the end of a run, your <b class="help-keyword action">Run Score</b> is converted into <b class="help-keyword xp">Account XP</b>.</li>
                <li>On the main menu, navigate to the <b class="help-keyword action">Legend & Legacy</b> screen to spend this Account XP on <b class="help-keyword action">Permanent Upgrades</b>.</li>
                <li>These upgrades grant small bonuses, like +1 to a base stat, that apply to <b class="help-keyword">all future runs</b> with that class, helping you get further each time!</li>
            </ul>`
    },
    {
        icon: 'grid_on',
        title: 'Combat Grid & Positioning',
        content: `<p>Combat happens on a <b class="help-keyword">5×5 tactical grid</b> where position matters!</p>
            <ul>
                <li><b class="help-keyword">Grid Layout:</b> Monsters spawn in front rows (0-2), players start in back rows (3-4).</li>
                <li><b class="help-keyword">Flanking:</b> When you and an ally are both adjacent to an enemy, you <b class="help-keyword success">flank</b> them for a <b>+2 attack bonus</b>!</li>
                <li><b class="help-keyword">Mobile:</b> Tap "View Grid" button to see the battlefield, then tap green cells to move.</li>
                <li><b>Tip:</b> Coordinate with your party to surround enemies and gain flanking bonuses!</li>
            </ul>`
    },
    {
        icon: 'directions_run',
        title: 'Movement & Weapon Ranges',
        content: `
            <p><b class="help-keyword">Movement Points:</b> You have <b>2 movement points</b> per turn (4 with Dash action). Moving costs 1 point per cell (Manhattan distance).</p>
            
            <p><b class="help-keyword">How to Move:</b></p>
            <ul>
                <li><b>Desktop:</b> Click green highlighted cells on the grid.</li>
                <li><b>Mobile:</b> Tap "View Grid" button, then tap green cells.</li>
                <li>You'll see a toast notification and the destination will pulse golden!</li>
            </ul>
            
            <p><b class="help-keyword">Weapon Ranges</b> (Advanced & Custom modes):</p>
            <ul>
                <li><b class="help-keyword damage">Melee Weapons</b> (Swords, Axes, Daggers): Must be <b>adjacent (1 cell)</b> to attack. Great for close combat!</li>
                <li><b class="help-keyword action">Reach Weapons</b> (Spears, Halberds): Can attack up to <b>2 cells</b> away. Good middle ground!</li>
                <li><b class="help-keyword dex">Ranged Weapons</b> (Bows, Crossbows): Must be <b>2+ cells away</b>. Can't attack adjacent targets (too close!).</li>
                <li><b class="help-keyword int">Magic Spells:</b> No range limit! Cast from anywhere on the grid.</li>
            </ul>
            
            <p><b>Note:</b> Beginner mode has no range restrictions (attack from anywhere). Advanced mode enforces ranges. Custom mode lets you choose!</p>`
    },
    {
        icon: 'auto_awesome',
        title: 'Synergies & Combos',
        content: `<p>Certain actions and abilities can <b class="help-keyword">combine for powerful synergies</b>!</p>
            <ul>
                <li><b class="help-keyword success">Coordinated Strike:</b> When an ally uses Help on you, your next attack deals <b>+3 damage</b>!</li>
                <li><b class="help-keyword success">Charge:</b> Use Dash then Attack in the same turn for <b>+2 damage</b>!</li>
                <li><b class="help-keyword success">Devastating Blow:</b> Flanking + Critical Hit deals <b>TRIPLE damage</b>!</li>
                <li><b class="help-keyword success">Shield Wall:</b> Stand next to an ally and both get <b>+2 shield</b>!</li>
                <li><b>Watch for epic popup notifications when you trigger synergies!</b> Try different combinations to discover more.</li>
            </ul>`
    },
    {
        icon: 'stars',
        title: 'Specializations & Abilities',
        content: `<p>As you level up, you can specialize your character with unique abilities!</p>
            <ul>
                <li><b>Level 3, 5, and 7:</b> Choose a specialization branch for your class.</li>
                <li><b>3 Branches per class:</b> Each offers a different playstyle (damage, tank, support, etc.).</li>
                <li><b>Passive bonuses:</b> Immediately improve your stats.</li>
                <li><b>Active abilities:</b> New actions you can use in combat.</li>
                <li><b>Example:</b> Barbarian → Berserker path grants increased critical damage and the "Execute" ability!</li>
            </ul>`
    },
];

function renderLegacyScreen(activeClass = clientState.activeLegacyClassTab) {
    get('legacy-xp-total').textContent = accountManager.data.xp;
    
    const essenceEl = get('legacy-essence-total');
    if (essenceEl) essenceEl.textContent = accountManager.data.essence || 0;
    
    const navContainer = get('legacy-class-nav');
    const contentContainer = get('legacy-class-content');
    if (!navContainer || !contentContainer) return;

    const classToShow = activeClass || clientState.activeLegacyClassTab;

    const classIconMap = {
        Barbarian: 'stadium', Cleric: 'ecg_heart', Mage: 'auto_awesome',
        Ranger: 'forest', Rogue: 'footprints', Warrior: 'swords'
    };

    navContainer.innerHTML = [
        ...Object.keys(staticClassData).map(className => `
            <button class="legacy-nav-item ${className === classToShow ? 'active' : ''}" data-class-name="${className}">
                <span class="material-symbols-outlined legacy-nav-icon">${classIconMap[className] || 'shield'}</span>
                ${className}
            </button>
        `),
        `<button class="legacy-nav-item ${classToShow === '__achievements' ? 'active' : ''}" data-class-name="__achievements">
            <span class="material-symbols-outlined legacy-nav-icon">emoji_events</span>
            Achievements
        </button>`,
        `<button class="legacy-nav-item ${classToShow === '__perks' ? 'active' : ''}" data-class-name="__perks">
            <span class="material-symbols-outlined legacy-nav-icon">stars</span>
            Perks
        </button>`
    ].join('');
    
    contentContainer.innerHTML = '';

    if (classToShow === '__achievements') {
        renderAchievementsTab(contentContainer);
        return;
    }
    if (classToShow === '__perks') {
        renderMetaPerksTab(contentContainer);
        return;
    }

    const classData = staticClassData[classToShow];
    if (!classData) {
        contentContainer.innerHTML = `<p>Select a class to view its legacy.</p>`;
        return;
    }
    
    const header = document.createElement('div');
    header.className = 'legacy-class-page-header';
    header.innerHTML = `<h3 class="legacy-class-title">${classToShow}</h3>`;
    contentContainer.appendChild(header);

    const upgradesGrid = document.createElement('div');
    upgradesGrid.className = 'account-upgrades-grid';

    Object.entries(classData.stats).forEach(([stat, baseValue]) => {
        const currentLevel = accountManager.data.upgrades[classToShow]?.[stat] || 0;
        const cost = accountManager.getUpgradeCost(classToShow, stat);
        const canAfford = accountManager.data.xp >= cost;
        
        const upgradeCard = document.createElement('div');
        upgradeCard.className = 'upgrade-card';
        upgradeCard.innerHTML = `
            <div class="upgrade-stat-name">${stat.toUpperCase()}</div>
            <div class="upgrade-stat-value">${baseValue + currentLevel}</div>
            <div class="upgrade-level">Current Bonus: +${currentLevel}</div>
            <button class="btn btn-sm account-upgrade-btn" data-class-name="${classToShow}" data-stat="${stat}" ${!canAfford ? 'disabled' : ''}>
                Upgrade (+1)
                <div class="upgrade-cost">Cost: ${cost} XP</div>
            </button>
        `;
        upgradesGrid.appendChild(upgradeCard);
    });
    
    contentContainer.appendChild(upgradesGrid);
}

function renderAchievementsTab(container) {
    const header = document.createElement('div');
    header.className = 'legacy-class-page-header';
    header.innerHTML = `<h3 class="legacy-class-title">Achievements</h3>
        <p class="legacy-subtitle">Earn Essence by completing challenges</p>`;
    container.appendChild(header);

    const grid = document.createElement('div');
    grid.className = 'achievements-grid';

    for (const [id, def] of Object.entries(accountManager.achievementDefs)) {
        const unlocked = !!accountManager.data.achievements[id];
        const card = document.createElement('div');
        card.className = `achievement-card ${unlocked ? 'unlocked' : 'locked'}`;
        card.innerHTML = `
            <span class="material-symbols-outlined achievement-icon">${def.icon}</span>
            <div class="achievement-info">
                <div class="achievement-name">${def.name}</div>
                <div class="achievement-desc">${def.description}</div>
                <div class="achievement-reward">${unlocked ? 'Completed' : `+${def.reward} Essence`}</div>
            </div>
        `;
        grid.appendChild(card);
    }

    container.appendChild(grid);

    const statsSection = document.createElement('div');
    statsSection.className = 'account-stats-section';
    const stats = accountManager.data.stats || {};
    statsSection.innerHTML = `
        <h4>Your Stats</h4>
        <div class="stats-grid">
            <div class="stat-item"><span class="stat-label">Games Played</span><span class="stat-value">${stats.gamesPlayed || 0}</span></div>
            <div class="stat-item"><span class="stat-label">Monsters Defeated</span><span class="stat-value">${stats.monstersDefeated || 0}</span></div>
            <div class="stat-item"><span class="stat-label">Bosses Defeated</span><span class="stat-value">${stats.bossesDefeated || 0}</span></div>
            <div class="stat-item"><span class="stat-label">Dungeons Completed</span><span class="stat-value">${stats.dungeonsCompleted || 0}</span></div>
            <div class="stat-item"><span class="stat-label">Highest Round</span><span class="stat-value">${stats.highestRound || 0}</span></div>
            <div class="stat-item"><span class="stat-label">Synergies Triggered</span><span class="stat-value">${stats.synergiesTriggered || 0}</span></div>
        </div>
    `;
    container.appendChild(statsSection);
}

function renderMetaPerksTab(container) {
    const header = document.createElement('div');
    header.className = 'legacy-class-page-header';
    header.innerHTML = `<h3 class="legacy-class-title">Meta Perks</h3>
        <p class="legacy-subtitle">Spend Essence on permanent bonuses (Essence: ${accountManager.data.essence || 0})</p>`;
    container.appendChild(header);

    const grid = document.createElement('div');
    grid.className = 'meta-perks-grid';

    const tiers = [1, 2, 3];
    for (const tier of tiers) {
        const tierSection = document.createElement('div');
        tierSection.className = 'perk-tier-section';
        tierSection.innerHTML = `<h4 class="perk-tier-title">Tier ${tier}</h4>`;
        
        const tierGrid = document.createElement('div');
        tierGrid.className = 'perk-tier-grid';

        for (const [id, def] of Object.entries(accountManager.metaPerkDefs)) {
            if (def.tier !== tier) continue;
            const owned = !!accountManager.data.metaPerks[id];
            const canAfford = (accountManager.data.essence || 0) >= def.cost;
            
            const card = document.createElement('div');
            card.className = `perk-card ${owned ? 'owned' : ''} ${!owned && canAfford ? 'affordable' : ''}`;
            card.innerHTML = `
                <span class="material-symbols-outlined perk-icon">${def.icon}</span>
                <div class="perk-info">
                    <div class="perk-name">${def.name}</div>
                    <div class="perk-desc">${def.description}</div>
                </div>
                ${owned ? '<div class="perk-status">Unlocked</div>' :
                  `<button class="btn btn-sm perk-buy-btn" data-perk-id="${id}" ${!canAfford ? 'disabled' : ''}>
                      ${def.cost} Essence
                  </button>`}
            `;
            tierGrid.appendChild(card);
        }

        tierSection.appendChild(tierGrid);
        grid.appendChild(tierSection);
    }

    container.appendChild(grid);

    container.querySelectorAll('.perk-buy-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const perkId = btn.dataset.perkId;
            if (accountManager.purchaseMetaPerk(perkId)) {
                renderLegacyScreen('__perks');
            }
        });
    });
}


// --- 5. DICE ROLLING LOGIC ---
function createDieSVG(sides, value = '') {
    const svgNS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(svgNS, "svg");
    svg.setAttribute('viewBox', '0 0 100 100');
    svg.classList.add('die-svg');
    const shape = document.createElementNS(svgNS, "rect");
    shape.setAttribute('x', '10'); shape.setAttribute('y', '10');
    shape.setAttribute('width', '80'); shape.setAttribute('height', '80');
    shape.setAttribute('rx', '15');
    shape.classList.add('die-shape');
    svg.appendChild(shape);
    const text = document.createElementNS(svgNS, "text");
    text.setAttribute('x', '50%'); text.setAttribute('y', '50%');
    text.setAttribute('text-anchor', 'middle');
    text.classList.add('die-text'); text.textContent = value;
    svg.appendChild(text);
    const sidesText = document.createElementNS(svgNS, "text");
    sidesText.setAttribute('x', '50%'); sidesText.setAttribute('y', '85%');
    sidesText.setAttribute('text-anchor', 'middle');
    sidesText.classList.add('die-sides-text'); sidesText.textContent = `d${sides}`;
    svg.appendChild(sidesText);
    return svg;
}

function showDiceRollModal(data) {
    const modal = get('dice-roll-modal');
    clearDiceRollAnimationAndPendingTimeout();
    if (clientState.rollModalCloseTimeout != null) {
        clearTimeout(clientState.rollModalCloseTimeout);
        clientState.rollModalCloseTimeout = null;
    }
    clientState.currentRollData = data;
    
    // CRITICAL FIX: Close any other modals that might be open to prevent conflicts
    const otherModals = [
        'confirmation-modal',
        'skill-challenge-modal',
        'choose-path-modal',
        'event-modal'
    ];
    otherModals.forEach(modalId => {
        const otherModal = get(modalId);
        if (otherModal && !otherModal.classList.contains('hidden')) {
            otherModal.classList.add('hidden');
        }
    });
    
    let titleText = data.title || 'Roll the Dice';
    if (data.sequenceInfo) {
        titleText += ` (Roll ${data.sequenceInfo.current} of ${data.sequenceInfo.total})`;
    }
    get('dice-roll-title').textContent = titleText;
    get('dice-roll-description').textContent = data.description || '';
    
    const diceContainer = get('dice-display-container');
    diceContainer.innerHTML = '';
    const sides = parseDiceSides(data.dice);
    const dieSVG = createDieSVG(sides, '?');
    diceContainer.appendChild(dieSVG);
    
    get('dice-roll-result-container').classList.add('hidden');
    
    const confirmBtn = get('dice-roll-confirm-btn');
    confirmBtn.classList.remove('hidden');
    confirmBtn.disabled = false;
    
    get('dice-roll-close-btn').classList.add('hidden');
    modal.classList.remove('hidden');
}

function handleDiceRoll() {
    const data = clientState.currentRollData;
    if (!data) return;

    const confirmBtn = get('dice-roll-confirm-btn');
    confirmBtn.disabled = true;

    const diceContainer = get('dice-display-container');
    const dieSVG = diceContainer.querySelector('.die-svg');
    if (!dieSVG) return;
    const dieText = dieSVG.querySelector('.die-text');
    dieSVG.classList.add('rolling');

    const sides = parseDiceSides(data.dice);
    let rollCount = 0;
    clearDiceRollAnimationAndPendingTimeout();
    clientState.diceAnimationInterval = setInterval(() => {
        dieText.textContent = Math.floor(Math.random() * sides) + 1;
        rollCount++;
        if (rollCount > 15) { // 1.5 seconds of animation
            clearInterval(clientState.diceAnimationInterval);
            clientState.diceAnimationInterval = null;
            dieSVG.classList.remove('rolling');

            // Now that animation is done, handle the roll
            if (OfflineActionHandler && OfflineActionHandler.isOffline()) {
                // Offline mode - handle the roll directly and keep parity with online by routing through actions
                const roll = Math.floor(Math.random() * sides) + 1;
                const payload = { ...data, roll };
                // Strip functions/non-serializable bits if any
                Object.keys(payload).forEach(k => { if (typeof payload[k] === 'function') delete payload[k]; });
                OfflineActionHandler.handleAction(data.action, payload);
                dismissDiceRollModal();
            } else {
                // Online mode - emit to server
                socket.emit('playerAction', {
                    action: data.action,
                    weaponId: data.weaponId,
                    targetId: data.targetId,
                    hasAdvantage: data.hasAdvantage,
                });
            }

            // Set a timeout to prevent getting stuck if server doesn't respond.
            clientState.rollResponseTimeout = setTimeout(() => {
                showToast('Server did not respond to roll.', 'error');
                dismissDiceRollModal();
            }, 5000);
        }
    }, 100);
}

// --- 6. SOCKET.IO EVENT HANDLERS ---
socket.on('connect', () => {
    myId = socket.id;
    qcDebug('Connected to server with ID:', socket.id);
    // If we have a saved identity, attempt seamless rejoin
    const roomId = sessionStorage.getItem('qc_roomId');
    const playerId = sessionStorage.getItem('qc_playerId');
    if (roomId && playerId) {
        try {
            socket.emit('rejoinRoom', { roomId, playerId });
            showToast('Reconnected! Restoring session...', 'success', 1500);
        } catch (_) {}
    }
});

// Register shop socket handlers now that socket exists
socket.on('shopOpened', ({ inventory, shopId, isMultiplayer, totalPlayers, playerId }) => {
    const modal = get('shop-modal');
    if (!modal) return;
    // Ensure Choose Path modal is closed before showing shop
    try { closeChoosePathModal(); } catch (_) {}
    renderShopInventory(inventory, shopId);
    
    // Store shop state for UI updates
    clientState.shopState = {
        isMultiplayer: isMultiplayer || false,
        totalPlayers: totalPlayers || 1,
        playerId: playerId || socket.id,
        isFinished: false
    };
    
    // CRITICAL FIX: Different behavior for multiplayer vs single player
    get('shop-close-btn').onclick = () => {
        modal.classList.add('hidden');
        
        if (clientState.shopState.isMultiplayer) {
            // Multiplayer: Mark as finished but wait for others
            clientState.shopState.isFinished = true;
            socket.emit('playerShopComplete');
            updateShopUI();
        } else {
            // Single player: Close immediately
            NotificationManager.resumeGameFromModal('shop');
            socket.emit('closeShop');
        }
    };
    
    // Pause game when shop opens (only in multiplayer)
    if (clientState.shopState.isMultiplayer) {
        NotificationManager.pauseGameForModal('shop');
    }
    modal.classList.remove('hidden');
    updateShopUI();
});

// Function to update shop UI based on multiplayer state
function updateShopUI() {
    const modal = get('shop-modal');
    if (!modal || modal.classList.contains('hidden')) return;
    
    const closeBtn = get('shop-close-btn');
    const statusText = get('shop-status-text');
    
    if (!clientState.shopState) return;
    
    if (clientState.shopState.isMultiplayer) {
        if (clientState.shopState.isFinished) {
            closeBtn.textContent = 'Waiting for other players...';
            closeBtn.disabled = true;
            if (statusText) {
                statusText.textContent = 'You have finished shopping. Waiting for other players to finish...';
                statusText.classList.remove('hidden');
            }
        } else {
            closeBtn.textContent = 'Finish Shopping';
            closeBtn.disabled = false;
            if (statusText) {
                statusText.textContent = `Shopping in progress... (${clientState.shopState.totalPlayers} players)`;
                statusText.classList.remove('hidden');
            }
        }
    } else {
        closeBtn.textContent = 'Close Shop';
        closeBtn.disabled = false;
        if (statusText) {
            statusText.classList.add('hidden');
        }
    }
}
socket.on('gameStateUpdate', (newState) => {
    // Update shop UI if open
    try {
        const modal = get('shop-modal');
        if (modal && !modal.classList.contains('hidden')) {
            const shopState = newState?.gameState?.shop;
            if (shopState && Array.isArray(shopState.inventory)) {
                renderShopInventory(shopState.inventory, shopState.id, newState);
                
                // Update shop player states for multiplayer
                if (newState?.gameState?.shopPlayerStates) {
                    clientState.shopPlayerStates = newState.gameState.shopPlayerStates;
                    updateShopUI();
                }
            } else {
                modal.classList.add('hidden');
                // Unpause when shop closes
                if (newState?.gameState?.isPaused) {
                    try { NotificationManager.notify('Shop closed', 'info', 1200); } catch (_) {}
                }
            }
        }
    } catch (e) {
        console.error('[gameStateUpdate] Shop UI update failed:', e);
    }
});

// --- Choose Path Modal (Unified, required choice) ---
let choosePathLock = false;
function closeChoosePathModal() {
    const overlay = get('choose-path-modal');
    if (overlay) {
        overlay.classList.add('hidden');
        // CRITICAL FIX: Resume game when path choice modal closes
        NotificationManager.resumeGameFromModal('choose-path');
    }
    const choices = get('choose-path-choices');
    if (choices) choices.innerHTML = '';
}

function renderChoosePathModal() {
    const overlay = get('choose-path-modal');
    const list = get('choose-path-choices');
    if (!overlay || !list) return;

    const rooms = currentRoomState?.gameState?.nextRooms || [];
    const chooserId = currentRoomState?.gameState?.pathChooserId;
    if (!rooms || rooms.length === 0) {
        closeChoosePathModal();
        choosePathLock = false;
        return;
    }

    const typeIcons = {
        combat: 'swords', treasure: 'diamond', event: 'explore',
        shop: 'storefront', rest: 'local_fire_department', ambush: 'warning',
        boss: 'castle'
    };

    list.innerHTML = '';
    rooms.forEach((r) => {
        const btn = document.createElement('button');
        const isBoss = r.type === 'boss';
        btn.className = `event-choice-btn ${isBoss ? 'boss-choice' : ''}`;
        const icon = typeIcons[r.type] || 'help';
        btn.innerHTML = `
            <div class="path-choice-header">
                <span class="material-symbols-outlined path-choice-icon">${icon}</span>
                <span class="event-choice-label">${r.type.toUpperCase()}</span>
            </div>
            <div class="event-choice-description">${r.preview?.description || ''}</div>
            <div class="path-choice-meta">
                <span class="path-danger">Danger: ${r.preview?.danger || '?'}</span>
                <span class="path-reward">Reward: ${r.preview?.reward || '?'}</span>
            </div>
        `;
        btn.addEventListener('click', () => {
            if (choosePathLock) return; // Debounce spam clicks
            choosePathLock = true;
            // Disable all buttons visually
            list.querySelectorAll('button').forEach(b => b.setAttribute('disabled', 'true'));
            try {
                if (OfflineActionHandler && OfflineActionHandler.isOffline()) {
                    // Mirror server behavior in offline: apply choice locally
                    handleOfflineChoosePath(r);
                } else {
                    socket.emit('chooseNextRoom', currentRoomState.id, r.id);
                }
            } catch (_) {}
            // Immediately close to reveal subsequent event/shop
            closeChoosePathModal();
            // Safety unlock in case state update is delayed
            setTimeout(() => { choosePathLock = false; }, 800);
        });
        list.appendChild(btn);
    });

    // Only the chooser sees the modal
    if (myId === chooserId) {
        // CRITICAL FIX: Pause game when path choice modal opens
        NotificationManager.pauseGameForModal('choose-path');
        overlay.classList.remove('hidden');
    } else {
        overlay.classList.add('hidden');
    }
}

// Offline parity for Choose Path: mimic minimal server behavior
function handleOfflineChoosePath(choice) {
    if (!currentRoomState?.gameState) return;
    // Clear pending choices
    currentRoomState.gameState.nextRooms = [];
    // Log selection
    const choiceText = (choice?.type || 'unknown').toUpperCase();
    try { NotificationManager.notify(`Next room: ${choiceText}`, 'info', 2000); } catch (_) {}
    // Apply effects similar to server
    if (choice.type === 'rest') {
        Object.values(currentRoomState.players || {}).forEach(p => {
            if (p.class) p.stats.currentHp = Math.min(p.stats.maxHp || p.stats.currentHp, (p.stats.currentHp || 0) + 5);
        });
    } else if (choice.type === 'shop') {
        // Synthesize a small shop inventory from sample cards in staticData-like pools if present
        const inv = [];
        const sample = [
            { name: 'Healing Potion', type: 'Consumable', price: 10 },
            { name: 'Lockpicks', type: 'Item', price: 8 },
            { name: 'Quick Blade', type: 'Weapon', price: 20 },
            { name: 'Hide Vest', type: 'Armor', price: 15 }
        ];
        sample.forEach((c, idx) => inv.push({ ...c, id: `shop_${Date.now()}_${idx}` }));
        currentRoomState.gameState.shop = { id: `shop_${Date.now()}`, inventory: inv };
        // Render using existing UI
        const modal = get('shop-modal');
        if (modal) {
            renderShopInventory(inv, currentRoomState.gameState.shop.id);
            
            // Offline mode: always single player behavior
            clientState.shopState = {
                isMultiplayer: false,
                totalPlayers: 1,
                playerId: 'offline',
                isFinished: false
            };
            
            // CRITICAL FIX: Add pause/resume functionality to offline shop modal
            get('shop-close-btn').onclick = () => {
                modal.classList.add('hidden');
                // Resume game when shop closes
                NotificationManager.resumeGameFromModal('shop');
                if (!offlineMode.isEnabled()) {
                    socket.emit('closeShop');
                }
            };
            
            // Pause game when shop opens
            NotificationManager.pauseGameForModal('shop');
            modal.classList.remove('hidden');
            updateShopUI();
        }
    } else if (choice.type === 'treasure') {
        // Offline parity: present a quick risk skill check tied to DEX
        const me = currentRoomState.players[myId];
        const dc = 12 + Math.floor((currentRoomState.gameState.turnCount || 0) / 5);
        showDiceRollModal({
            title: 'Risky Treasure Path',
            description: 'Navigate subtle traps to reach hidden treasure.',
            dice: 'd20',
            action: 'resolveSkillCheckRoll',
            skill: 'dex',
            dc: dc,
            rollType: 'treasure_path_risk',
            bonus: me?.stats?.dex || 0,
            targetAC: dc,
            hasAdvantage: false
        });
    } else if (choice.type === 'event') {
        if (typeof OfflineActionHandler !== 'undefined' && OfflineActionHandler.presentPathNpcEvent) {
            OfflineActionHandler.presentPathNpcEvent();
        }
    }
}

socket.on('gameStateUpdate', (newState) => {
    currentRoomState = newState;
    renderUI();
    combatGrid.render(); // Phase 2: Render combat grid
    try { renderChoosePathModal(); } catch (_) {}
});

socket.on('gameOver', (data) => {
    showGameOverModal(data);
});

socket.on('playerIdentity', ({ playerId, roomId }) => {
    // myId is set on connect, this is for session persistence
    sessionStorage.setItem('qc_roomId', roomId);
    sessionStorage.setItem('qc_playerId', playerId);
});

socket.on('turnStarted', ({ playerId }) => {
    // turnPopupReady is set from game state in renderGameplayState (server emits state before turnStarted).
    if (playerId !== myId) {
        return;
    }
    runWhenUngated(
        () => {
            revealYourTurnBanner();
            clientState.hasSeenSkillChallengePrompt = false;
            const myPlayer = currentRoomState.players[myId];
            if (myPlayer && !myPlayer.hasTakenFirstTurn) {
                clientState.isFirstTurnTutorialActive = true;
                showToast("It's your first turn! Click on a weapon (like 'Unarmed Strike') to select it for an attack.", "info", 5000);
            }
        },
        {
            intervalMs: 200,
            maxWaitMs: UI_GATE_MAX_WAIT_MS,
            onForcedRun: () => {
                NotificationManager.notify(
                    'Your turn — the UI was busy; you can act now. Close extra panels if buttons stay disabled.',
                    'warning',
                    7000,
                    { priority: NOTIFICATION_PRIORITY.critical }
                );
            }
        }
    );
});

socket.on('actionError', (message) => {
    // Don't show socket errors in offline mode
    if (offlineMode.isEnabled()) {
        qcDebug('[Offline] Ignoring socket actionError:', message);
        return;
    }
    
    // CRITICAL FIX: Show end turn prompt for 0 AP instead of error toast
    if (message === 'NO_AP_END_TURN') {
        showEndTurnPrompt();
    } else {
        showToast(message, 'error');
    }
});

socket.on('roomClosed', ({ message }) => {
    showToast(message, 'error', 5000);
    setTimeout(() => {
        sessionStorage.removeItem('qc_roomId');
        sessionStorage.removeItem('qc_playerId');
        window.location.reload();
    }, 5000);
});

socket.on('chooseToDiscard', ({ newCard, currentHand }) => {
    showChooseToDiscardModal({ newCard, currentHand });
});

socket.on('promptIndividualDiscovery', ({ newCard }) => {
    showDiscoveryModal({ newCard });
});

socket.on('levelUpPrompt', (data) => {
    showLevelUpEffect(); // Animation!
    showLevelUpModal(data);
});

socket.on('accountXpGained', ({ amount }) => {
    accountManager.addXp(amount);
});

// --- SPECTATOR TOAST LOGIC ---

function showSpectatorRollAnimation(data) {
    // If a toast is already showing, clear it first
    if (clientState.activeSpectatorToast) {
        clientState.activeSpectatorToast.element.remove();
    }
    if (clientState.spectatorToastTimeout) {
        clearTimeout(clientState.spectatorToastTimeout);
    }

    const container = get('spectator-roll-toast-container');
    const toast = document.createElement('div');
    toast.className = 'spectator-roll-toast';

    const title = data.title || `${data.rollerName} is rolling...`;
    const sides = parseDiceSides(data.dice || 'd20');
    const dieSVG = createDieSVG(sides, '?');
    dieSVG.classList.add('rolling');

    toast.innerHTML = `
        <div class="spectator-toast-header">${escapeHtml(data.rollerName)} rolled...</div>
        <div class="spectator-die-container"></div>
        <div class="spectator-roll-result-display hidden">
            <div class="spectator-toast-result"></div>
            <div class="spectator-toast-details"></div>
        </div>
    `;
    
    toast.querySelector('.spectator-die-container').appendChild(dieSVG);
    container.appendChild(toast);

    clientState.activeSpectatorToast = {
        element: toast,
        dieSVG,
        dieContainer: toast.querySelector('.spectator-die-container'),
        resultContainer: toast.querySelector('.spectator-roll-result-display'),
        resultText: toast.querySelector('.spectator-toast-result'),
        resultDetails: toast.querySelector('.spectator-toast-details'),
    };

    setTimeout(() => {
        toast.classList.add('visible');
    }, 10);
}


function updateSpectatorRollResult(data) {
    let toastInfo = clientState.activeSpectatorToast;
    
    // If no toast is active for this roll sequence, create one now to show the result statically.
    if (!toastInfo) {
        if (clientState.spectatorToastTimeout) clearTimeout(clientState.spectatorToastTimeout);
        const oldToast = get('spectator-roll-toast-container').querySelector('.spectator-roll-toast');
        if (oldToast) oldToast.remove();
        
        const container = get('spectator-roll-toast-container');
        const toast = document.createElement('div');
        toast.className = 'spectator-roll-toast';

        toast.innerHTML = `
            <div class="spectator-toast-header">${escapeHtml(data.rollerName)} rolled...</div>
            <div class="spectator-die-container hidden"></div>
            <div class="spectator-roll-result-display">
                <div class="spectator-toast-result"></div>
                <div class="spectator-toast-details"></div>
            </div>
        `;
        container.appendChild(toast);

        toastInfo = {
            element: toast,
            dieSVG: null, // No die was animated
            dieContainer: toast.querySelector('.spectator-die-container'),
            resultContainer: toast.querySelector('.spectator-roll-result-display'),
            resultText: toast.querySelector('.spectator-toast-result'),
            resultDetails: toast.querySelector('.spectator-toast-details'),
        };

        setTimeout(() => toast.classList.add('visible'), 10);
    }

    if (toastInfo.dieSVG) {
        toastInfo.dieSVG.classList.remove('rolling');
    }

    let outcomeClass = (data.outcome || '').toLowerCase();
    let resultText = '';
    let detailsText = '';
    let showDie = true;

    if (data.totalDamage !== undefined) {
        outcomeClass = 'damage';
        resultText = `${data.totalDamage} Damage!`;
        detailsText = `Rolls: [${data.rolls.join(', ')}] + ${data.damageBonus}`;
        showDie = false;
    } else if (data.totalValue !== undefined) {
        outcomeClass = data.effectType === 'heal' ? 'success' : 'damage';
        resultText = `${data.effectType === 'heal' ? 'Healed' : 'Dealt'} ${data.totalValue}`;
        detailsText = `Rolls: [${data.rolls.join(', ')}] + ${data.bonus}`;
        showDie = false;
    } else {
        if (toastInfo.dieSVG) {
            toastInfo.dieSVG.querySelector('.die-text').textContent = data.roll;
        }
        resultText = `${data.outcome}!`;
        detailsText = `${data.roll} + ${data.bonus} = ${data.total} vs ${data.targetAC}`;
    }

    if (!showDie) {
        toastInfo.dieContainer.classList.add('hidden');
    }

    toastInfo.resultText.className = `spectator-toast-result ${outcomeClass}`;
    toastInfo.resultText.innerHTML = resultText;
    toastInfo.resultDetails.innerHTML = detailsText;
    toastInfo.resultContainer.classList.remove('hidden');

    if (clientState.spectatorToastTimeout) {
        clearTimeout(clientState.spectatorToastTimeout);
    }
    
    clientState.spectatorToastTimeout = setTimeout(() => {
        toastInfo.element.classList.remove('visible');
        toastInfo.element.addEventListener('transitionend', () => {
            if (toastInfo.element.parentElement) {
                toastInfo.element.remove();
            }
            if (clientState.activeSpectatorToast && clientState.activeSpectatorToast.element === toastInfo.element) {
                clientState.activeSpectatorToast = null;
            }
        });
    }, 4000);
}

socket.on('promptAttackRoll', (data) => {
    if (data.rollerId === myId) {
        showDiceRollModal({ ...data, action: 'resolveAttackRoll' });
    } else {
        showSpectatorRollAnimation(data);
    }
});

socket.on('attackResolved', (data) => {
    if (data.rollerId === myId) {
        clearDiceRollAnimationAndPendingTimeout();
        const modal = get('dice-roll-modal');
        if (modal.classList.contains('hidden')) return;

        const dieSVG = modal.querySelector('.die-svg');
        if (dieSVG) {
            dieSVG.classList.remove('rolling');
            dieSVG.querySelector('.die-text').textContent = data.roll;
            dieSVG.classList.add('result-glow');
        }

        get('dice-roll-result-line').className = `result-line ${data.outcome.toLowerCase()}`;
        get('dice-roll-result-line').textContent = `${data.outcome}!`;
        get('dice-roll-details').textContent = `${data.roll} (roll) + ${data.bonus} (bonus) = ${data.total} vs AC ${data.targetAC}`;
        
        get('dice-roll-result-container').classList.remove('hidden');
        get('dice-roll-confirm-btn').classList.add('hidden');
        
        if (data.outcome === 'Miss') {
            get('dice-roll-close-btn').classList.remove('hidden');
            scheduleDiceRollModalHide(2000);
        }
    } else {
        updateSpectatorRollResult(data);
    }
});

socket.on('promptDiceSequenceRoll', (data) => {
    if (data.rollerId === myId) {
        showDiceRollModal({ ...data, action: 'resolveDiceSequenceRoll' });
    } else {
        if (data.sequenceInfo && data.sequenceInfo.current === 1) {
            showSpectatorRollAnimation(data);
        }
    }
});

socket.on('diceSequenceRollResult', (data) => {
    if (data.rollerId === myId) {
        clearDiceRollAnimationAndPendingTimeout();
        const modal = get('dice-roll-modal');
        if (modal.classList.contains('hidden')) return;

        const dieSVG = modal.querySelector('.die-svg');
        if (!dieSVG) return;
        const dieText = dieSVG.querySelector('.die-text');
        
        dieSVG.classList.remove('rolling');
        dieText.textContent = data.rollValue;
        
        get('dice-roll-result-line').className = 'result-line';
        get('dice-roll-result-line').textContent = `Rolled a ${data.rollValue}`;
        get('dice-roll-details').textContent = `(Roll ${data.sequenceInfo.current} of ${data.sequenceInfo.total})`;
        get('dice-roll-result-container').classList.remove('hidden');

        get('dice-roll-description').textContent = 'Waiting for next action...';
        get('dice-roll-confirm-btn').classList.add('hidden');
    }
});

socket.on('damageResolved', (data) => {
    if (data.rollerId === myId) {
        clearDiceRollAnimationAndPendingTimeout();
        const modal = get('dice-roll-modal');
        if (modal.classList.contains('hidden')) return;

        get('dice-roll-result-line').className = 'result-line damage';
        get('dice-roll-result-line').textContent = `${data.totalDamage} Damage!`;
        get('dice-roll-details').textContent = `Rolls: [${data.rolls.join(', ')}] + Bonus: ${data.damageBonus} = ${data.totalDamage}`;
        get('dice-roll-result-container').classList.remove('hidden');

        get('dice-roll-description').textContent = data.wasDefeated ? 'Target was defeated!' : 'Damage dealt!';
        
        // ANIMATIONS & SOUNDS
        showDamageNumber(data.totalDamage, window.innerWidth / 2, window.innerHeight / 2, data.isCritical);
        
        if (data.wasDefeated) {
            SoundManager.play('monsterDeath');
        } else {
            SoundManager.play('monsterHit');
        }
        
        get('dice-roll-confirm-btn').classList.add('hidden');
        get('dice-roll-close-btn').classList.remove('hidden');
        scheduleDiceRollModalHide(4000);
    } else {
        updateSpectatorRollResult(data);
    }
});

socket.on('skillCheckResolved', (data) => {
    if (data.rollerId === myId) {
        clearDiceRollAnimationAndPendingTimeout();
    }
    const modal = get('dice-roll-modal');
    if (data.rollerId === myId && !modal.classList.contains('hidden')) {
        const resultLine = get('dice-roll-result-line');
        const details = get('dice-roll-details');
        if (resultLine && details) {
            resultLine.className = `result-line ${data.outcome === 'Success' ? 'success' : 'failure'}`;
            resultLine.textContent = `${data.outcome}!`;
            details.textContent = `Roll ${data.roll} + ${data.bonus} = ${data.total} vs DC ${data.targetAC}`;
            get('dice-roll-result-container')?.classList.remove('hidden');
        }
        get('dice-roll-confirm-btn')?.classList.add('hidden');
        get('dice-roll-close-btn')?.classList.remove('hidden');
        scheduleDiceRollModalHide(2500);
    }
    if (data.rollerId !== myId) updateSpectatorRollResult(data);
});

socket.on('statusSaveResolved', (data) => {
    if (data.rollerId === myId) {
        socket.emit('attackResolved', data);
    } else {
        updateSpectatorRollResult(data);
    }
});

socket.on('cardEffectRollResolved', (data) => {
    if (data.rollerId === myId) {
        clearDiceRollAnimationAndPendingTimeout();
        const modal = get('dice-roll-modal');
        if (modal.classList.contains('hidden')) return;
        
        get('dice-roll-result-line').className = `result-line ${data.effectType === 'heal' ? 'success' : 'damage'}`;
        get('dice-roll-result-line').textContent = `${data.effectType === 'heal' ? 'Healed' : 'Dealt'} ${data.totalValue} ${data.effectType === 'heal' ? 'HP' : 'Damage'}!`;
        get('dice-roll-details').textContent = `Rolls: [${data.rolls.join(', ')}] + Bonus: ${data.bonus} = ${data.totalValue}`;

        get('dice-roll-confirm-btn').classList.add('hidden');
        get('dice-roll-close-btn').classList.remove('hidden');
        scheduleDiceRollModalHide(3000);
    } else {
        updateSpectatorRollResult(data);
    }
});

socket.on('diceRollError', () => {
    dismissDiceRollModal();
    
    // Don't show dice roll errors in offline mode
    if (offlineMode.isEnabled()) {
        qcDebug('[Offline] Ignoring socket diceRollError');
        return;
    }
    showToast('There was an error with the roll.', 'error');
});

// Voice Chat Signaling
socket.on('existing-voice-chatters', (chatterIds) => {
    qcDebug('[VC] Received existing chatters:', chatterIds);
    chatterIds.forEach(id => voiceChatManager.addPeer(id, true));
});
socket.on('new-voice-chatter', (chatterId) => {
    qcDebug('[VC] New chatter joined:', chatterId);
    voiceChatManager.addPeer(chatterId, false);
});
socket.on('voice-chatter-left', (chatterId) => {
    qcDebug('[VC] Chatter left:', chatterId);
    voiceChatManager.removePeer(chatterId);
});
socket.on('webrtc-signal', (payload) => {
    voiceChatManager.handleSignal(payload);
});


// --- CONNECTION STATUS HANDLING ---
// Monitor online/offline status and socket connection
let isOnline = navigator.onLine;
let isSocketConnected = false;

function updateConnectionStatus() {
    const statusEl = document.getElementById('connection-status');
    if (!statusEl) return;
    
    if (offlineMode.userChoice) {
        statusEl.textContent = '🎮 Solo Mode';
        statusEl.className = 'connection-status solo';
        statusEl.style.display = 'block';
    } else if (!isOnline || !isSocketConnected) {
        statusEl.textContent = '🔌 Offline Mode';
        statusEl.className = 'connection-status offline';
        statusEl.style.display = 'block';
    } else {
        statusEl.style.display = 'none';
    }
}

window.addEventListener('online', () => {
    isOnline = true;
    updateConnectionStatus();
    showToast('Connection restored', 'success');
});

window.addEventListener('offline', () => {
    isOnline = false;
    offlineMode.enable();
    updateConnectionStatus();
    showToast('Offline Mode - Your game continues!', 'info', 4000);
});

// CRITICAL FIX: Handle app suspension/backgrounding
document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
        qcDebug('[App] App backgrounded/suspended');
        // App is being backgrounded - no action needed, game continues
    } else {
        qcDebug('[App] App foregrounded - checking connection');
        // App is being foregrounded - check if we need to reconnect
        if (!isSocketConnected && currentRoomState && currentRoomState.id && currentRoomState.gameState?.phase === 'started') {
            qcDebug('[App] Game in progress but disconnected, enabling offline mode');
            offlineMode.enable();
            showToast('Welcome back! Continuing in offline mode.', 'info', 3000);
        }
    }
});

socket.on('connect', () => {
    isSocketConnected = true;
    updateConnectionStatus();
    qcDebug('[Socket] Connected to server');
    qcDebug('[Socket] Connection status updated:', isSocketConnected);
    
    // Prefer exact rejoin using stored identity
    const roomId = sessionStorage.getItem('qc_roomId');
    const playerId = sessionStorage.getItem('qc_playerId');
    if (roomId && playerId) {
        socket.emit('rejoinRoom', { roomId, playerId });
        showToast('Reconnected! Restoring session...', 'success', 1500);
        return;
    }
    // Fallback: name-based join if we still have state
    if (currentRoomState && currentRoomState.id && myPlayerName) {
        socket.emit('joinRoom', { roomId: currentRoomState.id, playerName: myPlayerName });
        showToast('Reconnected! Rejoining game...', 'success', 1500);
    }
});

socket.on('disconnect', (reason) => {
    isSocketConnected = false;
    updateConnectionStatus();
    qcDebug('[Socket] Disconnected from server:', reason);
    
    // CRITICAL FIX: Auto-enable offline mode when disconnected
    if (currentRoomState && currentRoomState.id && currentRoomState.gameState?.phase === 'started') {
        qcDebug('[Socket] Game in progress, enabling offline mode');
        offlineMode.enable();
        showToast('Connection lost - switching to offline mode. Your game continues!', 'warning', 5000);
    } else {
        // Show appropriate message based on disconnect reason
        if (reason === 'io server disconnect') {
            showToast('Disconnected by server', 'error');
        } else if (reason === 'transport close') {
            showToast('Connection lost - attempting to reconnect...', 'warning', 5000);
        }
    }
});

socket.on('connect_error', () => {
    isSocketConnected = false;
    updateConnectionStatus();
    qcDebug('[Socket] Connection error');
});

// ===========================
// COMBAT GRID MODULE (Phase 2)
// ===========================

const combatGrid = {
    gridSize: 5,
    selectedCell: null,
    usePixelArt: true, // Enable pixel art mode (falls back to emoji if assets not found)
    assetsLoaded: false,
    
    init() {
        const gridHeader = get('grid-header');
        if (gridHeader) {
            gridHeader.addEventListener('click', () => this.toggleGridVisibility());
        }
        // Preload assets
        this.preloadAssets();
    },
    
    preloadAssets() {
        // Try to preload a test image to see if assets are available
        const testImg = new Image();
        testImg.onload = () => {
            this.assetsLoaded = true;
            qcDebug('[Grid] Pixel art assets detected and loaded');
        };
        testImg.onerror = () => {
            this.assetsLoaded = false;
            qcDebug('[Grid] No pixel art assets found, using emoji fallback');
        };
        testImg.src = '/assets/tiles/stone-floor.png';
    },
    
    getSpritePath(type, name) {
        // Return sprite path if pixel art enabled, otherwise null (use emoji)
        if (!this.usePixelArt) return null;
        const rawDpr = window.devicePixelRatio || 1;
        const dpr = Math.min(Math.max(Math.round(rawDpr), 1), 4);
        const pickSize = (entry) => {
            if (!entry) return null;
            // DPR-aware selection: try nearest match, then graceful fallback
            const orderedPrefs = Array.from(new Set([
                dpr,
                Math.min(dpr + 1, 4),
                Math.max(dpr - 1, 1),
                4, 3, 2, 1
            ]));
            for (const s of orderedPrefs) {
                if (entry[`${s}x`]) return entry[`${s}x`];
            }
            return null;
        };
        const normalize = (s) => (s || '').toLowerCase().replace(/\s+/g, '-');
        const normalizedName = normalize(name);

        // Use manifest if available
        if (spriteManifest && spriteManifest[type]) {
            // direct name match
            const direct = spriteManifest[type][normalizedName];
            const chosen = pickSize(direct);
            if (chosen) return chosen;
            // try fuzzy/sensible mappings for monsters
            if (type === 'monster') {
                const mapKeys = Object.keys(spriteManifest.monster);
                const key = mapKeys.find(k => normalizedName.includes(k));
                const fuzzy = pickSize(spriteManifest.monster[key]);
                if (fuzzy) return fuzzy;
            }
            // companions: map to wolf or bear if exists
            if (type === 'companion') {
                const pref = ['wolf', 'bear', 'hawk'];
                for (const k of pref) {
                    const comp = pickSize(spriteManifest.companion?.[k] || spriteManifest.monster?.[k]);
                    if (comp) return comp;
                }
            }
        }

        // Fallback to legacy paths
        if (type === 'player') {
            return `/assets/sprites/${normalizedName}.png`;
        } else if (type === 'monster') {
            if (normalizedName.includes('goblin')) return '/assets/sprites/goblin.png';
            if (normalizedName.includes('wolf')) return '/assets/sprites/wolf.png';
            if (normalizedName.includes('skeleton')) return '/assets/sprites/skeleton.png';
            if (normalizedName.includes('spider')) return '/assets/sprites/spider.png';
            if (normalizedName.includes('orc')) return '/assets/sprites/orc.png';
            if (normalizedName.includes('dragon')) return '/assets/sprites/dragon.png';
            if (normalizedName.includes('zombie')) return '/assets/sprites/zombie.png';
            return `/assets/sprites/${normalizedName}.png`;
        } else if (type === 'companion') {
            if (normalizedName.includes('wolf')) return '/assets/sprites/wolf.png';
            if (normalizedName.includes('bear')) return '/assets/sprites/wolf.png';
            if (normalizedName.includes('hawk')) return '/assets/sprites/wolf.png';
            return '/assets/sprites/wolf.png';
        }
        return null;
    },

    /** If the sprite image fails to load, swap in a class/monster emoji so the grid stays readable. */
    applyGridSpriteFallback(entityDiv, emojiChar) {
        const img = entityDiv.querySelector('img.grid-sprite');
        if (!img) return;
        img.addEventListener('error', () => {
            const sp = document.createElement('span');
            sp.className = 'grid-emoji-fallback';
            sp.textContent = emojiChar;
            sp.setAttribute('role', 'img');
            img.replaceWith(sp);
        }, { once: true });
    },
    
    render() {
        const gridContainer = get('combat-grid');
        const gridPanel = get('combat-grid-container');
        
        
        if (!gridContainer || !currentRoomState.gameState?.grid) return;
        
        // CRITICAL FIX: Force grid visible when in game
        const inGame = currentRoomState.gameState?.phase === 'started';
        
        if (gridPanel) {
            if (inGame) {
                // Force visible with multiple methods
                gridPanel.classList.remove('hidden');
                gridPanel.style.display = 'block';
                gridPanel.style.visibility = 'visible';
                qcDebug('[Grid] Grid force shown - game started');
            } else {
                gridPanel.classList.add('hidden');
                qcDebug('[Grid] Grid hidden - not in game yet');
                return;
            }
        } else {
            console.error('[Grid] gridPanel element not found!');
        }
        
        const grid = currentRoomState.gameState.grid;
        const myPlayer = currentRoomState.players?.[myId];
        
        // Clear grid
        gridContainer.innerHTML = '';
        
        // Render 5x5 grid
        for (let y = 0; y < this.gridSize; y++) {
            for (let x = 0; x < this.gridSize; x++) {
                const cell = document.createElement('div');
                cell.className = 'grid-cell';
                cell.dataset.x = x;
                cell.dataset.y = y;
                
                // Add coordinate label
                const coordLabel = document.createElement('span');
                coordLabel.className = 'grid-coordinate';
                coordLabel.textContent = `${x},${y}`;
                cell.appendChild(coordLabel);
                
                // Find entities at this position
                const entitiesHere = [];
                
                // Check players
                Object.values(currentRoomState.players || {}).forEach(player => {
                    const pos = grid.entities[player.id];
                    if (pos && pos.x === x && pos.y === y) {
                        entitiesHere.push({ type: 'player', data: player, isMe: player.id === myId });
                    }
                });
                
                // Check monsters
                (currentRoomState.gameState.board?.monsters || []).forEach(monster => {
                    const pos = grid.entities[monster.id];
                    if (pos && pos.x === x && pos.y === y) {
                        entitiesHere.push({ type: 'monster', data: monster });
                    }
                });
                // Check companions (owned by players)
                Object.values(currentRoomState.players || {}).forEach(player => {
                    const comp = player.companion;
                    if (!comp || comp.currentHp <= 0) return;
                    const pos = grid.entities[comp.id];
                    if (pos && pos.x === x && pos.y === y) {
                        entitiesHere.push({ type: 'companion', data: comp, ownerName: player.name });
                    }
                });
                
                // Render entities
                entitiesHere.forEach(entity => {
                    const entityDiv = document.createElement('div');
                    entityDiv.className = `grid-entity ${entity.type}${entity.isMe ? ' me' : ''}`;
                    
                    if (entity.type === 'player') {
                        const spritePath = this.usePixelArt ? this.getSpritePath('player', entity.data.class) : null;
                        const em = this.getEmojiIcon('player', entity.data.class);
                        if (spritePath) {
                            entityDiv.innerHTML = `
                            <img src="${spritePath}" class="grid-sprite pixel-sprite" alt="${escapeHtml(entity.data.class)}" loading="lazy">
                            <div class="grid-name">${escapeHtml(entity.data.name)}</div>
                            <div class="grid-hp">${entity.data.stats.currentHp}/${entity.data.stats.maxHp}</div>
                        `;
                            this.applyGridSpriteFallback(entityDiv, em);
                        } else {
                            entityDiv.innerHTML = `
                            <span class="grid-emoji-fallback" role="img">${em}</span>
                            <div class="grid-name">${escapeHtml(entity.data.name)}</div>
                            <div class="grid-hp">${entity.data.stats.currentHp}/${entity.data.stats.maxHp}</div>
                        `;
                        }
                        
                        if (entity.isMe) {
                            cell.classList.add('my-position');
                            entityDiv.classList.add('pulsing');
                        } else {
                            cell.classList.add('occupied-player');
                        }
                    } else if (entity.type === 'monster') {
                        const spritePath = this.usePixelArt ? this.getSpritePath('monster', entity.data.name) : null;
                        const em = this.getEmojiIcon('monster', entity.data.name);
                        if (spritePath) {
                            entityDiv.innerHTML = `
                            <img src="${spritePath}" class="grid-sprite pixel-sprite monster-sprite" alt="${escapeHtml(entity.data.name)}" loading="lazy">
                            <div class="grid-name">${escapeHtml(entity.data.name)}</div>
                            <div class="grid-hp monster-hp">${entity.data.currentHp}/${entity.data.maxHp}</div>
                        `;
                            this.applyGridSpriteFallback(entityDiv, em);
                        } else {
                            entityDiv.innerHTML = `
                            <span class="grid-emoji-fallback" role="img">${em}</span>
                            <div class="grid-name">${escapeHtml(entity.data.name)}</div>
                            <div class="grid-hp monster-hp">${entity.data.currentHp}/${entity.data.maxHp}</div>
                        `;
                        }
                        cell.classList.add('occupied-monster');
                    } else if (entity.type === 'companion') {
                        const spritePath = this.usePixelArt ? this.getSpritePath('companion', entity.data.name || 'companion') : null;
                        const em = this.getEmojiIcon('companion', entity.data.name || 'companion');
                        if (spritePath) {
                            entityDiv.innerHTML = `
                            <img src="${spritePath}" class="grid-sprite pixel-sprite" alt="${escapeHtml(entity.data.name || 'Companion')}" loading="lazy">
                            <div class="grid-name">${escapeHtml(entity.data.name || 'Companion')}</div>
                            <div class="grid-hp">${entity.data.currentHp}/${entity.data.maxHp}</div>
                        `;
                            this.applyGridSpriteFallback(entityDiv, em);
                        } else {
                            entityDiv.innerHTML = `
                            <span class="grid-emoji-fallback" role="img">${em}</span>
                            <div class="grid-name">${escapeHtml(entity.data.name || 'Companion')}</div>
                            <div class="grid-hp">${entity.data.currentHp}/${entity.data.maxHp}</div>
                        `;
                        }
                        cell.classList.add('occupied-player');
                    } else if (entity.type === 'cover') {
                        entityDiv.innerHTML = `
                            <div class="terrain cover">🪵</div>
                            <div class="grid-name">Cover</div>
                        `;
                        cell.classList.add('occupied-cover');
                    } else if (entity.type === 'elevation') {
                        entityDiv.innerHTML = `
                            <div class="terrain elevation">⛰️</div>
                            <div class="grid-name">High Ground</div>
                        `;
                        cell.classList.add('occupied-elevation');
                    }
                    
                    cell.appendChild(entityDiv);
                });
                
                // Check if this is a valid move location
                if (myPlayer && this.isValidMove(myPlayer, x, y)) {
                    cell.classList.add('valid-move');
                    cell.style.cursor = 'pointer';
                    
                    // MOBILE FIX: Add both click AND touch handlers
                    const moveHandler = () => this.handleMoveClick(x, y, cell);
                    // Improve mobile tap accuracy: prefer touchend, stop propagation, and add 40ms delay to avoid double-trigger
                    let touched = false;
                    cell.addEventListener('touchend', (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        touched = true;
                        setTimeout(() => { touched = false; }, 40);
                        moveHandler();
                    }, { passive: false });
                    cell.addEventListener('click', (e) => {
                        if (touched) return; // skip duplicate click after touch
                        moveHandler();
                    });
                }
                
                // Check for flanking
                if (this.isFlanking(x, y)) {
                    cell.classList.add('flanking');
                }
                
                gridContainer.appendChild(cell);
            }
        }
        
        // Update movement points display
        this.updateMovementDisplay();
    },
    
    getEmojiIcon(type, name) {
                // Return appropriate emoji based on type and name
                if (type === 'player') {
                    const classIcons = {
                        'Barbarian': '⚔️',
                        'Warrior': '🛡️',
                        'Rogue': '🗡️',
                        'Ranger': '🏹',
                        'Mage': '🔮',
                        'Cleric': '✨'
                    };
                    return classIcons[name] || '👤';
                } else if (type === 'monster') {
                    const monsterName = String(name || '').toLowerCase();
                    if (monsterName.includes('goblin')) return '👺';
                    if (monsterName.includes('wolf')) return '🐺';
                    if (monsterName.includes('spider')) return '🕷️';
                    if (monsterName.includes('skeleton')) return '💀';
                    if (monsterName.includes('orc')) return '👹';
                    if (monsterName.includes('dragon')) return '🐉';
                    if (monsterName.includes('troll')) return '🧟';
                    if (monsterName.includes('zombie')) return '🧟‍♂️';
                    if (monsterName.includes('demon')) return '😈';
                    if (monsterName.includes('ghost')) return '👻';
                    if (monsterName.includes('vampire')) return '🧛';
                    if (monsterName.includes('werewolf')) return '🐺';
            if (monsterName.includes('boss') || monsterName.includes('king') || monsterName.includes('lord')) return '👑';
            return '👹';
        }
        if (type === 'companion') {
            const n = String(name || '').toLowerCase();
            if (n.includes('wolf')) return '🐺';
            if (n.includes('bear')) return '🐻';
            if (n.includes('hawk')) return '🦅';
            return '🐾';
        }
        return '❓';
    },
    
    isValidMove(player, targetX, targetY) {
        const grid = currentRoomState.gameState.grid;
        if (!grid || !player) return false;
        
        // CRITICAL FIX: Only allow movement on YOUR turn!
        const currentTurnPlayerId = currentRoomState.gameState.turnOrder[currentRoomState.gameState.currentPlayerIndex];
        // Use myId directly since player objects don't have an id field
        if (myId !== currentTurnPlayerId) return false;
        
        const myPos = grid.entities[myId];
        if (!myPos) return false;
        
        // Can't move to occupied cell
        const isOccupied = Object.values(grid.entities).some(pos => 
            pos && pos.x === targetX && pos.y === targetY
        );
        if (isOccupied) return false;
        
        // Check if within movement range (Manhattan distance)
        const distance = Math.abs(targetX - myPos.x) + Math.abs(targetY - myPos.y);
        const movementPoints = player.movementPoints || 0;
        
        return distance <= movementPoints && distance > 0;
    },
    
    isFlanking(x, y) {
        // Check if position has flanking advantage
        const grid = currentRoomState.gameState.grid;
        if (!grid) return false;

        // Use authoritative monster list
        const monsters = (currentRoomState.gameState.board?.monsters || []).filter(m => {
            const pos = grid.entities[m.id];
            return pos && this.isAdjacent(x, y, pos.x, pos.y);
        });
        
        const players = Object.values(currentRoomState.players || {}).filter(p => {
            const pos = grid.entities[p.id];
            return pos && p.id !== myId && this.isAdjacent(x, y, pos.x, pos.y);
        });
        
        return monsters.length > 0 && players.length > 0;
    },
    
    isAdjacent(x1, y1, x2, y2) {
        const dx = Math.abs(x2 - x1);
        const dy = Math.abs(y2 - y1);
        return (dx <= 1 && dy <= 1) && !(dx === 0 && dy === 0);
    },
    
    handleMoveClick(x, y, sourceCell = null) {
        const myPlayer = currentRoomState.players?.[myId];
        if (!myPlayer || !this.isValidMove(myPlayer, x, y)) return;
        
        // Calculate movement cost
        const grid = currentRoomState.gameState.grid;
        const myPos = grid.entities[myId];
        const cost = Math.abs(x - myPos.x) + Math.abs(y - myPos.y);
        
        // Check if player has movement points (separate from AP!)
        if (myPlayer.movementPoints < cost) {
            showToast(`Not enough movement points! Need ${cost}, have ${myPlayer.movementPoints}`, 'error', 3000);
            return;
        }
        
        // ENHANCED: Show movement feedback (only if we have enough points)
        showToast(`Moving to (${x}, ${y}) - ${cost} movement point${cost > 1 ? 's' : ''} (${myPlayer.movementPoints - cost} left)`, 'info', 2000);
        
        // Highlight the destination cell in the same grid surface the player used (desktop vs mobile modal)
        let targetCell = null;
        const root = sourceCell?.closest('#combat-grid, #combat-grid-mobile');
        if (root) {
            targetCell = root.querySelector(`.grid-cell[data-x="${x}"][data-y="${y}"]`);
        }
        if (!targetCell) {
            targetCell = get('combat-grid')?.querySelector(`.grid-cell[data-x="${x}"][data-y="${y}"]`)
                || get('combat-grid-mobile')?.querySelector(`.grid-cell[data-x="${x}"][data-y="${y}"]`);
        }
        if (targetCell) {
            targetCell.classList.add('moving-here');
            setTimeout(() => targetCell.classList.remove('moving-here'), 2000);
        }
        
        // Check offline mode
        if (OfflineActionHandler && OfflineActionHandler.isOffline()) {
            OfflineActionHandler.handleAction('move', {
                targetX: x,
                targetY: y,
                movementCost: cost
            });
        } else {
            // Optimistically update local movement points for snappier UI; server will correct if desynced
            myPlayer.movementPoints = Math.max(0, (myPlayer.movementPoints || 0) - cost);
            this.updateMovementDisplay();
            // Send move action to server (only if socket is connected)
            if (socket && socket.connected) {
                socket.emit('playerAction', {
                    roomId: currentRoomState.id,
                    action: 'move',
                    targetX: x,
                    targetY: y,
                    movementCost: cost
                });
            } else {
                qcDebug('[Move] Socket not connected, falling back to offline mode');
                OfflineActionHandler.handleAction('move', {
                    targetX: x,
                    targetY: y,
                    movementCost: cost
                });
            }
        }
    },
    
    updateMovementDisplay() {
        const myPlayer = currentRoomState.players?.[myId];
        const mpContainer = document.querySelector('[data-container="movement-points"]');
        
        if (mpContainer && myPlayer) {
            const mp = myPlayer.movementPoints || 0;
            mpContainer.innerHTML = `Movement: <strong>${mp}</strong>`;
        }
    },
    
    toggleGridVisibility() {
        const gridPanel = get('combat-grid-container');
        
        if (gridPanel) {
            gridPanel.classList.toggle('collapsed');
        }
    }
};

// Initialize grid on load
combatGrid.init();

// ===========================
// SPECIALIZATION SYSTEM (Phase 2)
// ===========================

const specializationManager = {
    selectedSpec: null,
    currentTier: 1,
    
    init() {
        // Listen for specialization prompt from server
        socket.on('specializationPrompt', (data) => this.showModal(data));
        
        // Set up modal interactions
        const confirmBtn = get('specialization-confirm-btn');
        if (confirmBtn) {
            confirmBtn.addEventListener('click', () => this.confirmSelection());
        }
    },
    
    showModal(data) {
        const { playerClass, level, availableSpecs } = data;
        const modal = get('specialization-modal');
        const container = get('specialization-trees-container');
        const confirmBtn = get('specialization-confirm-btn');
        
        if (!modal || !container) return;
        
        // Determine tier based on level
        this.currentTier = level === 3 ? 1 : level === 5 ? 2 : 3;
        
        // Clear previous selection
        this.selectedSpec = null;
        confirmBtn.disabled = true;
        
        // Get specs for this class
        const classSpecs = gameData.specializations[playerClass];
        if (!classSpecs) return;
        
        // Render specialization cards
        container.innerHTML = '';
        Object.keys(classSpecs).forEach(branchName => {
            const branch = classSpecs[branchName];
            const tierData = branch[`tier${this.currentTier}`];
            
            if (!tierData) return;
            
            const card = document.createElement('div');
            card.className = 'spec-tree-card';
            card.dataset.branch = branchName;
            card.dataset.tier = this.currentTier;
            
            // Header
            card.innerHTML = `
                <div class="spec-tree-name">${branchName}</div>
                <div class="spec-tree-tier">Tier ${this.currentTier}</div>
                <div class="spec-tree-description">${tierData.description}</div>
                <div class="spec-tree-bonuses">
                    ${this.renderBonuses(tierData)}
                </div>
            `;
            
            card.addEventListener('click', () => this.selectSpec(branchName, card));
            container.appendChild(card);
        });
        
        modal.classList.remove('hidden');
    },
    
    renderBonuses(tierData) {
        let html = '';
        
        // Render stat bonuses
        if (tierData.bonuses) {
            Object.entries(tierData.bonuses).forEach(([stat, value]) => {
                const label = this.getStatLabel(stat);
                html += `
                    <div class="spec-bonus-item">
                        <span class="material-symbols-outlined">arrow_upward</span>
                        <span class="spec-bonus-label">${label}:</span>
                        <span class="spec-bonus-value">+${value}</span>
                    </div>
                `;
            });
        }
        
        // Render active ability
        if (tierData.ability) {
            html += `
                <div class="spec-bonus-item">
                    <span class="material-symbols-outlined">bolt</span>
                    <span class="spec-ability-name">${tierData.ability}</span>
                </div>
            `;
        }
        
        return html;
    },
    
    getStatLabel(stat) {
        const labels = {
            damageBonus: 'Damage',
            shieldBonus: 'Shield',
            healingPower: 'Healing',
            spellPower: 'Spell Power',
            critChance: 'Crit Chance',
            maxHp: 'Max HP',
            maxAP: 'Max AP'
        };
        return labels[stat] || stat.toUpperCase();
    },
    
    selectSpec(branchName, cardElement) {
        // Deselect all cards
        document.querySelectorAll('.spec-tree-card').forEach(card => {
            card.classList.remove('selected');
        });
        
        // Select this card
        cardElement.classList.add('selected');
        this.selectedSpec = branchName;
        
        // Enable confirm button
        const confirmBtn = get('specialization-confirm-btn');
        if (confirmBtn) confirmBtn.disabled = false;
    },
    
    confirmSelection() {
        if (!this.selectedSpec) return;
        
        // Send selection to server
        socket.emit('playerAction', {
            roomId: currentRoomState.id,
            action: 'selectSpecialization',
            branch: this.selectedSpec,
            tier: this.currentTier
        });
        
        // Close modal
        const modal = get('specialization-modal');
        if (modal) modal.classList.add('hidden');
        
        this.selectedSpec = null;
    }
};

// Initialize specialization manager
specializationManager.init();

// ===========================
// DYNAMIC EVENTS (Phase 2)
// ===========================

const eventManager = {
    currentEvent: null,
    
    init() {
        socket.on('dungeonEvent', (eventData) => this.showEvent(eventData));
    },
    
    showEvent(eventData) {
        this.currentEvent = eventData;
        if (typeof OfflineActionHandler !== 'undefined' && OfflineActionHandler.isOffline() && eventData?.id) {
            const p = currentRoomState.players?.[myId];
            if (p) {
                p.pendingDungeonEvent = {
                    id: eventData.id,
                    interaction: eventData.interaction || 'quest',
                    name: eventData.name,
                    priceModifier: eventData.priceModifier != null ? eventData.priceModifier : 1,
                    reward: eventData.reward || null
                };
            }
        }
        const modal = get('event-modal');
        const icon = get('event-icon');
        const title = get('event-title');
        const description = get('event-description');
        const choicesContainer = get('event-choices-container');
        
        if (!modal) return;
        
        // Set icon based on event type
        const iconMap = {
            ambush: 'swords',
            trap: 'warning',
            puzzle: 'psychology',
            npc: 'person',
            hazard: 'dangerous'
        };
        
        icon.textContent = iconMap[eventData.type] || 'help';
        icon.className = `event-icon material-symbols-outlined ${eventData.type}`;
        
        // Set title and description
        title.textContent = eventData.name;
        description.textContent = eventData.description;
        
        // Render choices
        choicesContainer.innerHTML = '';
        eventData.choices.forEach((choice, index) => {
            const btn = document.createElement('button');
            btn.className = 'event-choice-btn';
            btn.innerHTML = `
                <span class="event-choice-label">${choice.label}</span>
                <div class="event-choice-description">${choice.description}</div>
                ${choice.stat ? `<div class="event-choice-stat">Requires: ${choice.stat.toUpperCase()} check</div>` : ''}
            `;
            btn.addEventListener('click', () => this.selectChoice(index));
            choicesContainer.appendChild(btn);
        });
        
        modal.classList.remove('hidden');
    },
    
    selectChoice(choiceIndex) {
        if (!this.currentEvent) return;
        const ev = this.currentEvent;
        const offline = typeof OfflineActionHandler !== 'undefined' && OfflineActionHandler.isOffline();
        if (offline) {
            OfflineActionHandler.handleAction('resolveEvent', {
                eventId: ev.id,
                choiceIndex
            });
        } else {
            socket.emit('playerAction', {
                roomId: currentRoomState.id,
                action: 'resolveEvent',
                eventId: ev.id,
                choiceIndex: choiceIndex
            });
        }
        const modal = get('event-modal');
        if (modal) modal.classList.add('hidden');
        this.currentEvent = null;
    }
};

// Initialize event manager
eventManager.init();

// ===========================
// SYNERGY SYSTEM (Phase 3)
// ===========================

const synergyManager = {
    activeSynergies: [],
    recentActions: [], // Track recent 5 actions for detection
    
    init() {
        socket.on('synergyTriggered', (synergyData) => this.showSynergy(synergyData));
        
        // Set up tracker toggle
        const trackerHeader = document.querySelector('.synergy-tracker-header');
        if (trackerHeader) {
            trackerHeader.addEventListener('click', () => this.toggleTracker());
        }
    },
    
    showSynergy(synergyData) {
        accountManager.trackStat('synergiesTriggered');
        const container = get('synergy-container');
        if (!container) return;
        
        // Create notification
        const notification = document.createElement('div');
        notification.className = 'synergy-notification';
        notification.innerHTML = `
            <span class="synergy-icon material-symbols-outlined">${synergyData.icon || 'auto_awesome'}</span>
            <div class="synergy-info">
                <h3 class="synergy-name">${synergyData.name}</h3>
                <p class="synergy-description">${synergyData.description}</p>
                <div class="synergy-bonus">${this.formatBonus(synergyData.bonus)}</div>
            </div>
        `;
        
        container.appendChild(notification);
        
        // Add to tracker
        this.addToTracker(synergyData);
        
        // Remove after 4 seconds
        setTimeout(() => {
            notification.classList.add('fade-out');
            setTimeout(() => notification.remove(), 500);
        }, 4000);
    },
    
    formatBonus(bonus) {
        if (bonus.damageBonus) return `+${bonus.damageBonus} Damage`;
        if (bonus.damageMultiplier) return `×${bonus.damageMultiplier} Damage`;
        if (bonus.healingMultiplier) return `×${bonus.healingMultiplier} Healing`;
        if (bonus.shieldBonus) return `+${bonus.shieldBonus} Shield`;
        if (bonus.apBonus) return `+${bonus.apBonus} AP`;
        if (bonus.statusEffect) return `Inflict ${bonus.statusEffect}`;
        if (bonus.freeAttack) return 'Free Counter-Attack!';
        if (bonus.critMultiplier) return `×${bonus.critMultiplier} Critical Damage`;
        return 'Combo Activated!';
    },
    
    addToTracker(synergyData) {
        const tracker = get('synergy-tracker');
        const content = get('synergy-tracker-content');
        
        if (!tracker || !content) return;
        
        // Show tracker
        tracker.classList.remove('hidden');
        
        // Add synergy to active list
        this.activeSynergies.push(synergyData);
        
        // Update tracker display
        this.updateTracker();
        
        // Remove from tracker after 10 seconds
        setTimeout(() => {
            this.activeSynergies = this.activeSynergies.filter(s => s !== synergyData);
            this.updateTracker();
        }, 10000);
    },
    
    updateTracker() {
        const content = get('synergy-tracker-content');
        if (!content) return;
        
        if (this.activeSynergies.length === 0) {
            content.innerHTML = '<p style="color: var(--color-text-light); font-size: 0.85rem; text-align: center;">No active combos</p>';
            return;
        }
        
        content.innerHTML = this.activeSynergies.map(synergy => `
            <div class="synergy-tracker-item">
                <span class="synergy-tracker-icon material-symbols-outlined">${synergy.icon || 'auto_awesome'}</span>
                <div class="synergy-tracker-info">
                    <div class="synergy-tracker-name">${synergy.name}</div>
                    <div class="synergy-tracker-bonus">${this.formatBonus(synergy.bonus)}</div>
                </div>
            </div>
        `).join('');
    },
    
    toggleTracker() {
        const tracker = get('synergy-tracker');
        if (tracker) {
            tracker.classList.toggle('collapsed');
        }
    }
};

// Initialize synergy manager
synergyManager.init();

// DEV TOOLS SYSTEM
// ================

function initializeDevTools() {
    const devToolsSection = get('dev-tools-section');
    const devToolsToggle = get('dev-tools-toggle');

    const enabled = localStorage.getItem('dev_tools_enabled') === 'true';

    if (devToolsSection) {
        if (enabled) {
            devToolsSection.classList.remove('hidden');
        } else {
            devToolsSection.classList.add('hidden');
        }
    }

    if (devToolsToggle && !devToolsToggle._bound) {
        devToolsToggle.textContent = enabled ? 'Hide Dev Tools' : 'Show Dev Tools';
        devToolsToggle.addEventListener('click', () => {
            const isHidden = devToolsSection?.classList.contains('hidden');
            if (isHidden) {
                enableDevTools();
            } else {
                disableDevTools();
            }
        });
        devToolsToggle._bound = true;
    }

    // Individual dev tool buttons
    setupDevToolButtons();
}

function enableDevTools() {
    const devToolsSection = get('dev-tools-section');
    const devToolsToggle = get('dev-tools-toggle');
    
    if (devToolsSection) {
        devToolsSection.classList.remove('hidden');
        localStorage.setItem('dev_tools_enabled', 'true');
    }
    
    if (devToolsToggle) {
        devToolsToggle.textContent = 'Hide Dev Tools';
    }
}

function disableDevTools() {
    const devToolsSection = get('dev-tools-section');
    const devToolsToggle = get('dev-tools-toggle');
    
    if (devToolsSection) {
        devToolsSection.classList.add('hidden');
        localStorage.setItem('dev_tools_enabled', 'false');
    }
    
    if (devToolsToggle) {
        devToolsToggle.textContent = 'Show Dev Tools';
    }
}

function setupDevToolButtons() {
    // XP Gain
    const gainXpBtn = get('dev-gain-xp');
    if (gainXpBtn) {
        gainXpBtn.addEventListener('click', () => {
            try {
                const amount = parseInt(get('dev-xp-amount').value) || 100;
                if (socket && socket.connected) {
                    socket.emit('playerAction', { action: 'devGainXp', amount });
                } else if (window.offlineGameEngine) {
                    window.offlineGameEngine.gainXp(amount);
                }
                showToast(`Gained ${amount} XP`, 'success');
            } catch (error) {
                console.error('[DevTools] Error gaining XP:', error);
                showToast('Failed to gain XP', 'error');
            }
        });
    }
    
    // Level Up
    const levelUpBtn = get('dev-level-up');
    if (levelUpBtn) {
        levelUpBtn.addEventListener('click', () => {
            try {
                if (socket && socket.connected) {
                    socket.emit('playerAction', { action: 'devLevelUp' });
                } else if (window.offlineGameEngine) {
                    window.offlineGameEngine.triggerLevelUp();
                } else {
                    showToast('No game connection available', 'error');
                    return;
                }
                showToast('Leveled up!', 'success');
            } catch (error) {
                console.error('[DevTools] Error leveling up:', error);
                showToast('Failed to level up', 'error');
            }
        });
    }
    
    // Test Specialization
    const testSpecBtn = get('dev-test-spec');
    if (testSpecBtn) {
        testSpecBtn.addEventListener('click', () => {
            try {
                if (socket && socket.connected) {
                    socket.emit('playerAction', { action: 'devTriggerSpecialization' });
                } else if (window.offlineGameEngine) {
                    window.offlineGameEngine.triggerSpecializationChoice();
                } else {
                    showToast('No game connection available', 'error');
                    return;
                }
                showToast('Specialization choice triggered', 'success');
            } catch (error) {
                console.error('[DevTools] Error triggering specialization:', error);
                showToast('Failed to trigger specialization', 'error');
            }
        });
    }
    
    // Add Gold
    const addGoldBtn = get('dev-add-gold');
    if (addGoldBtn) {
        addGoldBtn.addEventListener('click', () => {
            try {
                const amount = parseInt(get('dev-gold-amount').value) || 100;
                if (amount < 1 || amount > 10000) {
                    showToast('Gold amount must be between 1 and 10000', 'error');
                    return;
                }
                
                if (socket && socket.connected) {
                    socket.emit('playerAction', { action: 'devAddGold', amount });
                } else if (window.offlineGameEngine) {
                    window.offlineGameEngine.addGold(amount);
                } else {
                    showToast('No game connection available', 'error');
                    return;
                }
                showToast(`Added ${amount} gold`, 'success');
            } catch (error) {
                console.error('[DevTools] Error adding gold:', error);
                showToast('Failed to add gold', 'error');
            }
        });
    }
    
    // Spawn Monster
    const spawnMonsterBtn = get('dev-spawn-monster');
    if (spawnMonsterBtn) {
        spawnMonsterBtn.addEventListener('click', () => {
            try {
                if (socket && socket.connected) {
                    socket.emit('playerAction', { action: 'devSpawnMonster' });
                } else if (window.offlineGameEngine) {
                    window.offlineGameEngine.spawnMonster();
                } else {
                    showToast('No game connection available', 'error');
                    return;
                }
                showToast('Monster spawned', 'success');
            } catch (error) {
                console.error('[DevTools] Error spawning monster:', error);
                showToast('Failed to spawn monster', 'error');
            }
        });
    }
    
    // Heal Player
    const healPlayerBtn = get('dev-heal-player');
    if (healPlayerBtn) {
        healPlayerBtn.addEventListener('click', () => {
            try {
                if (socket && socket.connected) {
                    socket.emit('playerAction', { action: 'devHealPlayer' });
                } else if (window.offlineGameEngine) {
                    window.offlineGameEngine.fullHeal();
                } else {
                    showToast('No game connection available', 'error');
                    return;
                }
                showToast('Player healed to full', 'success');
            } catch (error) {
                console.error('[DevTools] Error healing player:', error);
                showToast('Failed to heal player', 'error');
            }
        });
    }
    
    // Cheat Code Execution
    const executeCheatBtn = get('dev-execute-cheat');
    if (executeCheatBtn) {
        executeCheatBtn.addEventListener('click', () => {
            try {
                const cheatCode = get('dev-cheat-code').value.toLowerCase().trim();
                if (!cheatCode) {
                    showToast('Please enter a cheat code', 'error');
                    return;
                }
                executeCheatCode(cheatCode);
            } catch (error) {
                console.error('[DevTools] Error executing cheat code:', error);
                showToast('Failed to execute cheat code', 'error');
            }
        });
    }
}

function executeCheatCode(cheatCode) {
    switch (cheatCode) {
        case 'levelup':
            if (socket && socket.connected) {
                socket.emit('playerAction', { action: 'devLevelUp' });
            } else if (window.offlineGameEngine) {
                window.offlineGameEngine.triggerLevelUp();
            }
            showToast('Level up cheat executed', 'success');
            break;
            
        case 'maxlevel':
            if (socket && socket.connected) {
                socket.emit('playerAction', { action: 'devSetMaxLevel' });
            } else if (window.offlineGameEngine) {
                window.offlineGameEngine.setMaxLevel();
            }
            showToast('Max level cheat executed', 'success');
            break;
            
        case 'gold1000':
            if (socket && socket.connected) {
                socket.emit('playerAction', { action: 'devAddGold', amount: 1000 });
            } else if (window.offlineGameEngine) {
                window.offlineGameEngine.addGold(1000);
            }
            showToast('1000 gold cheat executed', 'success');
            break;
            
        case 'heal':
            if (socket && socket.connected) {
                socket.emit('playerAction', { action: 'devHealPlayer' });
            } else if (window.offlineGameEngine) {
                window.offlineGameEngine.fullHeal();
            }
            showToast('Heal cheat executed', 'success');
            break;
            
        case 'monster':
            if (socket && socket.connected) {
                socket.emit('playerAction', { action: 'devSpawnMonster' });
            } else if (window.offlineGameEngine) {
                window.offlineGameEngine.spawnMonster();
            }
            showToast('Monster spawn cheat executed', 'success');
            break;
            
        case 'specialization':
            if (socket && socket.connected) {
                socket.emit('playerAction', { action: 'devTriggerSpecialization' });
            } else if (window.offlineGameEngine) {
                window.offlineGameEngine.triggerSpecializationChoice();
            }
            showToast('Specialization cheat executed', 'success');
            break;
            
        case 'godmode':
            if (socket && socket.connected) {
                socket.emit('playerAction', { action: 'devToggleGodMode' });
            } else if (window.offlineGameEngine) {
                window.offlineGameEngine.toggleGodMode();
            }
            showToast('God mode toggled', 'success');
            break;
            
        default:
            showToast(`Unknown cheat code: ${cheatCode}`, 'error');
            break;
    }
}

// --- SAVE AND LEAVE FUNCTIONALITY ---
function saveAndLeaveGame() {
    if (!currentRoomState || !myId) {
        showToast('Cannot save: No active game', 'error');
        return;
    }
    
    const me = currentRoomState.players[myId];
    
    // Validate game state before saving
    if (!me) {
        showToast('Cannot save: Player data not found', 'error');
        return;
    }
    
    // Check if player is in middle of an action
    if (me.pendingAction) {
        showToast('Cannot save during an action. Please complete your turn first.', 'warning', 4000);
        return;
    }
    
    // Check if game is in class selection phase
    if (currentRoomState.gameState?.phase === 'class_selection') {
        showToast('Cannot save during class selection. Start the game first.', 'warning', 4000);
        return;
    }
    
    // FIXED: Show save slot modal instead of auto-saving
    showSaveSlotModal();
    
    // Close the menu dropdown
    get('menu-dropdown')?.classList.add('hidden');
    get('mobile-menu-dropdown')?.classList.add('hidden');
}

// --- AVATAR DISPLAY FUNCTIONALITY ---
function showPlayerAvatar(playerId) {
    try {
        const player = currentRoomState?.players?.[playerId];
        if (!player) {
            console.warn('[Avatar] Player not found:', playerId);
            showToast('Player not found', 'error');
            return;
        }
        
        const modal = get('player-avatar-modal');
        if (!modal) {
            console.error('[Avatar] Modal not found');
            return;
        }
        
        // Get modal content
        const modalContent = modal.querySelector('.modal-content');
        
        // Build comprehensive player sheet
        const stats = player.stats || {};
        const equipment = player.equipment || {};
        const hand = player.hand || [];
        const statusEffects = player.statusEffects || [];
        
        // Status effects display
        let statusHTML = '';
        if (statusEffects.length > 0) {
            statusHTML = `<div class="avatar-status-effects">
                ${statusEffects.map(eff => `
                    <span class="status-badge status-${eff.type || 'buff'}" title="${eff.description || eff.name}">
                        ${eff.name} (${eff.duration}⌛)
                    </span>
                `).join('')}
            </div>`;
        }
        
        // Equipment display
        const equipHTML = `
            <div class="avatar-equipment">
                <h4>⚔️ Equipment</h4>
                <div class="equip-grid">
                    <div class="equip-slot">
                        <span class="equip-label">Weapon:</span>
                        <span class="equip-value">${equipment.weapon?.name || 'None'}</span>
                    </div>
                    <div class="equip-slot">
                        <span class="equip-label">Armor:</span>
                        <span class="equip-value">${equipment.armor?.name || 'None'}</span>
                    </div>
                    <div class="equip-slot">
                        <span class="equip-label">Accessory:</span>
                        <span class="equip-value">${equipment.accessory?.name || 'None'}</span>
                    </div>
                </div>
            </div>
        `;
        
        // Hand/Bag display
        const handHTML = `
            <div class="avatar-hand">
                <h4>🎒 Bag (${hand.length} cards)</h4>
                <div class="avatar-hand-grid">
                    ${hand.map(card => `
                        <div class="avatar-card-mini ${card.type?.toLowerCase() || ''}">
                            <div class="card-mini-name">${card.name}</div>
                            <div class="card-mini-type">${card.type || 'Item'}</div>
                        </div>
                    `).join('')}
                    ${hand.length === 0 ? '<div class="empty-hand">Empty</div>' : ''}
                </div>
            </div>
        `;
        
        // Complete modal HTML
        modalContent.innerHTML = `
            <button class="btn-icon modal-close-btn" aria-label="Close Avatar">
                <span class="material-symbols-outlined">close</span>
            </button>
            <div class="avatar-display-container">
                <div class="avatar-header">
                    <h2>${player.name}</h2>
                    <div class="avatar-subtitle">
                        <span class="avatar-class">${player.class || 'Adventurer'}</span>
                        <span class="avatar-level">Level ${player.level || 1}</span>
                        ${player.isNpc ? '<span class="npc-tag-large">[NPC]</span>' : ''}
                        ${player.isDowned ? '<span class="downed-tag-large">[DOWNED]</span>' : ''}
                    </div>
                    ${statusHTML}
                </div>
                
                <div class="avatar-body">
                    <div class="avatar-left-col">
                        <div class="avatar-frame">
                            <img src="${combatGrid.getSpritePath('player', player.class || '') || `/assets/sprites/${(player.class || '').toLowerCase()}.png`}" 
                                 alt="${player.class}" 
                                 class="avatar-sprite-img pixel-art" 
                                 loading="lazy"
                                 onerror="this.src='/assets/sprites/default.png'">
                        </div>
                        
                        <div class="avatar-primary-stats">
                            <div class="stat-row stat-hp">
                                <span class="stat-icon">❤️</span>
                                <span class="stat-label">HP:</span>
                                <span class="stat-value">${stats.currentHp || 0} / ${stats.maxHp || 0}</span>
                            </div>
                            <div class="stat-row stat-ap">
                                <span class="stat-icon">⚡</span>
                                <span class="stat-label">AP:</span>
                                <span class="stat-value">${player.currentAp || 0} / ${stats.maxAP || stats.ap || 0}</span>
                            </div>
                            <div class="stat-row stat-xp">
                                <span class="stat-icon">⭐</span>
                                <span class="stat-label">XP:</span>
                                <span class="stat-value">${player.xp || 0}</span>
                            </div>
                        </div>
                        
                        <div class="avatar-core-stats">
                            <h4>📊 Attributes</h4>
                            <div class="stats-grid">
                                <div class="stat-item"><span class="stat-name">STR</span><span class="stat-num">${stats.str || 0}</span></div>
                                <div class="stat-item"><span class="stat-name">DEX</span><span class="stat-num">${stats.dex || 0}</span></div>
                                <div class="stat-item"><span class="stat-name">CON</span><span class="stat-num">${stats.con || 0}</span></div>
                                <div class="stat-item"><span class="stat-name">INT</span><span class="stat-num">${stats.int || 0}</span></div>
                                <div class="stat-item"><span class="stat-name">WIS</span><span class="stat-num">${stats.wis || 0}</span></div>
                                <div class="stat-item"><span class="stat-name">CHA</span><span class="stat-num">${stats.cha || 0}</span></div>
                            </div>
                        </div>
                        
                        <div class="avatar-combat-stats">
                            <h4>⚔️ Combat</h4>
                            <div class="combat-stats-list">
                                <div class="combat-stat"><span>Hit Bonus:</span><span>+${stats.hitBonus || 0}</span></div>
                                <div class="combat-stat"><span>Damage Bonus:</span><span>+${stats.damageBonus || 0}</span></div>
                                <div class="combat-stat"><span>Shield Bonus:</span><span>+${stats.shieldBonus || 0}</span></div>
                                <div class="combat-stat"><span>Shield HP:</span><span>${stats.shieldHp || 0}</span></div>
                            </div>
                        </div>
                    </div>
                    
                    <div class="avatar-right-col">
                        ${equipHTML}
                        ${handHTML}
                    </div>
                </div>
            </div>
        `;
        
        // Wire up close button
        const closeBtn = modalContent.querySelector('.modal-close-btn');
        if (closeBtn) {
            closeBtn.addEventListener('click', () => modal.classList.add('hidden'));
        }
        
        modal.classList.remove('hidden');
    } catch (e) {
        console.error('[Avatar] Error showing avatar:', e);
        showToast('Failed to load avatar', 'error');
    }
}

// --- INITIALIZE NEW BUTTON HANDLERS ---
function initializeNewFeatures() {
    // Onboarding overlay (first-time only)
    try {
        const ONBOARDING_KEY = 'qc_onboarding_seen_v1';
        const overlay = get('onboarding-overlay');
        const closeBtn = get('onboarding-close-btn');
        const dontShowChk = get('onboarding-dont-show');
        const hasSeen = localStorage.getItem(ONBOARDING_KEY) === 'true';
        if (overlay && closeBtn && dontShowChk && !hasSeen) {
            overlay.classList.remove('hidden');
            closeBtn.addEventListener('click', () => {
                overlay.classList.add('hidden');
                if (dontShowChk.checked) localStorage.setItem(ONBOARDING_KEY, 'true');
                if (window.telemetry?.track) window.telemetry.track('onboarding_dismissed', { dontShow: !!dontShowChk.checked });
            });
        }
    } catch (e) {
        console.warn('[initializeNewFeatures] Onboarding overlay setup failed:', e.message);
    }

    // Save and Leave buttons
    const saveAndLeaveBtn = get('save-and-leave-btn');
    const mobileSaveAndLeaveBtn = get('mobile-save-and-leave-btn');
    
    if (saveAndLeaveBtn) {
        saveAndLeaveBtn.addEventListener('click', saveAndLeaveGame);
    }
    if (mobileSaveAndLeaveBtn) {
        mobileSaveAndLeaveBtn.addEventListener('click', saveAndLeaveGame);
    }
    
    // Settings buttons (already handled by existing settings modal)
    const mobileSettingsBtn = get('mobile-settings-btn');
    if (mobileSettingsBtn) {
        mobileSettingsBtn.addEventListener('click', () => {
            get('settings-modal')?.classList.remove('hidden');
            get('mobile-menu-dropdown')?.classList.add('hidden');
        });
    }
    
    // Avatar modal close button
    const avatarModal = get('player-avatar-modal');
    if (avatarModal) {
        const closeBtn = avatarModal.querySelector('.modal-close-btn');
        if (closeBtn) {
            closeBtn.addEventListener('click', () => {
                avatarModal.classList.add('hidden');
            });
        }
        // Close on overlay click
        avatarModal.addEventListener('click', (e) => {
            if (e.target === avatarModal) {
                avatarModal.classList.add('hidden');
            }
        });
    }
    
    // Player inspector modal close button fix
    const playerInspectorModal = get('player-inspector-modal');
    if (playerInspectorModal) {
        const closeBtn = playerInspectorModal.querySelector('.modal-close-btn');
        if (closeBtn) {
            closeBtn.addEventListener('click', () => {
                playerInspectorModal.classList.add('hidden');
            });
        }
    }
    
    // View My Avatar button (mobile navigation)
    const viewMyAvatarBtn = get('view-my-avatar-btn');
    if (viewMyAvatarBtn) {
        viewMyAvatarBtn.addEventListener('click', (e) => {
            e.stopPropagation(); // Prevent nav switching
            showPlayerAvatar(myId);
        });
    }
}

// Make showPlayerAvatar globally accessible for onclick handlers
window.showPlayerAvatar = showPlayerAvatar;

// --- MOBILE CHARACTER VIEWER ---
function updateMobileCharacterViewer() {
    if (!myId || !currentRoomState.players || !currentRoomState.players[myId]) return;
    
    const player = currentRoomState.players[myId];
    const stats = player.stats || {};
    
    // Update sprite
    const spriteImg = get('mobile-char-sprite');
    if (spriteImg && player.class) {
        const className = player.class.toLowerCase();
        spriteImg.src = combatGrid.getSpritePath('player', className) || `/assets/sprites/${className}.png`;
        spriteImg.alt = player.class;
    }
    
    // Update name and class
    const nameEl = get('mobile-char-name');
    const classEl = get('mobile-char-class');
    if (nameEl) nameEl.textContent = player.name || 'Hero';
    if (classEl) classEl.textContent = player.class || 'Adventurer';
    
    // Update stats
    const statUpdates = {
        'mobile-stat-hp': `${stats.currentHp || 0}/${stats.maxHp || 0}`,
        'mobile-stat-level': player.level || 1,
        'mobile-stat-xp': `${player.xp || 0}/${player.xpToNextLevel || 0}`,
        'mobile-stat-str': stats.str || 0,
        'mobile-stat-dex': stats.dex || 0,
        'mobile-stat-con': stats.con || 0,
        'mobile-stat-int': stats.int || 0,
        'mobile-stat-wis': stats.wis || 0,
        'mobile-stat-cha': stats.cha || 0
    };
    
    for (const [id, value] of Object.entries(statUpdates)) {
        const el = get(id);
        if (el) {
            const oldValue = el.textContent;
            el.textContent = value;
            
            // Add pulse animation if value changed
            if (oldValue !== value.toString() && oldValue !== '' && oldValue !== '0/0' && oldValue !== '0') {
                el.classList.add('updated');
                setTimeout(() => el.classList.remove('updated'), 500);
            }
        }
    }
}

// Helper function to switch mobile screens
function switchMobileScreen(screenName) {
    // Hide all screens
    document.querySelectorAll('.mobile-screen').forEach(screen => {
        screen.classList.remove('active');
    });
    
    // Show target screen
    const targetScreen = get(`mobile-screen-${screenName}`);
    if (targetScreen) {
        targetScreen.classList.add('active');
    }
    
    // Update nav buttons
    document.querySelectorAll('.mobile-bottom-nav .nav-btn').forEach(btn => {
        btn.classList.remove('active');
        if (btn.dataset.screen === screenName) {
            btn.classList.add('active');
        }
    });
}

// Initialize mobile navigation
function initializeMobileNavigation() {
    const navButtons = document.querySelectorAll('.mobile-bottom-nav .nav-btn');
    navButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            const screen = btn.dataset.screen;
            if (screen) {
                switchMobileScreen(screen);
                
                // Update character viewer when switching to character screen
                if (screen === 'character') {
                    updateMobileCharacterViewer();
                }
            }
        });
    });
}

// --- MOBILE ACTION DROPDOWN HANDLER ---
function initializeMobileActionDropdown() {
    const dropdown = get('mobile-action-dropdown');
    const executeBtn = get('mobile-action-execute-btn');
    
    if (!dropdown || !executeBtn) return;
    
    // Enable execute button when action is selected
    dropdown.addEventListener('change', () => {
        executeBtn.disabled = !dropdown.value;
    });
    
    // Execute the selected action
    executeBtn.addEventListener('click', () => {
        const action = dropdown.value;
        if (!action) return;
        
        // Map dropdown values to button data-container names
        const actionMap = {
            'guard': 'action-guard-btn',
            'dodge': 'action-dodge-btn',
            'dash': 'action-dash-btn',
            'help': 'action-help-btn',
            'search': 'action-search-btn',
            'respite': 'action-brief-respite-btn',
            'rest': 'action-full-rest-btn',
            'end-turn': 'action-end-turn-btn'
        };
        
        const buttonSelector = actionMap[action];
        if (buttonSelector) {
            const button = document.querySelector(`[data-container="${buttonSelector}"]`);
            if (button && !button.disabled) {
                button.click();
                // Reset dropdown after action
                dropdown.value = '';
                executeBtn.disabled = true;
            }
        }
    });
}

// --- INITIALIZATION ---
document.addEventListener('DOMContentLoaded', () => {
    initializeUI();
    // Load sprite manifest early for DPR-aware sprites
    loadSpriteManifest();
    initializeNewFeatures();
    initializeMobileNavigation();
    initializeSaveLoadSystem();
    initializeMobileCombatGrid();
    // If reloaded after saving, ensure offline is reset for a fresh menu
    try {
        if (typeof offlineMode !== 'undefined') {
            offlineMode.disable();
            offlineMode.setUserChoice(null);
        }
        if (typeof clientState !== 'undefined') {
            clientState.offlineMode = false;
            clientState.soloPlayMode = false;
        }
        const connStatus = document.getElementById('connection-status');
        if (connStatus) connStatus.style.display = 'none';
    } catch (e) {
        console.warn('[DOMContentLoaded] Offline mode reset failed:', e.message);
    }
    
    // Removed old menu guide button - now using purple book icon only
    
    // Wire up menu settings button
    const menuSettingsBtn = get('menu-settings-btn');
    if (menuSettingsBtn) {
        menuSettingsBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            qcDebug('[Settings] Opening settings modal from menu');
            const settingsModal = get('settings-modal');
            if (settingsModal) {
                settingsModal.classList.remove('hidden');
            } else {
                console.error('[Settings] Settings modal element not found!');
            }
        });
    }
});
window.addEventListener('resize', renderUI);
window.addEventListener('load', updateConnectionStatus);

// Initialize Notification Manager once DOM is ready
window.addEventListener('DOMContentLoaded', () => {
    try { NotificationManager.init(); } catch (_) {}
    try { initQcAboutLines(); } catch (_) {}
});

// Update character viewer on game state changes
socket.on('gameStateUpdate', (newState) => {
    // Update mobile character viewer if on character screen
    const characterScreen = get('mobile-screen-character');
    if (characterScreen && characterScreen.classList.contains('active')) {
        // Small delay to ensure state is updated
        setTimeout(updateMobileCharacterViewer, 100);
    }
});

// ========================================
// SAVE/LOAD SLOT SYSTEM
// ========================================

const SaveSlotManager = {
    SLOT_PREFIX: 'qc_save_slot_',
    
    // Get save data for a specific slot
    getSlot(slotNumber) {
        const key = this.SLOT_PREFIX + slotNumber;
        const data = localStorage.getItem(key);
        return data ? JSON.parse(data) : null;
    },
    
    // Save game to a specific slot
    saveToSlot(slotNumber, gameData) {
        const key = this.SLOT_PREFIX + slotNumber;
        const saveData = {
            slotNumber,
            timestamp: Date.now(),
            gameData: gameData
        };
        localStorage.setItem(key, JSON.stringify(saveData));
        return saveData;
    },
    
    // Delete a save slot
    deleteSlot(slotNumber) {
        const key = this.SLOT_PREFIX + slotNumber;
        localStorage.removeItem(key);
    },
    
    // Get all save slots
    getAllSlots() {
        const slots = [];
        for (let i = 1; i <= 3; i++) {
            slots.push(this.getSlot(i));
        }
        return slots;
    },
    
    // Format timestamp for display
    formatTimestamp(timestamp) {
        const date = new Date(timestamp);
        const now = new Date();
        const diffMs = now - date;
        const diffMins = Math.floor(diffMs / 60000);
        const diffHours = Math.floor(diffMs / 3600000);
        const diffDays = Math.floor(diffMs / 86400000);
        
        if (diffMins < 1) return 'Just now';
        if (diffMins < 60) return `${diffMins} min ago`;
        if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
        if (diffDays < 7) return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
        
        return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
};

// Show save slot modal
function showSaveSlotModal() {
    const modal = get('save-slot-modal');
    if (!modal) return;
    
    // Update slot previews
    updateSaveSlotPreviews();
    
    modal.classList.remove('hidden');
}

// Show load slot modal
function showLoadSlotModal() {
    const modal = get('load-slot-modal');
    if (!modal) return;
    
    // Update slot previews
    updateLoadSlotPreviews();
    
    modal.classList.remove('hidden');
}

// Update save slot previews
function updateSaveSlotPreviews() {
    for (let i = 1; i <= 3; i++) {
        const saveData = SaveSlotManager.getSlot(i);
        const card = document.querySelector(`.save-slot-card[data-slot="${i}"]`);
        if (!card) continue;
        
        const emptyDiv = card.querySelector('.slot-empty');
        const infoDiv = card.querySelector('.slot-info');
        
        if (saveData && saveData.gameData) {
            const player = saveData.gameData.players?.[saveData.gameData.myId];
            
            emptyDiv.classList.add('hidden');
            infoDiv.classList.remove('hidden');
            
            infoDiv.querySelector('.slot-character-name').textContent = player?.name || 'Unknown Hero';
            infoDiv.querySelector('.slot-details').textContent = 
                `${player?.class || 'Adventurer'} • Level ${player?.level || 1} • Room ${saveData.gameData.roomCode || '????'}`;
            infoDiv.querySelector('.slot-timestamp').textContent = SaveSlotManager.formatTimestamp(saveData.timestamp);
        } else {
            emptyDiv.classList.remove('hidden');
            infoDiv.classList.add('hidden');
        }
    }
}

// Update load slot previews
function updateLoadSlotPreviews() {
    const slots = SaveSlotManager.getAllSlots();
    let hasAnySave = false;
    
    for (let i = 1; i <= 3; i++) {
        const saveData = slots[i - 1];
        const card = document.querySelector(`.load-slot-card[data-slot="${i}"]`);
        if (!card) continue;
        
        const emptyDiv = card.querySelector('.slot-empty');
        const infoDiv = card.querySelector('.slot-info');
        const loadBtn = card.querySelector('.load-from-slot-btn');
        const deleteBtn = card.querySelector('.delete-slot-btn');
        
        if (saveData && saveData.gameData) {
            hasAnySave = true;
            const player = saveData.gameData.players?.[saveData.gameData.myId];
            
            emptyDiv.classList.add('hidden');
            infoDiv.classList.remove('hidden');
            loadBtn.disabled = false;
            deleteBtn.disabled = false;
            
            infoDiv.querySelector('.slot-character-name').textContent = player?.name || 'Unknown Hero';
            infoDiv.querySelector('.slot-details').textContent = 
                `${player?.class || 'Adventurer'} • Level ${player?.level || 1} • Room ${saveData.gameData.roomCode || '????'}`;
            infoDiv.querySelector('.slot-timestamp').textContent = SaveSlotManager.formatTimestamp(saveData.timestamp);
        } else {
            emptyDiv.classList.remove('hidden');
            infoDiv.classList.add('hidden');
            loadBtn.disabled = true;
            deleteBtn.disabled = true;
        }
    }
    
    // Show/hide no saves message
    const noSavesMsg = document.querySelector('.no-saves-message');
    if (noSavesMsg) {
        if (hasAnySave) {
            noSavesMsg.classList.add('hidden');
        } else {
            noSavesMsg.classList.remove('hidden');
        }
    }
}

// Save game to slot
function saveGameToSlot(slotNumber) {
    if (!currentRoomState || !myId) {
        showToast('Cannot save: No active game', 'error');
        return;
    }
    
    // Create save data with FULL game state
    const saveData = {
        roomCode: currentRoomState.code,
        roomId: currentRoomState.id,
        myId: myId,
        myPlayerName: myPlayerName,
        players: currentRoomState.players,
        gameState: currentRoomState.gameState,
        chatLog: currentRoomState.chatLog,
        staticData: currentRoomState.staticData,
        hostId: currentRoomState.hostId,
        timestamp: Date.now()
    };
    
    // Save to slot
    SaveSlotManager.saveToSlot(slotNumber, saveData);
    
    // Close modal
    get('save-slot-modal')?.classList.add('hidden');
    
    showToast(`Game saved to Slot ${slotNumber}! Returning to menu...`, 'success', 2000);
    
    // FIXED: Leave game after saving
    setTimeout(() => {
        try {
            if (typeof offlineMode !== 'undefined') {
                offlineMode.disable();
                offlineMode.setUserChoice(null);
            }
            if (typeof clientState !== 'undefined') {
                clientState.offlineMode = false;
                clientState.soloPlayMode = false;
            }
        } catch (e) {
            console.warn('[saveAndLeave] Cleanup error:', e.message);
        }
        sessionStorage.removeItem('qc_roomId');
        sessionStorage.removeItem('qc_playerId');
        window.location.reload();
    }, 2000);
}

// Load game from slot
function loadGameFromSlot(slotNumber) {
    const saveData = SaveSlotManager.getSlot(slotNumber);
    if (!saveData || !saveData.gameData) {
        showToast('No save data found', 'error');
        return;
    }
    
    qcDebug('[LoadGame] Raw save data:', saveData);
    qcDebug('[LoadGame] Game data:', saveData.gameData);
    
    // Close modal
    get('load-slot-modal')?.classList.add('hidden');
    
    // OFFLINE MODE: Restore game state locally
    showToast('Loading offline game...', 'info', 2000);

    // Ensure offline mode is fully enabled so actions route locally
    if (typeof offlineMode !== 'undefined') {
        offlineMode.enable();
        offlineMode.setUserChoice('solo');
    }
    clientState.offlineMode = true;
    clientState.soloPlayMode = true;
    
    // CRITICAL FIX: Properly restore state
    const loadedGame = saveData.gameData;
    
    // Restore global variables
    currentRoomState = {
        id: loadedGame.roomId || 'offline-room',
        code: loadedGame.roomCode || 'SOLO',
        hostId: loadedGame.myId,
        players: loadedGame.players || {},
        gameState: loadedGame.gameState || {},
        chatLog: loadedGame.chatLog || [],
        staticData: loadedGame.staticData || {},
        settings: loadedGame.settings || { enforceWeaponRanges: false }
    };
    
    myId = loadedGame.myId;
    myPlayerName = loadedGame.myPlayerName || 'Player';
    
    qcDebug('[LoadGame] Restored currentRoomState:', currentRoomState);
    qcDebug('[LoadGame] myId:', myId);
    qcDebug('[LoadGame] Players:', currentRoomState.players);
    
    // Show game screen
    get('menu-screen').classList.remove('active');
    get('guide-screen').classList.remove('active');
    get('legacy-screen').classList.remove('active');
    get('game-screen').classList.add('active');
    
    // Initialize game UI
    if (!gameUIInitialized) {
        initializeGameUIListeners();
        gameUIInitialized = true;
    }
    
    // Force render UI after a short delay and verify grid positions for myId
    setTimeout(() => {
        // If my player has no grid position, place at center
        const grid = currentRoomState.gameState?.grid;
        if (grid && grid.entities && !grid.entities[myId]) {
            grid.entities[myId] = { x: 2, y: 2, type: 'player' };
        }
        renderUI();
        combatGrid.render();
        qcDebug('[LoadGame] UI rendered');
    }, 100);
    
    showToast('Offline game loaded! You can continue playing.', 'success', 3000);
}

// Delete save slot
function deleteGameSlot(slotNumber) {
    if (!confirm(`Are you sure you want to delete the save in Slot ${slotNumber}?`)) {
        return;
    }
    
    SaveSlotManager.deleteSlot(slotNumber);
    updateLoadSlotPreviews();
    showToast(`Slot ${slotNumber} deleted`, 'info');
}

// Initialize save/load system
function initializeSaveLoadSystem() {
    // Save slot modal buttons
    document.querySelectorAll('.save-to-slot-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const slot = parseInt(btn.dataset.slot);
            saveGameToSlot(slot);
        });
    });
    
    // Load slot modal buttons
    document.querySelectorAll('.load-from-slot-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const slot = parseInt(btn.dataset.slot);
            loadGameFromSlot(slot);
        });
    });
    
    // Delete slot buttons
    document.querySelectorAll('.delete-slot-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const slot = parseInt(btn.dataset.slot);
            deleteGameSlot(slot);
        });
    });
    
    // Close buttons
    get('save-slot-close-btn')?.addEventListener('click', () => {
        get('save-slot-modal')?.classList.add('hidden');
    });
    
    get('load-slot-close-btn')?.addEventListener('click', () => {
        get('load-slot-modal')?.classList.add('hidden');
    });
    
    // Load game button in main menu
    get('load-game-btn')?.addEventListener('click', showLoadSlotModal);
    
    // Override the old save and leave function
    const originalSaveAndLeave = window.saveAndLeaveGame;
    window.saveAndLeaveGame = function() {
        // Show save slot modal instead of auto-saving
        showSaveSlotModal();
    };
}

// ========================================
// MOBILE COMBAT GRID MODAL
// ========================================

function initializeMobileCombatGrid() {
    const mobileGridBtn = get('mobile-grid-btn');
    const combatGridModal = get('combat-grid-modal');
    const closeBtn = get('combat-grid-close-btn');
    
    if (mobileGridBtn) {
        mobileGridBtn.addEventListener('click', () => {
            renderMobileCombatGrid();
            combatGridModal?.classList.remove('hidden');
        });
    }
    
    if (closeBtn) {
        closeBtn.addEventListener('click', () => {
            combatGridModal?.classList.add('hidden');
        });
    }
    
    // Close on overlay click
    if (combatGridModal) {
        combatGridModal.addEventListener('click', (e) => {
            if (e.target === combatGridModal) {
                combatGridModal.classList.add('hidden');
            }
        });
    }
}

function renderMobileCombatGrid() {
    const mobileGridContainer = get('combat-grid-mobile');
    if (!mobileGridContainer || !currentRoomState.gameState?.grid) return;
    
    const grid = currentRoomState.gameState.grid;
    const myPlayer = currentRoomState.players?.[myId];
    
    // Clear grid
    mobileGridContainer.innerHTML = '';
    
    // Render 5x5 grid (same logic as desktop)
    for (let y = 0; y < 5; y++) {
        for (let x = 0; x < 5; x++) {
            const cell = document.createElement('div');
            cell.className = 'grid-cell';
            cell.dataset.x = x;
            cell.dataset.y = y;
            
            // Add coordinate label
            const coordLabel = document.createElement('span');
            coordLabel.className = 'grid-coordinate';
            coordLabel.textContent = `${x},${y}`;
            cell.appendChild(coordLabel);
            
            // Find entities at this position
            const entitiesHere = [];
            
            // Check players
            Object.values(currentRoomState.players || {}).forEach(player => {
                const pos = grid.entities[player.id];
                if (pos && pos.x === x && pos.y === y) {
                    entitiesHere.push({ type: 'player', data: player });
                }
            });
            
            // Check monsters
            (currentRoomState.gameState.board?.monsters || []).forEach(monster => {
                const pos = grid.entities[monster.id];
                if (pos && pos.x === x && pos.y === y) {
                    entitiesHere.push({ type: 'monster', data: monster });
                }
            });
            
            // Render entities
            entitiesHere.forEach(entity => {
                const entityDiv = document.createElement('div');
                entityDiv.className = 'grid-entity';
                
                if (entity.type === 'player') {
                    const spritePath = combatGrid.usePixelArt ? combatGrid.getSpritePath('player', entity.data.class) : null;
                    const em = combatGrid.getEmojiIcon('player', entity.data.class);
                    if (spritePath) {
                        entityDiv.innerHTML = `
                        <img src="${spritePath}" class="grid-sprite pixel-sprite player-sprite" alt="${escapeHtml(entity.data.name)}" loading="lazy">
                        <div class="grid-name">${escapeHtml(entity.data.name)}</div>
                        <div class="grid-hp player-hp">${entity.data.stats.currentHp}/${entity.data.stats.maxHp}</div>
                    `;
                        combatGrid.applyGridSpriteFallback(entityDiv, em);
                    } else {
                        entityDiv.innerHTML = `
                        <span class="grid-emoji-fallback" role="img">${em}</span>
                        <div class="grid-name">${escapeHtml(entity.data.name)}</div>
                        <div class="grid-hp player-hp">${entity.data.stats.currentHp}/${entity.data.stats.maxHp}</div>
                    `;
                    }
                    cell.classList.add('occupied-player');
                } else if (entity.type === 'monster') {
                    const spritePath = combatGrid.usePixelArt ? combatGrid.getSpritePath('monster', entity.data.name) : null;
                    const em = combatGrid.getEmojiIcon('monster', entity.data.name);
                    if (spritePath) {
                        entityDiv.innerHTML = `
                        <img src="${spritePath}" class="grid-sprite pixel-sprite monster-sprite" alt="${escapeHtml(entity.data.name)}" loading="lazy">
                        <div class="grid-name">${escapeHtml(entity.data.name)}</div>
                        <div class="grid-hp monster-hp">${entity.data.currentHp}/${entity.data.maxHp}</div>
                    `;
                        combatGrid.applyGridSpriteFallback(entityDiv, em);
                    } else {
                        entityDiv.innerHTML = `
                        <span class="grid-emoji-fallback" role="img">${em}</span>
                        <div class="grid-name">${escapeHtml(entity.data.name)}</div>
                        <div class="grid-hp monster-hp">${entity.data.currentHp}/${entity.data.maxHp}</div>
                    `;
                    }
                    cell.classList.add('occupied-monster');
                }
                
                cell.appendChild(entityDiv);
            });
            
            // MOBILE FIX: Check if valid move and add touch handlers
            if (myPlayer && combatGrid.isValidMove(myPlayer, x, y)) {
                cell.classList.add('valid-move');
                cell.style.cursor = 'pointer';
                
                const moveHandler = () => {
                    combatGrid.handleMoveClick(x, y, cell);
                    // Close mobile grid modal after move with slight delay to ensure move is processed
                    setTimeout(() => {
                        get('combat-grid-modal')?.classList.add('hidden');
                    }, 100);
                };
                // Improve mobile tap accuracy and avoid duplicate events
                let touched = false;
                cell.addEventListener('touchend', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    touched = true;
                    setTimeout(() => { touched = false; }, 40);
                    moveHandler();
                }, { passive: false });
                cell.addEventListener('click', (e) => {
                    if (touched) return;
                    moveHandler();
                });
            }
            
            mobileGridContainer.appendChild(cell);
        }
    }
    
    // Update movement points display
    const movementDisplay = document.querySelector('[data-container="movement-points-mobile"]');
    if (movementDisplay && myPlayer) {
        movementDisplay.innerHTML = `Movement: <strong>${myPlayer.movementPoints || 0}</strong>`;
    }
}

// Update the combat grid render to also show/hide mobile button
const originalRender = combatGrid.render;
combatGrid.render = function() {
    originalRender.call(this);
    
    // Show/hide mobile grid button
    const mobileGridBtn = get('mobile-grid-btn');
    const phase = currentRoomState.gameState?.phase;
    const hasGrid = !!currentRoomState.gameState?.grid;
    const inActiveGame = phase === 'started' && hasGrid;
    
    if (mobileGridBtn && !isDesktop()) {
        if (inActiveGame) {
            mobileGridBtn.classList.remove('hidden');
        } else {
            mobileGridBtn.classList.add('hidden');
        }
    }
};
// ========================================
// ANIMATION & SOUND EFFECTS SYSTEM
// ========================================

function showDamageNumber(amount, x, y, isCritical = false, isHeal = false) {
    const damageEl = document.createElement('div');
    damageEl.className = `damage-number${isCritical ? ' critical' : ''}${isHeal ? ' heal' : ''}`;
    damageEl.textContent = isCritical ? `${amount}!!! CRIT` : (isHeal ? `+${amount}` : amount);
    damageEl.style.left = `${x}px`;
    damageEl.style.top = `${y}px`;
    
    document.body.appendChild(damageEl);
    
    setTimeout(() => damageEl.remove(), 1500);
}

function showAttackSlash(x, y) {
    const slash = document.createElement('div');
    slash.className = 'attack-slash';
    slash.style.left = `${x - 100}px`;
    slash.style.top = `${y}px`;
    
    document.body.appendChild(slash);
    
    SoundManager.play('attack');
    
    setTimeout(() => slash.remove(), 500);
}

function showSpellCastEffect(x, y, color = '#9f5ea0') {
    // Create 8 particles bursting outward
    for (let i = 0; i < 8; i++) {
        const particle = document.createElement('div');
        particle.className = 'spell-particle';
        particle.style.left = `${x}px`;
        particle.style.top = `${y}px`;
        particle.style.setProperty('--particle-color', color);
        
        const angle = (i / 8) * Math.PI * 2;
        const distance = 100 + Math.random() * 50;
        particle.style.setProperty('--particle-x', `${Math.cos(angle) * distance}px`);
        particle.style.setProperty('--particle-y', `${Math.sin(angle) * distance}px`);
        
        document.body.appendChild(particle);
        
        setTimeout(() => particle.remove(), 1000);
    }
    
    SoundManager.play('spellCast');
}

function showLevelUpEffect() {
    const effect = document.createElement('div');
    effect.className = 'level-up-effect';
    effect.textContent = '⭐ LEVEL UP! ⭐';
    
    document.body.appendChild(effect);
    
    SoundManager.play('levelUp');
    
    setTimeout(() => effect.remove(), 2000);
}

function showCriticalFlash() {
    const flash = document.createElement('div');
    flash.className = 'critical-flash-overlay';
    
    document.body.appendChild(flash);
    
    SoundManager.play('critical');
    
    setTimeout(() => flash.remove(), 500);
}

// Add button click sounds to all buttons
document.addEventListener('click', (e) => {
    const button = e.target.closest('button');
    if (button && !button.disabled) {
        SoundManager.play('buttonClick');
    }
}, true);

// Add card play animation
document.addEventListener('click', (e) => {
    const card = e.target.closest('.card');
    const button = e.target.closest('button');
    if (card && button && button.dataset.action) {
        card.classList.add('card-playing');
        setTimeout(() => card.classList.remove('card-playing'), 600);
        SoundManager.play('cardPlay');
    }
});

// Skill Check Roll Handler (for trapped chests, etc.)
socket.on('promptSkillCheckRoll', (data) => {
    qcDebug('[SkillCheck] Received prompt:', data);
    
    // Don't show skill check prompts in offline mode
    if (offlineMode.isEnabled()) {
        qcDebug('[Offline] Ignoring socket promptSkillCheckRoll');
        return;
    }
    
    if (data.rollerId === myId) {
        showDiceRollModal({ ...data, action: 'resolveSkillCheckRoll' });
    } else {
        showSpectatorRollAnimation(data);
    }
});

// ========================================
// GUIDE SCREEN (Full Page with Search)
// ========================================

function renderGuideScreen() {
    const tocContainer = get('guide-toc');
    const contentContainer = get('guide-full-content');
    const searchInput = get('guide-search-input');
    
    if (!tocContainer || !contentContainer) {
        console.error('[Guide] Missing guide screen elements');
        return;
    }
    
    qcDebug('[Guide] Rendering guide screen');
    
    // Generate Table of Contents
    let tocHTML = '';
    helpContent.forEach((page, index) => {
        tocHTML += `
            <div class="toc-item" data-page="${index}">
                <span class="material-symbols-outlined">${page.icon}</span>
                <span>${page.title}</span>
            </div>
        `;
    });
    tocContainer.innerHTML = tocHTML;
    
    // Wire up TOC clicks
    tocContainer.querySelectorAll('.toc-item').forEach(item => {
        item.addEventListener('click', () => {
            const pageIndex = parseInt(item.dataset.page);
            scrollToGuidePage(pageIndex);
        });
    });
    
    // Render all guide content
    let fullHTML = '';
    helpContent.forEach((page, index) => {
        fullHTML += `
            <div class="guide-page" id="guide-page-${index}" data-page="${index}">
                <h2>
                    <span class="material-symbols-outlined guide-page-icon">${page.icon}</span>
                    ${page.title}
                </h2>
                <div class="guide-page-content">
                    ${page.content}
                </div>
            </div>
        `;
    });
    contentContainer.innerHTML = fullHTML;
    
    // Wire up search
    if (searchInput) {
        searchInput.value = ''; // Clear any previous search
        searchInput.addEventListener('input', (e) => {
            filterGuideContent(e.target.value);
        });
    }
    
    qcDebug('[Guide] Guide screen rendered with', helpContent.length, 'pages');
}

function scrollToGuidePage(pageIndex) {
    const page = document.getElementById(`guide-page-${pageIndex}`);
    if (page) {
        page.scrollIntoView({ behavior: 'smooth', block: 'start' });
        
        // Highlight the page briefly
        page.classList.add('highlighted');
        setTimeout(() => page.classList.remove('highlighted'), 2000);
    }
}

function filterGuideContent(searchTerm) {
    const pages = document.querySelectorAll('.guide-page');
    const term = searchTerm.toLowerCase().trim();
    
    // Remove any existing no-results message
    const existingNoResults = get('guide-full-content').querySelector('.no-results');
    if (existingNoResults) existingNoResults.remove();
    
    if (!term) {
        // Show all pages
        pages.forEach(page => {
            page.classList.remove('hidden');
            page.classList.remove('search-match');
        });
        return;
    }
    
    let matchCount = 0;
    pages.forEach(page => {
        const title = page.querySelector('h2').textContent.toLowerCase();
        const content = page.querySelector('.guide-page-content').textContent.toLowerCase();
        
        if (title.includes(term) || content.includes(term)) {
            page.classList.remove('hidden');
            page.classList.add('search-match');
            matchCount++;
        } else {
            page.classList.add('hidden');
            page.classList.remove('search-match');
        }
    });
    
    // Show result count or no results
    if (matchCount === 0) {
        const noResultsEl = document.createElement('div');
        noResultsEl.className = 'no-results';
        noResultsEl.textContent = `No results found for "${searchTerm}"`;
        get('guide-full-content').insertAdjacentElement('afterbegin', noResultsEl);
    }
}

// Create offline solo game
function createOfflineSoloGame() {
    qcDebug('[Offline] Creating new solo game');
    
    // Set offline mode
    offlineMode.enable();
    offlineMode.setUserChoice('solo');
    
    // Show class selection
    showToast('Creating offline solo game...', 'info', 2000);
    
    // Create minimal game state
    myId = 'offline-solo-player';
    currentRoomState = {
        id: 'offline-room',
        code: 'SOLO',
        hostId: myId,
        players: {},
        gameState: {
            phase: 'class_selection',
            gameMode: clientState.selectedGameMode || 'Beginner',
            turnOrder: [myId, 'npc-finn', 'npc-grok', 'npc-lyra'],
            currentPlayerIndex: 0,
            board: { monsters: [], environment: [] },
            // Randomize a few terrain tiles for parity
            grid: { width: 5, height: 5, entities: {} },
            lootPool: [],
            turnCount: 0,
            partyHope: 5,
            worldEvents: { currentEvent: null, duration: 0 },
            skillChallenge: { isActive: false },
            isPaused: false,
            pauseReason: ''
        },
        chatLog: [
            { type: 'system', text: 'Welcome to offline solo mode! Playing with NPC companions.', timestamp: Date.now() }
        ],
        staticData: {
            classes: {
                Barbarian: { baseHp: 20, baseDamageBonus: 0, baseShieldBonus: 0, baseAP: 3, healthDice: 4, stats: { str: 4, dex: 2, con: 4, int: 0, wis: 0, cha: 1 }, primaryStat: 'str', ability: { name: 'Rage', apCost: 1, description: 'Enter a rage. Gain +4 damage on all attacks this turn.', effect: { type: 'buff', status: 'Raging', duration: 1, target: 'self' } } },
                Cleric: { baseHp: 18, baseDamageBonus: 0, baseShieldBonus: 1, baseAP: 2, healthDice: 3, stats: { str: 2, dex: 0, con: 3, int: 1, wis: 4, cha: 2 }, primaryStat: 'wis', ability: { name: 'Divine Heal', apCost: 1, description: 'Heal yourself for 1d8 + WIS HP.', effect: { type: 'heal', dice: '1d8', statBonus: 'wis', target: 'self' } } },
                Mage: { baseHp: 15, baseDamageBonus: 0, baseShieldBonus: 0, baseAP: 2, healthDice: 2, stats: { str: 0, dex: 2, con: 2, int: 5, wis: 2, cha: 1 }, primaryStat: 'int', ability: { name: 'Arcane Recovery', apCost: 0, description: 'Regain 1 AP. Usable once per turn.', effect: { type: 'resource', resource: 'ap', amount: 1 } } },
                Ranger: { baseHp: 18, baseDamageBonus: 0, baseShieldBonus: 1, baseAP: 2, healthDice: 3, stats: { str: 1, dex: 4, con: 3, int: 1, wis: 3, cha: 0 }, primaryStat: 'dex', ability: { name: 'Hunter\'s Mark', apCost: 1, description: 'Mark a target. Your next attack against it has +5 to hit.', effect: { type: 'buff', status: 'Hunter\'s Mark Ready', duration: 2, target: 'self' } } },
                Rogue: { baseHp: 16, baseDamageBonus: 0, baseShieldBonus: 0, baseAP: 3, healthDice: 2, stats: { str: 1, dex: 5, con: 2, int: 2, wis: 0, cha: 3 }, primaryStat: 'dex', ability: { name: 'Sneak Attack', apCost: 1, description: 'Your next attack this turn deals an extra 1d6 damage.', effect: { type: 'buff', status: 'Sneak Attack Ready', duration: 2, target: 'self' } } },
                Warrior: { baseHp: 20, baseDamageBonus: 0, baseShieldBonus: 1, baseAP: 3, healthDice: 4, stats: { str: 5, dex: 1, con: 4, int: 0, wis: 1, cha: 1 }, primaryStat: 'str', ability: { name: 'Power Surge', apCost: 1, description: 'Your next attack has +2 to hit and +2 damage.', effect: { type: 'buff', status: 'Power Surge Ready', duration: 2, target: 'self' } } }
            }
        },
        settings: { enforceWeaponRanges: clientState.selectedGameMode === 'Advanced' }
    };
    
    // Create player
    currentRoomState.players[myId] = {
        id: myId,
        name: myPlayerName,
        role: 'Explorer',
        isNpc: false,
        class: null, // Will choose
        level: 1,
        xp: 0,
        xpToNextLevel: 25,
        currentAp: 5,
        movementPoints: 2,
        gold: 25,
        hand: [],
        equipment: {},
        stats: {},
        statusEffects: [],
        isDowned: false,
        disconnected: false,
        pendingDungeonEvent: null
    };
    
    // Create NPC companions
    currentRoomState.players['npc-finn'] = {
        id: 'npc-finn',
        name: 'Finn',
        role: 'Explorer',
        isNpc: true,
        class: 'Cleric',
        level: 1,
        xp: 0,
        xpToNextLevel: 25,
        currentAp: 5,
        movementPoints: 2,
        hand: [],
        equipment: {},
        stats: { str: 2, dex: 1, con: 3, int: 4, wis: 5, cha: 2, maxHp: 20, currentHp: 20, maxAP: 5, hitBonus: 2, shieldBonus: 3 },
        statusEffects: [],
        isDowned: false,
        disconnected: false
    };
    
    currentRoomState.players['npc-grok'] = {
        id: 'npc-grok',
        name: 'Grok',
        role: 'Explorer',
        isNpc: true,
        class: 'Barbarian',
        level: 1,
        xp: 0,
        xpToNextLevel: 25,
        currentAp: 5,
        movementPoints: 2,
        hand: [],
        equipment: {},
        stats: { str: 5, dex: 2, con: 4, int: 1, wis: 2, cha: 1, maxHp: 28, currentHp: 28, maxAP: 5, hitBonus: 4, shieldBonus: 2 },
        statusEffects: [],
        isDowned: false,
        disconnected: false
    };
    
    currentRoomState.players['npc-lyra'] = {
        id: 'npc-lyra',
        name: 'Lyra',
        role: 'Explorer',
        isNpc: true,
        class: 'Mage',
        level: 1,
        xp: 0,
        xpToNextLevel: 25,
        currentAp: 5,
        movementPoints: 2,
        hand: [],
        equipment: {},
        stats: { str: 1, dex: 3, con: 2, int: 5, wis: 4, cha: 2, maxHp: 16, currentHp: 16, maxAP: 5, hitBonus: 1, shieldBonus: 1 },
        statusEffects: [],
        isDowned: false,
        disconnected: false
    };
    
    // Show game screen
    get('menu-screen').classList.remove('active');
    get('game-screen').classList.add('active');
    
    // Initialize UI
    if (!gameUIInitialized) {
        initializeGameUIListeners();
        gameUIInitialized = true;
    }
    
    // Place NPCs on grid
    const grid = currentRoomState.gameState.grid;
    grid.entities['npc-finn'] = { x: 1, y: 2, type: 'player' };
    grid.entities['npc-grok'] = { x: 3, y: 2, type: 'player' };
    grid.entities['npc-lyra'] = { x: 2, y: 3, type: 'player' };
    
    // Initialize offline decks for parity with online dealing
    window.__offlineDecks = (function(){
        const decks = (window.OFFLINE_DECKS || {});
        const shuffle = (arr) => arr.map(v=>({v, r:Math.random()})).sort((a,b)=>a.r-b.r).map(({v})=>({ ...v, id: `${v.type||'Card'}_${Math.random().toString(36).slice(2)}` }));
        return {
            weapon: shuffle(decks.weapon || []),
            armor: shuffle(decks.armor || []),
            spell: shuffle(decks.spell || []),
            item: shuffle(decks.item || [])
        };
    })();

    // Deal starting loadout mirroring online rules
    function drawFrom(deckName, playerClass) {
        const deck = window.__offlineDecks?.[deckName] || [];
        // Prefer class-compatible card if possible
        let idx = deck.findIndex(c => !c.class || c.class.includes('Any') || (playerClass && c.class.includes(playerClass)));
        if (idx < 0) idx = 0;
        const [card] = deck.splice(idx, 1);
        return card ? JSON.parse(JSON.stringify(card)) : null;
    }

    // After class selection we will deal; pre-hook into the offline handler
    if (typeof OfflineActionHandler !== 'undefined') {
        const originalChooseClass = OfflineActionHandler.handleChooseClass.bind(OfflineActionHandler);
        OfflineActionHandler.handleChooseClass = function(player, payload) {
            const res = originalChooseClass(player, payload);
            try {
                const me = currentRoomState.players[myId];
                if (me && me.class) {
                    const weapon = drawFrom('weapon', me.class);
                    const armor = drawFrom('armor', me.class);
                    if (weapon) me.equipment.weapon = weapon;
                    if (armor) me.equipment.armor = armor;
                    for (let k=0;k<2;k++) { const it = drawFrom('item'); if (it) me.hand.push(it); }
                    for (let k=0;k<2;k++) { const sp = drawFrom('spell', me.class); if (sp) me.hand.push(sp); }
                }
            } catch (e) {
                console.error('[OfflineDecks] Failed to deal starting cards:', e);
            }
            try {
                const gx = Math.floor(Math.random()*5);
                currentRoomState.gameState.grid.entities[myId] = { x: gx, y: 4, type: 'player' };
                const tier1Monsters = [
                    { name: 'Goblin Archer', maxHp: 12, attackBonus: 4, requiredRollToHit: 13, damage: '1d6+2', xpValue: 10 },
                    { name: 'Skeleton Guard', maxHp: 15, attackBonus: 2, requiredRollToHit: 13, damage: '1d6', xpValue: 8 },
                    { name: 'Giant Spider', maxHp: 18, attackBonus: 3, requiredRollToHit: 12, damage: '1d8+1', xpValue: 12 },
                ];
                const mCount = 1 + Math.floor(Math.random()*2);
                for (let m=0;m<mCount;m++) {
                    const template = tier1Monsters[Math.floor(Math.random()*tier1Monsters.length)];
                    const id = `monster_${Date.now()}_${m}`;
                    currentRoomState.gameState.board.monsters.push({
                        id, name: template.name, type: 'Monster',
                        maxHp: template.maxHp, currentHp: template.maxHp,
                        attackBonus: template.attackBonus, requiredRollToHit: template.requiredRollToHit,
                        damage: template.damage, xpValue: template.xpValue, statusEffects: []
                    });
                    currentRoomState.gameState.grid.entities[id] = { x: Math.floor(Math.random()*5), y: Math.floor(Math.random()*2), type: 'monster' };
                }
                currentRoomState.gameState.nextRooms = [
                    { id: `room_${Date.now()}_0`, type: 'combat', preview: { danger: 'Medium', reward: 'Standard loot + XP' } },
                    { id: `room_${Date.now()}_1`, type: 'event', preview: { danger: 'Variable', reward: 'Random boon' } },
                    { id: `room_${Date.now()}_2`, type: 'shop', preview: { danger: 'Safe', reward: 'Buy/Reroll items' } }
                ];
                try { renderChoosePathModal(); } catch (e) { console.warn('[OfflineDecks] Path modal render failed:', e.message); }
            } catch (e) {
                console.error('[OfflineDecks] Failed to set up initial board:', e);
            }
            renderUI();
            return res;
        };
    }

    // Render for class selection
    renderUI();
    
    showToast('Offline solo game created! Choose your class.', 'success', 3000);
}
