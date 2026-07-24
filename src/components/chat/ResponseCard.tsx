import type { ChatMessage } from "../../store/simStore";
import type { Recommendation } from "../../sim";
import type { OpsTab } from "../../store/opsStore";
import type { ViewId } from "../../views/registry";
import { SourceTag } from "../SourceTag";
import { RecommendationCard } from "../RecommendationCard";
import { navActionsFor } from "./navActions";
import { ResponseBody } from "./ResponseBody";
import { useSimStore } from "../../store/simStore";

const NAV_BTN =
  "rounded-md border border-slate-200 px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800";

// UIX-1: the assistant turn as a control-tower response card. Every element is
// backed by real data — status (provenance), the grounded answer, validated
// recommendation cards, real navigation, and measured latency. No confidence.
export function ResponseCard({
  msg,
  recs,
  onNavigate,
  setTab,
  onOpenEvidence,
}: {
  msg: ChatMessage;
  recs: Recommendation[];
  onNavigate: (view: ViewId) => void;
  setTab: (tab: OpsTab) => void;
  onOpenEvidence: () => void;
}) {
  const msgRecs = msg.recommendationIds
    .map((id) => recs.find((r) => r.id === id))
    .filter((r): r is Recommendation => Boolean(r));
  const invalid = msg.trace?.toolCalls.some((t) => t.validationStatus === "invalid");
  const hasProposals = msgRecs.length > 0;
  const navs = navActionsFor(msgRecs);
  const select = useSimStore((s) => s.select);

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
      <div className="mb-2 flex items-center gap-2">
        <SourceTag variant="ai" />
        {hasProposals && (
          <span
            className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
              invalid
                ? "bg-[#eda100]/10 text-[#c98500] dark:text-[#eda100]"
                : "bg-[#1baf7a]/10 text-[#199e70]"
            }`}
          >
            {invalid ? "Needs revision" : "Validated"}
          </span>
        )}
        {!msg.streaming && msg.responseMs !== undefined && (
          <span className="ml-auto text-[10px] tabular-nums text-slate-400 dark:text-slate-500">
            Answered in {(msg.responseMs / 1000).toFixed(1)}s
          </span>
        )}
      </div>

      <ResponseBody content={msg.content} />
      {msg.streaming && (
        <span className="ml-0.5 inline-block h-3 w-1.5 animate-pulse bg-current align-middle" aria-hidden="true" />
      )}
      {msg.streaming && (msg.trace?.searches.length ?? 0) > 0 && (
        <p className="mt-1 text-[10px] italic text-slate-400 dark:text-slate-500">searching doctrine…</p>
      )}

      {msgRecs.map((r) => (
        <div key={r.id} className="mt-2">
          <RecommendationCard rec={r} />
        </div>
      ))}

      {!msg.streaming && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {navs.map((n) => (
            <button
              key={n.label}
              type="button"
              className={NAV_BTN}
              onClick={() => {
                // Select before navigating so the destination view renders
                // already focused on the affected vessel/berth/customer.
                if (n.entityRef) select(n.entityRef);
                if (n.tab) setTab(n.tab);
                onNavigate(n.view);
              }}
            >
              {n.label}
            </button>
          ))}
          {msg.trace && (
            <button type="button" className={NAV_BTN} onClick={onOpenEvidence}>
              View Evidence
            </button>
          )}
        </div>
      )}

      {!msg.streaming && msg.trace && (
        <p className="mt-2 text-[10px] text-slate-400 dark:text-slate-500">
          Grounded · tick {msg.trace.tick} · {msg.trace.simTime}
        </p>
      )}
    </div>
  );
}
