import { DOCTRINE, dwellBuckets, type DwellBucket } from "../../sim";
import { useSimStore } from "../../store/simStore";
import { Panel, PanelState } from "../Panel";
import { SourceTag } from "../SourceTag";

const BUCKET_META: Record<DwellBucket["bucket"], { label: string; color: string }> = {
  normal: { label: `< ${DOCTRINE.cargo.dwellFlagDays}d`, color: "#1baf7a" },
  flagged: { label: `${DOCTRINE.cargo.dwellFlagDays}–${DOCTRINE.cargo.dwellEscalateDays}d`, color: "#eda100" },
  escalated: { label: `> ${DOCTRINE.cargo.dwellEscalateDays}d`, color: "#d03b3b" },
};
const ORDER: DwellBucket["bucket"][] = ["normal", "flagged", "escalated"];

// Yard dwell distribution against the doctrine thresholds (no new thresholds),
// high-priority lots separated so an escalating priority box is visible.
export function DwellPanel() {
  const sim = useSimStore((s) => s.sim);
  const buckets = dwellBuckets(sim);
  const totalLots = buckets.reduce((s, b) => s + b.count, 0);

  return (
    <Panel title="Dwell-Time Analysis" actions={<SourceTag variant="computed" />}>
      {totalLots === 0 ? (
        <PanelState text="No cargo currently dwelling in the yard." />
      ) : (
        <div className="space-y-2">
          {ORDER.map((bucketId) => {
            const high = buckets.find((b) => b.bucket === bucketId && b.priority === "high");
            const normal = buckets.find((b) => b.bucket === bucketId && b.priority === "normal");
            const count = (high?.count ?? 0) + (normal?.count ?? 0);
            const teu = (high?.teu ?? 0) + (normal?.teu ?? 0);
            const meta = BUCKET_META[bucketId];
            return (
              <div key={bucketId} className="flex items-center justify-between text-xs">
                <span className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-sm" style={{ background: meta.color }} aria-hidden="true" />
                  <span className="text-slate-600 dark:text-slate-300">{meta.label}</span>
                </span>
                <span className="font-mono text-slate-500 dark:text-slate-400">
                  {count} lot{count === 1 ? "" : "s"} · {teu} TEU
                  {high && high.count > 0 && (
                    <span className="ml-1 text-[#d03b3b]">({high.count} high-priority)</span>
                  )}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </Panel>
  );
}
