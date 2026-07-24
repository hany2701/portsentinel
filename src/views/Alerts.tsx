import { useEffect, useRef, useState } from "react";
import { formatSimTime } from "../sim";
import type { AlertSeverity, EntityRef, EntityType } from "../sim";
import { useSimStore } from "../store/simStore";
import { Panel, PanelState } from "../components/Panel";
import type { ViewProps } from "./registry";

const DOT: Record<AlertSeverity, string> = {
  info: "bg-[#2a78d6] dark:bg-[#3987e5]",
  warning: "bg-[#eda100] dark:bg-[#c98500]",
  critical: "bg-[#d03b3b]",
};

const SEVERITIES: (AlertSeverity | "all")[] = ["all", "info", "warning", "critical"];
const ENTITY_TYPES: (EntityType | "all")[] = ["all", "vessel", "berth", "yardBlock", "crane", "gate", "cargoLot", "customer"];
const SPATIAL: EntityType[] = ["vessel", "berth", "yardBlock", "crane"];

export function Alerts({ onNavigate }: ViewProps) {
  const alerts = useSimStore((s) => s.sim.alerts);
  const ackAll = useSimStore((s) => s.acknowledgeAllAlerts);
  const ack = useSimStore((s) => s.acknowledgeAlert);
  const select = useSimStore((s) => s.select);
  const [severity, setSeverity] = useState<AlertSeverity | "all">("all");
  const [entityType, setEntityType] = useState<EntityType | "all">("all");

  // An alert opened from the header bell: scroll to it and flash it once. The
  // store value is consumed immediately so returning to this view later does
  // not replay the highlight, and the local id is cleared after the animation
  // so the class does not linger on the row.
  const alertFocus = useSimStore((s) => s.alertFocus);
  const consumeAlertFocus = useSimStore((s) => s.consumeAlertFocus);
  const [flashId, setFlashId] = useState<string | null>(null);
  const flashRow = useRef<HTMLTableRowElement>(null);

  useEffect(() => {
    if (!alertFocus) return;
    // Clear any filter that would hide the alert we were asked to show —
    // navigating to a row that is filtered out would land on nothing.
    setSeverity("all");
    setEntityType("all");
    setFlashId(alertFocus);
    consumeAlertFocus();
  }, [alertFocus, consumeAlertFocus]);

  useEffect(() => {
    if (!flashId) return;
    flashRow.current?.scrollIntoView({ block: "center", behavior: "smooth" });
    const timer = window.setTimeout(() => setFlashId(null), 1800);
    return () => window.clearTimeout(timer);
  }, [flashId]);

  const rows = [...alerts]
    .reverse()
    .filter((a) => severity === "all" || a.severity === severity)
    .filter((a) => entityType === "all" || a.entityRef?.entityType === entityType);

  // A linked entity navigates: spatial entities open selected in the twin, others
  // jump to Operations.
  const openEntity = (ref: EntityRef) => {
    if (SPATIAL.includes(ref.entityType)) {
      select(ref);
      onNavigate("twin");
    } else {
      onNavigate("operations");
    }
  };

  return (
    <div className="mx-auto max-w-7xl space-y-4 2xl:max-w-none">
      <Panel
        title={`Alert history (${alerts.length})`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {SEVERITIES.map((s) => (
              <button
                key={s}
                onClick={() => setSeverity(s)}
                className={`rounded-md border px-2 py-0.5 text-xs capitalize ${severity === s ? "border-slate-900 bg-slate-900 text-white dark:border-slate-100 dark:bg-slate-100 dark:text-slate-900" : "border-slate-300 text-slate-600 dark:border-slate-700 dark:text-slate-300"}`}
              >
                {s}
              </button>
            ))}
            <select
              value={entityType}
              onChange={(e) => setEntityType(e.target.value as EntityType | "all")}
              className="rounded-md border border-slate-300 bg-white px-2 py-0.5 text-xs text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
            >
              {ENTITY_TYPES.map((t) => (
                <option key={t} value={t}>{t === "all" ? "all entities" : t}</option>
              ))}
            </select>
            <button onClick={ackAll} className="text-xs text-[#2a78d6] dark:text-[#3987e5]">Acknowledge all</button>
          </div>
        }
      >
        {alerts.length === 0 ? (
          <PanelState text="No alerts yet." />
        ) : rows.length === 0 ? (
          <PanelState text="No alerts match these filters." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs text-slate-400 dark:border-slate-800 dark:text-slate-500">
                  <th className="py-2 font-normal">Severity</th>
                  <th className="py-2 font-normal">Message</th>
                  <th className="py-2 font-normal">Entity</th>
                  <th className="py-2 font-normal">Sim time</th>
                  <th className="py-2 font-normal">State</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((a) => (
                  <tr
                    key={a.id}
                    ref={a.id === flashId ? flashRow : undefined}
                    className={`border-b border-slate-100 text-slate-600 dark:border-slate-800/50 dark:text-slate-300 ${
                      a.id === flashId ? "alert-flash" : ""
                    }`}
                  >
                    <td className="py-2">
                      <span className="inline-flex items-center gap-1.5 capitalize">
                        <span className={`h-1.5 w-1.5 rounded-full ${DOT[a.severity]}`} aria-hidden="true" />
                        {a.severity}
                      </span>
                    </td>
                    <td className="py-2 pr-4">
                      {a.message}
                      {a.count > 1 && (
                        <span className="ml-1.5 rounded bg-slate-100 px-1 text-[10px] font-medium text-slate-500 dark:bg-slate-800 dark:text-slate-400">×{a.count}</span>
                      )}
                    </td>
                    <td className="py-2 font-mono text-xs">
                      {a.entityRef ? (
                        <button onClick={() => openEntity(a.entityRef!)} className="text-[#2a78d6] hover:underline dark:text-[#3987e5]" title="Open this entity">
                          {a.entityRef.entityId}
                        </button>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="py-2 font-mono text-xs">{formatSimTime(a.tick * 5)}</td>
                    <td className="py-2">
                      {a.acknowledged ? (
                        <span className="text-xs text-slate-400 dark:text-slate-500">acknowledged</span>
                      ) : (
                        <button onClick={() => ack(a.id)} className="text-xs text-[#2a78d6] dark:text-[#3987e5]">Acknowledge</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}
