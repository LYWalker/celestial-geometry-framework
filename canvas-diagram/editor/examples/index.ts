/**
 * The worked examples the editor opens with.
 *
 * They are not decoration. The claim this editor makes is that anything the
 * scene layer can draw, a document can say and the editor can build — and the
 * only honest way to make that claim is to rebuild the figures that already
 * exist and see whether anything is missing. Between the three of them they
 * use every field of every kind the scene layer has: nested and eccentric
 * circles, an epicycle, an angle measured from somewhere that is not a
 * circle's own centre, a tilted plane, trails, sightlines of both kinds,
 * readings on the ring sighted from two different points, named body
 * renderers, a self-sizing ring with constellations, and parameters that fade
 * one model into another.
 *
 * They are also the fastest way to learn the editor: open one, click something,
 * and the panel explains what it is.
 */

import type { DiagramDoc } from '../doc.js';
import { demoFigure } from './demo.js';
import { inclinationFigure } from './inclination.js';
import { orreryFigure } from './orrery.js';

export { demoFigure, inclinationFigure, orreryFigure };

export const EXAMPLES: { name: string; doc: () => DiagramDoc }[] = [
  { name: 'Scene layer demo', doc: demoFigure },
  { name: 'The ladder of galgalim', doc: orreryFigure },
  { name: "The moon's inclination", doc: inclinationFigure },
];
