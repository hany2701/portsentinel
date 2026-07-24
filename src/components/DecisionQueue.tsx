import { useState } from "react";
import { useSimStore } from "../store/simStore";
import { Panel, PanelState } from "./Panel";
import { RecommendationCard } from "./RecommendationCard";

// D-77 + D-85: one-click discoverability for the AI-first pattern. AIF-2: the
// review is now dispatched immediately rather than only pre-filled — the agent
// completes the action it advertises. Its proposals still require deterministic
// validation and explicit human approval before anything executes.
const REVIEW_PROMPT =
  "Review the current situation and the decision queue: propose any actions doctrine warrants, rank pending items by urgency, and tell me which to approve first.";

export function DecisionQueue() {
  const recommendations = useSimStore((s) => s.sim.recommendations);
  const runAgentReview = useSimStore((s) => s.runAgentReview);
  const chatStatus = useSimStore((s) => s.chat.status);
  const [logOpen, setLogOpen] = useState(false);
  const pending = recommendations.filter((r) => r.status === "pending");
  // D-76 action log: every resolved recommendation, newest first, as compact
  // audit rows (replaces the old last-3 resolved cards).
  const resolved = recommendations.filter((r) => r.status !== "pending").reverse();

  return (
    <Panel
      title={`Decision queue${pending.length ? ` (${pending.length})` : ""}`}
      actions={
        <button
          type="button"
          onClick={() => void runAgentReview(REVIEW_PROMPT)}
          disabled={chatStatus === "streaming"}
          className="rounded-md border border-slate-200 px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-40 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
        >
          {chatStatus === "streaming" ? "Reviewing…" : "Run agent review"}
        </button>
      }
    >
      {pending.length === 0 && resolved.length === 0 ? (
        <PanelState text="No pending decisions. Ask PortSentinel for a review." />
      ) : (
        <div className="space-y-2">
          {pending.map((r) => <RecommendationCard key={r.id} rec={r} />)}
          {resolved.length > 0 && (
            <div className="border-t border-slate-200 pt-2 dark:border-slate-800">
              <button
                type="button"
                aria-expanded={logOpen}
                onClick={() => setLogOpen((o) => !o)}
                className="text-xs font-medium text-slate-400 hover:text-slate-600 dark:text-slate-500 dark:hover:text-slate-300"
              >
                {logOpen ? "▾" : "▸"} Action log ({resolved.length})
              </button>
              {logOpen && (
                <ul className="mt-1 max-h-48 space-y-1 overflow-y-auto">
                  {resolved.map((r) => (
                    <li key={r.id} className="flex items-baseline gap-2 text-xs text-slate-500 dark:text-slate-400">
                      <span className="shrink-0 font-mono text-[10px]">t{r.resolvedTick ?? r.createdTick}</span>
                      <span className="min-w-0 truncate text-slate-700 dark:text-slate-300">{r.title}</span>
                      <span className="shrink-0 rounded bg-slate-100 px-1 text-[10px] uppercase dark:bg-slate-800">{r.source}</span>
                      <span className={`ml-auto shrink-0 capitalize ${r.status === "approved" ? "text-[#1baf7a] dark:text-[#199e70]" : ""}`}>{r.status}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      )}
    </Panel>
  );
}
