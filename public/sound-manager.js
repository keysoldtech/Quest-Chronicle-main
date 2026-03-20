// Sound Manager - Graceful sound system with fallback
const SoundManager = {
    sounds: {},
    playing: new Set(), // track currently playing keys for polyphony limiting
    enabled: true,
    volume: 0.35,
    maxDurationMs: 1200,
    context: null,
    synths: {},
    _lastStartTimes: {},
    
    soundFiles: {
        attack: '/sounds/attack.mp3',
        hit: '/sounds/hit.mp3',
        miss: '/sounds/miss.mp3',
        critical: '/sounds/critical.mp3',
        spellCast: '/sounds/spell-cast.mp3',
        heal: '/sounds/heal.mp3',
        buff: '/sounds/buff.mp3',
        // Prefer a synthesized click for button presses; file is kept as a fallback
        buttonClick: '/sounds/button-click.mp3',
        cardPlay: '/sounds/card-play.mp3',
        levelUp: '/sounds/level-up.mp3',
        victory: '/sounds/victory.mp3',
        defeat: '/sounds/defeat.mp3',
        monsterHit: '/sounds/monster-hit.mp3',
        monsterDeath: '/sounds/monster-death.mp3',
        monsterSpawn: '/sounds/monster-spawn.mp3'
    },
    
    init() {
        // Try to preload sounds
        Object.keys(this.soundFiles).forEach(key => {
            const audio = new Audio();
            audio.volume = this.volume;
            audio.src = this.soundFiles[key];
            audio.onerror = () => {
                console.log(`[Sound] ${key} not found, will use silent fallback`);
            };
            this.sounds[key] = audio;
        });
        
        // Define lightweight synthesized sounds for subtle UI feedback
        this.synths.buttonClick = (ctx, masterVolume) => {
            // Short, tactile click: quick pitch-down blip with tight envelope
            const now = ctx.currentTime;
            const duration = 0.085; // 85ms
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = 'square';
            osc.frequency.setValueAtTime(2200, now);
            osc.frequency.exponentialRampToValueAtTime(700, now + duration * 0.7);
            // Envelope
            const startGain = Math.max(0.0001, masterVolume * 0.22);
            gain.gain.setValueAtTime(0.0001, now);
            gain.gain.linearRampToValueAtTime(startGain, now + 0.004);
            gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.start(now);
            osc.stop(now + duration);
            osc.onended = () => {
                try { osc.disconnect(); gain.disconnect(); } catch (_) {}
            };
            return duration * 1000; // return ms
        };

        this.synths.cardPlay = (ctx, masterVolume) => {
            // Soft, short thock using filtered noise with quick decay
            const now = ctx.currentTime;
            const duration = 0.14; // 140ms
            const sampleRate = ctx.sampleRate;
            const frameCount = Math.max(1, Math.floor(sampleRate * duration));
            const buffer = ctx.createBuffer(1, frameCount, sampleRate);
            const data = buffer.getChannelData(0);
            for (let i = 0; i < frameCount; i++) {
                // White noise with slight decay to avoid harshness
                const t = i / frameCount;
                const envelope = 1 - t;
                data[i] = (Math.random() * 2 - 1) * envelope * 0.9;
            }
            const src = ctx.createBufferSource();
            src.buffer = buffer;
            const filter = ctx.createBiquadFilter();
            filter.type = 'lowpass';
            filter.frequency.setValueAtTime(450, now);
            filter.Q.setValueAtTime(0.7, now);
            const gain = ctx.createGain();
            const startGain = Math.max(0.0001, masterVolume * 0.18);
            gain.gain.setValueAtTime(0.0001, now);
            gain.gain.linearRampToValueAtTime(startGain, now + 0.005);
            gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
            src.connect(filter);
            filter.connect(gain);
            gain.connect(ctx.destination);
            src.start(now);
            src.stop(now + duration);
            src.onended = () => {
                try { src.disconnect(); filter.disconnect(); gain.disconnect(); } catch (_) {}
            };
            return duration * 1000; // ms
        };

        // Load volume from settings
        const savedVolume = localStorage.getItem('qc_sound_volume');
        if (savedVolume !== null) {
            this.volume = parseFloat(savedVolume);
        }
    },
    
    ensureContext() {
        if (typeof window === 'undefined') return null;
        if (!this.context) {
            try {
                const AC = window.AudioContext || window.webkitAudioContext;
                if (AC) this.context = new AC();
            } catch (_) { /* no audio context available */ }
        }
        if (this.context && this.context.state === 'suspended') {
            try { this.context.resume(); } catch (_) {}
        }
        return this.context;
    },
    
    playSynth(soundName) {
        const synth = this.synths[soundName];
        if (!synth) return false;

        // Polyphony limit for synths mirrors audio element behavior
        if (this.playing.has(soundName)) {
            const last = this._lastStartTimes[soundName] || 0;
            const nowMs = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
            if (nowMs - last < 150) return true; // treat as handled
        }

        const ctx = this.ensureContext();
        if (!ctx) return true; // handled but cannot play in this environment

        const durationMs = synth(ctx, this.volume);
        const nowMs = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
        this._lastStartTimes[soundName] = nowMs;
        this.playing.add(soundName);
        setTimeout(() => this.playing.delete(soundName), Math.min(500, Math.max(50, durationMs + 10)));
        return true;
    },
    
    play(soundName) {
        if (!this.enabled) return;
        // Prefer synthesized versions for select UI sounds
        if (this.synths && this.synths[soundName]) {
            const handled = this.playSynth(soundName);
            if (handled) return;
        }
        
        const sound = this.sounds[soundName];
        if (sound) {
            // Simple polyphony limit: prevent overlapping duplicates of the same sound
            if (this.playing.has(soundName)) {
                // If already playing, restart only if it's been >150ms
                const last = sound._lastStartTime || 0;
                const now = performance.now ? performance.now() : Date.now();
                if (now - last < 150) return;
            }
            sound.volume = this.volume;
            sound.currentTime = 0;
            const playPromise = sound.play();
            if (playPromise && typeof playPromise.then === 'function') {
                playPromise.then(() => {
                    try {
                        // Hard cap duration to avoid long/hanging sounds
                        if (!sound._cutoffTimer) {
                            sound._cutoffTimer = setTimeout(() => {
                                sound.pause();
                                sound.currentTime = 0;
                                sound._cutoffTimer = null;
                                this.playing.delete(soundName);
                            }, this.maxDurationMs);
                        }
                        sound._lastStartTime = performance.now ? performance.now() : Date.now();
                        this.playing.add(soundName);
                        sound.onended = () => this.playing.delete(soundName);
                    } catch (_) {}
                }).catch(e => {
                    // Graceful fail - browser might block autoplay
                    console.log(`[Sound] Couldn't play ${soundName}:`, e.message);
                });
                return;
            }
            sound.play().catch(e => {
                // Graceful fail - browser might block autoplay
                console.log(`[Sound] Couldn't play ${soundName}:`, e.message);
            });
        }
    },
    
    setVolume(vol) {
        this.volume = Math.max(0, Math.min(1, vol));
        localStorage.setItem('qc_sound_volume', this.volume);
        Object.values(this.sounds).forEach(sound => {
            sound.volume = this.volume;
        });
    },
    
    toggle() {
        this.enabled = !this.enabled;
        return this.enabled;
    }
};

// Initialize on page load
if (typeof window !== 'undefined') {
    SoundManager.init();
}
