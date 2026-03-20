// Lightweight, opt-in telemetry for Quest & Chronicle
// Safe defaults: disabled unless user opts in via Settings
(function () {
  const STORAGE_KEYS = {
    enabled: 'setting_telemetryEnabled',
    session: 'qc_session_id'
  };

  function generateSessionId() {
    try {
      // Simple, short session id
      return 'sess_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-6);
    } catch {
      return 'sess_' + Date.now();
    }
  }

  function getSessionId() {
    try {
      let id = localStorage.getItem(STORAGE_KEYS.session);
      if (!id) {
        id = generateSessionId();
        localStorage.setItem(STORAGE_KEYS.session, id);
      }
      return id;
    } catch {
      return generateSessionId();
    }
  }

  function readEnabled() {
    try {
      return localStorage.getItem(STORAGE_KEYS.enabled) === 'true';
    } catch {
      return false;
    }
  }

  function writeEnabled(value) {
    try {
      localStorage.setItem(STORAGE_KEYS.enabled, value ? 'true' : 'false');
    } catch (_) {}
  }

  const state = {
    enabled: readEnabled(),
    queue: [],
    flushTimer: null,
    sessionId: getSessionId()
  };

  function track(eventName, props) {
    if (!state.enabled) return; // no-op when disabled
    try {
      state.queue.push({
        name: String(eventName).slice(0, 64),
        ts: Date.now(),
        props: props && typeof props === 'object' ? props : undefined
      });
      if (state.queue.length >= 20) flush('batch_threshold');
    } catch (_) {}
  }

  function flush(reason) {
    if (!state.enabled) return;
    if (state.queue.length === 0) return;
    if (navigator && 'onLine' in navigator && !navigator.onLine) return; // don't attempt offline

    const events = state.queue.splice(0, 100);
    const payload = {
      sessionId: state.sessionId,
      tzOffset: new Date().getTimezoneOffset(),
      sentAt: Date.now(),
      reason: reason || 'interval',
      userAgent: (typeof navigator !== 'undefined' && navigator.userAgent) ? navigator.userAgent : '',
      events
    };

    try {
      const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
      if (navigator.sendBeacon) {
        const ok = navigator.sendBeacon('/telemetry', blob);
        if (ok) return; // successful fire-and-forget
      }
      // Fallback to fetch
      fetch('/telemetry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        keepalive: true
      }).catch(() => {});
    } catch (_) {
      // swallow
    }
  }

  function scheduleFlush() {
    if (state.flushTimer) clearInterval(state.flushTimer);
    state.flushTimer = setInterval(() => flush('interval'), 30000);
  }

  function setEnabled(next) {
    const bool = !!next;
    state.enabled = bool;
    writeEnabled(bool);
    if (bool) {
      scheduleFlush();
      track('telemetry_enabled', {});
    } else {
      track('telemetry_disabled', {});
      if (state.flushTimer) clearInterval(state.flushTimer);
      state.flushTimer = null;
      state.queue.length = 0;
    }
  }

  // Wire settings checkbox (if present)
  function bindSettings() {
    try {
      const checkbox = document.getElementById('telemetry-opt-in');
      if (!checkbox) return;
      checkbox.checked = state.enabled;
      checkbox.addEventListener('change', (e) => {
        setEnabled(e.target.checked);
        if (e.target.checked) track('opt_in_telemetry', {});
      });
    } catch (_) {}
  }

  // Auto hooks (safe, best-effort)
  function bindAutoEvents() {
    // Basic lifecycle
    track('page_load', {});
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') flush('visibility_hidden');
    });
    window.addEventListener('beforeunload', () => flush('beforeunload'));

    // Common UI actions (guarded)
    [
      ['create-room-btn', 'click', 'click_create_room'],
      ['join-room-btn', 'click', 'click_join_room'],
      ['play-offline-btn', 'click', 'click_play_offline'],
      ['confirm-class-selection-btn', 'click', 'click_confirm_class'],
      ['confirm-class-btn', 'click', 'click_confirm_class_offline']
    ].forEach(([id, evt, name]) => {
      const el = document.getElementById(id);
      if (el) el.addEventListener(evt, () => track(name, {}));
    });
  }

  // Public API
  const api = {
    isEnabled: () => state.enabled,
    setEnabled,
    track,
    flush
  };
  window.telemetry = api;

  // Initialize
  if (state.enabled) scheduleFlush();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      bindSettings();
      bindAutoEvents();
    });
  } else {
    bindSettings();
    bindAutoEvents();
  }
})();
