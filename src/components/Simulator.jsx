export default function Simulator({ sim, onSimChange, metrics, onAskAI }) {
  const riskColor =
    metrics.riskScore >= 85 ? 'text-red-600' :
    metrics.riskScore >= 70 ? 'text-orange-500' :
    metrics.riskScore >= 40 ? 'text-amber-500' : 'text-green-600'

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-4">
      <div className="text-sm font-semibold text-gray-800 mb-4">Scenario simulator</div>

      <div className="space-y-4">
        {/* Berth wait */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs text-gray-600">Berth wait</span>
            <div className="flex items-center gap-2">
              {sim.berthWaitEnabled && (
                <span className="text-xs text-gray-400">(Live: {metrics.estimatedWaitHours}h)</span>
              )}
              <label className="flex items-center gap-1 text-xs text-gray-500 cursor-pointer">
                <input
                  type="checkbox"
                  checked={sim.berthWaitEnabled}
                  onChange={e => onSimChange('berthWaitEnabled', e.target.checked)}
                />
                override
              </label>
            </div>
          </div>
          <input
            type="range" min={0} max={48} step={1}
            value={sim.berthWait}
            disabled={!sim.berthWaitEnabled}
            onChange={e => onSimChange('berthWait', Number(e.target.value))}
            className="w-full accent-blue-600 disabled:opacity-40"
          />
          <div className="text-xs text-gray-500 text-right">{sim.berthWait}h</div>
        </div>

        {/* Weather risk */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs text-gray-600">Weather risk</span>
            <div className="flex items-center gap-2">
              {sim.weatherRiskEnabled && (
                <span className="text-xs text-gray-400">(Live: {metrics.liveWeatherRisk})</span>
              )}
              <label className="flex items-center gap-1 text-xs text-gray-500 cursor-pointer">
                <input
                  type="checkbox"
                  checked={sim.weatherRiskEnabled}
                  onChange={e => onSimChange('weatherRiskEnabled', e.target.checked)}
                />
                override
              </label>
            </div>
          </div>
          <div className="flex gap-1">
            {['Low', 'Medium', 'High'].map(level => (
              <button
                key={level}
                disabled={!sim.weatherRiskEnabled}
                onClick={() => onSimChange('weatherRisk', level)}
                className={`flex-1 text-xs py-1 rounded border transition-colors disabled:opacity-40 ${
                  sim.weatherRisk === level
                    ? 'bg-gray-800 text-white border-gray-800'
                    : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
                }`}
              >
                {level}
              </button>
            ))}
          </div>
        </div>

        {/* Inventory days */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs text-gray-600">Inventory coverage</span>
            <span className="text-xs text-gray-400">~ Simulated</span>
          </div>
          <input
            type="range" min={1} max={14} step={0.5}
            value={sim.inventoryDays}
            onChange={e => onSimChange('inventoryDays', Number(e.target.value))}
            className="w-full accent-blue-600"
          />
          <div className="text-xs text-gray-500 text-right">{sim.inventoryDays} days</div>
        </div>

        {/* Cargo urgency */}
        <div>
          <span className="text-xs text-gray-600 block mb-1">Cargo urgency</span>
          <div className="flex gap-1">
            {['Normal', 'High', 'Critical'].map(level => (
              <button
                key={level}
                onClick={() => onSimChange('cargoUrgency', level)}
                className={`flex-1 text-xs py-1 rounded border transition-colors ${
                  sim.cargoUrgency === level
                    ? 'bg-gray-800 text-white border-gray-800'
                    : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
                }`}
              >
                {level}
              </button>
            ))}
          </div>
        </div>

        {/* Rerouting cost */}
        <div>
          <span className="text-xs text-gray-600 block mb-1">Rerouting cost</span>
          <div className="flex gap-1">
            {['Low', 'Medium', 'High'].map(level => (
              <button
                key={level}
                onClick={() => onSimChange('rerouteCost', level)}
                className={`flex-1 text-xs py-1 rounded border transition-colors ${
                  sim.rerouteCost === level
                    ? 'bg-gray-800 text-white border-gray-800'
                    : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
                }`}
              >
                {level}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-4 pt-3 border-t border-gray-100">
        <div className="flex items-center justify-between">
          <span className="text-xs text-gray-500">Live risk score</span>
          <span className={`text-xl font-bold ${riskColor}`}>{metrics.riskScore} — {metrics.riskLevel}</span>
        </div>
        <div className="text-xs text-gray-400 mt-0.5">Port 30% · Weather 25% · Inventory 25% · Urgency 20%</div>
      </div>

      <button
        onClick={onAskAI}
        className="mt-3 w-full text-xs text-blue-600 border border-blue-200 rounded-md py-2 hover:bg-blue-50 transition-colors"
      >
        Ask AI about this scenario ↗
      </button>
    </div>
  )
}
