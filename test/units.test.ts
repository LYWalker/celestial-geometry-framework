import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  describeRatio,
  formatDMS,
  formatLongitude,
  parseAngle,
  parseLength,
  parseRate,
  parseRatio,
} from '../canvas-diagram/editor/units.js';

/** assert two numbers agree, saying which input failed */
function near(actual: number | null, expected: number, eps: number, what = ''): void {
  assert.ok(actual !== null && Math.abs(actual - expected) < eps, `${what}: got ${actual}, wanted ${expected}`);
}

const dms = (d: number, m = 0, s = 0) => d + m / 60 + s / 3600;

describe('parseAngle — every way the sources write one', () => {
  test('decimal, degree-minute-second marks, sexagesimal, and bare triples agree', () => {
    for (const text of ['86.75', '86°45′', "86° 45'", '86d45m', '86 45', '86;45']) {
      near(parseAngle(text), 86.75, 1e-9, text);
    }
    near(parseAngle('13°10′35″'), dms(13, 10, 35), 1e-12);
    near(parseAngle('13;10,35'), dms(13, 10, 35), 1e-12);
    near(parseAngle('45′'), 0.75, 1e-12);
  });

  test('a sign name adds its thirty degrees, in English or Hebrew, before or after', () => {
    near(parseAngle('26°45′8″ Gemini'), 60 + dms(26, 45, 8), 1e-12);
    near(parseAngle('Gemini 26;45,8'), 60 + dms(26, 45, 8), 1e-12);
    near(parseAngle('26 45 8 of Gemini'), 60 + dms(26, 45, 8), 1e-12);
    near(parseAngle('תאומים 26°45′'), 60 + dms(26, 45), 1e-12);
    near(parseAngle('Taurus 1°14′43″'), 30 + dms(1, 14, 43), 1e-12);
    near(parseAngle('Pisces'), 330, 1e-12);
  });

  test('what is not an angle is refused rather than guessed at', () => {
    assert.equal(parseAngle(''), null);
    assert.equal(parseAngle('abc'), null);
    assert.equal(parseAngle('1 2 3 4'), null);
  });
});

describe('parseRate', () => {
  test('a daily motion as the text gives it', () => {
    near(parseRate('13°10′35″'), dms(13, 10, 35), 1e-12);
    near(parseRate('0°59′8″ a day'), dms(0, 59, 8), 1e-12);
    near(parseRate('0.9856/day'), 0.9856, 1e-12);
  });

  test('a period is once round in that long', () => {
    near(parseRate('365.25 days'), 360 / 365.25, 1e-12);
    near(parseRate('period 27.32'), 360 / 27.32, 1e-12);
  });

  test("a table's motion over many days is divided out", () => {
    // KH 12:1 — the sun in ten thousand days
    near(parseRate('136°28′20″ per 10000 days'), dms(136, 28, 20) / 10000, 1e-15);
  });

  test('clockwise, or a minus, turns it the other way', () => {
    near(parseRate('13°3′54″ clockwise'), -dms(13, 3, 54), 1e-12);
    near(parseRate('-13.065'), -13.065, 1e-12);
  });
});

describe('parseRatio', () => {
  test('parts of sixty, a fraction, a percentage, a decimal', () => {
    near(parseRatio('2;30/60'), 2.5 / 60, 1e-12);
    near(parseRatio('1/9'), 1 / 9, 1e-12);
    near(parseRatio('4%'), 0.04, 1e-12);
    near(parseRatio('0.2'), 0.2, 1e-12);
    // the moon's eccentric, as 15:4 gives it
    near(parseRatio('10;19 / 49;41'), (10 + 19 / 60) / (49 + 41 / 60), 1e-12);
  });

  test('is described back as a fraction when it is one', () => {
    assert.match(describeRatio(1 / 9), /^1\/9 · /);
    assert.match(describeRatio(2.5 / 60), /2;30 parts of 60/);
  });
});

describe('formatting', () => {
  test('degrees, minutes and seconds, and a place in a sign', () => {
    assert.equal(formatDMS(dms(13, 10, 35)), '13°10′35″');
    assert.equal(formatDMS(90), '90°');
    assert.equal(formatLongitude(60 + dms(26, 45, 8)), '26°45′8″ Gemini');
  });

  test('a length may be the proportion it is', () => {
    near(parseLength('100/9'), 100 / 9, 1e-12);
    assert.equal(parseLength('alert(1)'), null);
  });
});
