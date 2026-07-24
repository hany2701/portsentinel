import { Menu, MessageSquare, Moon, SlidersHorizontal, Sun } from "lucide-react";
import { useSimStore } from "../store/simStore";
import { AlertBell } from "./AlertBell";
import { ScenarioControl } from "./ScenarioControl";
import { Tooltip } from "./Tooltip";

const ICON_BUTTON =
  "rounded-md p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200";

const LLM_HEALTH: Record<string, { dot: string; label: string }> = {
  unknown: { dot: "bg-slate-300 dark:bg-slate-600", label: "idle" },
  ok: { dot: "bg-[#1baf7a] dark:bg-[#199e70]", label: "online" },
  down: { dot: "bg-[#d03b3b]", label: "offline" },
};

export function Header({
  title,
  dark,
  onToggleDark,
  demoOpen,
  onToggleDemo,
  chatOpen,
  onToggleChat,
  onViewAllAlerts,
  onToggleSidebar,
}: {
  title: string;
  dark: boolean;
  onToggleDark: () => void;
  demoOpen: boolean;
  onToggleDemo: () => void;
  chatOpen: boolean;
  onToggleChat: () => void;
  onViewAllAlerts: () => void;
  onToggleSidebar: () => void;
}) {
  const llmHealth = useSimStore((s) => s.chat.llmHealth);
  const llm = LLM_HEALTH[llmHealth];
  const calibrationMode = useSimStore((s) => s.sim.calibrationMode);
  const setCalibrationMode = useSimStore((s) => s.setCalibrationMode);

  return (
    <header className="flex items-center justify-between gap-2 border-b border-slate-200 bg-white px-3 py-3 md:px-6 dark:border-slate-800 dark:bg-slate-900">
      <div className="flex min-w-0 items-center gap-2">
        <button
          type="button"
          aria-label="Toggle navigation"
          onClick={onToggleSidebar}
          className={`${ICON_BUTTON} md:hidden`}
        >
          <Menu className="h-4 w-4" aria-hidden="true" />
        </button>
        <h1 className="truncate text-lg font-semibold text-slate-900 dark:text-slate-100">{title}</h1>
      </div>
      <div className="flex items-center gap-2">
        <span className="mr-1 hidden items-center gap-1.5 text-xs text-slate-500 md:inline-flex dark:text-slate-400" title={`Assistant ${llm.label}`}>
          <span className={`h-1.5 w-1.5 rounded-full ${llm.dot}`} aria-hidden="true" />
          AI {llm.label}
        </span>
        <button
          type="button"
          onClick={() => setCalibrationMode(calibrationMode === "demo" ? "production" : "demo")}
          title="REAL-6 (D-84): toggle demo (compressed) vs production (real-world) doctrine thresholds"
          aria-pressed={calibrationMode === "production"}
          className={`mr-1 hidden items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium md:inline-flex ${
            calibrationMode === "production"
              ? "bg-[#2a78d6]/10 text-[#2a78d6] dark:text-[#5ea1f2]"
              : "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400"
          }`}
        >
          {calibrationMode === "production" ? "PRODUCTION" : "DEMO"}
        </button>
        <AlertBell onViewAll={onViewAllAlerts} />
        {/* Scenario controls sit between alerts and simulation: injecting a
            disruption is a global action, so it belongs beside the other global
            controls rather than inside one view. */}
        <ScenarioControl />
        <Tooltip label="Open the movable Simulation panel — clock, speed and seed" placement="bottom">
          {(tip) => (
            <button
              {...tip}
              type="button"
              aria-label="Toggle simulation panel"
              aria-pressed={demoOpen}
              className={`${ICON_BUTTON} ${demoOpen ? "bg-slate-100 dark:bg-slate-800" : ""}`}
              onClick={onToggleDemo}
            >
              <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />
            </button>
          )}
        </Tooltip>
        <Tooltip label="Ask PortSentinel about the current situation" placement="bottom">
          {(tip) => (
            <button
              {...tip}
              type="button"
              aria-label="Toggle chat drawer"
              aria-pressed={chatOpen}
              className={`${ICON_BUTTON} ${chatOpen ? "bg-slate-100 dark:bg-slate-800" : ""}`}
              onClick={onToggleChat}
            >
              <MessageSquare className="h-4 w-4" aria-hidden="true" />
            </button>
          )}
        </Tooltip>
        <Tooltip label={dark ? "Switch to light theme" : "Switch to dark theme"} placement="left">
          {(tip) => (
            <button {...tip} type="button" aria-label="Toggle dark mode" className={ICON_BUTTON} onClick={onToggleDark}>
              {dark ? <Sun className="h-4 w-4" aria-hidden="true" /> : <Moon className="h-4 w-4" aria-hidden="true" />}
            </button>
          )}
        </Tooltip>
      </div>
    </header>
  );
}
