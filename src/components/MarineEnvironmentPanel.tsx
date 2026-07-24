import { RefreshCw } from "lucide-react";
import { DOCTRINE, ticksToHours, ticksUntilTideWindow } from "../sim";
import { useSimStore } from "../store/simStore";
import { Panel } from "./Panel";

// REAL-5 (D-83): the three Singapore marine-environment feeds/curves — NEA
// lightning, NEA PSI/haze, and the deterministic tide curve — each with their
// own freshness, mirroring the weather feed's live/stale/simulated badges.

function FreshnessDot({ freshness }: { freshness: "live" | "stale" | "simulated" | "modelled" }) {
  const styles =
    freshness === "live"
      ? { cls: "bg-[#1baf7a]/10 text-[#199e70]", dot: "bg-[#199e70]", text: "Live" }
      : freshness === "stale"
        ? { cls: "bg-[#eda100]/10 text-[#c98500]", dot: "bg-[#c98500]", text: "Stale" }
        : freshness === "modelled"
          ? { cls: "bg-[#2a78d6]/10 text-[#2a78d6] dark:text-[#5ea1f2]", dot: "bg-[#2a78d6]", text: "Modelled" }
          : { cls: "bg-[#eda100]/10 text-[#c98500]", dot: "bg-[#c98500]", text: "Simulated" };
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ${styles.cls}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${styles.dot}`} aria-hidden="true" />
      {styles.text}
    </span>
  );
}

export function MarineEnvironmentPanel() {
  const sim = useSimStore((s) => s.sim);
  const error = useSimStore((s) => s.marineFeedError);
  const pollMarineFeeds = useSimStore((s) => s.pollMarineFeeds);
  const { lightning, haze, tide } = sim;

  return (
    <Panel
      title="Marine Environment"
      actions={
        <button
          type="button"
          onClick={() => pollMarineFeeds()}
          className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-slate-500 hover:bg-slate-100 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200"
        >
          <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
          Refresh
        </button>
      }
    >
      {error && <p className="mb-2 text-xs text-[#c98500]">{error}</p>}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="rounded-md bg-slate-50 px-3 py-2 dark:bg-slate-800/50">
          <div className="flex items-center justify-between">
            <span className="text-xs text-slate-500 dark:text-slate-400">Lightning (NEA)</span>
            <FreshnessDot freshness={lightning.freshness} />
          </div>
          <div className={`mt-1 font-mono text-sm ${lightning.active ? "text-[#d03b3b]" : "text-slate-800 dark:text-slate-100"}`}>
            {lightning.active ? "RISK — cranes suspend" : "Clear"}
          </div>
          <div className="mt-0.5 text-xs text-slate-400">
            {lightning.source === "nea" ? "source: NEA observation" : "source: precip proxy (fallback)"}
          </div>
        </div>

        <div className="rounded-md bg-slate-50 px-3 py-2 dark:bg-slate-800/50">
          <div className="flex items-center justify-between">
            <span className="text-xs text-slate-500 dark:text-slate-400">Haze (PSI, west)</span>
            <FreshnessDot freshness={haze.freshness} />
          </div>
          <div className="mt-1 font-mono text-sm text-slate-800 dark:text-slate-100">PSI {haze.psi}</div>
          <div className="mt-0.5 text-xs text-slate-400">visibility contribution {haze.visibilityKm} km</div>
        </div>

        <div className="rounded-md bg-slate-50 px-3 py-2 dark:bg-slate-800/50">
          <div className="flex items-center justify-between">
            <span className="text-xs text-slate-500 dark:text-slate-400">Tide (harmonic curve)</span>
            {/* Deterministic harmonic model (src/sim/tide.ts) with no external
                feed — labelling it "Live" would contradict the provenance
                constraint the assistant is held to. */}
            <FreshnessDot freshness="modelled" />
          </div>
          <div className={`mt-1 font-mono text-sm ${tide.windowOpen ? "text-[#199e70]" : "text-[#c98500]"}`}>
            {tide.heightM} m — {tide.windowOpen ? "window open" : "window closed"}
          </div>
          <div className="mt-0.5 text-xs text-slate-400">
            {tide.windowOpen
              ? `neopanamax may berth (>= ${DOCTRINE.tide.minBerthingHeightM} m)`
              : `reopens in ~${ticksToHours(ticksUntilTideWindow(sim)).toFixed(1)} h`}
          </div>
        </div>
      </div>
    </Panel>
  );
}
