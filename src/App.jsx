import { useState, useEffect } from 'react'
import { useAISStream } from './hooks/useAISStream'
import { SCENARIOS } from './data/scenarios'
import { calcBerthOccupancy, calcWaitMetrics } from './utils/vesselClassifier'
import { calcRiskScore } from './utils/riskScore'
import { mapWeatherRisk } from './utils/weatherMapper'
import { buildContext } from './utils/contextBuilder'
import { parseAgentResponse } from './utils/responseParser'
import Header from './components/Header'
import MetricsBar from './components/MetricsBar'
import TerminalChart from './components/TerminalChart'
import RiskBreakdown from './components/RiskBreakdown'
import WeatherDetail from './components/WeatherDetail'
import Simulator from './components/Simulator'
import AgentPanel from './components/AgentPanel'
import TradeoffTable from './components/TradeoffTable'
import ChatBox from './components/ChatBox'
import Confidence from './components/Confidence'
import Escalation from './components/Escalation'
import MapView from './components/MapView'

export default function App() {
  const { vessels, connected: aisConnected } = useAISStream()
  const [activeTab, setActiveTab] = useState('dashboard')
  const [weather, setWeather] = useState(null)
  const [news, setNews] = useState([])
  const [activeScenario, setActiveScenario] = useState('Live Data')

  const [sim, setSim] = useState({
    berthWaitEnabled:   false,
    berthWait:          0,
    weatherRiskEnabled: false,
    weatherRisk:        'Low',
    inventoryDays:      7,
    cargoUrgency:       'Normal',
    rerouteCost:        'Low'
  })

  const [metrics, setMetrics] = useState({
    berthOccupancy:       { T1: 0, T2: 0, T3: 0, T4: 0, T5: 0 },
    waitingCount:         0,
    waitingVessels:       [],
    estimatedWaitHours:   0,
    effectiveBerthWait:   0,
    liveWeatherRisk:      'Unknown',
    effectiveWeatherRisk: 'Unknown',
    riskScore:            0,
    riskLevel:            'Low',
    riskComponents:       { portScore: 0, weatherScore: 0, invScore: 0, urgencyScore: 0 }
  })

  const [conflicts, setConflicts] = useState([])
  const [chatHistory, setChatHistory] = useState([])
  const [agentSections, setAgentSections] = useState(null)
  const [aiLoading, setAiLoading] = useState(false)
  const [escalationLoading, setEscalationLoading] = useState(false)
  const [advisoryLoading, setAdvisoryLoading] = useState(false)
  const [escalationBrief, setEscalationBrief] = useState(null)
  const [advisory, setAdvisory] = useState(null)

  // Central derived metrics
  useEffect(() => {
    const scenario = SCENARIOS[activeScenario]
    const isLiveMode = scenario.liveMode === true

    const berthOccupancy =
      isLiveMode
        ? calcBerthOccupancy(vessels)
        : aisConnected && vessels.filter(v => v.status === 'berthed').length > 3
          ? calcBerthOccupancy(vessels)
          : scenario.defaultBerthOccupancy

    const waitMetrics =
      isLiveMode || (aisConnected && vessels.length > 0)
        ? calcWaitMetrics(vessels)
        : { waitingCount: scenario.defaultWaitingCount, estimatedWaitHours: scenario.berthWait, waitingVessels: scenario.defaultWaitingVesselNames }

    const effectiveBerthWait = sim.berthWaitEnabled ? sim.berthWait : waitMetrics.estimatedWaitHours
    const liveWeatherRisk = weather
      ? mapWeatherRisk(
          Math.max(weather.strait.wind_kmh, weather.sgStrait?.wind_kmh ?? 0),
          Math.max(weather.strait.wave_m,   weather.sgStrait?.wave_m   ?? 0)
        )
      : 'Unknown'
    const effectiveWeatherRisk = sim.weatherRiskEnabled ? sim.weatherRisk : liveWeatherRisk

    const { total, level, portScore, weatherScore, invScore, urgencyScore } = calcRiskScore({
      berthWait: effectiveBerthWait, weatherRisk: effectiveWeatherRisk,
      inventoryDays: sim.inventoryDays, cargoUrgency: sim.cargoUrgency
    })

    const newConflicts = []
    if (!aisConnected) newConflicts.push('AIS feed offline — using scenario default berth data')
    if (weather?.stale) newConflicts.push('Weather feed stale — API unreachable, showing last known values')
    if (sim.weatherRiskEnabled && weather && liveWeatherRisk !== sim.weatherRisk)
      newConflicts.push(`Weather override (${sim.weatherRisk}) conflicts with live data (${liveWeatherRisk})`)
    if (sim.berthWaitEnabled && aisConnected) {
      const diff = Math.abs(sim.berthWait - waitMetrics.estimatedWaitHours)
      if (diff > 8) newConflicts.push(`Simulated berth wait (${sim.berthWait}h) differs from AIS-derived (${waitMetrics.estimatedWaitHours}h) by ${diff}h`)
    }

    setMetrics({ berthOccupancy, ...waitMetrics, effectiveBerthWait, liveWeatherRisk, effectiveWeatherRisk, riskScore: total, riskLevel: level, riskComponents: { portScore, weatherScore, invScore, urgencyScore } })
    setConflicts(newConflicts)
  }, [vessels, weather, sim, activeScenario, aisConnected])

  // Scenario change reset
  useEffect(() => {
    const scenario = SCENARIOS[activeScenario]
    setSim({ berthWaitEnabled: false, berthWait: scenario.berthWait, weatherRiskEnabled: !scenario.liveMode, weatherRisk: scenario.weatherRisk ?? 'Low', inventoryDays: scenario.inventoryDays, cargoUrgency: scenario.cargoUrgency, rerouteCost: scenario.rerouteCost })
    setEscalationBrief(null)
    setAgentSections(null)
    setChatHistory([])
  }, [activeScenario])

  // Weather fetch
  useEffect(() => {
    async function fetchWeather() {
      try {
        const res = await fetch('/api/weather')
        const data = await res.json()
        setWeather(data)
        const risk = mapWeatherRisk(data.strait.wind_kmh, data.strait.wave_m)
        if (risk !== 'Low') fetchAdvisory(data)
      } catch {
        setWeather(prev => prev ? { ...prev, stale: true } : null)
      }
    }
    fetchWeather()
    const interval = setInterval(fetchWeather, 15 * 60 * 1000)
    return () => clearInterval(interval)
  }, [])

  // News fetch
  useEffect(() => {
    async function fetchNews() {
      try {
        const res = await fetch('/api/news')
        const data = await res.json()
        setNews(data.articles ?? [])
      } catch { /* silent fail */ }
    }
    fetchNews()
    const interval = setInterval(fetchNews, 30 * 60 * 1000)
    return () => clearInterval(interval)
  }, [])

  async function handleSend(userMessage) {
    const userMsg = { role: 'user', content: userMessage }
    setChatHistory(prev => [...prev, userMsg])
    setAiLoading(true)
    try {
      const context = buildContext(metrics, sim, weather, vessels, activeScenario)
      const res = await fetch('/api/chat', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: [...chatHistory, userMsg], context })
      })
      const data = await res.json()
      const parsed = parseAgentResponse(data.content)
      setAgentSections(parsed)
      setChatHistory(prev => [...prev, { role: 'assistant', content: data.content }])
    } catch {
      setChatHistory(prev => [...prev, { role: 'assistant', content: '[ERROR] Unable to reach AI — please try again.' }])
    } finally {
      setAiLoading(false)
    }
  }

  async function handleEscalation() {
    setEscalationLoading(true)
    try {
      const context = buildContext(metrics, sim, weather, vessels, activeScenario)
      const scenario = SCENARIOS[activeScenario]
      const escalationPrompt = `Generate a formal escalation brief. Use only data from the current operating context. Format it exactly as follows — no other text:

ESCALATION BRIEF
Generated: ${new Date().toLocaleTimeString('en-SG', { hour: '2-digit', minute: '2-digit' })} SGT
Prepared by: PortSentinel AI Incident Commander

INCIDENT SUMMARY
Active incident: ${activeScenario}
Risk score: ${metrics.riskScore} — ${metrics.riskLevel}
Confidence: [derive from data quality]

CURRENT CONDITIONS
Berth wait: ${metrics.effectiveBerthWait}h
Weather risk: ${metrics.effectiveWeatherRisk}
Inventory coverage: ${sim.inventoryDays} days
Cargo urgency: ${sim.cargoUrgency}
Cargo at risk: ${scenario.cargoType}
Vessel of concern: ${scenario.vesselName}

RECOMMENDED ACTION
[2–3 sentence recommendation]

REASON FOR ESCALATION
[1–2 sentences — specific threshold or conflict]

DATA CONFIDENCE NOTES
[List any conflict flags or data quality issues]

ACTIONS REQUIRED FROM DIRECTOR
1. Approve or deny rerouting recommendation within 2 hours
2. Authorise emergency safety stock purchase order if inventory < 3 days
3. Notify customer service of potential SLA breach

— End of brief —`

      const res = await fetch('/api/chat', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: [{ role: 'user', content: escalationPrompt }], context })
      })
      const data = await res.json()
      setEscalationBrief(data.content)
    } catch {
      setEscalationBrief('[ERROR] Unable to generate brief — please try again.')
    } finally {
      setEscalationLoading(false)
    }
  }

  async function fetchAdvisory(weatherData) {
    setAdvisoryLoading(true)
    try {
      const res = await fetch('/api/advisory', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ wind_kmh: weatherData.strait.wind_kmh, wave_m: weatherData.strait.wave_m, swell_m: weatherData.strait.swell_m, sg_wind_kmh: weatherData.sg.wind_kmh })
      })
      const data = await res.json()
      setAdvisory(data.advisory)
    } catch { /* silent fail */ }
    finally { setAdvisoryLoading(false) }
  }

  const isLiveMode = SCENARIOS[activeScenario]?.liveMode === true

  const occupancySourceLabel = isLiveMode
    ? (aisConnected ? '● Live (AIS)' : '⚠ AIS offline')
    : aisConnected && vessels.filter(v => v.status === 'berthed').length > 3
      ? '● Live (AIS)'
      : '~ Scenario defaults'

  const berthWaitLabel = sim.berthWaitEnabled
    ? '~ Simulated'
    : isLiveMode
      ? (aisConnected ? '● Live (AIS)' : '⚠ AIS offline')
      : aisConnected && vessels.length > 0
        ? '● Live (AIS)'
        : '~ Scenario defaults'

  const weatherLabel = sim.weatherRiskEnabled
    ? '~ Simulated'
    : weather
      ? '● Live'
      : '— Unavailable'

  return (
    <div className="min-h-screen bg-gray-50">
      <Header
        activeTab={activeTab}
        onTabChange={setActiveTab}
        activeScenario={activeScenario}
        onScenarioChange={setActiveScenario}
        riskLevel={metrics.riskLevel}
        riskScore={metrics.riskScore}
        aisConnected={aisConnected}
      />

      {activeTab === 'dashboard' ? (
        <main className="p-4 space-y-4">
          <MetricsBar
            metrics={metrics}
            sim={sim}
            weather={weather}
            berthWaitLabel={berthWaitLabel}
            weatherLabel={weatherLabel}
          />

          <div className="grid grid-cols-3 gap-4">
            <TerminalChart
              berthOccupancy={metrics.berthOccupancy}
              waitingVessels={metrics.waitingVessels}
              waitingCount={metrics.waitingCount}
              aisConnected={aisConnected}
              sourceLabel={occupancySourceLabel}
            />
            <RiskBreakdown
              riskComponents={metrics.riskComponents}
              riskScore={metrics.riskScore}
              riskLevel={metrics.riskLevel}
            />
            <WeatherDetail weather={weather} advisory={advisory} advisoryLoading={advisoryLoading} />
          </div>

          <div className="grid grid-cols-3 gap-4">
            <Simulator
              sim={sim}
              onSimChange={(key, val) => setSim(prev => ({ ...prev, [key]: val }))}
              metrics={metrics}
              onAskAI={() => handleSend(
                `Based on current simulator settings — berth wait ${metrics.effectiveBerthWait}h, ` +
                `weather ${metrics.effectiveWeatherRisk}, inventory ${sim.inventoryDays} days, ` +
                `urgency ${sim.cargoUrgency} — provide your full assessment and recommendation.`
              )}
            />
            <AgentPanel agentSections={agentSections} aiLoading={aiLoading} />
            <div className="space-y-4">
              <TradeoffTable
                riskScore={metrics.riskScore}
                riskLevel={metrics.riskLevel}
                rerouteCost={sim.rerouteCost}
                inventoryDays={sim.inventoryDays}
                cargoUrgency={sim.cargoUrgency}
              />
              <Confidence confidence={agentSections?.confidence ?? null} conflicts={conflicts} />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div className="col-span-2">
              <ChatBox chatHistory={chatHistory} onSend={handleSend} aiLoading={aiLoading} />
            </div>
            <Escalation
              onGenerate={handleEscalation}
              escalationBrief={escalationBrief}
              escalationLoading={escalationLoading}
            />
          </div>
        </main>
      ) : (
        <MapView
          vessels={vessels}
          metrics={metrics}
          sim={sim}
          aisConnected={aisConnected}
        />
      )}
    </div>
  )
}
