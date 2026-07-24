import { useLayoutEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { weatherRiskBand } from "../../sim";
import { GROUND } from "../layout";

// Severe or critical band — the point at which the sky turns overcast and rain
// falls. Derived from the canonical band model (D-52) so the twin flips at the
// same risk as every other consumer instead of a private `> 60` literal.
function isStormy(risk: number): boolean {
  const id = weatherRiskBand(risk).id;
  return id === "severe" || id === "critical";
}

// Ambient weather (D-40): daylight dims as the risk index climbs, so a storm reads
// visually. Sun colour also cools toward overcast at high risk.
export function SkyLight({ risk }: { risk: number }) {
  const dim = 1 - 0.55 * Math.min(1, risk / 100);
  const sun = isStormy(risk) ? "#9fb0c4" : "#fff6e6";
  return (
    <group>
      <ambientLight intensity={0.55 * dim + 0.15} />
      <directionalLight position={[60, 100, 40]} intensity={1.1 * dim} color={sun} castShadow shadow-mapSize={[1024, 1024]}>
        <orthographicCamera attach="shadow-camera" args={[-130, 130, 130, -130, 0.1, 300]} />
      </directionalLight>
      <hemisphereLight args={["#cfe0f0", "#2b3340", 0.35 * dim + 0.1]} />
    </group>
  );
}

const RAIN_COUNT = 260;

// Rain streaks at severe+ (severe/critical band). One instanced mesh of thin
// falling boxes, recycled as they hit the ground — cheap on GPU (D-40).
export function Rain({ risk }: { risk: number }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const speeds = useMemo(() => Array.from({ length: RAIN_COUNT }, () => 18 + Math.random() * 14), []);
  const seeds = useMemo(
    () =>
      Array.from({ length: RAIN_COUNT }, () => ({
        x: GROUND.minX + Math.random() * (GROUND.maxX - GROUND.minX),
        z: GROUND.minZ + Math.random() * (GROUND.maxZ - GROUND.minZ),
        y: Math.random() * 40,
      })),
    [],
  );
  const dummy = useMemo(() => new THREE.Object3D(), []);

  useLayoutEffect(() => {
    if (!ref.current) return;
    seeds.forEach((s, i) => {
      dummy.position.set(s.x, s.y, s.z);
      dummy.updateMatrix();
      ref.current!.setMatrixAt(i, dummy.matrix);
    });
    ref.current.instanceMatrix.needsUpdate = true;
  }, [seeds, dummy]);

  useFrame((_, dt) => {
    if (!ref.current) return;
    for (let i = 0; i < RAIN_COUNT; i++) {
      seeds[i].y -= speeds[i] * dt;
      if (seeds[i].y < 0) seeds[i].y = 40;
      dummy.position.set(seeds[i].x, seeds[i].y, seeds[i].z);
      dummy.updateMatrix();
      ref.current.setMatrixAt(i, dummy.matrix);
    }
    ref.current.instanceMatrix.needsUpdate = true;
  });

  if (!isStormy(risk)) return null;
  return (
    <instancedMesh ref={ref} args={[undefined, undefined, RAIN_COUNT]}>
      <boxGeometry args={[0.05, 1.6, 0.05]} />
      <meshBasicMaterial color="#aab8cc" transparent opacity={0.5} />
    </instancedMesh>
  );
}
