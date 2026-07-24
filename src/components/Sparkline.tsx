export function Sparkline({ values, height = 40 }: { values: number[]; height?: number }) {
  if (values.length < 2) {
    return <div className="text-xs text-slate-400 dark:text-slate-500">Collecting trend…</div>;
  }
  const w = 200;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const points = values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * w;
      const y = height - ((v - min) / span) * (height - 4) - 2;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  return (
    <svg viewBox={`0 0 ${w} ${height}`} className="w-full" preserveAspectRatio="none" role="img" aria-label="Trend">
      <polyline
        points={points}
        fill="none"
        strokeWidth="2"
        className="stroke-[#2a78d6] dark:stroke-[#3987e5]"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
