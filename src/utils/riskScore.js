export function calcRiskScore({ berthWait, weatherRisk, inventoryDays, cargoUrgency }) {
  const portScore = Math.min(100, Math.round((berthWait / 48) * 100))

  const weatherMap = { Low: 20, Medium: 55, High: 90, Unknown: 50 }
  const weatherScore = weatherMap[weatherRisk] ?? 50

  const invScore = Math.max(0, Math.min(100,
    Math.round(((10 - inventoryDays) / 9) * 100)
  ))

  const urgencyMap = { Normal: 20, High: 60, Critical: 100 }
  const urgencyScore = urgencyMap[cargoUrgency] ?? 20

  const total = Math.round(
    portScore    * 0.30 +
    weatherScore * 0.25 +
    invScore     * 0.25 +
    urgencyScore * 0.20
  )

  const level =
    total >= 85 ? 'Critical' :
    total >= 70 ? 'High'     :
    total >= 40 ? 'Medium'   : 'Low'

  return { total, level, portScore, weatherScore, invScore, urgencyScore }
}

export function getRiskColour(level) {
  return {
    Critical: 'text-red-600',
    High:     'text-orange-500',
    Medium:   'text-amber-500',
    Low:      'text-green-600'
  }[level] ?? 'text-gray-500'
}

export function getRiskBg(level) {
  return {
    Critical: 'bg-red-50 border-red-200',
    High:     'bg-orange-50 border-orange-200',
    Medium:   'bg-amber-50 border-amber-200',
    Low:      'bg-green-50 border-green-200'
  }[level] ?? 'bg-gray-50 border-gray-200'
}
