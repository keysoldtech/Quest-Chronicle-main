'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
    parseDiceSides,
    parseDiceString,
    rollDiceWithDetails
} = require('../lib/qc-dice.cjs');

test('parseDiceSides: d20-style strings', () => {
    assert.equal(parseDiceSides('d20'), 20);
    assert.equal(parseDiceSides('D8'), 8);
    assert.equal(parseDiceSides('1d6'), 6);
    assert.equal(parseDiceSides('  3d12 '), 12);
});

test('parseDiceSides: edge cases', () => {
    assert.equal(parseDiceSides(''), 20);
    assert.equal(parseDiceSides(null), 20);
    assert.equal(parseDiceSides('20'), 20);
    assert.equal(parseDiceSides('d0'), 20);
    assert.equal(parseDiceSides('d-1'), 20);
});

test('parseDiceString: counts and bonus', () => {
    assert.deepEqual(parseDiceString('2d6+3'), {
        dice: ['d6', 'd6'],
        bonus: 3
    });
    assert.deepEqual(parseDiceString('d20'), { dice: ['d20'], bonus: 0 });
    assert.deepEqual(parseDiceString('1d8+2'), { dice: ['d8'], bonus: 2 });
    assert.deepEqual(parseDiceString(''), { dice: [], bonus: 0 });
    assert.deepEqual(parseDiceString(null), { dice: [], bonus: 0 });
});

test('rollDiceWithDetails: deterministic rng', () => {
    const alwaysLow = () => 0;
    const r = rollDiceWithDetails('2d6+1', alwaysLow);
    assert.deepEqual(r.rolls, [1, 1]);
    assert.equal(r.rollSum, 2);
    assert.equal(r.bonus, 1);
    assert.equal(r.total, 3);

    const maxD20 = () => 0.999999;
    const r2 = rollDiceWithDetails('d20', maxD20);
    assert.equal(r2.rolls[0], 20);
    assert.equal(r2.total, 20);
});
