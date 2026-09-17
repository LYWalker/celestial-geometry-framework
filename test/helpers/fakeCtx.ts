/**
 * A duck-typed stand-in for CanvasRenderingContext2D, for the handful of
 * tests that exercise a `draw()` method (Trail.draw, Scene.draw) without
 * pulling in a real DOM/canvas — this repo's test suite otherwise stays to
 * the pure layers entirely (see the item list this suite was written
 * against: "do not write tests that require a DOM/canvas... stub only if it
 * stays simple"). Every property read/write and every method call is a
 * no-op that succeeds; nothing here renders anything or asserts on how it
 * was called. That's enough for the two things these tests actually check —
 * a returned Label[]'s contents, and how many times an author's own Scalar
 * function got called — neither of which depends on anything actually
 * being drawn.
 */
export function makeFakeCtx(): CanvasRenderingContext2D {
  const store = new Map<PropertyKey, unknown>();
  // Matches real CanvasRenderingContext2D's own default — code under test
  // (Scene.draw, Trail.draw) reads this back before ever setting it, the
  // same way it would read a caller's real, un-touched context.
  store.set('globalAlpha', 1);
  const noop = () => undefined;
  const handler: ProxyHandler<object> = {
    get(_target, prop) {
      if (store.has(prop)) return store.get(prop);
      // Anything not explicitly set reads as a callable no-op — covers
      // every ctx.method(...) call (save, restore, beginPath, moveTo,
      // lineTo, bezierCurveTo, stroke, fill, arc, translate, scale, ...)
      // without hand-listing the ones each test path happens to hit.
      return noop;
    },
    set(_target, prop, value) {
      store.set(prop, value);
      return true;
    },
  };
  return new Proxy({}, handler) as unknown as CanvasRenderingContext2D;
}
