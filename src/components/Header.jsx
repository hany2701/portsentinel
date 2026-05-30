import { useState, useEffect } from 'react'
import { SCENARIO_NAMES } from '../data/scenarios'

export default function Header({ activeTab, onTabChange, activeScenario, onScenarioChange, riskLevel, riskScore, aisConnected }) {
  const [time, setTime] = useState('')

  useEffect(() => {
    const tick = () => setTime(new Date().toLocaleTimeString('en-SG', {
      hour: '2-digit', minute: '2-digit', second: '2-digit'
    }))
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [])

  const riskBadgeStyle = {
    Critical: 'bg-red-100 text-red-700 border-red-200',
    High:     'bg-orange-100 text-orange-700 border-orange-200',
    Medium:   'bg-amber-100 text-amber-700 border-amber-200',
    Low:      'bg-green-100 text-green-700 border-green-200'
  }[riskLevel] ?? 'bg-gray-100 text-gray-600 border-gray-200'

  return (
    <header className="bg-white border-b border-gray-200 px-4 py-2 flex items-center gap-4">
      <span className="font-bold text-gray-900 text-sm whitespace-nowrap">PortSentinel AI</span>

      <div className="flex gap-1">
        <button
          onClick={() => onTabChange('dashboard')}
          className={`px-4 py-1.5 text-sm rounded-md border transition-colors ${
            activeTab === 'dashboard'
              ? 'bg-gray-900 text-white border-gray-900'
              : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
          }`}
        >
          Control tower
        </button>
        <button
          onClick={() => onTabChange('map')}
          className={`px-4 py-1.5 text-sm rounded-md border transition-colors ${
            activeTab === 'map'
              ? 'bg-gray-900 text-white border-gray-900'
              : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
          }`}
        >
          Live map
        </button>
      </div>

      <select
        value={activeScenario}
        onChange={e => onScenarioChange(e.target.value)}
        className="text-sm border border-gray-200 rounded-md px-2 py-1.5 bg-white text-gray-700"
      >
        {SCENARIO_NAMES.map(name => (
          <option key={name} value={name}>{name}</option>
        ))}
      </select>

      <div className="flex-1" />

      <div className="flex items-center gap-1.5">
        <div className={`w-2 h-2 rounded-full ${aisConnected ? 'bg-green-500 animate-pulse' : 'bg-red-500'}`} />
        <span className="text-xs text-gray-500">{aisConnected ? 'AIS live' : 'AIS offline'}</span>
      </div>

      <span className={`text-xs font-semibold px-2 py-1 rounded-full border ${riskBadgeStyle}`}>
        {riskScore} — {riskLevel}
      </span>

      <span className="text-xs text-gray-400 font-mono">{time} SGT</span>
    </header>
  )
}
