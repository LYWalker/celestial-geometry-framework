/**
 * What the inspector shows, field by field.
 *
 * The scene layer's configs are already documented — at length, in their own
 * files, and that prose is the best explanation of them there is. What it
 * cannot do is appear next to the control. So this file is that documentation
 * restated as data: for every field of every kind, what it is called in the
 * panel, what kind of control it gets, and the one line that says what it
 * means. The editor renders the panel from this list and knows nothing about
 * any particular field, which is what keeps "a field the scene layer has" and
 * "a field you can edit" the same set.
 *
 * The `help` lines are the point, not decoration. An editor for a kit like
 * this one is only intuitive if it explains the vocabulary as you use it —
 * what an eccentric is, why `measureFrom` exists, what makes a mean place
 * differ from a true one. Someone who has not read the scene layer's source
 * should be able to build a correct figure out of this panel, and that is the
 * bar these lines are written to.
 */

import type { DiagramDoc, ObjectDoc, ObjectKind } from './doc.js';
import type { Unit } from './units.js';

export type FieldType =
  /** a line of text */
  | 'text'
  /** several lines — a description */
  | 'prose'
  /** a colour, with a swatch */
  | 'color'
  /** a plain number, never an expression (`speed`, `phase`, `bands`) */
  | 'number'
  /** a `Scalar`: a number, or an expression of the frame */
  | 'scalar'
  /** a `PointLike`: another object, a fixed point, or an expression */
  | 'point'
  /** a `DirectionLike`: a bearing in degrees, an object to point at, or an expression */
  | 'dir'
  /** a plain checkbox */
  | 'bool'
  /** a `BoolLike`: a checkbox, or an expression */
  | 'boolLike'
  /** one of a fixed set */
  | 'enum'
  /** a `Face`: a CSS font shorthand and its pixel size */
  | 'face'
  /** text, or an expression producing text (a gloss stating a live figure) */
  | 'textLike'
  /** a `{ x, y }` direction hint, or an expression producing one */
  | 'vec'
  /** an expression and nothing else — a formatter, a renderer written inline */
  | 'expr'
  /** a named body renderer, chosen from the registry */
  | 'renderer'
  /** a list of Frame keys (`Trail.dependsOn`) */
  | 'keys'
  /** `RingMarker.reach` — two numbers, in and out */
  | 'reach';

export interface FieldSpec {
  /** dotted path into the object: `radius`, `eccentric.ratio` */
  path: string;
  label: string;
  type: FieldType;
  group: string;
  help?: string;
  options?: readonly string[];
  step?: number;
  min?: number;
  max?: number;
  /** what the scene layer does when this is left empty — shown as the
   * placeholder, so an omitted field reads as a default rather than a blank */
  fallback?: string;
  /** what kind of quantity a number is, so it can be typed the way the
   * sources state it (`13°10′35″`, `26°45′ Gemini`, `2;30/60`) and read back
   * in every form — see `units.ts` */
  unit?: Unit | ((o: ObjectDoc) => Unit);
  /** tucked under "More options" rather than shown with the essentials.
   * Defaults to whether the path is in `ADVANCED`. */
  advanced?: boolean;
  /** show this field only when the object is in a state where it means
   * something: `phase` is meaningless once `angle` is set, and saying so by
   * hiding it is clearer than a note under a control that does nothing */
  when?: (o: ObjectDoc, doc: DiagramDoc) => boolean;
}

/** The order the panel's sections appear in. */
export const GROUPS = ['What it is', 'Where it is', 'How it moves', 'Its name', 'How it draws'] as const;

const ID: FieldSpec[] = [
  {
    path: 'name',
    label: 'Name',
    type: 'text',
    group: 'What it is',
    help: 'The headline on its label, and what a hover says first.',
  },
  {
    path: 'nameHe',
    label: 'Hebrew name',
    type: 'text',
    group: 'What it is',
    help: 'Drawn as the label’s second line — or as the headline, under “name it as a construction”.',
  },
  {
    path: 'description',
    label: 'Description',
    type: 'prose',
    group: 'What it is',
    help: 'A sentence or two: the hover tooltip’s second line, and the figure’s screen-reader text.',
  },
  {
    path: 'id',
    label: 'id',
    type: 'text',
    group: 'What it is',
    help: 'How everything else refers to this object, and the name it becomes in the emitted code. Renaming it updates every reference.',
  },
];

const LABEL: FieldSpec[] = [
  {
    path: 'gloss',
    label: 'Gloss',
    type: 'textLike',
    group: 'Its name',
    help: 'The one short line beneath the headline — “the sun’s apogee (12:2)”. As an expression it can state a live figure.',
  },
  {
    path: 'hebrewFirst',
    label: 'Name it as a construction',
    type: 'bool',
    group: 'Its name',
    help: 'Hebrew name as the headline, gloss beneath — how this kit labels a construction. A body reads the other way round, which is the default.',
  },
  {
    path: 'showLabel',
    label: 'Name it at all',
    type: 'bool',
    group: 'Its name',
    fallback: 'yes',
  },
  {
    path: 'labelDir',
    label: 'Label direction',
    type: 'vec',
    group: 'Its name',
    help: 'Which way from its own point the label would rather sit. Each kind has a sensible default; set this for the exceptions.',
    fallback: 'outward',
  },
  {
    path: 'labelRank',
    label: 'Label rank',
    type: 'number',
    group: 'Its name',
    help: 'Who keeps their name when there isn’t room for everyone. Lower ranks are placed first.',
    step: 1,
  },
  {
    path: 'labelGap',
    label: 'Label gap',
    type: 'number',
    group: 'Its name',
    help: 'Clearance between the point and its label, world px.',
    step: 1,
  },
  { path: 'labelFont', label: 'Label face', type: 'face', group: 'Its name', fallback: 'the theme’s' },
  { path: 'labelSubFont', label: 'Second-line face', type: 'face', group: 'Its name', fallback: 'the theme’s' },
];

const DRAW: FieldSpec[] = [
  { path: 'color', label: 'Colour', type: 'color', group: 'How it draws', fallback: 'the theme’s' },
  {
    path: 'opacity',
    label: 'Opacity',
    type: 'scalar',
    group: 'How it draws',
    help: '0–1. As an expression this is the mechanism every mode crossfade in this kit is built from.',
    min: 0,
    max: 1,
    step: 0.05,
    fallback: '1',
  },
  {
    path: 'layer',
    label: 'Draw order',
    type: 'number',
    group: 'How it draws',
    help: 'Lower draws first. Shells 0, trails 5, anchors 8, connectors 10, angles 20, readings 25, bodies 30.',
    step: 1,
    fallback: 'its kind’s',
  },
  {
    path: 'excludeFromExtent',
    label: 'Leave out of the fit',
    type: 'bool',
    group: 'How it draws',
    help: 'Keep this out of what the ring and camera size themselves to — for a sightline drawn out to the ring, which would otherwise push the ring further out every frame.',
  },
];

const BY_KIND: Record<ObjectKind, FieldSpec[]> = {
  anchor: [
    {
      path: 'at',
      label: 'At',
      type: 'point',
      group: 'Where it is',
      help: 'Where it sits — a fixed point, or riding another object.',
      fallback: 'the origin',
    },
    {
      path: 'marker',
      label: 'Marker',
      type: 'enum',
      group: 'How it draws',
      options: ['cross', 'crosshair', 'dot', 'none'],
      // a point drawn as a body has no marker to choose
      when: (o) => o.kind === 'anchor' && o.render === undefined,
      help: 'A crosshair for a centre the construction keeps referring back to; “none” for a point that exists only for others to reference.',
      fallback: 'cross',
    },
    { path: 'dotSize', label: 'Size', type: 'number', group: 'How it draws', step: 0.5, min: 0 },
  ],

  sphere: [
    {
      path: 'radius',
      label: 'Radius',
      unit: 'length',
      type: 'scalar',
      group: 'Where it is',
      help: 'This circle’s own radius, world px. Drag its rim on the canvas to set it.',
      step: 1,
      min: 0,
    },
    {
      path: 'center',
      label: 'Centred on',
      type: 'point',
      group: 'Where it is',
      help: 'Point this at another sphere and this one rides its rim — that is an epicycle, with no coordinate arithmetic anywhere.',
      fallback: 'the origin',
    },
    {
      path: 'eccentric.ratio',
      label: 'Off-centre by',
      unit: 'ratio',
      type: 'scalar',
      group: 'Where it is',
      help: 'How far this circle’s own centre sits from what it is centred on, as a fraction of its radius. That offset alone is why the sun runs fast in one season and slow in another.',
      min: 0,
      max: 1,
      step: 0.01,
      fallback: '0',
    },
    {
      path: 'eccentric.direction',
      label: 'Off-centre toward',
      unit: 'bearing',
      type: 'dir',
      group: 'Where it is',
      help: 'Which way the offset points — a fixed bearing for an apogee, or something that moves.',
      when: (o) => o.kind === 'sphere' && o.eccentric !== undefined,
    },
    {
      path: 'measureFrom',
      label: 'Its angle is seen from',
      type: 'point',
      group: 'Where it is',
      help: 'Count this sphere’s angle from here instead of from its own centre, and put the body where that ray meets the rim — the construction the Rambam’s moon needs, whose course is counted from the earth.',
      fallback: 'its own centre',
      when: (o) => o.kind === 'sphere' && o.plane === undefined,
    },
    {
      path: 'plane.tilt',
      label: 'Tilt out of the page',
      unit: 'angle',
      type: 'scalar',
      group: 'Where it is',
      help: 'Degrees. The rim then draws as an ellipse and the body gains a real depth — an exact projection, not an impression.',
      step: 0.5,
      when: (o) => o.kind === 'sphere' && o.measureFrom === undefined,
    },
    {
      path: 'plane.nodes',
      label: 'Line of nodes',
      unit: 'bearing',
      type: 'dir',
      group: 'Where it is',
      help: 'The bearing it is tipped about. Real nodes move — the moon’s regress once round in 18.6 years.',
      when: (o) => o.kind === 'sphere' && o.plane !== undefined,
    },
    {
      path: 'plane.behindFade',
      label: 'Fade behind',
      type: 'number',
      group: 'Where it is',
      help: 'How much opacity the half behind the flat plane keeps, 0–1.',
      min: 0,
      max: 1,
      step: 0.05,
      fallback: '0.4',
      when: (o) => o.kind === 'sphere' && o.plane !== undefined,
    },
    {
      path: 'speed',
      label: 'Motion',
      unit: 'rate',
      type: 'number',
      group: 'How it moves',
      help: 'How fast it turns, per unit of the clock. Type it as the source gives it: 13°10′35″ (a day), 136°28′20″ per 10000 days, 27.32 days (once round), 0.9856. ↺/↻ sets which way. For a motion that is not even — a true place from a table — give its angle outright, under More options.',
      step: 0.1,
      when: (o) => o.kind === 'sphere' && o.angle === undefined,
    },
    {
      path: 'phase',
      label: 'Where it starts',
      unit: (o) => (o.kind === 'sphere' && o.countFrom === 'carrier' ? 'angle' : 'bearing'),
      type: 'number',
      group: 'How it moves',
      help: 'Where the body stands when the clock reads zero — at the epoch. A longitude, like 1°14′43″ Taurus; or, counted from its carrier, the angle along it, like the moon’s course of 84°28′42″ (14:4).',
      step: 1,
      when: (o) => o.kind === 'sphere' && o.angle === undefined,
    },
    {
      path: 'clockwise',
      label: 'Turns clockwise',
      type: 'bool',
      group: 'How it moves',
      help: 'Its motion and starting point are counted clockwise — how the Rambam gives the small sphere, which turns against the large one (14:3), so his numbers go in as he states them. The ↻ beside Motion does the same.',
      when: (o) => o.kind === 'sphere' && (o.speed !== undefined || o.angle !== undefined),
    },
    {
      path: 'countFrom',
      label: 'Its motion is counted from',
      type: 'enum',
      group: 'How it moves',
      options: ['east', 'carrier'],
      help: '“carrier”: from the line the sphere it rides carries it along — how the Rambam gives an epicycle’s motion (the moon’s course, 14:3, counted from the small sphere’s far point). Choose it, and his numbers go in as he states them.',
      fallback: 'east',
      // only for a sphere riding another sphere — anything else has no line to count from
      when: (o, doc) =>
        o.kind === 'sphere' &&
        o.center !== undefined &&
        'ref' in o.center &&
        doc.objects.some((x) => x.kind === 'sphere' && 'ref' in o.center! && x.id === (o.center as { ref: string }).ref),
    },
    {
      path: 'angle',
      label: 'Angle outright',
      unit: (o) => (o.kind === 'sphere' && o.countFrom === 'carrier' ? 'angle' : 'bearing'),
      type: 'scalar',
      group: 'How it moves',
      help: 'The bearing itself, for a body whose motion is not a constant rate — where a real ephemeris plugs in. Takes precedence over speed and phase.',
      step: 1,
    },
    {
      path: 'showRing',
      label: 'Draw the rim',
      type: 'bool',
      group: 'How it draws',
      fallback: 'yes',
    },
    {
      path: 'showBody',
      label: 'Draw the body',
      type: 'bool',
      group: 'How it draws',
      fallback: 'yes when it turns',
      help: 'The point riding the rim. Off by default for a sphere that is only a shell for others to sit in.',
    },
    {
      path: 'markCenter',
      label: 'Mark its centre',
      type: 'boolLike',
      group: 'How it draws',
      help: 'A small cross at this circle’s own centre — the Rambam’s own convention for a centre that is not the earth.',
    },
    {
      path: 'dotSize',
      label: 'Body size',
      type: 'number',
      group: 'How it draws',
      help: 'Screen px — a constant on-screen size whatever the zoom, like a map pin.',
      step: 0.5,
      min: 0,
    },
    {
      path: 'render',
      label: 'Body renderer',
      type: 'renderer',
      group: 'How it draws',
      help: 'How the body draws itself. A lit disc needs the figure to have a light source set, under View.',
      fallback: 'a plain dot',
    },
    {
      path: 'labelAt',
      label: 'Name the rim at',
      type: 'dir',
      group: 'Its name',
      help: 'Where round its own rim a bare shell hangs its name. No effect when the body is drawn — the body’s own label covers that.',
      when: (o) => o.kind === 'sphere' && o.showBody === false,
    },
  ],

  angle: [
    { path: 'vertex', label: 'Vertex', type: 'point', group: 'Where it is', help: 'The point the angle is seen from.' },
    {
      path: 'from',
      label: 'From',
      unit: 'bearing',
      type: 'dir',
      group: 'Where it is',
      help: 'One arm — a bearing, or an object to sight at, in which case the arm follows wherever it goes.',
    },
    { path: 'to', label: 'To', unit: 'bearing',
      type: 'dir', group: 'Where it is', help: 'The other arm.' },
    {
      path: 'radius',
      label: 'Arc radius',
      unit: 'length',
      type: 'scalar',
      group: 'Where it is',
      help: 'How far out the arc is drawn, world px. As an expression it can stay a constant fraction of the way out to whatever it sights at.',
      step: 1,
      min: 0,
    },
    {
      path: 'short',
      label: 'It is a correction',
      type: 'bool',
      group: 'How it moves',
      fallback: 'yes',
      help: 'Sweep whichever way is under 180° and report it signed — the way “add” or “subtract” is meant. Turn off for a swept angle that can run all the way round, like an elongation.',
    },
    {
      path: 'clockwise',
      label: 'Sweep clockwise',
      type: 'bool',
      group: 'How it moves',
      help: 'Which way round, for an angle that is not a correction.',
      when: (o) => o.kind === 'angle' && o.short === false,
    },
    {
      path: 'showValue',
      label: 'Show the value',
      type: 'bool',
      group: 'Its name',
      help: 'Write the number of degrees as the label’s second line.',
    },
    {
      path: 'format',
      label: 'Value format',
      type: 'expr',
      group: 'Its name',
      help: 'A function of the degrees — `(d) => `${(d * 60).toFixed(0)}′`` for a correction the text states in arc-minutes.',
      fallback: '12.3°',
      when: (o) => o.kind === 'angle' && o.showValue === true,
    },
    { path: 'lineWidth', label: 'Line width', type: 'number', group: 'How it draws', step: 0.1, min: 0 },
  ],

  connector: [
    { path: 'from', label: 'From', type: 'point', group: 'Where it is' },
    {
      path: 'to',
      label: 'To',
      type: 'point',
      group: 'Where it is',
      help: 'The other end. Leave it empty and give a bearing and a length instead, for a sightline with no real endpoint of its own.',
    },
    {
      path: 'toward',
      label: 'Toward',
      unit: 'bearing',
      type: 'dir',
      group: 'Where it is',
      help: 'A bearing from the start, used with a length instead of an end point.',
      when: (o) => o.kind === 'connector' && o.to === undefined,
    },
    {
      path: 'length',
      label: 'Length',
      unit: 'length',
      type: 'scalar',
      group: 'Where it is',
      step: 1,
      min: 0,
      when: (o) => o.kind === 'connector' && o.to === undefined,
    },
    {
      path: 'dashed',
      label: 'Dashed',
      type: 'bool',
      group: 'How it draws',
      help: 'This kit’s convention throughout for a direction rather than a route actually travelled.',
    },
    {
      path: 'shorten',
      label: 'Stop short by',
      type: 'number',
      group: 'How it draws',
      help: 'World px, so the line does not run under the dot at its far end.',
      step: 1,
      min: 0,
    },
    {
      path: 'arrow',
      label: 'Arrowhead',
      type: 'boolLike',
      group: 'How it draws',
      help: 'For a line asserting a direction rather than joining two things that are both already drawn.',
    },
    {
      path: 'labelAt',
      label: 'Name it at',
      type: 'number',
      group: 'Its name',
      help: '0 is the start, 1 the end. A sightline drawn out to a point the figure names wants its name at that end, not halfway down.',
      min: 0,
      max: 1,
      step: 0.05,
      fallback: '0.5',
    },
    { path: 'lineWidth', label: 'Line width', type: 'number', group: 'How it draws', step: 0.1, min: 0 },
  ],

  trail: [
    { path: 'target', label: 'Of', type: 'point', group: 'Where it is', help: 'The thing whose past positions are drawn.' },
    {
      path: 'relativeTo',
      label: 'Plotted against',
      type: 'point',
      group: 'Where it is',
      help: 'Positions are reduced against this point at each past moment too, so the trail bends into whatever frame is current. Usually the figure’s own centre.',
      fallback: 'raw world space',
    },
    {
      path: 'span',
      label: 'Span',
      type: 'number',
      group: 'How it moves',
      help: 'How far back to draw, in the clock’s own units.',
      step: 0.5,
      min: 0,
    },
    {
      path: 'step',
      label: 'Sample step',
      type: 'number',
      group: 'How it moves',
      help: 'Spacing between samples. With curve interpolation this is “how many degrees of motion one sample may skip”, so it tracks the target’s speed rather than how far you can zoom.',
      step: 0.01,
      min: 0.001,
    },
    {
      path: 'bands',
      label: 'Fade bands',
      type: 'number',
      group: 'How it draws',
      help: 'Stepped alpha, oldest faintest.',
      step: 1,
      min: 1,
      fallback: '6',
    },
    { path: 'lineWidth', label: 'Line width', type: 'number', group: 'How it draws', step: 0.1, min: 0 },
    {
      path: 'dependsOn',
      label: 'Depends on',
      type: 'keys',
      group: 'How it moves',
      help: 'Which parameters this trail actually reads, besides the clock. Leave empty for a trail that only follows the clock — it then keeps its samples while a slider is dragged instead of rebuilding every frame.',
      fallback: 'everything',
    },
  ],

  ringmarker: [
    {
      path: 'radius',
      label: 'Ring radius',
      unit: 'length',
      type: 'scalar',
      group: 'Where it is',
      help: 'Point this at the ring’s own inner edge, so the tick can never sit on a different circle than the one drawn.',
      step: 1,
      min: 0,
    },
    {
      path: 'center',
      label: 'Ring centre',
      type: 'point',
      group: 'Where it is',
      fallback: 'the origin',
    },
    {
      path: 'toward',
      label: 'Reading',
      unit: 'bearing',
      type: 'dir',
      group: 'Where it is',
      help: 'The longitude being read — a bearing, or an object to sight at.',
    },
    {
      path: 'pivot',
      label: 'Sighted from',
      type: 'point',
      group: 'Where it is',
      help: 'The ring’s centre for a true place; a circle’s own off-centre centre for a mean one. That difference is the whole reason this field exists.',
      fallback: 'the ring’s centre',
    },
    {
      path: 'parallax',
      label: 'How far off the ring is',
      type: 'enum',
      group: 'Where it is',
      options: ['none', 'finite'],
      help: '“none” reads the ring as the sky at infinity and puts the mark at its bearing from the centre. “finite” puts it where the ray actually crosses the circle — right for a wheel, wrong for the sky, and worth up to two degrees of a thirty-degree sign.',
      fallback: 'none',
    },
    {
      path: 'style',
      label: 'Mark',
      type: 'enum',
      group: 'How it draws',
      options: ['solid', 'open'],
      help: 'Filled for a place the earth actually sees; open for a mean place — something in the construction rather than in the sky.',
      fallback: 'solid',
    },
    { path: 'reach', label: 'Tick reach', type: 'reach', group: 'How it draws', help: 'How far the tick reaches inside and outside the ring, world px.' },
    { path: 'dotSize', label: 'Dot size', type: 'number', group: 'How it draws', step: 0.5, min: 0 },
    { path: 'lineWidth', label: 'Line width', type: 'number', group: 'How it draws', step: 0.1, min: 0 },
  ],
};

/**
 * Fields most figures never touch. They stay one click away under "More
 * options" instead of in the way: a sphere is a centre, a radius and how it
 * turns, and a panel that leads with label rank and line width buries that.
 */
const ADVANCED = new Set([
  'id',
  'hebrewFirst',
  'showLabel',
  'labelDir',
  'labelRank',
  'labelGap',
  'labelFont',
  'labelSubFont',
  'excludeFromExtent',
  'layer',
  'dotSize',
  'lineWidth',
  'plane.behindFade',
  'parallax',
  'format',
  'render',
  'labelAt',
  'shorten',
  'dependsOn',
  'reach',
  'step',
  'bands',
  'relativeTo',
  'showBody',
  'plane.tilt',
  'plane.nodes',
  'angle',
  'clockwise',
]);

/** The unit a field is in, for this object — some depend on it: a sphere's
 * starting point is a longitude, unless it is counted from its carrier. */
export function unitOf(spec: FieldSpec, o: ObjectDoc): Unit | undefined {
  return typeof spec.unit === 'function' ? spec.unit(o) : spec.unit;
}

export function isAdvanced(spec: FieldSpec): boolean {
  return spec.advanced ?? ADVANCED.has(spec.path);
}

/** Every field the inspector shows for one kind, in panel order. */
export function fieldsFor(kind: ObjectKind): FieldSpec[] {
  const all = [...ID, ...(BY_KIND[kind] ?? []), ...LABEL, ...DRAW];
  // Stable within a group, grouped in GROUPS order — so a kind's own geometry
  // comes before the label and drawing fields every kind shares, without each
  // kind's list having to interleave them by hand.
  return GROUPS.flatMap((g) => all.filter((f) => f.group === g));
}

/** One line on what each kind is, for the "add" menu. */
export const KIND_NOTES: Record<ObjectKind, string> = {
  anchor: 'A named point other things are centred on or sighted from. The earth, a mean sun.',
  sphere: 'A circle, and optionally something riding its rim. Nest them, offset them, or ride one on another to make an epicycle.',
  connector: 'A line between two points, or a sightline out along a bearing.',
  angle: 'The angle between two bearings, seen from a vertex — with its value, if it is worth reading.',
  trail: 'Where something has been: a rolling window of past positions.',
  ringmarker: 'A reading on the ring at the figure’s edge — a tick, a dot and a name at one longitude.',
};

/** The label for each kind in the object list and the add menu. */
export const KIND_LABELS: Record<ObjectKind, string> = {
  anchor: 'Point',
  sphere: 'Sphere',
  connector: 'Line',
  angle: 'Angle',
  trail: 'Trail',
  ringmarker: 'Ring reading',
};
