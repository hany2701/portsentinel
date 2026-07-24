import { useEffect } from "react";
import { TICK_REAL_MS, TICK_SIM_MINUTES } from "../sim";
import { useSimStore } from "../store/simStore";

// REAL-6 (D-84): the "realtime" speed is the 1x "realistic shift" preset —
// genuine wall-clock pace (TICK_SIM_MINUTES real minutes per tick) instead of
// the compressed demo multipliers.
const REALTIME_INTERVAL_MS = TICK_SIM_MINUTES * 60 * 1000;

export function useSimLoop() {
  const running = useSimStore((s) => s.sim.clock.running);
  const speed = useSimStore((s) => s.sim.clock.speed);
  const tickOnce = useSimStore((s) => s.tickOnce);

  useEffect(() => {
    if (!running) return;
    const interval = speed === "realtime" ? REALTIME_INTERVAL_MS : TICK_REAL_MS / speed;
    const id = setInterval(tickOnce, interval);
    return () => clearInterval(id);
  }, [running, speed, tickOnce]);
}
