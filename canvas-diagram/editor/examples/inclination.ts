/**
 * The moon's orbit, inclined to the ecliptic — the construction
 * the lwalker.dev site's `MoonInclination.astro` is built on, as a document.
 *
 * It is here for one field: `plane`. A sphere given a tilt and a line of nodes
 * stops being a circle and becomes a circle seen edge-on from somewhere else,
 * projected exactly rather than impressionistically — its rim draws as an
 * ellipse, its carried point gains a real height above the flat plane, and the
 * half of the rim that has gone behind that plane fades. Two such spheres, on
 * the same nodes and a few degrees apart, *are* the figure: the gap that opens
 * between the two ellipses is the inclination itself.
 *
 * It is also the clearest demonstration of what parameters are for. The
 * inclination is 5.145°, which at any honest viewing angle is a sliver. So the
 * figure declares two: how far round we are looking from, and how much the
 * inclination is exaggerated — and every tilt in it is written as an
 * expression reading those. Drag the second slider and the figure lies more,
 * on purpose, by an amount you chose and can see.
 */

import { DEFAULT_BACKGROUND, DEFAULT_THEME, MAZALOT, type DiagramDoc } from '../doc.js';

/** Both circles are drawn at one radius: they are the same sphere's worth of
 * sky, differing only in which plane it is counted in. */
const R = 150;
/** The bearing of the line of nodes. Fixed here; the real ones regress once
 * round in 18.6 years, which is `{ expr: '-f.t * 0.053' }` away. */
const NODES = 20;

export function inclinationFigure(): DiagramDoc {
  return {
    version: 1,
    name: 'The moon’s inclination',
    description:
      'The moon’s orbit is tilted 5.145° to the ecliptic, and crosses it at two opposite points and nowhere else — which is why there is not an eclipse every month. Both circles are the same size; the gap between them is the whole of the inclination, exaggerated here by however much the second slider says.',
    clock: { speed: 2, running: true, start: 0, scrub: 60, unit: 'days' },
    view: { fitRadius: 'auto', refId: 'earth', minZoom: 0.5, maxZoom: 10 },
    params: [
      {
        key: 'view',
        label: 'Looking from',
        control: 'range',
        min: 0,
        max: 75,
        step: 1,
        value: 55,
        description: 'How far out of the ecliptic’s own plane we are looking — 0° is edge-on, 90° is from straight above.',
      },
      {
        key: 'exaggerate',
        label: 'Inclination ×',
        control: 'range',
        min: 1,
        max: 6,
        step: 0.1,
        value: 3,
        description: 'How many times its true 5.145° the inclination is drawn at. At 1 it is honest and nearly invisible.',
      },
    ],
    theme: structuredClone(DEFAULT_THEME),
    background: structuredClone(DEFAULT_BACKGROUND),
    zodiac: {
      radius: 'auto',
      padding: 26,
      band: 20,
      segments: MAZALOT.map((s) => ({ name: s.name, ...(s.nameHe !== undefined ? { nameHe: s.nameHe } : {}) })),
      color: 'rgba(150,168,214,0.2)',
    },
    objects: [
      {
        kind: 'anchor',
        id: 'earth',
        name: 'The earth',
        nameHe: 'הארץ',
        hebrewFirst: true,
        description: 'Both circles are drawn about it, and both tilts are counted from its own plane.',
        marker: 'dot',
        dotSize: 5,
        color: '#6fa8dc',
        labelDir: { x: 0, y: 1 },
        labelGap: 9,
      },
      {
        kind: 'sphere',
        id: 'ecliptic',
        name: 'The ecliptic',
        gloss: 'the plane the sun appears to travel in',
        hebrewFirst: true,
        description:
          'The plane the earth goes round the sun in, and so the plane the sun appears to travel in as seen from the earth. Tilted here only by the viewing angle: this is the plane the whole figure is measured against.',
        center: { ref: 'earth' },
        radius: R,
        showBody: false,
        plane: { tilt: { expr: 'f.view' }, nodes: NODES, behindFade: 0.35 },
        labelAt: 300,
        labelRank: 20,
        color: 'rgba(224,180,92,0.55)',
      },
      {
        kind: 'sphere',
        id: 'moon-orbit',
        name: "The moon's orbit",
        gloss: 'inclined 5.145° to the ecliptic',
        hebrewFirst: true,
        description:
          'Inclined 5.145° to the ecliptic, about the same line of nodes. It crosses the ecliptic at those two points and nowhere else, so the moon is only ever exactly on the ecliptic twice a month — and only an eclipse when it is there at the right moment.',
        center: { ref: 'earth' },
        radius: R,
        // The angle is the moon's argument of latitude — how far round its own
        // tilted plane it has come from the ascending node. What falls out of
        // the projection is its longitude in the flat one, which is the whole
        // point of stating it this way round.
        angle: { expr: 'f.t * 13.176' },
        plane: {
          tilt: { expr: 'f.view + 5.145 * f.exaggerate' },
          nodes: NODES,
          behindFade: 0.35,
        },
        showBody: true,
        dotSize: 6,
        color: '#c6d4f0',
        labelAt: 120,
        labelRank: 22,
      },
      {
        kind: 'connector',
        id: 'node-line',
        name: 'The line of nodes',
        gloss: 'where the two planes cross',
        hebrewFirst: true,
        description:
          'The one line both planes share. The moon is on the ecliptic only when it is on this line — twice a month — and an eclipse needs it to be there at new or full moon, which is why they are rare.',
        from: { ref: 'earth' },
        toward: NODES,
        length: R * 1.16,
        dashed: true,
        arrow: true,
        labelAt: 0.92,
        color: 'rgba(143,214,201,0.7)',
        excludeFromExtent: true,
      },
      {
        kind: 'connector',
        id: 'node-line-back',
        name: 'and the other way',
        showLabel: false,
        from: { ref: 'earth' },
        toward: NODES + 180,
        length: R * 1.16,
        dashed: true,
        color: 'rgba(143,214,201,0.7)',
        excludeFromExtent: true,
      },
      {
        kind: 'connector',
        id: 'to-moon',
        name: 'Out to the moon',
        showLabel: false,
        from: { ref: 'earth' },
        to: { ref: 'moon-orbit' },
        shorten: 7,
        color: 'rgba(198,212,240,0.45)',
      },
      {
        kind: 'trail',
        id: 'moon-trail',
        name: "The moon's path",
        description:
          'A month of it. Seen at this angle the path is an ellipse that does not close on the ecliptic’s own — it rides above it for half the month and below it for the other half.',
        target: { ref: 'moon-orbit' },
        relativeTo: { ref: 'earth' },
        span: 27.3,
        step: 0.08,
        bands: 8,
        color: 'rgba(198,212,240,0.55)',
        // it reads both sliders: a change to either moves every past sample
        dependsOn: ['view', 'exaggerate'],
      },
      {
        kind: 'ringmarker',
        id: 'moon-longitude',
        name: "The moon's longitude",
        gloss: 'read against the signs',
        hebrewFirst: true,
        description:
          'Where the moon stands among the signs — its longitude in the flat plane, which is what the projection hands back and what a table of the moon’s place actually states.',
        center: { ref: 'earth' },
        radius: { expr: 'ringRadius(f)' },
        toward: { ref: 'moon-orbit' },
        style: 'solid',
        color: '#c6d4f0',
        excludeFromExtent: true,
      },
    ],
  };
}
