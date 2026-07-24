import { DOCTRINE } from "./doctrine";
import { addAlert } from "./alerts";
import type { EntityRef, SimState } from "./types";

// Pilotage & towage as a booked, contended resource (REAL-4, D-82). Every
// berthing/unberthing manoeuvre needs one pilot + DOCTRINE.pilotage.
// tugsPerManoeuvre tugs from the shared pool. Runs right after stepWxOps and
// before moveVessels, so a manoeuvre that just started this tick gets its
// first reservation attempt before moveVessels can ever complete it.
// Deterministic and RNG-free: reservation is a straight availability check,
// release is a status sweep (a booking's vessel leaving "berthing"/"departing"
// frees it), and freezing a blocked manoeuvre's phaseEndsTick mirrors the
// weather freeze in wxOps.ts.

function vesselRef(vesselId: string): EntityRef {
  return { entityType: "vessel", entityId: vesselId };
}

export function stepPilotage(state: SimState): void {
  const p = state.pilotage;

  // Release: a booking whose vessel is no longer manoeuvring returns its pilot
  // and tugs to the pool.
  p.bookings = p.bookings.filter((b) => {
    const v = state.vessels.find((x) => x.id === b.vesselId);
    if (v && (v.status === "berthing" || v.status === "departing")) return true;
    p.pilotsAvailable += 1;
    p.tugsAvailable += DOCTRINE.pilotage.tugsPerManoeuvre;
    return false;
  });

  // Reserve or wait: every manoeuvring vessel without an active booking either
  // gets one now, or has its manoeuvre timer frozen this tick (OPS-PILOT §1).
  for (const v of state.vessels) {
    if (v.status !== "berthing" && v.status !== "departing") continue;
    if (p.bookings.some((b) => b.vesselId === v.id)) continue;
    if (p.pilotsAvailable >= 1 && p.tugsAvailable >= DOCTRINE.pilotage.tugsPerManoeuvre) {
      p.pilotsAvailable -= 1;
      p.tugsAvailable -= DOCTRINE.pilotage.tugsPerManoeuvre;
      p.bookings.push({ vesselId: v.id });
      if (v.pilotageWaiting) {
        v.pilotageWaiting = false;
        addAlert(state, "info", `${v.id} "${v.name}" secured pilot and tugs — manoeuvre resuming (OPS-PILOT §1).`, vesselRef(v.id));
      }
    } else {
      if (v.phaseEndsTick !== undefined) v.phaseEndsTick += 1;
      if (!v.pilotageWaiting) {
        v.pilotageWaiting = true;
        addAlert(state, "warning", `${v.id} "${v.name}" waiting for pilot/tug availability — manoeuvre delayed (OPS-PILOT §1).`, vesselRef(v.id));
      }
    }
  }
}
