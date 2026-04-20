"use client";

import { Canvas, useFrame, useLoader } from "@react-three/fiber";
import { Environment, useGLTF, Preload } from "@react-three/drei";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";

const MAX_DEPTH_M = 1000;
const DEPTH_WORLD_PER_METER = 0.012; // 1000m -> ~12 world units of descent

type Props = {
  distance: number | null;
  animating: boolean;
  onAnimDone: () => void;
};

export function DiveScene({ distance, animating, onAnimDone }: Props) {
  return (
    <div className="dive-canvas-wrap">
      <div className="dive-canvas">
        <Canvas
          gl={{ antialias: true, alpha: false }}
          dpr={[1, 2]}
          camera={{ fov: 45, position: [0, 1, 4.5], near: 0.1, far: 200 }}
          style={{ width: "100%", height: "100%", display: "block" }}
        >
          <color attach="background" args={["#020618"]} />
          <fog attach="fog" args={["#01030d", 4, 22]} />
          <Suspense fallback={null}>
            <SceneContents
              distance={distance}
              animating={animating}
              onAnimDone={onAnimDone}
            />
            <Preload all />
          </Suspense>
        </Canvas>
      </div>
    </div>
  );
}

function SceneContents({ distance, animating, onAnimDone }: Props) {
  return (
    <>
      <OceanLighting />
      <Surface />
      <GodRays />
      <Plankton count={180} />
      <Bubbles count={60} />
      <DepthMarkers />
      <Squid distance={distance} animating={animating} onAnimDone={onAnimDone} />
    </>
  );
}

function OceanLighting() {
  return (
    <>
      <ambientLight intensity={0.35} color="#5fa7d4" />
      <directionalLight
        position={[2, 6, 3]}
        intensity={1.2}
        color="#a8d8ff"
      />
      <pointLight position={[0, 0, 2]} intensity={0.6} color="#5fd8ff" distance={10} />
    </>
  );
}

function Surface() {
  const meshRef = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    if (!meshRef.current) return;
    const m = meshRef.current.material as THREE.MeshStandardMaterial;
    m.opacity = 0.55 + Math.sin(clock.elapsedTime * 0.6) * 0.04;
  });
  return (
    <mesh ref={meshRef} rotation={[-Math.PI / 2, 0, 0]} position={[0, 2.2, 0]}>
      <planeGeometry args={[30, 30, 1, 1]} />
      <meshStandardMaterial
        color="#2a6ca3"
        transparent
        opacity={0.55}
        emissive="#3a7fbf"
        emissiveIntensity={0.4}
        roughness={0.3}
      />
    </mesh>
  );
}

function GodRays() {
  // Three large volumetric cones coming down from the surface, animated in opacity.
  const group = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    if (!group.current) return;
    group.current.children.forEach((c, i) => {
      const t = clock.elapsedTime;
      (c as THREE.Mesh).rotation.z = Math.sin(t * 0.3 + i) * 0.04;
      const m = (c as THREE.Mesh).material as THREE.MeshBasicMaterial;
      m.opacity = 0.07 + Math.sin(t * 0.7 + i * 1.2) * 0.03;
    });
  });
  const shafts = [-1.6, 0, 1.8];
  return (
    <group ref={group} position={[0, 0, -1]}>
      {shafts.map((x, i) => (
        <mesh key={i} position={[x, 0, -0.5 - i * 0.3]} rotation={[0, 0, 0]}>
          <coneGeometry args={[0.6, 6, 12, 1, true]} />
          <meshBasicMaterial
            color="#a8d8ff"
            transparent
            opacity={0.08}
            depthWrite={false}
            side={THREE.DoubleSide}
          />
        </mesh>
      ))}
    </group>
  );
}

function Plankton({ count }: { count: number }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const positions = useMemo(() => {
    const arr: { x: number; y: number; z: number; speed: number; tw: number }[] = [];
    for (let i = 0; i < count; i++) {
      arr.push({
        x: (Math.random() - 0.5) * 14,
        y: 2 - Math.random() * 20,
        z: -1 + Math.random() * 3,
        speed: 0.04 + Math.random() * 0.12,
        tw: Math.random() * Math.PI * 2,
      });
    }
    return arr;
  }, [count]);

  useFrame(({ clock }, dt) => {
    if (!ref.current) return;
    const dummy = new THREE.Object3D();
    for (let i = 0; i < count; i++) {
      const p = positions[i];
      p.y -= p.speed * dt;
      p.tw += dt * 1.5;
      if (p.y < -20) p.y = 2;
      const sway = Math.sin(clock.elapsedTime * 0.5 + i) * 0.05;
      const scale = 0.025 + Math.sin(p.tw) * 0.015;
      dummy.position.set(p.x + sway, p.y, p.z);
      dummy.scale.setScalar(scale);
      dummy.updateMatrix();
      ref.current.setMatrixAt(i, dummy.matrix);
    }
    ref.current.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh ref={ref} args={[undefined, undefined, count]}>
      <sphereGeometry args={[1, 6, 6]} />
      <meshBasicMaterial color="#b8e8ff" transparent opacity={0.55} />
    </instancedMesh>
  );
}

function Bubbles({ count }: { count: number }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const bubbles = useMemo(() => {
    const arr: { x: number; y: number; z: number; vy: number; r: number; sway: number }[] = [];
    for (let i = 0; i < count; i++) {
      arr.push({
        x: (Math.random() - 0.5) * 12,
        y: 1.5 - Math.random() * 18,
        z: -0.5 + Math.random() * 2,
        vy: 0.3 + Math.random() * 0.6,
        r: 0.018 + Math.random() * 0.028,
        sway: Math.random() * Math.PI * 2,
      });
    }
    return arr;
  }, [count]);

  useFrame(({ clock }, dt) => {
    if (!ref.current) return;
    const dummy = new THREE.Object3D();
    for (let i = 0; i < count; i++) {
      const b = bubbles[i];
      b.y += b.vy * dt;
      b.sway += dt * 2;
      if (b.y > 2) {
        b.y = -18 + Math.random() * 2;
        b.x = (Math.random() - 0.5) * 12;
      }
      dummy.position.set(
        b.x + Math.sin(clock.elapsedTime + b.sway) * 0.08,
        b.y,
        b.z,
      );
      dummy.scale.setScalar(b.r);
      dummy.updateMatrix();
      ref.current.setMatrixAt(i, dummy.matrix);
    }
    ref.current.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh ref={ref} args={[undefined, undefined, count]}>
      <sphereGeometry args={[1, 12, 12]} />
      <meshStandardMaterial
        color="#d0eaff"
        transparent
        opacity={0.7}
        roughness={0.1}
        metalness={0}
        emissive="#a0d4ff"
        emissiveIntensity={0.15}
      />
    </instancedMesh>
  );
}

function DepthMarkers() {
  const markers = [100, 250, 500, 750, 1000];
  return (
    <group position={[3.3, 0, -0.3]}>
      {markers.map((m) => {
        const y = 1.5 - m * DEPTH_WORLD_PER_METER;
        return (
          <mesh key={m} position={[0, y, 0]}>
            <boxGeometry args={[0.04, 0.008, 0.01]} />
            <meshBasicMaterial color="#78b4d0" transparent opacity={0.4} />
          </mesh>
        );
      })}
    </group>
  );
}

function Squid({ distance, animating, onAnimDone }: Props) {
  const group = useRef<THREE.Group>(null);
  const trailRef = useRef<Array<{ x: number; y: number; z: number; age: number }>>([]);
  const startTimeRef = useRef<number>(0);
  const prevYRef = useRef<number>(1.5);
  const doneRef = useRef(false);
  const [modelAvailable, setModelAvailable] = useState<boolean | null>(null);

  // Check if the GLB exists. Next.js serves /public at /, so we HEAD for it.
  useEffect(() => {
    let cancelled = false;
    fetch("/models/squid.glb", { method: "HEAD" })
      .then((r) => {
        if (!cancelled) setModelAvailable(r.ok);
      })
      .catch(() => {
        if (!cancelled) setModelAvailable(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const targetY = distance != null ? 1.5 - Math.min(distance, MAX_DEPTH_M) * DEPTH_WORLD_PER_METER : 1.5;

  useFrame(({ clock }, dt) => {
    if (!group.current) return;

    const now = clock.elapsedTime;
    if (animating) {
      if (startTimeRef.current === 0) {
        startTimeRef.current = now;
        doneRef.current = false;
      }
      const t = Math.min(1, (now - startTimeRef.current) / 1.8);
      const eased = 1 - Math.pow(1 - t, 3);
      group.current.position.y = 1.5 + eased * (targetY - 1.5);
      if (t >= 1 && !doneRef.current) {
        doneRef.current = true;
        startTimeRef.current = 0;
        onAnimDone();
      }
    } else {
      group.current.position.y = targetY;
      if (startTimeRef.current !== 0) startTimeRef.current = 0;
    }

    // Idle bob + tentacle phase animation happens inside the squid model
    const bob = Math.sin(now * 1.6) * 0.02;
    group.current.position.x = bob;

    prevYRef.current = group.current.position.y;

    // Slight rotation sway for life
    group.current.rotation.z = Math.sin(now * 0.7) * 0.04;
  });

  return (
    <group ref={group} position={[0, 1.5, 0]}>
      {modelAvailable ? (
        <SquidModel />
      ) : (
        <PrimitiveSquid />
      )}
    </group>
  );
}

// Loaded GLB path. `useGLTF` is declared at module scope but only called
// when we've confirmed the asset exists so a missing model doesn't
// suspend the whole tree indefinitely.
function SquidModel() {
  const { scene } = useGLTF("/models/squid.glb");
  const cloned = useMemo(() => scene.clone(true), [scene]);
  return <primitive object={cloned} scale={0.45} />;
}

// Fallback primitive squid while the real model isn't downloaded yet.
// Gradient-tinted mantle + 8 tentacle rods. It's a stand-in, not the
// final visual — the GLB path takes over as soon as the model arrives.
function PrimitiveSquid() {
  const group = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    if (!group.current) return;
    group.current.children.forEach((c, i) => {
      if (c.userData.tentacle) {
        c.rotation.x = Math.sin(clock.elapsedTime * 2 + i * 0.4) * 0.25;
      }
    });
  });

  return (
    <group ref={group}>
      {/* Mantle — elongated ellipsoid pointing up */}
      <mesh position={[0, 0.1, 0]} scale={[0.22, 0.36, 0.22]}>
        <sphereGeometry args={[1, 24, 24]} />
        <meshStandardMaterial
          color="#7c5fff"
          emissive="#9f7cff"
          emissiveIntensity={0.45}
          roughness={0.35}
          metalness={0.2}
        />
      </mesh>
      {/* Fin triangles */}
      {[-1, 1].map((s) => (
        <mesh key={s} position={[s * 0.18, 0.22, 0]} rotation={[0, 0, s * 0.6]} scale={[0.16, 0.22, 0.04]}>
          <coneGeometry args={[1, 1.6, 3]} />
          <meshStandardMaterial
            color="#6b82ff"
            emissive="#6b82ff"
            emissiveIntensity={0.25}
            transparent
            opacity={0.85}
            roughness={0.4}
          />
        </mesh>
      ))}
      {/* Eye */}
      <mesh position={[-0.12, 0.04, 0.16]}>
        <sphereGeometry args={[0.035, 16, 16]} />
        <meshStandardMaterial color="#0a1024" emissive="#5fd8ff" emissiveIntensity={0.6} />
      </mesh>
      <mesh position={[-0.11, 0.05, 0.19]}>
        <sphereGeometry args={[0.012, 8, 8]} />
        <meshStandardMaterial color="#ffffff" emissive="#ffffff" emissiveIntensity={1} />
      </mesh>
      {/* 8 tentacles + 2 feeding arms */}
      {Array.from({ length: 10 }).map((_, i) => {
        const t = i / 9 - 0.5;
        const len = i === 0 || i === 9 ? 0.7 : 0.46;
        const color = i === 0 || i === 9 ? "#b196ff" : "#7a5fd6";
        return (
          <mesh
            key={i}
            position={[t * 0.3, -0.1 - len / 2, Math.cos(i) * 0.04]}
            rotation={[0, 0, t * 0.4]}
            userData={{ tentacle: true }}
          >
            <cylinderGeometry args={[0.035, 0.012, len, 8]} />
            <meshStandardMaterial
              color={color}
              emissive={color}
              emissiveIntensity={0.25}
              roughness={0.55}
              metalness={0.1}
            />
          </mesh>
        );
      })}
      {/* Halo glow */}
      <mesh position={[0, 0.05, 0]}>
        <sphereGeometry args={[0.4, 16, 16]} />
        <meshBasicMaterial color="#9f7cff" transparent opacity={0.12} depthWrite={false} />
      </mesh>
    </group>
  );
}

useGLTF.preload("/models/squid.glb");
