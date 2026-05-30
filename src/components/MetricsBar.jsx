function berthColor(h) {
  if (h >= 36) return 'bg-red-500'
  if (h >= 24) return 'bg-orange-500'
  if (h >= 12) return 'bg-amber-500'
  return 'bg-green-500'
}
function weatherColor(r) {
  return r === 'High' ? 'bg-red-500' : r === 'Medium' ? 'bg-amber-500' : 'bg-green-500'
}
function invColor(d) {
  if (d < 3) return 'bg-red-500'
  if (d <= 5) return 'bg-amber-500'
  return 'bg-green-500'
}
function riskColor(s) {
  if (s >= 85) return 'bg-red-500'
  if (s >= 70) return 'bg-orange-500'
  if (s >= 40) return 'bg-amber-500'
  return 'bg-green-500'
}

function SourceTag({ label }) {
  if (!label) return null
  if (label.startsWith('○')) {
    return (
      <span className="flex items-center gap-1 text-xs text-red-500 font-medium">
        <span className="w-1.5 h-1.5 rounded-full bg-red-500 flex-shrink-0" />
        AIS offline
      </span>
    )
  }
  if (label.startsWith('●')) {
    return (
      <span className="flex items-center gap-1 text-xs text-green-600 font-medium">
        <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse flex-shrink-0" />
        {label.replace('● ', '')}
      </span>
    )
  }
  return <span className="text-xs text-gray-900">{label.replace(/^[~◈—]\s*/, '')}</span>
}

export default function MetricsBar({ metrics, sim, weather, berthWaitLabel, weatherLabel }) {
  const wrisk = metrics.effectiveWeatherRisk
  const wriskPct = wrisk === 'High' ? 100 : wrisk === 'Medium' ? 55 : 20

  const cards = [
    {
      label: 'Berth wait',
      source: berthWaitLabel ?? '● Live (AIS)',
      value: `${metrics.effectiveBerthWait}h`,
      barPct: Math.min(100, Math.round((metrics.effectiveBerthWait / 48) * 100)),
      barClass: berthColor(metrics.effectiveBerthWait),
      subtitle: `${metrics.waitingCount} vessels waiting`
    },
    {
      label: 'Weather risk',
      source: weatherLabel ?? (weather ? '● Live' : '— Unavailable'),
      value: wrisk,
      barPct: wriskPct,
      barClass: weatherColor(wrisk),
      subtitle: weather ? `Wind ${weather.strait.wind_kmh} km/h · Wave ${weather.strait.wave_m}m` : 'No data'
    },
    {
      label: 'Inventory coverage',
      source: '~ Simulated',
      value: `${sim.inventoryDays}d`,
      barPct: Math.min(100, Math.round((sim.inventoryDays / 14) * 100)),
      barClass: invColor(sim.inventoryDays),
      subtitle: `${sim.cargoUrgency} urgency`
    },
    {
      label: 'Risk score',
      source: '◈ Computed',
      value: `${metrics.riskScore}`,
      barPct: metrics.riskScore,
      barClass: riskColor(metrics.riskScore),
      subtitle: metrics.riskLevel
    }
  ]

  return (
    <div className="grid grid-cols-4 gap-4">
      {cards.map(c => (
        <div key={c.label} className="bg-white border border-gray-200 rounded-lg p-4">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs text-gray-500">{c.label}</span>
            <SourceTag label={c.source} />
          </div>
          <div className="text-2xl font-bold text-gray-900 mb-2">{c.value}</div>
          <div className="w-full h-1.5 bg-gray-100 rounded-full mb-2">
            <div className={`h-1.5 rounded-full transition-all duration-500 ${c.barClass}`} style={{ width: `${c.barPct}%` }} />
          </div>
          <div className="text-xs text-gray-500">{c.subtitle}</div>
        </div>
      ))}
    </div>
  )
}
