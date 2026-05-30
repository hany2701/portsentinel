function barColor(pct) {
  if (pct >= 85) return 'bg-red-500'
  if (pct >= 70) return 'bg-amber-500'
  return 'bg-green-500'
}

export default function TerminalChart({ berthOccupancy, waitingVessels, waitingCount, aisConnected, sourceLabel }) {
  const shown = waitingVessels.slice(0, 3)
  const extra = waitingCount - shown.length

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-4">
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm font-semibold text-gray-800">Terminal occupancy</span>
        {sourceLabel?.startsWith('○')
          ? <span className="flex items-center gap-1 text-xs text-red-500 font-medium"><span className="w-1.5 h-1.5 rounded-full bg-red-500 flex-shrink-0" />AIS offline</span>
          : sourceLabel?.startsWith('●')
          ? <span className="flex items-center gap-1 text-xs text-green-600 font-medium"><span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse flex-shrink-0" />{sourceLabel.replace('● ', '')}</span>
          : <span className="text-xs text-gray-900">{(sourceLabel ?? '~ Scenario defaults').replace(/^[~◈—]\s*/, '')}</span>
        }
      </div>

      <div className="space-y-2.5">
        {['T1', 'T2', 'T3', 'T4', 'T5'].map(t => {
          const pct = berthOccupancy[t] ?? 0
          return (
            <div key={t} className="flex items-center gap-2">
              <span className="text-xs text-gray-500 w-5">{t}</span>
              <div className="flex-1 h-4 bg-gray-100 rounded-sm overflow-hidden">
                <div
                  className={`h-full transition-all duration-500 ${barColor(pct)}`}
                  style={{ width: `${pct}%` }}
                />
              </div>
              <span className="text-xs text-gray-600 w-8 text-right">{pct}%</span>
            </div>
          )
        })}
      </div>

      {waitingCount > 0 && (
        <div className="mt-3 pt-3 border-t border-gray-100">
          <div className="text-xs text-gray-500 mb-1">Waiting at anchorage ({waitingCount})</div>
          {shown.map(name => (
            <div key={name} className="text-xs text-gray-700">· {name}</div>
          ))}
          {extra > 0 && <div className="text-xs text-gray-400">+ {extra} more</div>}
        </div>
      )}
    </div>
  )
}
