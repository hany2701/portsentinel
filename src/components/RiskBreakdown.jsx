const levelColor = {
  Critical: 'text-red-600',
  High:     'text-orange-500',
  Medium:   'text-amber-500',
  Low:      'text-green-600'
}

export default function RiskBreakdown({ riskComponents, riskScore, riskLevel }) {
  const { portScore, weatherScore, invScore, urgencyScore } = riskComponents

  const bars = [
    { label: 'Port congestion', weight: '30%', score: portScore },
    { label: 'Weather risk',    weight: '25%', score: weatherScore },
    { label: 'Inventory risk',  weight: '25%', score: invScore },
    { label: 'Cargo urgency',   weight: '20%', score: urgencyScore }
  ]

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-4">
      <div className="text-sm font-semibold text-gray-800 mb-3">Risk breakdown</div>

      <div className="space-y-3">
        {bars.map(({ label, weight, score }) => (
          <div key={label}>
            <div className="flex justify-between text-xs text-gray-500 mb-1">
              <span>{label}</span>
              <span>{weight} · {score}</span>
            </div>
            <div className="w-full h-2 bg-gray-100 rounded-full">
              <div
                className="h-2 bg-blue-500 rounded-full transition-all duration-500"
                style={{ width: `${score}%` }}
              />
            </div>
          </div>
        ))}
      </div>

      <div className="mt-4 pt-3 border-t border-gray-100 flex items-center justify-between">
        <span className="text-sm text-gray-500">Total score</span>
        <span className={`text-xl font-bold ${levelColor[riskLevel] ?? 'text-gray-600'}`}>
          {riskScore} — {riskLevel}
        </span>
      </div>
      <div className="mt-1 text-xs text-gray-400">Port 30% · Weather 25% · Inventory 25% · Urgency 20%</div>
    </div>
  )
}
