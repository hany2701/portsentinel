import { useState } from "react";
import { Pause, Play, RotateCcw, StepForward } from "lucide-react";
import { SPEEDS, formatSimTime } from "../sim";
import { useSimStore } from "../store/simStore";
import { GLOBAL_TUAS_SCENARIO, pickFocusVessel } from "../maritime/scenario";
import type { ViewId } from "../views/registry";
import { SourceTag } from "./SourceTag";
import { showToast } from "./ToastStack";
import { MovablePanel, type PanelPosition } from "./MovablePanel";
import { Tooltip } from "./Tooltip";

const BTN =
  "rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800";

/**
 * The simulation controls — clock, transport, speed, seed and the GR-10
 * scenario trigger.
 *
 * Extracted from the fixed card so the same controls, the same store and the
 * same handlers can render inside the movable overlay. Nothing about the
 * behaviour changed; only its container did.
 */
export function SimulationControls({ onNavigate }: { onNavigate: (view: ViewId) => void }) {
  const clock = useSimStore((s) => s.sim.clock);
  const { play, pause, setSpeed, reset, tickOnce } = useSimStore();
  const [seedText, setSeedText] = useState(String(clock.seed));

  const startGlobalTuasScenario = () => {
    // Compose the existing public store actions. No recommendation is created
    // here: the detected route decision remains evidence until a manager or the
    // advisor explicitly proposes it (D-85 / AIF-1).
    const actions = useSimStore.getState();
    actions.pause();
    actions.reset(GLOBAL_TUAS_SCENARIO.seed);
    // Geographic storm — drives V-333's corridor reroute on the network map.
    actions.injectDisruption(
      GLOBAL_TUAS_SCENARIO.disruption.type,
      GLOBAL_TUAS_SCENARIO.disruption.severity,
      GLOBAL_TUAS_SCENARIO.disruption.durationTicks,
      GLOBAL_TUAS_SCENARIO.disruption.atNodeId,
    );
    // Local storm (untargeted) — the other half of the monsoon: drives the Tuas
    // terminal overlay so cranes/berths suspend and the AI has a full-port crisis
    // to advise on across the Resilience Monitor, Weather and Operations tabs.
    actions.injectDisruption(
      GLOBAL_TUAS_SCENARIO.localStorm.type,
      GLOBAL_TUAS_SCENARIO.localStorm.severity,
      GLOBAL_TUAS_SCENARIO.localStorm.durationTicks,
    );

    const focus = pickFocusVessel(useSimStore.getState().sim);
    if (!focus) {
      showToast("Global-to-Tuas scenario could not find its focus vessel.", "error");
      return;
    }

    useSimStore.getState().select({ entityType: "vessel", entityId: focus.id });
    useSimStore.getState().setSpeed(GLOBAL_TUAS_SCENARIO.playbackSpeed);
    useSimStore.getState().play();
    setSeedText(String(GLOBAL_TUAS_SCENARIO.seed));
    // Open at the command centre (Resilience Monitor) so the crisis reads first;
    // the demo script drills into Weather, Alerts, Operations and the map from here.
    onNavigate("monitor");
    showToast(
      `Monsoon crisis running: Tuas ops suspended and ${focus.name}'s corridor blocked. Ask PortSentinel what to do.`,
      "info",
    );
  };

  return (
    <div>
      <div className="flex items-center justify-between">
        <span className="text-xs text-slate-500 dark:text-slate-400">Clock</span>
        <SourceTag variant="simulated" />
      </div>
      <div className="mt-2 flex items-baseline justify-between">
        <span className="font-mono text-sm text-slate-900 dark:text-slate-100">
          {formatSimTime(clock.simMinutes)}
        </span>
        <span className="text-xs text-slate-500 dark:text-slate-400">
          tick {clock.tick}
        </span>
      </div>
      <div className="mt-3 flex items-center gap-2">
        {clock.running ? (
          <Tooltip label="Pause the simulation clock">
            {(tip) => (
              <button {...tip} className={BTN} onClick={pause} aria-label="Pause simulation">
                <Pause className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            )}
          </Tooltip>
        ) : (
          <Tooltip label="Run the simulation clock">
            {(tip) => (
              <button {...tip} className={BTN} onClick={play} aria-label="Play simulation">
                <Play className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            )}
          </Tooltip>
        )}
        <Tooltip label="Advance exactly one tick (5 simulated minutes)">
          {(tip) => (
            <button {...tip} className={BTN} onClick={tickOnce} aria-label="Step one tick">
              <StepForward className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          )}
        </Tooltip>
      </div>
      <div className="mt-2 grid grid-cols-3 gap-1">
        {SPEEDS.map((s) => (
          <button
            key={s}
            onClick={() => setSpeed(s)}
            className={`${BTN} text-center ${clock.speed === s ? "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900" : ""}`}
          >
            {s}x
          </button>
        ))}
        <button
          onClick={() => setSpeed("realtime")}
          title="1x realistic shift — genuine wall-clock pace (D-84)"
          className={`${BTN} text-center ${clock.speed === "realtime" ? "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900" : ""}`}
        >
          1× real
        </button>
      </div>
      <div className="mt-3 flex items-center gap-2">
        <Tooltip label="Seed for the deterministic run — the same seed replays identically">
          {(tip) => (
            <input
              {...tip}
              value={seedText}
              onChange={(e) => setSeedText(e.target.value)}
              aria-label="Simulation seed"
              className="w-24 rounded-md border border-slate-300 bg-white px-2 py-1 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
            />
          )}
        </Tooltip>
        <Tooltip label="Restart the simulation from this seed">
          {(tip) => (
            <button
              {...tip}
              className={BTN}
              aria-label="Reset simulation to seed"
              onClick={() => reset(Number(seedText) || clock.seed)}
            >
              <RotateCcw className="mr-1 inline h-3.5 w-3.5" aria-hidden="true" />
              Reset
            </button>
          )}
        </Tooltip>
      </div>
      <button
        type="button"
        onClick={startGlobalTuasScenario}
        className="mt-3 w-full rounded-md bg-[#2a78d6] px-3 py-2 text-xs font-medium text-white hover:bg-[#2368bd]"
      >
        Run Monsoon Crisis Scenario
      </button>
      <p className="mt-1 text-[10px] leading-snug text-slate-500 dark:text-slate-400">
        Suspends Tuas ops and blocks the Bay of Bengal corridor · seed-locked · AI advises, human approves.
      </p>
    </div>
  );
}

const PANEL_WIDTH = 320;
const SIDEBAR_WIDTH = 240;

/**
 * A first-open position that blocks nothing important: clear of the sidebar
 * navigation on the left, clear of the map's "Zoom to Singapore" button at the
 * canvas top-left, and clear of its zoom controls at the bottom-right.
 *
 * Computed rather than constant so it stays sensible on any window size; once
 * the user drags the panel their position wins.
 */
function defaultPosition(): PanelPosition {
  if (typeof window === "undefined") return { x: SIDEBAR_WIDTH + 16, y: 96 };
  return {
    x: Math.max(16, Math.min(SIDEBAR_WIDTH + 16, window.innerWidth - PANEL_WIDTH - 16)),
    y: Math.max(96, window.innerHeight - 430),
  };
}

/**
 * The Simulation overlay: the same controls, in a movable window opened from the
 * existing Simulation button in the header.
 *
 * Mounted whether or not it is open, so the panel remembers where the user put
 * it between openings. Closing it does not pause, reset or otherwise touch the
 * simulation — it only hides the controls.
 */
export function DemoPanel({
  open,
  onClose,
  onNavigate,
}: {
  open: boolean;
  onClose: () => void;
  onNavigate: (view: ViewId) => void;
}) {
  const [position, setPosition] = useState<PanelPosition | null>(null);

  return (
    <MovablePanel
      title="Simulation"
      open={open}
      onClose={onClose}
      defaultPosition={defaultPosition()}
      position={position}
      onPositionChange={setPosition}
      width={PANEL_WIDTH}
    >
      <SimulationControls onNavigate={onNavigate} />
    </MovablePanel>
  );
}
