import { useEffect, useRef, useState } from "react";
import { CloudLightning } from "lucide-react";
import { useSimStore } from "../store/simStore";
import { ScenarioControls } from "./ScenarioPanel";
import { Tooltip } from "./Tooltip";

// The Scenario Controls, moved out of the permanent card layout into a popover
// that opens from a button — the same pattern as AlertBell.
//
// The CONTROLS THEMSELVES are unchanged: this renders <ScenarioControls />,
// the exact body that used to sit in the panel, still driving the same
// injectDisruption action and the same severity state. Opening or closing the
// popover touches no simulation state.

export function ScenarioControl() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const sim = useSimStore((s) => s.sim);

  const activeCount = sim.disruptions.filter(
    (d) => sim.clock.tick < d.startTick + d.durationTicks,
  ).length;

  // Close on outside click and on Escape, returning focus to the trigger so
  // keyboard users are not stranded.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <Tooltip
        label={
          activeCount > 0
            ? `Scenario controls — ${activeCount} disruption${activeCount > 1 ? "s" : ""} active`
            : "Inject a disruption scenario"
        }
        placement="bottom"
      >
        {(tip) => (
          <button
            {...tip}
            ref={buttonRef}
            type="button"
            aria-label={`Scenario controls${activeCount ? `, ${activeCount} active` : ""}`}
            aria-expanded={open}
            aria-haspopup="dialog"
            onClick={() => setOpen((o) => !o)}
            className={`relative rounded-md p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200 ${
              open ? "bg-slate-100 dark:bg-slate-800" : ""
            }`}
          >
            <CloudLightning className="h-4 w-4" aria-hidden="true" />
            {/* Active count reads at a glance without opening the popover —
                the same affordance the alert bell uses. */}
            {activeCount > 0 && (
              <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-[#eda100] px-1 text-[10px] font-medium text-white">
                {activeCount}
              </span>
            )}
          </button>
        )}
      </Tooltip>

      {open && (
        <div
          role="dialog"
          aria-label="Scenario controls"
          className="absolute right-0 z-50 mt-2 w-80 rounded-lg border border-slate-200 bg-white p-3 shadow-lg dark:border-slate-800 dark:bg-slate-900"
        >
          <div className="mb-2 text-sm font-semibold text-slate-900 dark:text-slate-100">
            Scenario Controls
          </div>
          <ScenarioControls />
        </div>
      )}
    </div>
  );
}
