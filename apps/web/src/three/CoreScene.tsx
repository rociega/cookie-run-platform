/**
 * The server-core scene: an instanced cube cluster that fragments, reconverges
 * and is finally swallowed by fog as the page scrolls.
 *
 * This whole module (three, drei, gsap) is code-split behind React.lazy in
 * CoreCanvas so none of it lands in the initial bundle.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { PerformanceMonitor } from "@react-three/drei";
import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { coreState, resetCoreState } from "./coreState";

gsap.registerPlugin(ScrollTrigger);

/* ── Cluster geometry ─────────────────────────────────────────────────────
   8 x 8 x 8 = 512 instances in a single draw call. The illuminated subset
   is a second instanced mesh (~74 instances) drawn additively on top.
   ─────────────────────────────────────────────────────────────────────── */
const GRID = 8;
const COUNT = GRID * GRID * GRID; // 512, well under the 1000 cap
const SPACING = 0.42;
const CUBE = 0.3;
const NODE_EVERY = 7;

type Seed = {
  base: THREE.Vector3;
  dir: THREE.Vector3;
  spread: number;
  phase: number;
  size: number;
};

/** Deterministic PRNG so the cluster looks identical on every load. */
function makeRandom(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}

function buildSeeds(): { seeds: Seed[]; nodeIndices: number[] } {
  const rand = makeRandom(0x5eed);
  const seeds: Seed[] = [];
  const nodeIndices: number[] = [];
  const half = (GRID - 1) / 2;

  for (let x = 0; x < GRID; x++) {
    for (let y = 0; y < GRID; y++) {
      for (let z = 0; z < GRID; z++) {
        const base = new THREE.Vector3(
          (x - half) * SPACING,
          (y - half) * SPACING,
          (z - half) * SPACING,
        );
        // Fragment outward along the radial direction, jittered so the burst
        // reads as organic rather than a clean explosion sphere.
        const dir = base
          .clone()
          .normalize()
          .add(
            new THREE.Vector3(
              rand() - 0.5,
              rand() - 0.5,
              rand() - 0.5,
            ).multiplyScalar(0.55),
          )
          .normalize();
        const i = seeds.length;
        seeds.push({
          base,
          dir,
          spread: 1.6 + rand() * 2.4,
          phase: rand() * Math.PI * 2,
          size: 0.86 + rand() * 0.28,
        });
        if (i % NODE_EVERY === 0) nodeIndices.push(i);
      }
    }
  }
  return { seeds, nodeIndices };
}

/* ── Environment: PMREM from RoomEnvironment, no external HDRI ─────────── */
function RoomEnv() {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);

  useEffect(() => {
    const pmrem = new THREE.PMREMGenerator(gl);
    const room = new RoomEnvironment();
    const target = pmrem.fromScene(room, 0.04);
    scene.environment = target.texture;

    return () => {
      scene.environment = null;
      target.dispose();
      pmrem.dispose();
      room.traverse((obj) => {
        const mesh = obj as THREE.Mesh;
        if (mesh.geometry) mesh.geometry.dispose();
        const mat = mesh.material;
        if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
        else if (mat) mat.dispose();
      });
    };
  }, [gl, scene]);

  return null;
}

/* ── Fog, tweened by the exit act ──────────────────────────────────────── */
function ScrollFog() {
  const scene = useThree((s) => s.scene);

  useEffect(() => {
    const fog = new THREE.Fog(0x000000, coreState.fogNear, coreState.fogFar);
    scene.fog = fog;
    return () => {
      scene.fog = null;
    };
  }, [scene]);

  useFrame(() => {
    const fog = scene.fog as THREE.Fog | null;
    if (fog) {
      fog.near = coreState.fogNear;
      fog.far = coreState.fogFar;
    }
  });

  return null;
}

/* ── The core itself ───────────────────────────────────────────────────── */
function Core() {
  const group = useRef<THREE.Group>(null!);
  const shell = useRef<THREE.InstancedMesh>(null!);
  const nodes = useRef<THREE.InstancedMesh>(null!);
  const spin = useRef(0);
  const lastFragment = useRef(-1);

  const { seeds, nodeIndices } = useMemo(buildSeeds, []);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const tint = useMemo(() => new THREE.Color(), []);

  useFrame((state, delta) => {
    const t = state.clock.elapsedTime;
    const g = group.current;
    if (!g) return;

    // Idle breathing: ~2% amplitude on a 4s period.
    const breathe =
      coreState.idle > 0 ? 1 + 0.02 * Math.sin((t * Math.PI * 2) / 4) : 1;

    g.scale.setScalar(coreState.scale * breathe * (1 + coreState.hover * 0.05));

    // Horizontal placement is expressed in viewport fractions so the core
    // lands on the right third at any aspect ratio.
    const cam = state.camera as THREE.PerspectiveCamera;
    const dist = Math.abs(cam.position.z - coreState.z);
    const halfH = Math.tan(((cam.fov * Math.PI) / 180) / 2) * dist;
    const halfW = halfH * cam.aspect;
    g.position.set(coreState.offsetX * halfW, 0, coreState.z);

    spin.current += delta * coreState.spin * (coreState.idle > 0 ? 1 : 0);
    g.rotation.y = spin.current + coreState.rotY;
    g.rotation.x = 0.16;

    const f = coreState.fragment;
    const shellMesh = shell.current;
    const nodeMesh = nodes.current;
    if (!shellMesh || !nodeMesh) return;

    // While the cluster is solid and still, its matrices never change —
    // skip the per-instance rebuild entirely (this is the hero, i.e. most
    // of the time anyone is looking at the page).
    const settled = f === 0 && lastFragment.current === 0;
    if (!settled) {
      for (let i = 0; i < COUNT; i++) {
        const s = seeds[i];
        dummy.position.copy(s.base).addScaledVector(s.dir, s.spread * f);
        if (f > 0) {
          dummy.position.y += Math.sin(t * 1.1 + s.phase) * 0.14 * f;
          dummy.rotation.set(f * s.phase * 0.35, f * s.phase * 0.5, 0);
        } else {
          dummy.rotation.set(0, 0, 0);
        }
        dummy.scale.setScalar((1 - 0.3 * f) * s.size);
        dummy.updateMatrix();
        shellMesh.setMatrixAt(i, dummy.matrix);
      }
      shellMesh.instanceMatrix.needsUpdate = true;
      lastFragment.current = f;
    }

    // Illuminated subset — brightness carried per instance so the cluster
    // reads as computational activity rather than a uniform glow.
    const pulse = coreState.pulse;
    for (let j = 0; j < nodeIndices.length; j++) {
      const s = seeds[nodeIndices[j]];
      dummy.position.copy(s.base).addScaledVector(s.dir, s.spread * f);
      if (f > 0) dummy.position.y += Math.sin(t * 1.1 + s.phase) * 0.14 * f;
      dummy.rotation.set(f * s.phase * 0.35, f * s.phase * 0.5, 0);
      dummy.scale.setScalar((1 - 0.3 * f) * s.size * 1.06);
      dummy.updateMatrix();
      nodeMesh.setMatrixAt(j, dummy.matrix);

      const flicker = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(t * 2.3 + s.phase * 5));
      nodeMesh.setColorAt(j, tint.setScalar(pulse * flicker));
    }
    nodeMesh.instanceMatrix.needsUpdate = true;
    if (nodeMesh.instanceColor) nodeMesh.instanceColor.needsUpdate = true;
  });

  return (
    <group ref={group}>
      <instancedMesh
        ref={shell}
        args={[undefined, undefined, COUNT]}
        frustumCulled={false}
      >
        <boxGeometry args={[CUBE, CUBE, CUBE]} />
        <meshPhysicalMaterial
          color="#0a0a0a"
          metalness={1.0}
          roughness={0.15}
          clearcoat={0.8}
          clearcoatRoughness={0.1}
          envMapIntensity={1.2}
        />
      </instancedMesh>

      <instancedMesh
        ref={nodes}
        args={[undefined, undefined, nodeIndices.length]}
        frustumCulled={false}
      >
        <boxGeometry args={[CUBE, CUBE, CUBE]} />
        <meshBasicMaterial
          color="#ffffff"
          transparent
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          toneMapped={false}
        />
      </instancedMesh>
    </group>
  );
}

/* ── Scroll choreography ───────────────────────────────────────────────── */
function useChoreography(reducedMotion: boolean) {
  useLayoutEffect(() => {
    const el = (act: string) =>
      document.querySelector<HTMLElement>(`[data-core-act="${act}"]`);

    const hero = el("hero");
    const features = el("features");
    const inventory = el("inventory");
    const exit = el("exit");

    const ctx = gsap.context(() => {
      // Reduced motion: no scrub. Each act settles into a static frame.
      const trigger = (
        target: HTMLElement | null,
        start: string,
        end: string,
      ) =>
        target
          ? reducedMotion
            ? { trigger: target, start, end, toggleActions: "play none none reverse" as const }
            : { trigger: target, start, end, scrub: true as const }
          : undefined;

      const dur = reducedMotion ? 0.4 : undefined;

      if (hero) {
        gsap.to(coreState, {
          z: -1.2,
          scale: 0.94,
          ease: "none",
          duration: dur,
          scrollTrigger: trigger(hero, "top top", "bottom top"),
        });
      }

      // Act 2 — the core comes at you, turns 180 degrees and fragments.
      if (features) {
        gsap.to(coreState, {
          z: 2.4,
          rotY: Math.PI,
          fragment: 1,
          pulse: 1,
          spin: 0.2,
          ease: "none",
          duration: dur,
          scrollTrigger: trigger(features, "top bottom", "bottom top"),
        });

        // Feature panels arrive from the left as the core opens up.
        const cards = features.querySelectorAll<HTMLElement>("[data-core-card]");
        if (cards.length) {
          gsap.fromTo(
            cards,
            { x: reducedMotion ? 0 : -100, opacity: 0 },
            {
              x: 0,
              opacity: 1,
              stagger: 0.1,
              duration: 0.8,
              ease: "power3.out",
              immediateRender: false,
              scrollTrigger: { trigger: features, start: "top 72%" },
            },
          );
        }
      }

      // Act 3 — reconverge, shrink, move to the right third, keep turning.
      if (inventory) {
        gsap.to(coreState, {
          fragment: 0,
          pulse: 0.22,
          scale: 0.56,
          offsetX: 0.5,
          rotY: Math.PI * 1.5,
          spin: 0.314, // ~20s per revolution
          ease: "none",
          duration: dur,
          scrollTrigger: trigger(inventory, "top bottom", "center center"),
        });
      }

      // Act 4 — pushed away while the fog closes over it.
      if (exit) {
        gsap.to(coreState, {
          z: -16,
          offsetX: 0.18,
          pulse: 0,
          fogNear: 0.5,
          fogFar: 8,
          ease: "none",
          duration: dur,
          scrollTrigger: trigger(exit, "top bottom", "bottom bottom"),
        });
      }
    });

    ScrollTrigger.refresh();

    return () => {
      ctx.revert();
      resetCoreState();
    };
  }, [reducedMotion]);
}

/* ── Dev-only frame-rate probe (opt in with ?fps=1) ────────────────────── */
function FpsProbe() {
  const frames = useRef(0);
  const worst = useRef(Infinity);
  const since = useRef(performance.now());

  useFrame(() => {
    frames.current += 1;
    const now = performance.now();
    const elapsed = now - since.current;
    if (elapsed >= 1000) {
      const fps = Math.round((frames.current * 1000) / elapsed);
      worst.current = Math.min(worst.current, fps);
      (window as unknown as Record<string, unknown>).__coreFps = {
        fps,
        min: worst.current,
      };
      // eslint-disable-next-line no-console
      console.log(`[core-fps] ${fps} fps (worst ${worst.current})`);
      frames.current = 0;
      since.current = now;
    }
  });

  return null;
}

export default function CoreScene({
  reducedMotion,
  showFps,
}: {
  reducedMotion: boolean;
  showFps: boolean;
}) {
  const [dpr, setDpr] = useState(() =>
    Math.min(typeof window === "undefined" ? 1 : window.devicePixelRatio, 2),
  );

  useChoreography(reducedMotion);

  useEffect(() => {
    coreState.idle = reducedMotion ? 0 : 1;
  }, [reducedMotion]);

  return (
    <Canvas
      dpr={dpr}
      frameloop="always"
      camera={{ position: [0, 0, 9], fov: 38, near: 0.1, far: 100 }}
      gl={{
        antialias: true,
        alpha: true,
        powerPreference: "high-performance",
        preserveDrawingBuffer: false,
      }}
      onCreated={({ gl }) => {
        gl.toneMapping = THREE.ACESFilmicToneMapping;
        gl.toneMappingExposure = 1.05;
        gl.domElement.addEventListener(
          "webglcontextlost",
          (e) => e.preventDefault(),
          false,
        );
      }}
      style={{ position: "absolute", inset: 0 }}
    >
      {/* Sole owner of the pixel ratio: drop resolution before dropping frames. */}
      <PerformanceMonitor
        onDecline={() => setDpr((d) => Math.max(1, d - 0.5))}
        onIncline={() =>
          setDpr((d) => Math.min(Math.min(window.devicePixelRatio, 2), d + 0.5))
        }
      />
      <RoomEnv />
      <ScrollFog />

      {/* Rim light behind and above the cluster; hemisphere fill only. */}
      <directionalLight position={[4, 7, -6]} intensity={3} color="#ffffff" />
      <hemisphereLight args={["#222222", "#000000", 0.3]} />

      <Core />
      {showFps ? <FpsProbe /> : null}
    </Canvas>
  );
}
