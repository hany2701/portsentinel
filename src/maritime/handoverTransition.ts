import { openHandover } from "../sim/maritimeStep";
import type { SimState } from "../sim/types";

// GR-5: the presentation side of a frame crossing.
//
// The geographic frame and the D-62 world frame are separate coordinate systems
// (GR-D6), so a vessel's position necessarily jumps at the crossing. That jump
// is hidden by a short view handover — focus, fade, status chip — rather than by
// faking a transform between the frames.
//
// THIS IS PRESENTATION ONLY. Nothing here reads or writes simulation state: it
// derives a label and a direction from the handover record the engine already
// wrote, and returns them. The transition can be skipped entirely without
// changing a single simulated value.

export type HandoverTransition = {
  vesselId: string;
  direction: "regional_to_tuas" | "tuas_to_regional";
  /** Which view the user should end up in. */
  target: "twin" | "maritime";
  label: string;
  /** Ticks since the crossing, so the UI can fade the chip out. */
  ageTicks: number;
};

// How long the chip stays up after the crossing. Long enough to read at demo
// speed, short enough not to linger.
export const TRANSITION_VISIBLE_TICKS = 6;

/**
 * The in-flight transition for a vessel, or null when it is not crossing.
 * Callers use it to show a status chip and to decide whether to offer the view
 * handoff — never to move anything.
 */
export function handoverTransition(sim: SimState, vesselId: string | null): HandoverTransition | null {
  if (!vesselId) return null;
  const handover = openHandover(sim, vesselId) ?? lastCompletedHandover(sim, vesselId);
  if (!handover) return null;

  const ageTicks = sim.clock.tick - handover.handoverTick;
  if (ageTicks < 0 || ageTicks > TRANSITION_VISIBLE_TICKS) return null;

  return handover.direction === "regional_to_tuas"
    ? {
        vesselId,
        direction: "regional_to_tuas",
        target: "twin",
        label: "Entering Tuas operational zone",
        ageTicks,
      }
    : {
        vesselId,
        direction: "tuas_to_regional",
        target: "maritime",
        label: "Returning to regional route",
        ageTicks,
      };
}

function lastCompletedHandover(sim: SimState, vesselId: string) {
  return sim.maritime.handovers
    .filter((h) => h.vesselId === vesselId)
    .reduce<(typeof sim.maritime.handovers)[number] | undefined>(
      (latest, h) => (!latest || h.handoverTick > latest.handoverTick ? h : latest),
      undefined,
    );
}

/** Opacity for a cross-dissolve, fading out as the crossing recedes. */
export function transitionOpacity(ageTicks: number): number {
  return Math.max(0, 1 - ageTicks / TRANSITION_VISIBLE_TICKS);
}
