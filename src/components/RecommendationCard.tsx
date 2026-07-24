import { useMemo, useState } from "react";
import { previewEffect } from "../sim";
import type { KpiSnapshot, Recommendation, SimulationEffect } from "../sim";
import { useSimStore } from "../store/simStore";
import { SourceTag } from "./SourceTag";
import { stripDashes } from "./chat/responseBlocks";

const HORIZONS = [
  { label: "1 h", ticks: 12 },
  { label: "2 h", ticks: 24 },
  { label: "4 h", ticks: 48 },
];

function impactText(rec: Recommendation): string {
  const bits: string[] = [];
  if (rec.impact.waitHoursSaved) bits.push(`~${rec.impact.waitHoursSaved} h wait saved`);
  if (rec.impact.teuProtected) bits.push(`${rec.impact.teuProtected.toLocaleString()} TEU protected`);
  if (rec.impact.utilizationDeltaPct) bits.push(`-${rec.impact.utilizationDeltaPct}% on block`);
  return bits.join(" · ") || "Advisory";
}

const PREVIEW_ROWS: { key: keyof KpiSnapshot; label: string; higherIsBetter: boolean }[] = [
  { key: "resilienceScore", label: "Resilience", higherIsBetter: true },
  { key: "vesselsWaiting", label: "Vessels waiting", higherIsBetter: false },
  { key: "yardUtilisationPct", label: "Yard %", higherIsBetter: false },
  { key: "teuAtRisk", label: "TEU at risk", higherIsBetter: false },
];

export function RecommendationCard({ rec }: { rec: Recommendation }) {
  const sim = useSimStore((s) => s.sim);
  const approve = useSimStore((s) => s.approveRecommendation);
  const dismiss = useSimStore((s) => s.dismissRecommendation);
  const [open, setOpen] = useState(false);
  const [horizon, setHorizon] = useState(24);
  const [override, setOverride] = useState<string>("");

  const effect: SimulationEffect = useMemo(() => {
    if (override && rec.proposedEffect.kind === "reassignBerth") return { ...rec.proposedEffect, toBerthId: override };
    if (override && rec.proposedEffect.kind === "divertVessel") return { ...rec.proposedEffect, toPortId: override };
    return rec.proposedEffect;
  }, [override, rec.proposedEffect]);

  const preview = useMemo(() => (open ? previewEffect(sim, effect, horizon) : null), [open, effect, horizon, sim]);

  const alternatives = useMemo(() => {
    const eff = rec.proposedEffect;
    if (eff.kind === "reassignBerth") {
      const v = sim.vessels.find((x) => x.id === eff.vesselId);
      return sim.berths
        .filter((b) => b.status === "available" && (v?.class !== "neopanamax" || b.deepWater))
        .map((b) => ({ id: b.id, label: b.name }));
    }
    if (eff.kind === "divertVessel") {
      return sim.alternatePorts.map((p) => ({ id: p.id, label: p.name }));
    }
    return [];
  }, [rec.proposedEffect, sim]);

  const pending = rec.status === "pending";
  const badgeClass = rec.source === "rule"
    ? "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300"
    : rec.source === "agent"
      ? "bg-violet-100 text-violet-700 dark:bg-violet-900 dark:text-violet-200"
      : "bg-sky-100 text-sky-700 dark:bg-sky-900 dark:text-sky-200";

  return (
    <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-800">
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-medium text-slate-900 dark:text-slate-100">{stripDashes(rec.title)}</p>
        <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] uppercase ${badgeClass}`}>{rec.source}</span>
      </div>
      <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{stripDashes(rec.rationale)}</p>
      <div className="mt-2 flex items-center justify-between">
        <span className="text-xs text-slate-600 dark:text-slate-300">{impactText(rec)}</span>
        <SourceTag variant={rec.source === "agent" ? "ai" : rec.source === "user" ? "user" : "computed"} />
      </div>

      {rec.validationStatus === "invalid" && (
        <p className="mt-2 text-xs text-[#d03b3b]">Invalid: {rec.validationMessage}</p>
      )}

      {pending && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button onClick={() => approve(rec.id)} disabled={rec.validationStatus === "invalid"} className="rounded-md bg-slate-900 px-3 py-1 text-xs font-medium text-white disabled:opacity-40 dark:bg-slate-100 dark:text-slate-900">Approve</button>
          <button onClick={() => dismiss(rec.id)} className="rounded-md border border-slate-300 px-3 py-1 text-xs text-slate-600 dark:border-slate-700 dark:text-slate-300">Dismiss</button>
          <button onClick={() => setOpen((o) => !o)} className="ml-auto text-xs text-[#2a78d6] dark:text-[#3987e5]">{open ? "Hide preview" : "Preview impact"}</button>
        </div>
      )}

      {!pending && <p className="mt-2 text-xs capitalize text-slate-400 dark:text-slate-500">{rec.status}</p>}

      {open && pending && (
        <div className="mt-3 rounded-md bg-slate-50 p-2 dark:bg-slate-950">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="text-slate-500 dark:text-slate-400">Horizon</span>
            {HORIZONS.map((h) => (
              <button key={h.ticks} onClick={() => setHorizon(h.ticks)} className={`rounded border px-1.5 py-0.5 ${horizon === h.ticks ? "border-slate-900 bg-slate-900 text-white dark:border-slate-100 dark:bg-slate-100 dark:text-slate-900" : "border-slate-300 dark:border-slate-700"}`}>{h.label}</button>
            ))}
            {alternatives.length > 0 && (
              <select value={override} onChange={(e) => setOverride(e.target.value)} className="ml-auto rounded border border-slate-300 bg-white px-1 py-0.5 dark:border-slate-700 dark:bg-slate-900">
                <option value="">proposed target</option>
                {alternatives.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
              </select>
            )}
          </div>
          {preview && !preview.valid && <p className="mt-2 text-xs text-[#d03b3b]">Cannot preview: {preview.message}</p>}
          {preview && preview.valid && preview.coverDelta && (
            <div className="mt-2">
              <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                Days of cover — {preview.coverDelta.customerName} (+{preview.horizonTicks / 12} h)
              </p>
              <div className="mt-1 flex items-baseline gap-3 text-xs">
                <span className="text-slate-600 dark:text-slate-300">
                  Without <span className="font-mono">{preview.coverDelta.beforeDays.toFixed(1)} d</span>
                </span>
                <span className="text-slate-600 dark:text-slate-300">
                  With <span className="font-mono">{preview.coverDelta.afterDays.toFixed(1)} d</span>
                </span>
                <span className="font-mono text-[#1baf7a] dark:text-[#199e70]">
                  +{(preview.coverDelta.afterDays - preview.coverDelta.beforeDays).toFixed(1)} d
                </span>
              </div>
              <p className="mt-1 text-[10px] text-slate-400 dark:text-slate-500">
                Port throughput KPIs are unchanged — a safety-stock advisory protects the customer's inventory buffer, not berth, yard or crane capacity.
              </p>
            </div>
          )}
          {preview && preview.valid && !preview.coverDelta && (
            <table className="mt-2 w-full text-xs">
              <thead>
                <tr className="text-slate-400 dark:text-slate-500">
                  <th className="text-left font-normal">Metric (+{preview.horizonTicks / 12} h)</th>
                  <th className="text-right font-normal">Without</th>
                  <th className="text-right font-normal">With</th>
                  <th className="text-right font-normal">Δ</th>
                </tr>
              </thead>
              <tbody>
                {PREVIEW_ROWS.map((r) => {
                  const wo = preview.without[r.key];
                  const wi = preview.withEffect[r.key];
                  const delta = Math.round(wi - wo);
                  const improving = r.higherIsBetter ? delta > 0 : delta < 0;
                  return (
                    <tr key={r.key} className="text-slate-600 dark:text-slate-300">
                      <td className="py-0.5">{r.label}</td>
                      <td className="text-right font-mono">{wo}</td>
                      <td className="text-right font-mono">{wi}</td>
                      <td className={`text-right font-mono ${delta === 0 ? "text-slate-400" : improving ? "text-[#1baf7a] dark:text-[#199e70]" : "text-[#d03b3b]"}`}>{delta > 0 ? `+${delta}` : delta}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          <p className="mt-1 text-[10px] text-slate-400 dark:text-slate-500">Simulated on a throwaway copy — the live port is untouched.</p>
        </div>
      )}
    </div>
  );
}
