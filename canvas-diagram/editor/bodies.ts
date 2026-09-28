/**
 * The bodies a sphere in these figures usually carries — what each is called,
 * in both languages, and how it looks.
 *
 * A sphere's body is chosen in the panel: one of these, which brings its name,
 * Hebrew name, colour and icon, or a custom one named and drawn by hand. Only
 * the look comes from here. How a body moves is the sphere's business, set
 * there exactly, from whatever source the figure follows.
 */

import type { ObjectDoc } from './doc.js';

export interface BodyPreset {
  key: string;
  name: string;
  nameHe: string;
  color: string;
  /** a renderer from `renderers.ts`; the plain dot when omitted */
  render?: string;
  dotSize: number;
}

export const BODIES: readonly BodyPreset[] = [
  { key: 'sun', name: 'the sun', nameHe: 'חמה', color: '#e0b45c', render: 'sun', dotSize: 8 },
  { key: 'moon', name: 'the moon', nameHe: 'ירח', color: '#d8d4c8', render: 'lit', dotSize: 5 },
  { key: 'mercury', name: 'Mercury', nameHe: 'כוכב', color: '#b9a898', render: 'shaded', dotSize: 3.5 },
  { key: 'venus', name: 'Venus', nameHe: 'נוגה', color: '#e8cf9a', render: 'shaded', dotSize: 4.5 },
  { key: 'earth', name: 'the earth', nameHe: 'הארץ', color: '#6fa8dc', render: 'lit', dotSize: 5 },
  { key: 'mars', name: 'Mars', nameHe: 'מאדים', color: '#c9603c', render: 'shaded', dotSize: 4 },
  { key: 'jupiter', name: 'Jupiter', nameHe: 'צדק', color: '#d8ab7c', render: 'shaded', dotSize: 6 },
  { key: 'saturn', name: 'Saturn', nameHe: 'שבתאי', color: '#dcc68f', render: 'ringed', dotSize: 5.5 },
];

/** The preset a sphere's body is, if it is one. */
export function bodyPreset(key: string | undefined): BodyPreset | undefined {
  return BODIES.find((b) => b.key === key);
}

/** A sun at the centre of a figure: what the modern arrangement turns about —
 * a point, drawn as the body it is. */
export function centralSun(): ObjectDoc {
  return {
    kind: 'anchor',
    id: 'sun',
    name: 'the sun',
    nameHe: 'חמה',
    description: 'At the centre of the modern arrangement, with every planet turning about it.',
    color: '#e0b45c',
    dotSize: 8,
    body: 'sun',
    render: { ref: 'sun' },
  };
}
