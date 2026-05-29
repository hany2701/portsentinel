function getRowStatus(option, { riskScore, inventoryDays, cargoUrgency }) {
  if (option === 'wait') {
    if (riskScore >= 85 || (inventoryDays < 3 && cargoUrgency === 'Critical'))
      return { label: 'Not viable', style: 'danger' }
    if (riskScore >= 70) return { label: 'Risky', style: 'warning' }
    return { label: 'Possible', style: 'neutral' }
  }
  if (option === 'reroute') {
    if (riskScore >= 85) return { label: 'Recommended', style: 'success' }
    if (riskScore >= 70) return { label: 'Prepare now', style: 'warning' }
    return { label: 'Optional', style: 'neutral' }
  }
  if (option === 'safetyStock') {
    if (inventoryDays < 3) return { label: 'Urgent', style: 'warning' }
    return { label: 'Monitor', style: 'neutral' }
  }
  if (option === 'escalate') {
    if (riskScore >= 85) return { label: 'Required', style: 'danger' }
    return { label: 'Not required', style: 'neutral' }
  }
}

const BADGE = {
  danger:  'bg-red-100 text-red-700',
  warning: 'bg-amber-100 text-amber-700',
  success: 'bg-green-100 text-green-700',
  neutral: 'bg-gray-100 text-gray-600'
}

const ROWS = [
  { key: 'wait',        option: 'Wait',             benefit: 'No immediate cost',        risk: 'Stockout if delay extends' },
  { key: 'reroute',     option: 'Reroute cargo',     benefit: 'Avoids port congestion',   risk: 'Higher freight cost' },
  { key: 'safetyStock', option: 'Build safety stock', benefit: 'Buffer against disruption', risk: 'Working capital tied up' },
  { key: 'escalate',    option: 'Escalate to director', benefit: 'Human oversight',        risk: 'Delay in decision-making' }
]

export default function TradeoffTable({ riskScore, riskLevel, rerouteCost, inventoryDays, cargoUrgency }) {
  const ctx = { riskScore, inventoryDays, cargoUrgency }

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-4">
      <div className="text-sm font-semibold text-gray-800 mb-3">Option trade-offs</div>
      <table className="w-full text-xs">
        <thead>
          <tr className="text-gray-400 border-b border-gray-100">
            <th className="text-left pb-2 font-medium">Option</th>
            <th className="text-left pb-2 font-medium">Benefit</th>
            <th className="text-left pb-2 font-medium">Risk</th>
            <th className="text-left pb-2 font-medium">Status</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-50">
          {ROWS.map(({ key, option, benefit, risk }) => {
            const status = getRowStatus(key, ctx)
            return (
              <tr key={key}>
                <td className="py-2 pr-2 text-gray-700 font-medium">{option}</td>
                <td className="py-2 pr-2 text-gray-500">{benefit}</td>
                <td className="py-2 pr-2 text-gray-500">{risk}</td>
                <td className="py-2">
                  <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${BADGE[status.style]}`}>
                    {status.label}
                  </span>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
