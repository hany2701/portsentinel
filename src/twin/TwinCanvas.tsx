import { useEffect, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import type { SimState } from "../sim";
import { Scene, type Layers } from "./Scene";
import { CameraRig, PRESETS, type CamGoal } from "./camera";
import { validateLayout } from "./layout";
import type { PickHandlers } from "./picking";

// Dev-time placement audit (D-63): a bad layout constant fails loudly at twin
// mount instead of rendering a silently wrong terminal. No-op in production.
if (import.meta.env.DEV) validateLayout();

// Throws during render inside the R3F tree; the error propagates to the twin's
// error boundary, proving a scene crash is contained (IP-5 gate).
function Boom(): never {
  throw new Error("Forced twin crash (error-boundary test).");
}

// Pauses the render loop while the tab is hidden (§7 performance budget); unmounting
// the view stops it entirely.
function useActiveFrameloop(): "always" | "never" {
  const [active, setActive] = useState(!document.hidden);
  useEffect(() => {
    const onVis = () => setActive(!document.hidden);
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);
  return active ? "always" : "never";
}

// One canvas for both the full view and the dashboard embed (D-41). Embed mode is a
// non-interactive slow auto-orbit at 1.5 DPR; the full view is clamped orbit/pan/zoom.
export function TwinCanvas({ sim, layers, selection, hoverId, onPick, onHover, onBackground, goal, embed = false, crash = false }: {
  sim: SimState; layers: Layers; goal: CamGoal; embed?: boolean; crash?: boolean; onBackground: () => void;
} & PickHandlers) {
  const frameloop = useActiveFrameloop();
  return (
    <Canvas
      shadows
      frameloop={frameloop}
      dpr={[1, embed ? 1.5 : 2]}
      gl={{ antialias: true, powerPreference: "high-performance" }}
      camera={{ position: PRESETS.Overview.pos, fov: 42, near: 0.5, far: 800 }}
      onPointerMissed={onBackground}
    >
      <color attach="background" args={["#0b1220"]} />
      <fog attach="fog" args={["#0b1220", 150, 480]} />
      <Scene sim={sim} layers={layers} selection={selection} hoverId={hoverId} onPick={onPick} onHover={onHover} />
      {crash && <Boom />}
      <OrbitControls
        makeDefault
        enablePan={!embed}
        enableZoom={!embed}
        enableRotate={!embed}
        autoRotate={embed}
        autoRotateSpeed={0.35}
        minDistance={18}
        maxDistance={280}
        maxPolarAngle={Math.PI / 2 - 0.04}
        target={PRESETS.Overview.target}
      />
      {!embed && <CameraRig goal={goal} />}
    </Canvas>
  );
}
