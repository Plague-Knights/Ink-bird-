"use client";

import { Canvas, useFrame } from "@react-three/fiber";
import { useGLTF, Preload } from "@react-three/drei";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";

// Meshy GLBs are meshopt-compressed. Shared setup hook for all models.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const withMeshopt = (loader: any) => loader.setMeshoptDecoder(MeshoptDecoder);

// Arc geometry parameters. The squid launches from (-5, 0, 0) and
// travels toward increasing X. Parabola height is tuned so that a
// 10-blot run reads clearly and a 1-blot run still feels like a
// "shot", not a hop.
const LAUNCH_X = -5.5;
const LAUNCH_Y = -0.6;
const ARC_SPACING_X = 1.1; // world units between blots
const ARC_MAX_HEIGHT = 2.4;
const FLIGHT_SECONDS_PER_BLOT = 0.35;
const HAZARD_OFFSET = 1.2; // how far past the last blot the hazard sits
const LINGER_SECONDS = 0.8;

export type CannonEvent =
  | { kind: "blot"; value: number }
  | { kind: "hazard" };

type Props = {
  events: readonly CannonEvent[] | null;
  animating: boolean;
  onAnimDone: () => void;
  onMultiplierUpdate?: (bps: number) => void;
};

export function CannonScene({ events, animating, onAnimDone, onMultiplierUpdate }: Props) {
  return (
    <div className="dive-canvas-wrap">
      <div className="dive-canvas cannon-canvas">
        <Canvas
          gl={{ antialias: true, alpha: false }}
          dpr={[1, 2]}
          camera={{ fov: 40, position: [0, 1.0, 9], near: 0.1, far: 200 }}
          style={{ width: "100%", height: "100%", display: "block" }}
        >
          <color attach="background" args={["#021120"]} />
          <fog attach="fog" args={["#02060f", 10, 26]} />
          <Suspense fallback={null}>
            <Contents
              events={events}
              animating={animating}
              onAnimDone={onAnimDone}
              onMultiplierUpdate={onMultiplierUpdate}
            />
            <Preload all />
          </Suspense>
        </Canvas>
      </div>
    </div>
  );
}

function Contents({ events, animating, onAnimDone, onMultiplierUpdate }: Props) {
  return (
    <>
      <Lighting />
      <OceanBackdrop />
      <Cannon />
      <Blots events={events} />
      <Hazard events={events} />
      <Squid
        events={events}
        animating={animating}
        onAnimDone={onAnimDone}
        onMultiplierUpdate={onMultiplierUpdate}
      />
    </>
  );
}

function Lighting() {
  return (
    <>
      <ambientLight intensity={0.55} color="#86b0d4" />
      <directionalLight position={[3, 5, 4]} intensity={1.3} color="#d0eaff" />
      <pointLight position={[-5, 0, 3]} intensity={1.4} color="#ff9e5f" distance={8} />
      <pointLight position={[6, 0, 3]} intensity={0.8} color="#c986ff" distance={10} />
    </>
  );
}

function OceanBackdrop() {
  // Twin-plane backdrop — a deep-water gradient behind the arc, plus a
  // subtler foreground water plane so bubbles/particles read against
  // depth. Tiled noise would be nicer but is overkill for the MVP.
  return (
    <>
      <mesh position={[0, 0, -4]}>
        <planeGeometry args={[40, 16]} />
        <meshBasicMaterial color="#02142a" />
      </mesh>
      <mesh position={[0, 4, -3.5]}>
        <planeGeometry args={[40, 6]} />
        <meshBasicMaterial color="#0b3a66" transparent opacity={0.75} />
      </mesh>
      <mesh position={[0, -3.5, -3.5]}>
        <planeGeometry args={[40, 6]} />
        <meshBasicMaterial color="#010812" />
      </mesh>
    </>
  );
}

// Cannon sits at the launch point — low-poly primitive, enough to read
// as a launcher without needing a custom GLB.
function Cannon() {
  return (
    <group position={[LAUNCH_X - 0.55, LAUNCH_Y - 0.3, 0]}>
      <mesh rotation={[0, 0, Math.PI / 6]} position={[0, 0.15, 0]}>
        <cylinderGeometry args={[0.45, 0.55, 1.6, 16]} />
        <meshStandardMaterial color="#6e3922" metalness={0.3} roughness={0.6} />
      </mesh>
      <mesh position={[-0.1, -0.55, 0]}>
        <boxGeometry args={[1.1, 0.3, 0.9]} />
        <meshStandardMaterial color="#3a2013" roughness={0.8} />
      </mesh>
      <mesh position={[-0.1, -0.92, 0.35]}>
        <sphereGeometry args={[0.3, 16, 16]} />
        <meshStandardMaterial color="#1d100a" roughness={0.9} />
      </mesh>
      <mesh position={[-0.1, -0.92, -0.35]}>
        <sphereGeometry args={[0.3, 16, 16]} />
        <meshStandardMaterial color="#1d100a" roughness={0.9} />
      </mesh>
    </group>
  );
}

function blotCount(events: readonly CannonEvent[] | null): number {
  if (!events) return 0;
  return events.reduce((n, e) => (e.kind === "blot" ? n + 1 : n), 0);
}

function arcPoint(t: number, totalBlots: number): [number, number, number] {
  // t in 0..1 across the full flight (last blot or hazard).
  // Parabola: y = 4h * t * (1-t), x interpolates linearly.
  const width = Math.max(1, totalBlots) * ARC_SPACING_X + HAZARD_OFFSET;
  const x = LAUNCH_X + t * width;
  const h = ARC_MAX_HEIGHT * Math.min(1, 0.6 + 0.1 * totalBlots);
  const y = LAUNCH_Y + 4 * h * t * (1 - t);
  return [x, y, 0];
}

function Blots({ events }: { events: readonly CannonEvent[] | null }) {
  const blots = useMemo(() => {
    if (!events) return [] as Array<{ pos: [number, number, number]; value: number }>;
    const total = blotCount(events);
    let i = 0;
    const out: Array<{ pos: [number, number, number]; value: number }> = [];
    for (const e of events) {
      if (e.kind !== "blot") continue;
      i++;
      // Space evenly at t = i / (total + padding-for-hazard).
      const t = i / (total + 1);
      out.push({ pos: arcPoint(t, total), value: e.value });
    }
    return out;
  }, [events]);

  const group = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    if (!group.current) return;
    const t = clock.elapsedTime;
    group.current.children.forEach((c, i) => {
      c.scale.setScalar(1 + Math.sin(t * 2.5 + i * 0.7) * 0.08);
    });
  });

  return (
    <group ref={group}>
      {blots.map((b, i) => {
        // Bigger blot = bigger sphere with warmer emissive
        const size = 0.22 + Math.min(0.35, b.value / 20000);
        const color = b.value > 3000 ? "#ffc24a" : b.value > 1000 ? "#c986ff" : "#5fd8ff";
        return (
          <mesh key={i} position={b.pos} userData={{ blotIndex: i }}>
            <sphereGeometry args={[size, 16, 16]} />
            <meshStandardMaterial
              color={color}
              emissive={color}
              emissiveIntensity={0.9}
              roughness={0.3}
              metalness={0.1}
            />
          </mesh>
        );
      })}
    </group>
  );
}

function Hazard({ events }: { events: readonly CannonEvent[] | null }) {
  const gltf = useGLTF("/models/anglerfish.glb", true, true, withMeshopt);
  const cloned = useMemo(() => gltf.scene.clone(true), [gltf.scene]);
  const group = useRef<THREE.Group>(null);

  useFrame(({ clock }) => {
    if (!group.current) return;
    group.current.position.y += Math.sin(clock.elapsedTime * 1.4) * 0.003;
    group.current.rotation.y = Math.PI / 2 + Math.sin(clock.elapsedTime * 0.5) * 0.1;
  });

  if (!events) return null;
  const hasHazard = events.some((e) => e.kind === "hazard");
  if (!hasHazard) return null;
  const total = blotCount(events);
  const t = 1;
  const [x, y, z] = arcPoint(t, total);
  return (
    <group ref={group} position={[x, y, z]}>
      <primitive object={cloned} scale={0.7} rotation={[0, Math.PI / 2, 0]} />
    </group>
  );
}

function Squid({ events, animating, onAnimDone, onMultiplierUpdate }: Props) {
  const gltf = useGLTF("/models/squid.glb", true, true, withMeshopt);
  const cloned = useMemo(() => gltf.scene.clone(true), [gltf.scene]);
  const group = useRef<THREE.Group>(null);

  const startTimeRef = useRef<number>(0);
  const doneRef = useRef(false);
  const splashesRef = useRef<Array<{ age: number; pos: [number, number, number]; color: string }>>([]);
  const hitSetRef = useRef<Set<number>>(new Set());
  const accumulatedBpsRef = useRef<number>(0);

  const blotPlan = useMemo(() => {
    if (!events) return [] as Array<{ t: number; value: number }>;
    const blots = events.filter((e) => e.kind === "blot") as Array<{ kind: "blot"; value: number }>;
    const total = blots.length;
    return blots.map((b, i) => ({
      t: (i + 1) / (total + 1),
      value: b.value,
    }));
  }, [events]);

  // Phase duration depends on blot count; min 1.2s.
  const flightSeconds = useMemo(() => {
    if (!events) return 1;
    return Math.max(1.2, blotCount(events) * FLIGHT_SECONDS_PER_BLOT + 0.8);
  }, [events]);

  useFrame(({ clock }) => {
    if (!group.current) return;
    const now = clock.elapsedTime;

    if (animating && events) {
      if (startTimeRef.current === 0) {
        startTimeRef.current = now;
        doneRef.current = false;
        hitSetRef.current = new Set();
        splashesRef.current = [];
        accumulatedBpsRef.current = 0;
        if (onMultiplierUpdate) onMultiplierUpdate(0);
      }
      const elapsed = now - startTimeRef.current;
      const linger = LINGER_SECONDS;
      const tPhase = Math.min(1, elapsed / flightSeconds);
      const total = blotCount(events);
      const [x, y, z] = arcPoint(tPhase, total);
      group.current.position.set(x, y, z);
      // Face the direction of travel (slight tilt)
      const slope = total > 0 ? Math.PI * (0.5 - tPhase) * 0.6 : 0;
      group.current.rotation.set(slope, Math.PI, 0);

      // Check blot hits
      for (let i = 0; i < blotPlan.length; i++) {
        if (hitSetRef.current.has(i)) continue;
        if (tPhase >= blotPlan[i].t) {
          hitSetRef.current.add(i);
          accumulatedBpsRef.current += blotPlan[i].value;
          if (onMultiplierUpdate) onMultiplierUpdate(accumulatedBpsRef.current);
          const [sx, sy, sz] = arcPoint(blotPlan[i].t, total);
          splashesRef.current.push({
            age: 0,
            pos: [sx, sy, sz],
            color: blotPlan[i].value > 3000 ? "#ffc24a" : blotPlan[i].value > 1000 ? "#c986ff" : "#5fd8ff",
          });
        }
      }

      if (tPhase >= 1 && elapsed >= flightSeconds + linger && !doneRef.current) {
        doneRef.current = true;
        startTimeRef.current = 0;
        onAnimDone();
      }
    } else if (!events) {
      // Idle pose — sit in the cannon mouth
      group.current.position.set(LAUNCH_X, LAUNCH_Y, 0);
      group.current.rotation.set(0, Math.PI, 0);
    }

    // Age splash particles (not currently drawn — slot for a particle layer)
    splashesRef.current.forEach((s) => (s.age += 1 / 60));
    splashesRef.current = splashesRef.current.filter((s) => s.age < 0.6);
  });

  return (
    <group ref={group} position={[LAUNCH_X, LAUNCH_Y, 0]}>
      <primitive object={cloned} scale={0.28} />
      {/* Warm halo from the cannon's muzzle flash during early flight */}
      <pointLight color="#ffa85f" intensity={0.7} distance={3} decay={2} />
    </group>
  );
}

useGLTF.preload("/models/squid.glb", true, true, withMeshopt);
useGLTF.preload("/models/anglerfish.glb", true, true, withMeshopt);
