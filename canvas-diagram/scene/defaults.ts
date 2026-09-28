/**
 * The look every figure in this kit starts from: the dark sky, the parchment
 * ink, the Latin/Hebrew pair of faces, and the twelve signs.
 *
 * Every figure used to carry its own copy of these — a forty-line THEME
 * literal, a background, a list of sign names — identical in all but the odd
 * colour. They live here once instead, so a figure states only where it
 * differs (`theme: { ring: '…' }`) and a change to the house style is one
 * edit rather than one per component.
 */

import type { Face } from '../labels.js';
import type { SceneTheme } from './scene.js';
import type { BackgroundTheme } from './stage.js';
import type { ZodiacSegment } from './zodiac.js';

/** The kit's sans face at a weight and size. */
export const SANS = (weight: number, px: number): Face => ({
  css: `${weight} ${px}px "Inter Variable", Inter, system-ui, sans-serif`,
  px,
});

/** The kit's Hebrew face at a weight and size. */
export const HEBREW = (weight: number, px: number): Face => ({
  css: `${weight} ${px}px "Frank Ruhl Libre", "SBL Hebrew", David, serif`,
  px,
});

export const DEFAULT_THEME: SceneTheme = {
  font: SANS(500, 11),
  activeFont: SANS(600, 11),
  subFont: HEBREW(400, 11.5),
  noteFont: SANS(500, 9.5),
  ink: '#e9e6df',
  dim: '#96a0bd',
  halo: 'rgba(7,11,22,0.92)',
  ring: 'rgba(150,168,214,0.35)',
  body: '#e9e6df',
  centerMark: 'rgba(224,180,92,0.85)',
  angle: '#8fd6c9',
  connector: 'rgba(224,180,92,0.6)',
  trail: 'rgba(216,212,200,0.5)',
};

export const DEFAULT_BACKGROUND: BackgroundTheme = {
  mid: '#0d1526',
  deep: '#070b16',
  star: 'rgba(216,212,200,0.75)',
  vignette: 'rgba(3,5,12,0.55)',
};

/** The twelve, English and Hebrew, in order from Aries — what a ring is nearly
 * always divided into in these figures. */
export const MAZALOT: readonly ZodiacSegment[] = [
  { name: 'Aries', nameHe: 'טלה' },
  { name: 'Taurus', nameHe: 'שור' },
  { name: 'Gemini', nameHe: 'תאומים' },
  { name: 'Cancer', nameHe: 'סרטן' },
  { name: 'Leo', nameHe: 'אריה' },
  { name: 'Virgo', nameHe: 'בתולה' },
  { name: 'Libra', nameHe: 'מאזנים' },
  { name: 'Scorpio', nameHe: 'עקרב' },
  { name: 'Sagittarius', nameHe: 'קשת' },
  { name: 'Capricorn', nameHe: 'גדי' },
  { name: 'Aquarius', nameHe: 'דלי' },
  { name: 'Pisces', nameHe: 'דגים' },
];
