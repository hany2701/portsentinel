const LENGTH = Math.PI * 90;

// Semantics-free arc gauge (D-52): the caller decides the band colour and passes
// it as a Tailwind stroke token, so weather-risk (high = bad) and resilience
// (high = good) can share one component without inverted colours.
export function Gauge({ value, label, colorClass }: { value: number; label: string; colorClass: string }) {
  const clamped = Math.max(0, Math.min(100, value));
  const dash = (clamped / 100) * LENGTH;

  return (
    <div className="flex flex-col items-center">
      <svg viewBox="0 0 220 130" className="w-full max-w-[220px]" role="img" aria-label={`${label}: ${clamped}`}>
        <path
          d="M 20 110 A 90 90 0 0 1 200 110"
          fill="none"
          strokeWidth="16"
          strokeLinecap="round"
          className="stroke-slate-200 dark:stroke-slate-800"
        />
        <path
          d="M 20 110 A 90 90 0 0 1 200 110"
          fill="none"
          strokeWidth="16"
          strokeLinecap="round"
          strokeDasharray={`${dash} ${LENGTH}`}
          className={colorClass}
        />
        <text x="110" y="100" textAnchor="middle" className="fill-slate-900 text-3xl font-semibold dark:fill-slate-100" style={{ fontSize: 34 }}>
          {clamped}
        </text>
      </svg>
      <span className="text-xs text-slate-500 dark:text-slate-400">{label}</span>
    </div>
  );
}
