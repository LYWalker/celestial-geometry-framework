/**
 * The three or four shapes every orbital figure in this kit needs, and which
 * three.js has no particular opinion about: a line with thickness between two
 * points that both move, and a frame tilted the way an orbit is tilted.
 *
 * Not a scene graph. three already has one; these are the pieces an author
 * would otherwise write out by hand in every figure, and get subtly wrong in
 * at least one of them.
 */

import * as THREE from 'three';

const DEG = Math.PI / 180;
/** three builds cylinders and cones along +Y, so that is what everything
 * here is rotated *from*. */
const UP = new THREE.Vector3(0, 1, 0);

/**
 * A line with real thickness: a unit-height cylinder that `segment()` then
 * points wherever it is needed.
 *
 * A cylinder rather than a `Line`, because WebGL line width is one pixel on
 * essentially every platform regardless of what the material asks for — so a
 * `Line` cannot be emphasised, and at a grazing angle it shimmers. A cylinder
 * is ordinary geometry: it thickens, it lights, and it occludes correctly.
 */
export function strut(opts: {
  color: string;
  opacity?: number;
  radius?: number;
  /** sides round the cylinder. Default 8, which is plenty for something a
   * couple of pixels wide. */
  segments?: number;
}): THREE.Mesh {
  const r = opts.radius ?? 0.4;
  return new THREE.Mesh(
    new THREE.CylinderGeometry(r, r, 1, opts.segments ?? 8),
    new THREE.MeshBasicMaterial({
      color: opts.color,
      transparent: (opts.opacity ?? 1) < 1,
      opacity: opts.opacity ?? 1,
    }),
  );
}

/**
 * Point a `strut()` (or any +Y-aligned mesh) from `a` to `b`.
 *
 * Moves and stretches the one mesh rather than rebuilding geometry, which
 * matters because in these figures both ends are usually moving every frame.
 * A zero-length segment is hidden rather than drawn as a degenerate sliver:
 * the moon's height above a plane really does go to nothing twice a month,
 * and that is a thing to show by absence, not by a smear.
 */
export function segment(mesh: THREE.Object3D, a: THREE.Vector3, b: THREE.Vector3): void {
  const dir = new THREE.Vector3().subVectors(b, a);
  const len = dir.length();
  if (len < 1e-6) {
    mesh.visible = false;
    return;
  }
  mesh.visible = true;
  mesh.position.copy(a).addScaledVector(dir, 0.5);
  mesh.quaternion.setFromUnitVectors(UP, dir.divideScalar(len));
  mesh.scale.set(1, len, 1);
}

/**
 * A frame tilted the way an orbit is tilted: two nested groups, the outer
 * swinging the line of nodes round to its longitude and the inner tipping
 * everything about that line.
 *
 * Two groups rather than one composed rotation, because this way the
 * construction *is* the definition of an inclination and cannot be written
 * down wrong — no Euler order to get backwards, no quaternion to compose in
 * the wrong sequence. The node line is the inner group's own +X axis by
 * construction, so "where does the orbit cross the reference plane" is
 * answered by reading a local coordinate rather than by solving anything.
 *
 * Add the orbit's own geometry to `tilt`; add anything that should swing with
 * the nodes but stay in the reference plane to `node`.
 */
export class InclinedFrame {
  /** swings the line of nodes to its longitude; lies in the reference plane */
  readonly node = new THREE.Group();
  /** tips about the node line; the orbit's own plane */
  readonly tilt = new THREE.Group();

  constructor() {
    this.node.add(this.tilt);
  }

  /** Add the whole frame to a scene (or to another object). */
  addTo(parent: THREE.Object3D): this {
    parent.add(this.node);
    return this;
  }

  /** `nodeLongitude` and `inclination` in degrees. */
  set(nodeLongitude: number, inclination: number): void {
    this.node.rotation.z = nodeLongitude * DEG;
    this.tilt.rotation.x = inclination * DEG;
  }

  /** A point at `longitude` (degrees, measured in the tilted plane from the
   * ascending node) and `radius` from the centre, in world space. The
   * argument of latitude goes in; where it actually is comes out. */
  at(longitude: number, radius: number, out = new THREE.Vector3()): THREE.Vector3 {
    const a = longitude * DEG;
    out.set(Math.cos(a) * radius, Math.sin(a) * radius, 0);
    return this.tilt.localToWorld(out);
  }

  /** Where the orbit crosses the reference plane: `which` 0 is the ascending
   * node, 1 the descending. In world space, and on the node group rather
   * than the tilted one because at a node the two coincide. */
  nodeAt(which: 0 | 1, radius: number, out = new THREE.Vector3()): THREE.Vector3 {
    out.set(which === 0 ? radius : -radius, 0, 0);
    return this.node.localToWorld(out);
  }
}
