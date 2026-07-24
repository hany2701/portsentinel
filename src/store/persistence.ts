import type { SimState } from "../sim";
import type { ChatMessage } from "./simStore";
import { isConnectedSequence } from "../maritime/graph";

// D-76: best-effort session persistence in localStorage so an accidental
// refresh never wipes the shift. SimState is plain JSON (the engine's own
// clone proves it); the RNG state is data, so a resumed run stays exactly as
// deterministic as it was. Persistence must never break the app — every call
// swallows storage failures (quota, privacy mode, SSR/tests without a DOM).

// v4: REAL-6 added a required top-level SimState field (calibrationMode) and
// widened SimulationClock.speed to include "realtime" — a v3 save lacks the
// former, so bump again (same reasoning as the v2→v3 bump).
// v5: GR-1 added a required top-level SimState field (maritime), the "enroute"
// vessel status, and the tracked vessel population — a v4 save has none of it.
const KEY = "portsentinel-session-v5";

export type SavedSession = { sim: SimState; chatMessages: ChatMessage[]; savedAtMs: number };

function storage(): Storage | null {
  return typeof localStorage === "undefined" ? null : localStorage;
}

export function saveSession(sim: SimState, chatMessages: ChatMessage[]): void {
  try {
    storage()?.setItem(KEY, JSON.stringify({ sim, chatMessages, savedAtMs: Date.now() }));
  } catch {
    /* best-effort */
  }
}

// GR-1's static route graph can change between builds (nodes renamed/removed);
// a save from an older graph can carry an active route plan whose consecutive
// nodes no longer form a single hop. Resuming that plan crashes any code path
// that walks it (e.g. chat context building — the P0 deadlock this guards
// against), so a save with a disconnected active route is treated the same as
// corrupt: discarded rather than resumed.
function hasOnlyConnectedRoutes(sim: SimState): boolean {
  return sim.maritime.routePlans
    .filter((p) => p.status === "active")
    .every((p) => isConnectedSequence(p.nodeIds));
}

export function loadSession(): SavedSession | null {
  try {
    const raw = storage()?.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SavedSession;
    const valid = parsed && parsed.sim && Array.isArray(parsed.chatMessages);
    if (!valid) return null;
    if (!hasOnlyConnectedRoutes(parsed.sim)) {
      clearSession();
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function clearSession(): void {
  try {
    storage()?.removeItem(KEY);
  } catch {
    /* best-effort */
  }
}
