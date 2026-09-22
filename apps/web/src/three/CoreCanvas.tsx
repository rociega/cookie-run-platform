/**
 * Decides whether this device gets the WebGL core or the CSS fallback, then
 * lazily pulls in the three/gsap bundle only when it has earned its place.
 */
import { Suspense, lazy, useEffect, useState } from "react";
import { coreState } from "./coreState";

const CoreScene = lazy(() => import("./CoreScene"));

type Capability = {
  /** Whether this device should run the WebGL scene at all. */
  webgl: boolean;
  reducedMotion: boolean;
  resolved: boolean;
};

function webglSupported() {
  try {
    const canvas = document.createElement("canvas");
    return Boolean(
      canvas.getContext("webgl2") ??
        canvas.getContext("webgl") ??
        canvas.getContext("experimental-webgl"),
    );
  } catch {
    return false;
  }
}

/**
 * matchMedia rather than a bare width check, so low-power desktops and
 * touch-first devices skip the scene too — not only narrow viewports.
 */
function evaluate(): Omit<Capability, "resolved"> {
  const small = window.matchMedia("(max-width: 767px)").matches;
  const coarse = window.matchMedia("(pointer: coarse)").matches;
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  // Only genuinely constrained machines are excluded here. The cluster is two
  // draw calls, so anything with a real GPU copes; PerformanceMonitor drops
  // the pixel ratio if a specific device turns out not to.
  const fewCores =
    typeof navigator.hardwareConcurrency === "number" &&
    navigator.hardwareConcurrency > 0 &&
    navigator.hardwareConcurrency <= 2;

  return {
    webgl: !small && !coarse && !fewCores && webglSupported(),
    reducedMotion,
  };
}

export default function CoreCanvas() {
  const [cap, setCap] = useState<Capability>({
    webgl: false,
    reducedMotion: false,
    resolved: false,
  });

  useEffect(() => {
    const queries = [
      window.matchMedia("(max-width: 767px)"),
      window.matchMedia("(pointer: coarse)"),
      window.matchMedia("(prefers-reduced-motion: reduce)"),
    ];

    // Defer the decision (and therefore the dynamic import) until the main
    // thread is idle, so the 3D bundle never competes with first paint.
    const scheduler = window as Window & {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
      cancelIdleCallback?: (handle: number) => void;
    };

    let idle = 0;
    let timer = 0;
    const settle = () => setCap({ ...evaluate(), resolved: true });

    if (typeof scheduler.requestIdleCallback === "function") {
      idle = scheduler.requestIdleCallback(settle, { timeout: 1200 });
    } else {
      timer = window.setTimeout(settle, 400);
    }

    const onChange = () => setCap({ ...evaluate(), resolved: true });
    queries.forEach((q) => q.addEventListener("change", onChange));

    return () => {
      queries.forEach((q) => q.removeEventListener("change", onChange));
      if (idle && typeof scheduler.cancelIdleCallback === "function") {
        scheduler.cancelIdleCallback(idle);
      }
      if (timer) window.clearTimeout(timer);
    };
  }, []);

  const showFps =
    typeof window !== "undefined" && window.location.search.includes("fps");

  // The canvas layer never takes pointer events. Interaction is opt-in via
  // the discrete hotspot below, so foreground DOM always stays clickable.
  return (
    <div
      aria-hidden="true"
      className="fixed inset-0 z-[1] pointer-events-none overflow-hidden"
      data-testid="core-canvas-layer"
      data-core-mode={
        !cap.resolved ? "pending" : cap.webgl ? "webgl" : "fallback"
      }
      data-core-reduced-motion={cap.reducedMotion ? "true" : "false"}
    >
      {cap.resolved && cap.webgl ? (
        <Suspense fallback={<MeshFallback />}>
          <CoreScene reducedMotion={cap.reducedMotion} showFps={showFps} />
        </Suspense>
      ) : (
        <MeshFallback />
      )}
    </div>
  );
}

/** No-WebGL background: animated entirely through registered CSS properties. */
function MeshFallback() {
  return (
    <div className="absolute inset-0 mesh-fallback" data-testid="core-mesh-fallback">
      <div className="absolute inset-0 mesh-wireframe" />
    </div>
  );
}

/**
 * A discrete, small interactive target over the core. This is the only place
 * pointer events are re-enabled — never the full-screen canvas.
 */
export function CoreHotspot({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      onPointerEnter={() => {
        coreState.hover = 1;
      }}
      onPointerLeave={() => {
        coreState.hover = 0;
      }}
      className={className}
      style={{ pointerEvents: "auto" }}
      data-testid="core-hotspot"
    />
  );
}
