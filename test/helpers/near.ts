/** Floating-point-tolerant equality helpers shared across the test suite —
 * every geometric result here comes out of trig, so exact equality would be
 * both wrong to expect and a maintenance trap the moment an implementation
 * detail (evaluation order, a different but equivalent formula) changes. */
export const near = (a: number, b: number, eps = 1e-6): boolean => Math.abs(a - b) < eps;

export const nearVec = (a: { x: number; y: number }, b: { x: number; y: number }, eps = 1e-6): boolean =>
  near(a.x, b.x, eps) && near(a.y, b.y, eps);
