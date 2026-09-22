/**
 * Shared, mutable choreography state for the server-core scene.
 *
 * GSAP ScrollTrigger writes into this object; the R3F render loop reads it
 * every frame. Deliberately a plain object rather than React state — the
 * scroll scrub runs at frame rate and must never trigger a re-render.
 */
export type CoreState = {
  /** Depth offset in world units. Positive is toward the camera. */
  z: number;
  /** Extra Y rotation on top of the continuous spin, in radians. */
  rotY: number;
  /** Continuous spin speed in radians/second. */
  spin: number;
  /** 0 = solid cluster, 1 = fully fragmented into nodes. */
  fragment: number;
  /** 0..1 emissive activity on the illuminated subset. */
  pulse: number;
  /** Uniform scale of the whole cluster. */
  scale: number;
  /** Horizontal placement, normalised: 0 = centre, 1 = right edge. */
  offsetX: number;
  /** Fog distances, tweened to swallow the core on the way out. */
  fogNear: number;
  fogFar: number;
  /** 1 = idle breathing enabled, 0 = held still (reduced motion). */
  idle: number;
  /** 0..1 hotspot hover response. */
  hover: number;
};

export const CORE_DEFAULTS: CoreState = {
  z: 0,
  rotY: 0,
  spin: 0.105, // ~60s per revolution
  fragment: 0,
  pulse: 0,
  scale: 1,
  offsetX: 0,
  fogNear: 9,
  fogFar: 44,
  idle: 1,
  hover: 0,
};

export const coreState: CoreState = { ...CORE_DEFAULTS };

export function resetCoreState() {
  Object.assign(coreState, CORE_DEFAULTS);
}

/** Scroll acts, matched to `data-core-act` attributes in the page markup. */
export const CORE_ACTS = ["hero", "features", "inventory", "exit"] as const;
export type CoreAct = (typeof CORE_ACTS)[number];
