import type { ChatMessage } from "../../store/simStore";
import type { Recommendation } from "../../sim";
import { navActionsFor } from "./navActions";

// UIX-1: the Evidence tab — full explainability for the latest answer, built
// entirely from the existing response trace (D-68): what the assistant was
// grounded on, the doctrine it retrieved/searched, and every proposal with its
// validation verdict. Nothing here is generated for display.
function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">{label}</p>
      <div className="mt-1 space-y-1 text-xs text-slate-600 dark:text-slate-300">{children}</div>
    </div>
  );
}

export function EvidencePanel({ msg, recs }: { msg?: ChatMessage; recs: Recommendation[] }) {
  if (!msg || !msg.trace) {
    return (
      <p className="p-4 text-sm text-slate-500 dark:text-slate-400">
        No answer yet. Ask a question in the Chat tab — its supporting data appears here.
      </p>
    );
  }
  const t = msg.trace;
  const msgRecs = msg.recommendationIds
    .map((id) => recs.find((r) => r.id === id))
    .filter((r): r is Recommendation => Boolean(r));
  const related = navActionsFor(msgRecs);

  return (
    <div className="space-y-4 p-4">
      <Section label="Grounding">
        <p className="tabular-nums">Snapshot · tick {t.tick} · {t.simTime}</p>
        {t.revision && <p className="text-amber-600 dark:text-amber-400">Revision — a prior proposal was rejected by validation (D-74).</p>}
      </Section>

      <Section label="Doctrine retrieved">
        {t.retrieved.length === 0 ? (
          <p>None.</p>
        ) : (
          t.retrieved.map((r) => (
            <p key={r.sectionId}>
              <span className="font-medium text-slate-800 dark:text-slate-100">{r.sectionId}</span> ·{" "}
              {r.forced ? "forced by situation" : `TF-IDF score ${r.score.toFixed(1)}`}
            </p>
          ))
        )}
      </Section>

      {t.searches.length > 0 && (
        <Section label="Doctrine searches">
          {t.searches.map((s, i) => (
            <p key={i}>
              “{s.query}” → {s.results.length === 0 ? "no match" : s.results.map((r) => `${r.sectionId} (${r.score.toFixed(1)})`).join(" · ")}
            </p>
          ))}
        </Section>
      )}

      <Section label="Proposed actions">
        {t.toolCalls.length === 0 ? (
          <p>None — advisory answer.</p>
        ) : (
          t.toolCalls.map((c, i) => (
            <p key={i}>
              <span className="font-medium text-slate-800 dark:text-slate-100">{c.title}</span> ({c.kind}) →{" "}
              <span className={c.validationStatus === "invalid" ? "text-[#d03b3b]" : "text-[#199e70]"}>{c.validationStatus}</span>
              {c.validationMessage ? ` — ${c.validationMessage}` : ""}
            </p>
          ))
        )}
      </Section>

      {related.length > 0 && (
        <Section label="Related modules">
          <p>{related.map((r) => r.label.replace(/^View /, "")).join(" · ")}</p>
        </Section>
      )}
    </div>
  );
}
