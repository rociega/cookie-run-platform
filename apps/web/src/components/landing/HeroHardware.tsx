import { Component, Suspense, useEffect, useRef, useState, type ReactNode } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Environment, Lightformer, RoundedBox } from "@react-three/drei";
import { Group, MathUtils, OrthographicCamera } from "three";

const silver = { color: "#d9dfdc", metalness: 0.8, roughness: 0.27 };
const dark = { color: "#28312e", metalness: 0.55, roughness: 0.35 };
const copper = { color: "#a87043", metalness: 0.8, roughness: 0.25 };

function Slab({ position, size, material = silver }: { position: [number, number, number]; size: [number, number, number]; material?: typeof silver }) {
  return <RoundedBox args={size} radius={0.035} smoothness={2} position={position} castShadow receiveShadow><meshStandardMaterial {...material} /></RoundedBox>;
}

function Module({ level }: { level: number }) {
  return (
    <group position={[0, level * .64, 0]}>
      <Slab position={[0, 0, 0]} size={[3.7, .49, 2.5]} />
      <Slab position={[0, 0, 1.257]} size={[3.43, .32, .055]} material={dark} />
      {Array.from({ length: 14 }, (_, i) => (
        <mesh key={i} position={[-1.48 + i * .19, 0, 1.3]}><boxGeometry args={[.09, .19, .032]} /><meshStandardMaterial color="#111d19" roughness={.8} /></mesh>
      ))}
      {[-1.72, 1.72].map(x => (
        <group key={x}>
          <mesh position={[x, 0, 1.29]} rotation={[Math.PI / 2, 0, 0]}><cylinderGeometry args={[.043, .043, .045, 12]} /><meshStandardMaterial color="#66726b" metalness={.8} roughness={.3} /></mesh>
          <mesh position={[x, 0, -1.15]} rotation={[0, 0, Math.PI / 2]}><cylinderGeometry args={[.07, .07, .26, 12]} /><meshStandardMaterial {...dark} /></mesh>
        </group>
      ))}
      <mesh position={[1.42, .015, 1.3]}><boxGeometry args={[.2, .085, .025]} /><meshStandardMaterial color="#78c293" emissive="#387c4a" emissiveIntensity={.3} /></mesh>
      {Array.from({ length: 8 }, (_, i) => (
        <Slab key={`rail-${i}`} position={[1.86, 0, -.92 + i * .26]} size={[.025, .24, .065]} material={dark} />
      ))}
      <Slab position={[-1.55, .275, 0]} size={[.14, .035, 2.2]} material={copper} />
      <Slab position={[1.55, .275, 0]} size={[.14, .035, 2.2]} material={copper} />
    </group>
  );
}

function ComputeAssembly({ reduced }: { reduced: boolean }) {
  const assembly = useRef<Group>(null);
  const circuit = useRef<Group>(null);
  const lid = useRef<Group>(null);
  const scroll = useRef(0);
  const { camera, size } = useThree();
  useEffect(() => {
    if (camera instanceof OrthographicCamera) {
      camera.zoom = Math.min(size.width / 5.5, size.height / 4.4);
      camera.updateProjectionMatrix();
    }
  }, [camera, size]);
  useEffect(() => {
    const update = () => { scroll.current = Math.min(1, window.scrollY / Math.max(window.innerHeight, 1)); };
    update();
    window.addEventListener("scroll", update, { passive: true });
    return () => window.removeEventListener("scroll", update);
  }, []);
  useFrame(({ pointer }, delta) => {
    if (!assembly.current || !circuit.current || !lid.current) return;
    const amount = reduced ? 0 : scroll.current;
    const dt = Math.min(delta, .05);
    assembly.current.rotation.y = MathUtils.damp(assembly.current.rotation.y, -.4 + amount * .55 + (reduced ? 0 : pointer.x * .07), 4, dt);
    assembly.current.rotation.x = MathUtils.damp(assembly.current.rotation.x, .03 + (reduced ? 0 : pointer.y * -.04), 4, dt);
    circuit.current.position.y = MathUtils.damp(circuit.current.position.y, 1.11 + amount * .45, 4, dt);
    lid.current.position.y = MathUtils.damp(lid.current.position.y, 1.8 + amount * .95, 4, dt);
  });
  return (
    <group ref={assembly} position={[0, -.35, 0]} rotation={[.03, -.4, 0]}>
      <Module level={-1} />
      <Module level={0} />
      <Module level={1} />
      <group ref={circuit} position={[0, 1.11, 0]}>
        <Slab position={[0, 0, 0]} size={[3.37, .065, 2.18]} material={{ color: "#225940", metalness: .28, roughness: .53 }} />
        <Slab position={[-.45, .07, .05]} size={[1.4, .085, 1.35]} material={dark} />
        {Array.from({ length: 15 }, (_, i) => <Slab key={i} position={[-1.05 + i * .085, .18, .05]} size={[.032, .26, 1.18]} />)}
        {[-.5, -.23, .04, .31].map(z => <Slab key={z} position={[.99, .075, z]} size={[.62, .09, .16]} material={dark} />)}
        {[-1.48, 1.48].flatMap(x => [-.93, .93].map(z => <mesh key={`${x}-${z}`} position={[x, .058, z]}><cylinderGeometry args={[.038, .038, .06, 12]} /><meshStandardMaterial {...copper} /></mesh>))}
        <Slab position={[.1, .065, -.89]} size={[1.82, .04, .065]} material={copper} />
        <Slab position={[.1, .065, .89]} size={[1.82, .04, .065]} material={copper} />
      </group>
      <group ref={lid} position={[0, 1.8, 0]}>
        <Slab position={[0, 0, 0]} size={[3.7, .07, 2.5]} />
        {Array.from({ length: 10 }, (_, i) => <Slab key={i} position={[-.77 + i * .17, .037, -.05]} size={[.055, .008, 1.14]} material={{ color: "#737f78", metalness: .5, roughness: .4 }} />)}
      </group>
    </group>
  );
}

function Poster() {
  return <img src={`${import.meta.env.BASE_URL}forgerun-infrastructure.png`} alt="Cookie Run modular compute hardware" style={{ width: "100%", height: "100%", objectFit: "contain", mixBlendMode: "multiply" }} />;
}

class RenderBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? <Poster /> : this.props.children; }
}

export default function HeroHardware({ className }: { className?: string }) {
  const [ready, setReady] = useState(false);
  const [reduced, setReduced] = useState(false);
  const [visible, setVisible] = useState(true);
  const container = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const query = matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(query.matches);
    update();
    query.addEventListener("change", update);
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
    setReady(Boolean(gl));
    gl?.getExtension("WEBGL_lose_context")?.loseContext();
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { rootMargin: "100px" });
    if (container.current) observer.observe(container.current);
    return () => { query.removeEventListener("change", update); observer.disconnect(); };
  }, []);
  return (
    <div ref={container} className={className} role="img" aria-label="Interactive 3D Cookie Run compute assembly, revealing its hardware layers as you scroll" style={{ width: "100%", height: "100%", minHeight: 320 }}>
      {ready ? <RenderBoundary>
        <Canvas orthographic camera={{ position: [6.4, 4.6, 8], zoom: 80, near: .1, far: 60 }} dpr={[1, 1.5]} frameloop={visible ? "always" : "never"} gl={{ alpha: true, antialias: true, powerPreference: "low-power" }}>
          <ambientLight intensity={1.25} />
          <directionalLight position={[5, 8, 5]} intensity={3.2} color="#ffffff" />
          <directionalLight position={[-5, 4, -2]} intensity={1.5} color="#cfdecd" />
          <Suspense fallback={null}>
            <Environment resolution={128}>
              <Lightformer intensity={3} position={[0, 5, 0]} rotation={[Math.PI / 2, 0, 0]} scale={[12, 8, 1]} />
              <Lightformer intensity={2} position={[-5, 1, 0]} rotation={[0, Math.PI / 2, 0]} scale={[5, 9, 1]} />
              <Lightformer intensity={2} position={[4, 2, 3]} rotation={[0, -Math.PI / 3, 0]} scale={[3, 6, 1]} />
            </Environment>
            <ComputeAssembly reduced={reduced} />
          </Suspense>
        </Canvas>
      </RenderBoundary> : <Poster />}
    </div>
  );
}