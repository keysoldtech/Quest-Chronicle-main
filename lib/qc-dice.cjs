/**
 * Shared dice helpers for server + automated tests.
 * UI modal uses the same rules as parseDiceSides — keep public/client.js in sync.
 */

/** Face count for single-die UI (d20, 1d8, etc.). Defaults to 20. */
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

/** Parse notations like "2d6+3", "d20", "1d8+2". */
function parseDiceString(diceString) {
    if (!diceString || typeof diceString !== 'string') return { dice: [], bonus: 0 };
    const dice = [];
    let bonus = 0;
    const parts = diceString.split('+');
    for (const part of parts) {
        const trimmed = part.trim().toLowerCase();
        if (trimmed.includes('d')) {
            const [countStr, sidesStr] = trimmed.split('d');
            const count = parseInt(countStr, 10) || 1;
            const sides = parseInt(sidesStr, 10);
            if (!isNaN(sides)) {
                for (let i = 0; i < count; i++) {
                    dice.push(`d${sides}`);
                }
            }
        } else {
            bonus += parseInt(trimmed, 10) || 0;
        }
    }
    return { dice, bonus };
}

/**
 * Roll full notation. Optional rng: () => number in [0, 1), for tests.
 */
function rollDiceWithDetails(diceString, rng = Math.random) {
    const parsed = parseDiceString(diceString);
    const rolls = [];
    let rollSum = 0;
    for (const die of parsed.dice) {
        if (!die || !die.startsWith('d')) continue;
        const sides = parseInt(die.substring(1), 10);
        if (isNaN(sides) || sides < 1) continue;
        const roll = Math.floor(rng() * sides) + 1;
        rolls.push(roll);
        rollSum += roll;
    }
    const total = rollSum + parsed.bonus;
    return { rolls, rollSum, bonus: parsed.bonus, total };
}

module.exports = {
    parseDiceSides,
    parseDiceString,
    rollDiceWithDetails
};
