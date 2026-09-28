/**
 * Reading and writing the numbers these figures are made of, the way their
 * sources state them.
 *
 * The Rambam gives a mean motion as `13° 10′ 35″` a day, an apogee as
 * `26° 45′ 8″ of Gemini`, an eccentricity as so many parts of sixty; a modern
 * table gives `13.1764°/day`, a period of `27.32 days`, `0.0549`. A panel
 * that accepts only one of those makes its author convert by hand, which is
 * exactly where a figure picks up the error it was built to avoid. So every
 * precise field accepts all of them, and says back what it understood in
 * each form.
 *
 * Pure functions, no DOM — tested directly.
 */

import { MAZALOT } from '../scene/defaults.js';

export type Unit = 'angle' | 'bearing' | 'rate' | 'ratio' | 'length';

/* -------------------------------------------------------------------------
 * Angles
 * ---------------------------------------------------------------------- */

/** Where a sign's name appears in some text, and which sign it is. */
function findSign(text: string): { index: number; rest: string } | null {
  const lower = text.toLowerCase();
  for (const [i, seg] of MAZALOT.entries()) {
    const names = [seg.name.toLowerCase(), seg.name.toLowerCase().slice(0, 3), ...(seg.nameHe ? [seg.nameHe] : [])];
    for (const name of names) {
      // whole words only, so "Leo" is not found inside "Leonard", nor "ari" in "variable"
      const re = new RegExp(`(^|[^a-z\\u0590-\\u05ff])${escapeRe(name)}([^a-z\\u0590-\\u05ff]|$)`, 'i');
      const m = re.exec(lower);
      if (m) {
        const rest = (lower.slice(0, m.index) + ' ' + lower.slice(m.index + m[0].length)).replace(/\bof\b/g, ' ');
        return { index: i, rest };
      }
    }
  }
  return null;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Degrees from any of the ways an angle is written:
 *
 *   86.75 · 86°45′ · 86° 45' 8" · 86d45m8s · 86 45 8 · 86;45,8
 *   26°45′8″ Gemini · Gemini 26;45 · 26 45 of תאומים
 *
 * A sign's name adds its thirty-degree start, so a longitude can be given
 * the way the text gives it. `null` when it is not an angle at all.
 */
export function parseAngle(text: string): number | null {
  let s = text.trim();
  if (s === '') return null;
  let base = 0;
  const sign = findSign(s);
  if (sign) {
    base = sign.index * 30;
    s = sign.rest.trim();
    if (s === '') return base;
  }

  let negative = false;
  if (s.startsWith('-') || s.startsWith('−')) {
    negative = true;
    s = s.slice(1).trim();
  }

  const value = parseSexagesimal(s);
  if (value === null) return null;
  return base + (negative ? -value : value);
}

/** The magnitude part of an angle: degrees, minutes and seconds in any of the
 * usual spellings, or a plain decimal. */
function parseSexagesimal(s: string): number | null {
  const t = s
    .replace(/[′’']/g, 'm')
    .replace(/[″”"]/g, 's')
    .replace(/°|deg(rees?)?/gi, 'd')
    .replace(/min(utes?)?/gi, 'm')
    .replace(/sec(onds?)?/gi, 's')
    .trim();

  // 86;45,8 — the sexagesimal notation of the translators and of Neugebauer
  if (/^\d+(\.\d+)?\s*;\s*\d+(\.\d+)?(\s*,\s*\d+(\.\d+)?)*$/.test(t)) {
    const [whole, frac] = t.split(';') as [string, string];
    const places = frac.split(',').map((x) => Number(x.trim()));
    return places.reduce((acc, v, i) => acc + v / 60 ** (i + 1), Number(whole));
  }

  // 86d45m8s, 86 45 8, 45m, 8.5s — numbers each with an optional mark
  const tokens = [...t.matchAll(/(\d+(?:\.\d+)?)\s*([dms])?/g)];
  if (tokens.length === 0) return null;
  // nothing but numbers, marks and spaces may be present
  if (t.replace(/(\d+(?:\.\d+)?)\s*([dms])?/g, '').trim() !== '') return null;
  if (tokens.length > 3) return null;

  const marked = tokens.some((m) => m[2] !== undefined);
  let total = 0;
  for (const [i, m] of tokens.entries()) {
    const v = Number(m[1]);
    const mark = m[2] ?? (marked ? null : (['d', 'm', 's'] as const)[i]);
    if (mark === null) return null;
    total += mark === 'd' ? v : mark === 'm' ? v / 60 : v / 3600;
  }
  return total;
}

/** `13°10′35″`, to the precision asked — the form the text itself uses. */
export function formatDMS(deg: number, secondsDp = 0): string {
  const negative = deg < 0;
  const scale = 10 ** secondsDp;
  let totalSec = Math.round(Math.abs(deg) * 3600 * scale) / scale;
  const d = Math.floor(totalSec / 3600);
  totalSec -= d * 3600;
  const m = Math.floor(totalSec / 60);
  const sec = Math.round((totalSec - m * 60) * scale) / scale;
  let out = `${d}°`;
  if (m !== 0 || sec !== 0) out += `${m}′`;
  if (sec !== 0) out += `${secondsDp > 0 ? sec.toFixed(secondsDp).replace(/\.?0+$/, '') : sec}″`;
  return `${negative ? '−' : ''}${out}`;
}

/** A longitude as a place in a sign: `26°45′8″ Gemini`. */
export function formatLongitude(deg: number, secondsDp = 0): string {
  const lon = ((deg % 360) + 360) % 360;
  const i = Math.floor(lon / 30 + 1e-9) % 12;
  const within = lon - i * 30;
  const seg = MAZALOT[i];
  return `${formatDMS(within, secondsDp)} ${seg?.name ?? ''}`.trim();
}

/* -------------------------------------------------------------------------
 * Rates
 * ---------------------------------------------------------------------- */

/**
 * Degrees per unit of the clock, from:
 *
 *   13.1764 · 13°10′35″ · 13;10,35 a day · 0°59′8″/day
 *   27.32 days (a period — once round in that long)
 *   3°58′20″ per 10000 days (the Rambam's own tables, per 10, 100, 29, 354…)
 *   … clockwise / cw · a leading minus
 */
export function parseRate(text: string): number | null {
  let s = text.trim().toLowerCase();
  if (s === '') return null;

  let sense = 1;
  if (/\b(cw|clockwise)\b/.test(s) && !/\b(ccw|anticlockwise|counter-?clockwise)\b/.test(s)) sense = -1;
  s = s.replace(/\b(ccw|cw|anticlockwise|counter-?clockwise|clockwise)\b/g, ' ');
  if (s.trim().startsWith('-') || s.trim().startsWith('−')) {
    sense = -sense;
    s = s.trim().slice(1);
  }

  // "per 10000 days", "/ 29 days", "in 354 days": a table's worth of motion
  let per = 1;
  const perMatch = /(?:per|\/|in)\s*(\d+(?:\.\d+)?)\s*(?:days?|d|units?)?\s*$/.exec(s.trim());
  if (perMatch) {
    per = Number(perMatch[1]);
    s = s.trim().slice(0, perMatch.index);
  } else {
    s = s.replace(/(?:\/|per|a|each)\s*(?:day|d|unit)\b/g, ' ').replace(/\bdaily\b/g, ' ');
  }
  s = s.trim();

  // "27.32 days", "period 27.32": once round in that many units
  const period = /^(?:period\s*)?(\d+(?:\.\d+)?)\s*(?:days?|d)$/.exec(s) ?? /^period\s*(\d+(?:\.\d+)?)$/.exec(s);
  if (period && per === 1) {
    const n = Number(period[1]);
    return n > 0 ? (sense * 360) / n : null;
  }

  const deg = parseSexagesimal(s);
  if (deg === null || per <= 0) return null;
  return (sense * deg) / per;
}

/** A rate, said every way it is useful to see it. */
export function describeRate(rate: number, unit = 'day'): string {
  if (rate === 0) return 'still';
  const a = Math.abs(rate);
  const period = 360 / a;
  return [
    `${formatDMS(a, 2)} a ${unit}`,
    `${trim(a, 6)}°/${unit}`,
    `once round in ${trim(period, period < 100 ? 3 : 1)} ${unit}s`,
    rate < 0 ? 'clockwise' : 'anticlockwise',
  ].join(' · ');
}

/* -------------------------------------------------------------------------
 * Ratios
 * ---------------------------------------------------------------------- */

/**
 * A fraction of a radius, from:
 *
 *   0.0417 · 4.17% · 1/9 · 2;30/60 (parts of sixty) · 10;19 / 49;41
 */
export function parseRatio(text: string): number | null {
  const s = text.trim();
  if (s === '') return null;
  const pct = /^(\d+(?:\.\d+)?)\s*%$/.exec(s);
  if (pct) return Number(pct[1]) / 100;
  if (s.includes('/')) {
    const [a, b] = s.split('/').map((x) => x.trim());
    if (a === undefined || b === undefined) return null;
    const num = parseSexagesimal(a.replace(/parts?|of/gi, '').trim());
    const den = parseSexagesimal(b.replace(/parts?|of/gi, '').trim());
    return num !== null && den !== null && den !== 0 ? num / den : null;
  }
  const n = parseSexagesimal(s);
  return n;
}

export function describeRatio(r: number): string {
  const parts = [`${trim(r * 100, 3)}% of its radius`, `${formatSexagesimal(r * 60)} parts of 60`];
  const frac = simpleFraction(r);
  if (frac) parts.unshift(frac);
  return parts.join(' · ');
}

/** `2;30` — a number in the sexagesimal notation, to two places. */
export function formatSexagesimal(x: number): string {
  const whole = Math.floor(x);
  let rest = x - whole;
  const places: number[] = [];
  for (let i = 0; i < 2; i++) {
    rest *= 60;
    const p = i === 1 ? Math.round(rest) : Math.floor(rest);
    places.push(p);
    rest -= p;
  }
  while (places.length > 0 && places[places.length - 1] === 0) places.pop();
  return places.length === 0 ? String(whole) : `${whole};${places.join(',')}`;
}

function simpleFraction(x: number): string | null {
  for (let q = 2; q <= 20; q++) {
    const p = Math.round(x * q);
    if (p > 0 && Math.abs(p / q - x) < 1e-9) return `${p}/${q}`;
  }
  return null;
}

/* -------------------------------------------------------------------------
 * Lengths
 * ---------------------------------------------------------------------- */

/** A length: a number, or plain arithmetic on numbers — `100/9`, `60 * 1.5` —
 * so a proportion can be typed as the proportion it is. */
export function parseLength(text: string): number | null {
  const s = text.trim();
  if (!/^[\d\s.+\-*/()]+$/.test(s) || s === '') return null;
  try {
    const v = Function(`"use strict"; return (${s});`)() as unknown;
    return typeof v === 'number' && Number.isFinite(v) ? v : null;
  } catch {
    return null;
  }
}

/* -------------------------------------------------------------------------
 * By unit
 * ---------------------------------------------------------------------- */

export function parseAs(unit: Unit, text: string): number | null {
  switch (unit) {
    case 'angle':
    case 'bearing':
      return parseAngle(text);
    case 'rate':
      return parseRate(text);
    case 'ratio':
      return parseRatio(text);
    case 'length':
      return parseLength(text);
  }
}

/** What a value means, in the forms other than the one in the box. */
export function describeAs(unit: Unit, v: number, clockUnit = 'day'): string {
  switch (unit) {
    case 'angle':
      return formatDMS(v, 1);
    case 'bearing':
      return `${formatLongitude(v)} · ${formatDMS(((v % 360) + 360) % 360, 1)} from east`;
    case 'rate':
      return describeRate(v, clockUnit);
    case 'ratio':
      return describeRatio(v);
    case 'length':
      return `${trim(v, 4)} world px`;
  }
}

/** What to type, shown as the placeholder. */
export const UNIT_EXAMPLES: Record<Unit, string> = {
  angle: '5°8′ · 5;8 · 5.133',
  bearing: '26°45′ Gemini · 86.75',
  rate: '13°10′35″ · 27.32 days · 0.9856',
  ratio: '2;30/60 · 1/9 · 0.0417 · 4%',
  length: '100 · 100/9',
};

function trim(n: number, dp: number): string {
  return String(Math.round(n * 10 ** dp) / 10 ** dp);
}
