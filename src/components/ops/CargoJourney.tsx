import { cargoJourney, type JourneyStage } from "../../sim";
import { useSimStore } from "../../store/simStore";
import { Panel, PanelState } from "../Panel";

const STATE_COLOR: Record<JourneyStage["state"], string> = {
  complete: "#1baf7a",
  active: "#2a78d6",
  pending: "#94a3b8",
  unavailable: "#cbd5e1",
};

// Traces the selected vessel or cargo lot through its journey stages, from
// existing joins only — stages with no data-model link render honestly as
// "unavailable" rather than being guessed.
export function CargoJourney() {
  const sim = useSimStore((s) => s.sim);
  const selection = useSimStore((s) => s.selection);
  const stages =
    selection && (selection.entityType === "vessel" || selection.entityType === "cargoLot")
      ? cargoJourney(sim, selection)
      : null;

  return (
    <Panel title="Cargo Journey">
      {!stages ? (
        <PanelState text="Select a cargo lot or vessel to trace its journey." />
      ) : (
        <ol className="space-y-2">
          {stages.map((s) => (
            <li key={s.id} className="flex items-start gap-2">
              <span
                className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ background: STATE_COLOR[s.state] }}
                aria-hidden="true"
              />
              <div className="min-w-0">
                <p className="text-xs font-medium text-slate-700 dark:text-slate-200">
                  {s.label}
                  {s.state === "unavailable" && <span className="ml-1 font-normal text-slate-400">· unavailable</span>}
                </p>
                <p className="truncate text-[11px] text-slate-500 dark:text-slate-400">{s.detail}</p>
              </div>
            </li>
          ))}
        </ol>
      )}
    </Panel>
  );
}
