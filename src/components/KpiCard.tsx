import { TrendingDown, TrendingUp } from "lucide-react";
import { SourceTag, type SourceVariant } from "./SourceTag";

export type KpiTrend = { delta: number; improving: boolean };
export type KpiAccent = "success" | "warning" | "danger";

const ACCENT_BORDER: Record<KpiAccent, string> = {
  success: "border-l-4 border-l-[#1baf7a] dark:border-l-[#199e70]",
  warning: "border-l-4 border-l-[#eda100] dark:border-l-[#c98500]",
  danger: "border-l-4 border-l-[#d03b3b] dark:border-l-[#d03b3b]",
};

export function KpiCard({
  label,
  value,
  detail,
  detailTitle,
  detailAccent,
  source,
  mutedSource,
  trend,
  accent,
}: {
  label: string;
  value: string;
  /**
   * Supporting text under the value.
   *
   * A plain string wraps freely and reserves nothing — the original behaviour,
   * which the Operations tabs still use. An ARRAY is one explicit line per
   * entry and reserves a fixed two-line block, which is what a row of cards
   * needs to keep its provenance tags level: a wrapping string is 1, 2 or 4
   * lines depending on how wide the card happens to be, so the one card that
   * had a detail sat out of line with the rest of the row.
   */
  detail?: string | string[];
  /** Hover text for the detail block, when it carries more than the lines show. */
  detailTitle?: string;
  detailAccent?: boolean; // D-75: red detail line (e.g. doctrine breach)
  source: SourceVariant;
  mutedSource?: boolean; // neutralise the provenance dot so it recedes at rest
  trend?: KpiTrend;
  accent?: KpiAccent;
}) {
  return (
    // p-3 rather than p-4: at seven cards across, 16px of padding each side left
    // only 47px for the detail text once the provenance tag had taken its share
    // of the last line, so "avg 2.9 h" truncated to "avg 2.9…". Trimming the
    // padding gives the figures room without narrowing the card.
    <div className={`rounded-lg border border-slate-200 bg-white p-3 shadow-sm dark:border-slate-800 dark:bg-slate-900 ${accent ? ACCENT_BORDER[accent] : ""}`}>
      <p className="text-xs text-slate-500 dark:text-slate-400">{label}</p>
      <div className="mt-1 flex items-center gap-2">
        <p className="text-2xl font-semibold tabular-nums text-slate-900 dark:text-slate-100">{value}</p>
        {trend && trend.delta !== 0 && (
          <span className={`inline-flex items-center text-xs ${trend.improving ? "text-[#1baf7a] dark:text-[#199e70]" : "text-[#d03b3b]"}`}>
            {trend.delta > 0 ? (
              <TrendingUp className="h-3.5 w-3.5" aria-hidden="true" />
            ) : (
              <TrendingDown className="h-3.5 w-3.5" aria-hidden="true" />
            )}
            {Math.abs(trend.delta)}
          </span>
        )}
      </div>
      {/* Supporting lines on the left, provenance tag on the right, SHARING the
          block's last line — `items-end` puts the tag on the bottom line of the
          detail rather than on a row of its own beneath it. That is what levels
          "Simulated" with "max 2.2 h" and drops the extra row the tag used to
          occupy.
          The block is the SAME height on every card — two short lines —
          whether or not this card has anything to put in it, so the tag lands at
          one height right across the row instead of only the Vessels Waiting
          card sitting low. Each line is single-line-truncated, so the block is a
          known height at any card width rather than growing as text wraps.
          `title` keeps the full text available on hover. */}
      <div
        className={`mt-1 flex items-end justify-between gap-1.5 ${
          Array.isArray(detail) ? "min-h-[1.875rem]" : ""
        }`}
        title={detailTitle ?? (Array.isArray(detail) ? detail.join(" · ") : detail)}
      >
        <div className="min-w-0">
          {(Array.isArray(detail) ? detail : detail ? [detail] : []).map((line) => (
            <p
              key={line}
              className={`text-xs leading-tight ${Array.isArray(detail) ? "truncate" : ""} ${
                detailAccent ? "font-medium text-[#d03b3b]" : "text-slate-500 dark:text-slate-400"
              }`}
            >
              {line}
            </p>
          ))}
        </div>
        <div className="shrink-0 leading-tight">
          <SourceTag variant={source} muted={mutedSource} />
        </div>
      </div>
    </div>
  );
}
