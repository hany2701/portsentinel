import { RULE_COOLDOWN_TICKS } from "./config";
import type { AlertSeverity, EntityRef, SimState } from "./types";

// D-77: how long a critical alert may sit unacknowledged before one escalation
// alert is raised on top of it (24 ticks = 2 sim-hours).
export const CRITICAL_ESCALATE_AFTER_TICKS = 24;

// Shared alert emitter (used by the tick stages and the wxOps state machine).
// D-77 lifecycle: an identical message that is still unacknowledged collapses
// into the existing alert as a ×N count (alert fatigue control) instead of
// appending or being dropped; the buffer stays capped.
export function addAlert(state: SimState, severity: AlertSeverity, message: string, entityRef?: EntityRef): void {
  const existing = [...state.alerts].reverse().find((a) => a.message === message && !a.acknowledged);
  if (existing) {
    // Within the cooldown this is the same ongoing condition — just refresh.
    if (state.clock.tick - existing.tick < RULE_COOLDOWN_TICKS) return;
    existing.count += 1;
    existing.tick = state.clock.tick;
    return;
  }
  state.alerts.push({
    id: `ALERT-${state.seq++}`, severity, message, entityRef,
    tick: state.clock.tick, acknowledged: false, count: 1, provenance: "simulated",
  });
  if (state.alerts.length > 100) state.alerts.splice(0, state.alerts.length - 100);
}

// D-77: one escalation per ignored critical alert — the marker prevents repeats
// and the escalation alert itself is never re-escalated (it carries the marker).
export function escalateStaleCriticals(state: SimState): void {
  for (const a of [...state.alerts]) {
    if (a.severity !== "critical" || a.acknowledged || a.escalated) continue;
    if (state.clock.tick - a.tick < CRITICAL_ESCALATE_AFTER_TICKS) continue;
    a.escalated = true;
    state.alerts.push({
      id: `ALERT-${state.seq++}`,
      severity: "critical",
      message: `Unacknowledged critical alert for 2 h: "${a.message}" — acknowledge or act.`,
      entityRef: a.entityRef,
      tick: state.clock.tick,
      acknowledged: false,
      count: 1,
      escalated: true,
      provenance: "simulated",
    });
  }
  if (state.alerts.length > 100) state.alerts.splice(0, state.alerts.length - 100);
}
