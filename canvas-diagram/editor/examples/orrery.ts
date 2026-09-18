/**
 * The ladder of galgalim, with the signs and their constellations round it —
 * the shape `components/OrreryFw.astro` is built on, reduced to what a
 * document can say without an ephemeris behind it.
 *
 * It is here for the three things the other examples do not reach:
 *
 *  - **A ring that is the sky, not a dial.** Segments, the constellations
 *    drawn outside the names, and the honest note that the one thing a drawn
 *    zodiac cannot get right is its distance.
 *  - **Readings on that ring.** A `RingMarker` is a tick, a dot and a name at
 *    one longitude, and the pair here is the whole argument for why the field
 *    `pivot` exists: the sun's *true* place is sighted from the earth, its
 *    *mean* place from its own circle's off-centre centre, and on a ring of
 *    finite radius those are not the same spot. Drawn side by side, filled and
 *    open, which is which is the point.
 *  - **A parameter that changes what the figure is.** `shells` fades the bare
 *    nested spheres in and out, so the same figure is either a diagram of the
 *    mechanism or a picture of the sky, and the crossfade between them is one
 *    slider and one expression per opacity.
 */

import { DEFAULT_BACKGROUND, DEFAULT_THEME, MAZALOT, type DiagramDoc, type ObjectDoc } from '../doc.js';

/** The seven, inward to outward, with the rate each is given and the colour it
 * is drawn in. Speeds are degrees per day — mean motions, near enough that the
 * figure turns at recognisable rates without pretending to be an ephemeris. */
const GALGALIM: { id: string; name: string; nameHe: string; radius: number; speed: number; color: string }[] = [
  { id: 'moon', name: 'The moon', nameHe: 'לבנה', radius: 46, speed: 13.176, color: '#d8d4c8' },
  { id: 'mercury', name: 'Mercury', nameHe: 'כוכב', radius: 72, speed: 4.092, color: '#b9a88f' },
  { id: 'venus', name: 'Venus', nameHe: 'נוגה', radius: 98, speed: 1.602, color: '#e8d6a8' },
  { id: 'sun', name: 'The sun', nameHe: 'חמה', radius: 126, speed: 0.9856, color: '#f0c14b' },
  { id: 'mars', name: 'Mars', nameHe: 'מאדים', radius: 158, speed: 0.524, color: '#d98a5a' },
  { id: 'jupiter', name: 'Jupiter', nameHe: 'צדק', radius: 190, speed: 0.083, color: '#d8b98a' },
  { id: 'saturn', name: 'Saturn', nameHe: 'שבתאי', radius: 222, speed: 0.033, color: '#c9bb92' },
];

/** The sun's own circle is the one drawn off-centre: its apogee, and how far
 * off its centre sits as a fraction of its radius. */
const SUN_APOGEE = 86.8;
const SUN_ECCENTRICITY = 0.0417;

export function orreryFigure(): DiagramDoc {
  const objects: ObjectDoc[] = [
    {
      kind: 'anchor',
      id: 'earth',
      name: 'The earth',
      nameHe: 'הארץ',
      hebrewFirst: true,
      description:
        'The centre of the world, in his model and every ancient one. Every circle in the figure is drawn about it — though the sun’s, as the figure shows, is not quite centred on it.',
      marker: 'crosshair',
      dotSize: 4,
      color: '#9fb3d9',
      labelDir: { x: 0, y: 1 },
      labelGap: 10,
      labelRank: 4,
    },
  ];

  for (const [i, g] of GALGALIM.entries()) {
    // The bare shell: the sphere itself, as a thing in the world rather than as
    // the path of the body riding it. Faded by the slider, because whether
    // those spheres are drawn is exactly the difference between a diagram of
    // the mechanism and a picture of the sky.
    objects.push({
      kind: 'sphere',
      id: `${g.id}-shell`,
      name: `${g.name}’s sphere`,
      nameHe: g.nameHe,
      hebrewFirst: true,
      description:
        'One rung of the ladder of galgalim. They lie one above the other like the layers of an onion, with no empty space between any of them (Yesodei haTorah 3:2) — so each sphere’s thickness is set by what it has to hold.',
      center: { ref: 'earth' },
      radius: g.radius,
      showBody: false,
      // low on the left, where the figure is otherwise quiet
      labelAt: 200 + i * 4,
      labelRank: 40 + i,
      labelGap: 4,
      color: 'rgba(150,168,214,0.3)',
      opacity: { expr: 'f.shells * 0.9' },
      layer: 0,
    });

    // The body riding it. The sun's circle is the one drawn off-centre; every
    // other is concentric, which is what makes the sun's stand out.
    objects.push({
      kind: 'sphere',
      id: g.id,
      name: g.name,
      nameHe: g.nameHe,
      description:
        g.id === 'sun'
          ? 'It turns at a perfectly even rate, but its own circle’s centre sits a little off from the earth — and that offset alone is why it runs fast in one season and slow in another, with no second motion invented to explain it.'
          : `Riding its own sphere once round in ${(360 / g.speed).toFixed(g.speed > 1 ? 1 : 0)} days.`,
      center: { ref: 'earth' },
      radius: g.radius,
      ...(g.id === 'sun' ? { eccentric: { ratio: SUN_ECCENTRICITY, direction: SUN_APOGEE }, markCenter: true } : {}),
      speed: g.speed,
      phase: (i * 47) % 360,
      showRing: true,
      showBody: true,
      dotSize: g.id === 'sun' ? 7 : 4.5,
      color: g.color,
      render: { ref: g.id === 'sun' ? 'sun' : g.id === 'saturn' ? 'ringed' : 'shaded' },
      labelRank: 10 + i,
      // the rim is the shell's job when the shells are up; when they are down
      // the body's own circle is the only thing saying where it goes
      opacity: { expr: '1 - f.shells * 0.35' },
    });
  }

  objects.push(
    {
      kind: 'connector',
      id: 'apogee',
      name: "The sun's apogee",
      gloss: 'the far point of its own circle',
      hebrewFirst: true,
      description:
        'The direction its circle’s centre is offset in, and so where the sun is furthest from us and slowest. A direction, not a path — which is what the dashes mean throughout these figures.',
      from: { ref: 'earth' },
      toward: SUN_APOGEE,
      length: { expr: 'ringOuter(f)' },
      dashed: true,
      arrow: true,
      labelAt: 0.88,
      color: 'rgba(240,193,75,0.55)',
      // drawn out to the ring, so it must not be what the ring measures itself
      // against — or it would push the ring further out every frame
      excludeFromExtent: true,
    },
    {
      kind: 'ringmarker',
      id: 'sun-true',
      name: 'the sun’s true place',
      gloss: 'where the earth actually sees it',
      hebrewFirst: true,
      description:
        'Sighted from the earth. This is the reading a table of the sun’s place gives, and the one the signs are counted in.',
      center: { ref: 'earth' },
      radius: { expr: 'ringRadius(f)' },
      pivot: { ref: 'earth' },
      toward: { ref: 'sun' },
      parallax: 'none',
      style: 'solid',
      color: '#f0c14b',
      excludeFromExtent: true,
    },
    {
      kind: 'ringmarker',
      id: 'sun-mean',
      name: 'the sun’s mean place',
      gloss: 'where an even motion would put it',
      hebrewFirst: true,
      description:
        'Sighted from its own circle’s centre, not from the earth. The gap between this mark and the filled one is the whole of the sun’s correction — up to nearly two degrees, and zero only at the apogee and the point opposite it.',
      center: { ref: 'earth' },
      radius: { expr: 'ringRadius(f)' },
      // the sun's circle's own off-centre centre: the earth, plus the offset
      pivot: { expr: 'polar(' + SUN_APOGEE + ', ' + SUN_ECCENTRICITY * GALGALIM[3]!.radius + ')' },
      toward: { ref: 'sun' },
      parallax: 'none',
      style: 'open',
      color: 'rgba(240,193,75,0.75)',
      excludeFromExtent: true,
    },
    {
      kind: 'trail',
      id: 'mars-trail',
      name: "Mars's path",
      description:
        'Two years of it, drawn against the earth — an even circle, because in this figure it is one. The loops the real planet makes are what the epicycles are for, and this figure does not draw them.',
      target: { ref: 'mars' },
      relativeTo: { ref: 'earth' },
      span: 500,
      step: 2,
      bands: 6,
      color: 'rgba(217,138,90,0.4)',
      opacity: { expr: '1 - f.shells' },
      dependsOn: [],
    },
  );

  return {
    version: 1,
    name: 'The ladder of galgalim',
    description:
      'The seven, each on its own sphere, with the signs and their constellations round the outside. The slider fades the spheres themselves in and out — the same figure as a diagram of the mechanism, or as a picture of the sky.',
    clock: { speed: 6, running: true, start: 0, scrub: 800, unit: 'days' },
    view: { fitRadius: 'auto', refId: 'earth', lightId: 'sun', minZoom: 0.4, maxZoom: 20 },
    params: [
      {
        key: 'shells',
        label: 'The spheres themselves',
        control: 'range',
        min: 0,
        max: 1,
        step: 0.01,
        value: 1,
        description: 'Fades the bare nested spheres. At zero the figure is just the bodies and their paths.',
      },
    ],
    theme: structuredClone(DEFAULT_THEME),
    background: structuredClone(DEFAULT_BACKGROUND),
    zodiac: {
      radius: 'auto',
      padding: 26,
      // the outermost planet's distance swings, and a frame-by-frame ring
      // would breathe in and out around it
      fit: 'grow',
      band: 22,
      segments: MAZALOT.map((s) => ({ name: s.name, ...(s.nameHe !== undefined ? { nameHe: s.nameHe } : {}) })),
      language: 'en',
      color: 'rgba(158,176,222,0.28)',
      labelColor: 'rgba(223,231,251,0.9)',
      constellations: {
        figures: 'zodiac',
        // each figure carried round until its own middle is its segment's:
        // the ring as an emblem, where the picture and the word agree
        align: 'sign',
        nameStarsBrighterThan: 1.9,
      },
    },
    objects,
  };
}
