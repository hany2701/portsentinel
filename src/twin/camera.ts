import { useRef } from "react";
import { useThree, useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { GROUND } from "./layout";

export type CamPreset = "Overview" | "Quay" | "Yard" | "Gate";
export type CamGoal = { pos: [number, number, number]; target: [number, number, number]; nonce: number };

// Four camera presets (§7, rescaled for the INT-2 Tuas footprint). Overview keeps
// the reference-image isometric angle over the whole comb + offshore anchorage.
export const PRESETS: Record<CamPreset, { pos: [number, number, number]; target: [number, number, number] }> = {
  Overview: { pos: [-90, 115, 120], target: [0, 0, -20] },
  Quay: { pos: [5, 55, 45], target: [0, 0, -40] },
  Yard: { pos: [0, 75, 110], target: [0, 0, 30] },
  Gate: { pos: [-35, 32, 100], target: [-10, 0, 58] },
};

export const OVERVIEW_GOAL: CamGoal = { ...PRESETS.Overview, nonce: 0 };

// Smoothly tweens the camera + OrbitControls target toward the active goal, then
// clamps the target inside the port footprint so panning can't drift into the void.
// Requires <OrbitControls makeDefault /> so useThree exposes `controls`.
export function CameraRig({ goal }: { goal: CamGoal }) {
  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls) as unknown as { target: THREE.Vector3; update: () => void } | null;
  const toPos = useRef(new THREE.Vector3(...goal.pos));
  const toTgt = useRef(new THREE.Vector3(...goal.target));
  const lastNonce = useRef(-1);
  const animating = useRef(false);

  useFrame((_, dt) => {
    if (!controls) return;
    if (goal.nonce !== lastNonce.current) {
      lastNonce.current = goal.nonce;
      toPos.current.set(...goal.pos);
      toTgt.current.set(...goal.target);
      animating.current = true;
    }
    if (animating.current) {
      const k = 1 - Math.pow(0.0015, dt); // frame-rate-independent smoothing
      camera.position.lerp(toPos.current, k);
      controls.target.lerp(toTgt.current, k);
      if (camera.position.distanceTo(toPos.current) < 0.3) animating.current = false;
    }
    // Pan clamp: keep the orbit target within the port bounds.
    controls.target.x = THREE.MathUtils.clamp(controls.target.x, GROUND.minX, GROUND.maxX);
    controls.target.z = THREE.MathUtils.clamp(controls.target.z, GROUND.minZ, GROUND.maxZ);
    controls.target.y = 0;
    controls.update();
  });

  return null;
}
