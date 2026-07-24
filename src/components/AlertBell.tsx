import { useEffect, useRef, useState } from "react";
import { Bell, ChevronRight } from "lucide-react";
import { formatSimTime } from "../sim";
import type { AlertSeverity } from "../sim";
import { useSimStore } from "../store/simStore";

const DOT: Record<AlertSeverity, string> = {
  info: "bg-[#2a78d6] dark:bg-[#3987e5]",
  warning: "bg-[#eda100] dark:bg-[#c98500]",
  critical: "bg-[#d03b3b]",
};

// The unacknowledged accent bar down the left edge of a card. Colour carries the
// severity, presence carries "needs attention" — an acknowledged alert loses the
// bar entirely rather than only dimming, so the two states differ in shape as
// well as opacity.
const BAR: Record<AlertSeverity, string> = {
  info: "bg-[#2a78d6]",
  warning: "bg-[#eda100]",
  critical: "bg-[#d03b3b]",
};

export function AlertBell({ onViewAll }: { onViewAll: () => void }) {
  const [open, setOpen] = useState(false);
  const alerts = useSimStore((s) => s.sim.alerts);
  const ack = useSimStore((s) => s.acknowledgeAlert);
  const ackAll = useSimStore((s) => s.acknowledgeAllAlerts);
  const focusAlert = useSimStore((s) => s.focusAlert);
  const root = useRef<HTMLDivElement>(null);
  const unacked = alerts.filter((a) => !a.acknowledged).length;
  const recent = [...alerts].slice(-12).reverse();

  // Close on outside click and on Escape. The panel used to stay open until the
  // bell was clicked again, which meant it sat over the dashboard while you were
  // trying to read what it was telling you about.
  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Opening an alert hands its id to the Alerts view, which scrolls to it and
  // flashes it — so a click from here lands on the row you actually picked
  // rather than the top of a long table.
  const openAlert = (alertId: string) => {
    focusAlert(alertId);
    setOpen(false);
    onViewAll();
  };

  return (
    <div className="relative" ref={root}>
      <button
        type="button"
        aria-label={`Alerts${unacked ? `, ${unacked} unacknowledged` : ""}`}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="relative rounded-md p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200"
      >
        <Bell className="h-4 w-4" aria-hidden="true" />
        {unacked > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-[#d03b3b] px-1 text-[10px] font-medium text-white">
            {unacked}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 z-50 mt-2 w-[26rem] max-w-[calc(100vw-2rem)] rounded-xl border border-slate-200 bg-white shadow-xl dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center justify-between border-b border-slate-100 px-3 py-2.5 dark:border-slate-800">
            <div className="flex items-baseline gap-2">
              <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">Alerts</span>
              <span className="text-xs text-slate-400 dark:text-slate-500">
                {unacked > 0 ? `${unacked} unacknowledged` : "all acknowledged"}
              </span>
            </div>
            {unacked > 0 && (
              <button onClick={ackAll} className="text-xs text-[#2a78d6] hover:underline dark:text-[#3987e5]">
                Acknowledge all
              </button>
            )}
          </div>

          {recent.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-slate-500 dark:text-slate-400">No alerts.</p>
          ) : (
            <ul className="max-h-[26rem] space-y-1 overflow-y-auto p-2">
              {recent.map((a) => (
                <li key={a.id}>
                  {/* The whole row is the button — a card, not a line of text
                      with a link buried in it. The Ack control sits inside it
                      and stops propagation, so acknowledging never navigates. */}
                  <button
                    type="button"
                    onClick={() => openAlert(a.id)}
                    className={`group relative flex w-full items-start gap-2.5 overflow-hidden rounded-lg py-2 pl-3 pr-2 text-left transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/70 ${
                      a.acknowledged ? "opacity-60" : ""
                    }`}
                  >
                    {!a.acknowledged && (
                      <span className={`absolute inset-y-1 left-0 w-0.5 rounded-full ${BAR[a.severity]}`} aria-hidden="true" />
                    )}
                    <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${DOT[a.severity]}`} aria-hidden="true" />
                    <span className="min-w-0 flex-1">
                      <span className="block text-xs leading-snug text-slate-700 dark:text-slate-200">
                        {a.message}
                        {a.count > 1 && (
                          <span className="ml-1.5 rounded bg-slate-100 px-1 text-[10px] font-medium text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                            ×{a.count}
                          </span>
                        )}
                      </span>
                      <span className="mt-1 flex items-center gap-2 text-[11px] text-slate-400 dark:text-slate-500">
                        <span className="font-mono">{formatSimTime(a.tick * 5)}</span>
                        {a.entityRef && <span className="truncate font-mono">{a.entityRef.entityId}</span>}
                        {a.acknowledged && <span>· acknowledged</span>}
                      </span>
                    </span>
                    <span className="flex shrink-0 items-center gap-1 self-center">
                      {!a.acknowledged && (
                        <span
                          role="button"
                          tabIndex={0}
                          onClick={(e) => {
                            e.stopPropagation();
                            ack(a.id);
                          }}
                          onKeyDown={(e) => {
                            if (e.key !== "Enter" && e.key !== " ") return;
                            e.stopPropagation();
                            e.preventDefault();
                            ack(a.id);
                          }}
                          className="rounded-md border border-slate-200 px-1.5 py-0.5 text-[11px] text-[#2a78d6] hover:bg-white dark:border-slate-700 dark:text-[#3987e5] dark:hover:bg-slate-900"
                        >
                          Ack
                        </span>
                      )}
                      <ChevronRight
                        className="h-3.5 w-3.5 text-slate-300 transition-colors group-hover:text-slate-500 dark:text-slate-600 dark:group-hover:text-slate-400"
                        aria-hidden="true"
                      />
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div className="border-t border-slate-100 p-2 dark:border-slate-800">
            <button
              onClick={() => {
                setOpen(false);
                onViewAll();
              }}
              className="w-full rounded-lg py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              View all alerts
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
