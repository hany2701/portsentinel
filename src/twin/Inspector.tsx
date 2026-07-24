import { ArrowUpRight, Globe2, MessageSquare, X } from "lucide-react";
import { useSimStore } from "../store/simStore";
import { TUAS_VIEW_ZOOM, useMapViewStore } from "../store/mapViewStore";
import { yardBlockUtilisationPct } from "../sim";
import type { EntityRef, Recommendation, SimState } from "../sim";
import { useOpsStore } from "../store/opsStore";
import { operationsDestinations } from "../views/operations/routing";
import type { ViewId } from "../views/registry";
import { presentTwin } from "./presentation";

// Recommendations whose proposed effect touches this entity.
function relatedRecs(sim: SimState, ref: EntityRef): Recommendation[] {
  return sim.recommendations.filter((r) => {
    if (r.status !== "pending") return false;
    const e = r.proposedEffect;
    switch (ref.entityType) {
      case "vessel":
        return "vesselId" in e && e.vesselId === ref.entityId;
      case "berth":
        return ("toBerthId" in e && e.toBerthId === ref.entityId) || ("berthId" in e && e.berthId === ref.entityId);
      case "yardBlock":
        return e.kind === "reallocateYard" && e.toBlockId === ref.entityId;
      default:
        return false;
    }
  });
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3 py-0.5">
      <dt className="text-slate-500 dark:text-slate-400">{label}</dt>
      <dd className="text-right font-medium text-slate-800 dark:text-slate-100">{value}</dd>
    </div>
  );
}

// Detail rows + a natural-language question seed for the chat drawer.
function detail(sim: SimState, ref: EntityRef): { title: string; rows: [string, string][]; ask: string } | null {
  const pres = presentTwin(sim);
  if (ref.entityType === "vessel") {
    const v = sim.vessels.find((x) => x.id === ref.entityId);
    if (!v) return null;
    const teu = v.manifest.reduce((s, m) => s + m.quantityTEU, 0);
    return {
      title: `${v.name} (${v.id})`,
      rows: [
        ["Class", v.class],
        ["Status", pres.held[v.id] ? `${v.status} · held` : v.status],
        ["Length", `${v.lengthM} m`],
        ["Berth", v.berthId ?? "—"],
        ["Held until", v.heldUntilTick !== undefined && sim.clock.tick < v.heldUntilTick ? `tick ${v.heldUntilTick}` : "—"],
        ["Pilot/tug", v.pilotageWaiting ? "waiting" : v.status === "berthing" || v.status === "departing" ? "reserved" : "—"],
        ["Work progress", `${Math.round(v.workProgress * 100)}%`],
        ["Manifest", `${teu.toLocaleString()} TEU`],
      ],
      ask: `Tell me about vessel ${v.name} (${v.id}) — its current status and any action I should take.`,
    };
  }
  if (ref.entityType === "berth") {
    const b = sim.berths.find((x) => x.id === ref.entityId);
    if (!b) return null;
    const occupant = b.vesselId ? sim.vessels.find((v) => v.id === b.vesselId)?.name ?? b.vesselId : "—";
    return {
      title: `Berth ${b.id}`,
      rows: [
        ["Status", b.status],
        ["Finger", b.fingerId],
        ["Deep-water", b.deepWater ? "yes" : "no"],
        ["Length", `${b.lengthM} m`],
        ["Vessel", occupant],
        ["Cranes", `${b.craneIds.length} STS`],
      ],
      ask: `Tell me about berth ${b.id} — its status and any action I should take.`,
    };
  }
  if (ref.entityType === "crane") {
    const c = sim.cranes.find((x) => x.id === ref.entityId);
    if (!c) return null;
    const shown = pres.cranes[c.id]?.status ?? c.status;
    return {
      title: `${c.kind} ${c.id}`,
      rows: [
        ["Kind", c.kind],
        ["Status", shown === "suspended" ? "suspended (weather)" : shown],
        ["Location", c.locationId],
        ["Down until", c.downUntilTick ? `tick ${c.downUntilTick}` : "—"],
      ],
      ask: `Tell me about ${c.kind} crane ${c.id} at ${c.locationId} — its status and any impact on operations.`,
    };
  }
  if (ref.entityType === "yardBlock") {
    const b = sim.yardBlocks.find((x) => x.id === ref.entityId);
    if (!b) return null;
    const lots = sim.cargoLots.filter((l) => l.blockId === b.id && (l.status === "yard" || l.status === "discharging")).length;
    return {
      title: `Yard block ${b.id}`,
      rows: [
        ["Utilization", `${Math.round(yardBlockUtilisationPct(sim, b.id))}%`],
        ["Capacity", `${b.capacityTEU.toLocaleString()} TEU`],
        ["Reefer-powered", b.reeferPowered ? "yes" : "no"],
        ["Hazmat", b.hazmat ? "yes" : "no"],
        ["Active lots", String(lots)],
      ],
      ask: `Tell me about yard block ${b.id} — its utilization and whether it needs re-allocation.`,
    };
  }
  return null;
}

export function Inspector({ onNavigate }: { onNavigate: (view: ViewId) => void }) {
  const selection = useSimStore((s) => s.selection);
  const sim = useSimStore((s) => s.sim);
  const select = useSimStore((s) => s.select);
  const askAbout = useSimStore((s) => s.askAbout);
  const setOpsTab = useOpsStore((s) => s.setTab);
  const flyTo = useMapViewStore((s) => s.flyTo);
  const trackedVessel =
    selection?.entityType === "vessel"
      ? sim.vessels.find((v) => v.id === selection.entityId && v.scope !== undefined)
      : undefined;
  if (!selection) return null;
  const info = detail(sim, selection);
  if (!info) return null;
  const recs = relatedRecs(sim, selection);
  // Twin → Operations: preserve the shared selection, route to the tab(s) this
  // entity is relevant to, and navigate only on explicit action.
  const destinations = operationsDestinations(sim, selection);

  return (
    <aside className="absolute right-4 top-4 z-10 w-72 rounded-lg border border-slate-200 bg-white/95 p-4 shadow-lg backdrop-blur dark:border-slate-700 dark:bg-slate-900/95">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs uppercase tracking-wide text-slate-400">{selection.entityType}</p>
          <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">{info.title}</h3>
        </div>
        <button type="button" aria-label="Close inspector" onClick={() => select(null)} className="rounded-md p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800">
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>

      <dl className="mt-3 space-y-0 text-xs">
        {info.rows.map(([l, v]) => (
          <Row key={l} label={l} value={v} />
        ))}
      </dl>

      {recs.length > 0 && (
        <div className="mt-3 border-t border-slate-200 pt-2 dark:border-slate-700">
          <p className="mb-1 text-xs font-medium text-slate-500 dark:text-slate-400">Related recommendations</p>
          {recs.map((r) => (
            <p key={r.id} className="text-xs text-slate-700 dark:text-slate-200">• {r.title}</p>
          ))}
        </div>
      )}

      {/* GR-5: the inverse of the map's "Open in Tuas twin" — a tracked vessel
          can be followed back out to its geographic route. Offered only for
          vessels the maritime engine owns; the 22 Tuas baseline vessels have no
          position in that frame. */}
      {selection.entityType === "vessel" && trackedVessel && (
        <button
          type="button"
          onClick={() => {
            if (trackedVessel.track) {
              flyTo([trackedVessel.track.longitude, trackedVessel.track.latitude], TUAS_VIEW_ZOOM);
            }
            onNavigate("maritime");
          }}
          className="mt-3 inline-flex w-full items-center justify-center gap-1.5 rounded-md border border-slate-300 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
        >
          <Globe2 className="h-3.5 w-3.5" aria-hidden="true" />
          View on Maritime map
        </button>
      )}

      {destinations.length > 0 && (
        <div className="mt-3 space-y-1.5">
          {destinations.map((d) => (
            <button
              key={d.tab}
              type="button"
              onClick={() => {
                setOpsTab(d.tab);
                onNavigate("operations");
              }}
              className="inline-flex w-full items-center justify-center gap-1.5 rounded-md border border-slate-300 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
              Open in {d.label}
            </button>
          ))}
        </div>
      )}

      <button
        type="button"
        onClick={() => askAbout(info.ask)}
        className="mt-3 inline-flex w-full items-center justify-center gap-1.5 rounded-md bg-[#2a78d6] px-3 py-2 text-xs font-medium text-white hover:bg-[#2368bd]"
      >
        <MessageSquare className="h-3.5 w-3.5" aria-hidden="true" />
        Ask PortSentinel about this
      </button>
    </aside>
  );
}
