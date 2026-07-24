export type SourceVariant = "live" | "stale" | "simulated" | "computed" | "ai" | "user";

const VARIANTS: Record<SourceVariant, { label: string; dot: string }> = {
  live: { label: "Live", dot: "bg-[#1baf7a] dark:bg-[#199e70]" },
  stale: { label: "Stale", dot: "bg-[#eda100] dark:bg-[#c98500]" },
  simulated: { label: "Simulated", dot: "bg-[#eda100] dark:bg-[#c98500]" },
  computed: { label: "Computed", dot: "bg-[#2a78d6] dark:bg-[#3987e5]" },
  ai: { label: "AI-generated", dot: "bg-violet-500" },
  user: { label: "User-initiated", dot: "bg-sky-500" }, // D-69: provenance user_input
};

export function SourceTag({ variant, muted }: { variant: SourceVariant; muted?: boolean }) {
  const v = VARIANTS[variant];
  // `muted` neutralises the dot colour (keeping the word) so a grid of provenance
  // tags reads as calm metadata rather than a field of amber/blue signals —
  // colour is then free to mean "exception" elsewhere. The label is unchanged, so
  // provenance stays fully explicit and accessible.
  const dot = muted ? "bg-slate-300 dark:bg-slate-600" : v.dot;
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
      <span className={`h-1.5 w-1.5 rounded-full ${dot}`} aria-hidden="true" />
      {v.label}
    </span>
  );
}
