'use strict';

/**
 * Light contract checks so refactors don't drop offline event resolution.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const offlineActionsPath = path.join(__dirname, '..', 'public', 'offline-actions.js');
const clientPath = path.join(__dirname, '..', 'public', 'client.js');

test('offline-actions exposes event resolution hooks', () => {
    const src = fs.readFileSync(offlineActionsPath, 'utf8');
    assert.match(src, /case\s+['"]resolveEvent['"]/);
    assert.match(src, /presentPathNpcEvent\s*\(/);
    assert.match(src, /handleResolveEvent\s*\(/);
    assert.match(src, /OFFLINE_NPC_EVENT_TEMPLATES/);
    assert.match(src, /openOfflineMerchantShop\s*\(/);
});

test('client routes offline event choices to OfflineActionHandler', () => {
    const src = fs.readFileSync(clientPath, 'utf8');
    assert.match(src, /handleAction\s*\(\s*['"]resolveEvent['"]/);
    assert.match(src, /pendingDungeonEvent/);
});
