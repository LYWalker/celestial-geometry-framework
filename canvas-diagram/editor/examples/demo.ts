/**
 * `components/CanvasDiagramDemo.astro`, as a document.
 *
 * This one is the editor's own proof. The demo figure was written by hand to
 * exercise every construction the scene layer has — a bare nested shell, an
 * eccentric circle, an epicycle riding another sphere, an angle measured from
 * a point that is not a circle's own centre, a trail, two connectors of both
 * kinds, an angle between two objects, a custom body renderer, and a
 * self-sizing ring. If the editor can hold all of that, there is nothing in
 * the kit it cannot hold.
 *
 * Read side by side with the hand-written original, the only differences are
 * the two the document format exists to make: a closure (`angle: (f) => f.t *
 * 22`) is written as its source, and a reference (`center: earth`) is written
 * as an id. Everything else — every number, every name, every description — is
 * the same text in the same field.
 */

import { DEFAULT_BACKGROUND, DEFAULT_THEME, MAZALOT, type DiagramDoc } from '../doc.js';

/** The nest of shells, as `nester(46, 30)` produces it. */
const R_MERCURY = 46;
const R_SUN = 76;
const R_MARS = 106;

export function demoFigure(): DiagramDoc {
  return {
    version: 1,
    name: 'Scene layer demo',
    description:
      'Every construction the scene layer has, in one figure: nested shells, an eccentric circle, an epicycle, an angle measured from a point that is not a circle’s own centre, a trail, sightlines, and a ring that sizes itself to whatever the figure reaches.',
    clock: { speed: 1, running: true, start: 0, scrub: 60, unit: 'seconds' },
    view: { fitRadius: 'auto', refId: 'earth', lightId: 'sun', minZoom: 0.5, maxZoom: 8 },
    params: [],
    theme: structuredClone(DEFAULT_THEME),
    background: structuredClone(DEFAULT_BACKGROUND),
    zodiac: {
      // no radius: the ring sizes itself to whatever the scene reaches, plus
      // padding — widen Mars's orbit and it follows, instead of this figure
      // keeping its own copy of the number
      radius: 'auto',
      padding: 20,
      band: 22,
      segments: MAZALOT.map((s) => ({ name: s.name })),
      color: 'rgba(150,168,214,0.22)',
    },
    objects: [
      {
        kind: 'anchor',
        id: 'earth',
        name: 'The earth',
        description: 'Everything else in this figure is either centred on it or offset from something that is.',
        marker: 'cross',
        color: '#9fb3d9',
      },
      {
        kind: 'sphere',
        id: 'mercury-shell',
        name: 'A bare nested shell',
        description:
          'Nothing rides this one — the body is off — it only shows that a sphere can be a pure construction shell, nested like the others, and still name itself on its own rim without a body to hang the name off.',
        center: { ref: 'earth' },
        radius: R_MERCURY,
        showBody: false,
        labelAt: 250,
        color: 'rgba(150,168,214,0.35)',
      },
      {
        kind: 'sphere',
        id: 'sun',
        name: 'The sun',
        nameHe: 'חמה',
        description:
          'An eccentric circle: it turns at an even rate, but its own centre sits off from the earth by a fixed fraction of its radius — that offset alone is why the sun runs fast in one season and slow in another. Its motion is given as an angle outright, not a speed, which is the hook a real ephemeris plugs into.',
        color: '#e0b45c',
        center: { ref: 'earth' },
        radius: R_SUN,
        eccentric: { ratio: 0.09, direction: 65 },
        angle: { expr: 'f.t * 22' },
        markCenter: true,
        render: { ref: 'sun' },
        dotSize: 5,
      },
      {
        kind: 'sphere',
        id: 'mars-shell',
        name: 'A further nested shell',
        description:
          'Sphere nesting works outward as freely as inward — this one just sits further out than the sun, sharing the same earth-anchored centre.',
        center: { ref: 'earth' },
        radius: R_MARS,
        showBody: false,
        labelAt: 250,
        color: 'rgba(150,168,214,0.35)',
      },
      {
        kind: 'sphere',
        id: 'moon-deferent',
        name: "The moon's large circle",
        nameHe: 'הגלגל הגדול',
        description:
          "Carries the small sphere the moon actually rides. It is itself off-centre from the earth, the way every one of the seven spheres is said to be — and its own carried point is measured from the earth, not from its own eccentric centre, which is the real construction the Rambam's moon needs: a ray from the earth out to where it meets this circle's rim.",
        color: 'rgba(146,198,240,0.55)',
        center: { ref: 'earth' },
        radius: 34,
        eccentric: { ratio: 0.2, direction: 200 },
        measureFrom: { ref: 'earth' },
        speed: -8,
        showBody: false,
        markCenter: true,
      },
      {
        kind: 'trail',
        id: 'moon-trail',
        name: "The moon's trail",
        description:
          'A rolling window of past positions, replayed under whatever frame is current right now — a trail needs only a target and a span, never a stored history kept in sync by hand. Joined with a curve, not straight segments, so the sample step only has to track the moon’s own speed rather than being retuned against how far you are allowed to zoom in.',
        color: '#d8d4c8',
        target: { ref: 'moon' },
        relativeTo: { ref: 'earth' },
        span: 5,
        step: 0.05,
        bands: 10,
        opacity: 0.8,
        // this figure's frame only ever carries the clock — nothing here reads
        // a parameter — so this trail never rebuilds for anything but time
        dependsOn: [],
      },
      {
        kind: 'sphere',
        id: 'moon',
        name: 'The moon',
        nameHe: 'ירח',
        description:
          "An epicycle: this sphere's centre is not a point, it is the large circle above — this sphere rides wherever that one currently is, with no coordinate arithmetic written anywhere to make that happen. Its dot is drawn shaded from the sun's direction rather than as a plain disc.",
        color: '#d8d4c8',
        center: { ref: 'moon-deferent' },
        radius: 9,
        speed: 210,
        dotSize: 5,
        render: { ref: 'lit' },
      },
      {
        kind: 'connector',
        id: 'earth-to-sun',
        name: 'Line to the sun',
        description:
          'One of the two rays the elongation is measured between — an ordinary connector from the earth to the sun, so it always points at wherever the sun currently is.',
        color: 'rgba(224,180,92,0.5)',
        from: { ref: 'earth' },
        to: { ref: 'sun' },
        shorten: 7,
      },
      {
        kind: 'connector',
        id: 'earth-to-moon',
        name: 'Line to the moon',
        description: 'The other ray the elongation is measured between.',
        color: 'rgba(216,212,200,0.5)',
        from: { ref: 'earth' },
        to: { ref: 'moon' },
        shorten: 8,
      },
      {
        kind: 'connector',
        id: 'apogee-line',
        name: "The sun's apogee",
        description:
          'A direction, not a path — dashed, this kit’s convention throughout for a bearing rather than a route actually travelled. Given as a bearing and a length rather than an end point the author would otherwise have to work out.',
        color: 'rgba(224,180,92,0.6)',
        from: { ref: 'earth' },
        toward: 65,
        length: R_SUN + 26,
        dashed: true,
        arrow: true,
        labelAt: 1,
      },
      {
        kind: 'angle',
        id: 'elongation',
        name: 'Elongation',
        description:
          'The angle between the sun and the moon, seen from the earth. An angle needs only a vertex and two things to sight toward — here, two other objects in the figure — so its bearings are read off their positions, never entered by hand.',
        vertex: { ref: 'earth' },
        from: { ref: 'sun' },
        to: { ref: 'moon' },
        radius: 20,
        short: true,
        showValue: true,
        color: '#8fd6c9',
      },
    ],
  };
}
