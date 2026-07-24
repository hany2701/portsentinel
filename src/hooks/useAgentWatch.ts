import { useEffect } from "react";
import { useSimStore } from "../store/simStore";
import type { Disruption } from "../sim/types";

// AIF-2: the Tuas brief asks the agent to MONITOR disruption and suggest
// immediate intervention, not merely answer when asked. This watcher dispatches
// exactly one grounded review per severe (severity 3) disruption. It never
// executes anything — proposals still land in the decision queue for
// deterministic validation and explicit human approval.

export const SEVERE_DISRUPTION_SEVERITY = 3;

export function reviewPromptFor(d: Disruption): string {
  const targets = d.targetIds.length ? ` affecting ${d.targetIds.join(", ")}` : "";
  return (
    `A severity-${d.severity} ${d.type} disruption (${d.id}) has just been detected${targets}. ` +
    `Assess the impact on Tuas operations now: which vessels, berths, connections and customers are exposed, ` +
    `and propose any immediate action doctrine warrants (rerouting, holding, re-berthing, or a safety-stock advisory). ` +
    `If no action is warranted yet, say so explicitly and state what you are watching.`
  );
}

export function useAgentWatch() {
  const disruptions = useSimStore((s) => s.sim.disruptions);
  const claim = useSimStore((s) => s.claimDisruptionReview);
  const runAgentReview = useSimStore((s) => s.runAgentReview);

  useEffect(() => {
    const severe = disruptions.find((d) => d.severity >= SEVERE_DISRUPTION_SEVERITY);
    if (!severe) return;
    if (!claim(severe.id)) return;
    void runAgentReview(reviewPromptFor(severe));
  }, [disruptions, claim, runAgentReview]);
}
