import { useState, useEffect } from 'react'
import { useAISStream } from './hooks/useAISStream'
import { SCENARIOS } from './data/scenarios'
import { calcBerthOccupancy, calcWaitMetrics } from './utils/vesselClassifier'
import { calcRiskScore } from './utils/riskScore'
import { mapWeatherRisk } from './utils/weatherMapper'
import { buildContext } from './utils/contextBuilder'
import { parseAgentResponse } from './utils/responseParser'

export default function App() {
  // --- AIS ---
  const { vessels, connected: aisConnected } = useAISStream()

  // --- Tab routing ---
  const [activeTab, setActiveTab] = useState('dashboard')

  // --- Weather ---
  const [weather, setWeather] = useState(null)

  // --- News ---
  const [news, setNews] = useState([])

  // --- Active scenario ---
  const [activeScenario, setActiveScenario] = useState('Typhoon Yagi')

  // --- Simulator overrides ---
  const [sim, setSim] = useState({
    berthWaitEnabled:   false,
    berthWait:          28,
    weatherRiskEnabled: false,
    weatherRisk:        'Low',
    inventoryDays:      2.3,
    cargoUrgency:       'Critical',
    rerouteCost:        'Medium'
  })

  // --- Derived metrics ---
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

  // --- Conflict flags ---
  const [conflicts, setConflicts] = useState([])

  // --- Chat ---
  const [chatHistory, setChatHistory] = useState([])

  // --- AI agent response ---
  const [agentSections, setAgentSections] = useState(null)

  // --- Loading flags ---
  const [aiLoading, setAiLoading] = useState(false)
  const [escalationLoading, setEscalationLoading] = useState(false)
  const [advisoryLoading, setAdvisoryLoading] = useState(false)

  // --- Escalation brief ---
  const [escalationBrief, setEscalationBrief] = useState(null)

  // --- Background AI advisory ---
  const [advisory, setAdvisory] = useState(null)

  // --- Central derived metrics effect ---
  useEffect(() => {
    const scenario = SCENARIOS[activeScenario]

    const berthOccupancy =
      aisConnected && vessels.filter(v => v.status === 'berthed').length > 3
        ? calcBerthOccupancy(vessels)
        : scenario.defaultBerthOccupancy

    const waitMetrics =
      aisConnected && vessels.length > 0
        ? calcWaitMetrics(vessels)
        : {
            waitingCount: scenario.defaultWaitingCount,
            estimatedWaitHours: scenario.berthWait,
            waitingVessels: scenario.defaultWaitingVesselNames
          }

    const effectiveBerthWait = sim.berthWaitEnabled
      ? sim.berthWait
      : waitMetrics.estimatedWaitHours

    const liveWeatherRisk = weather
      ? mapWeatherRisk(weather.strait.wind_kmh, weather.strait.wave_m)
      : 'Unknown'

    const effectiveWeatherRisk = sim.weatherRiskEnabled
      ? sim.weatherRisk
      : liveWeatherRisk

    const { total, level, portScore, weatherScore, invScore, urgencyScore } = calcRiskScore({
      berthWait: effectiveBerthWait,
      weatherRisk: effectiveWeatherRisk,
      inventoryDays: sim.inventoryDays,
      cargoUrgency: sim.cargoUrgency
    })

    const newConflicts = []
    if (!aisConnected)
      newConflicts.push('AIS feed offline — using scenario default berth data')
    if (weather?.stale)
      newConflicts.push('Weather feed stale — API unreachable, showing last known values')
    if (sim.weatherRiskEnabled && weather && liveWeatherRisk !== sim.weatherRisk)
      newConflicts.push(`Weather override (${sim.weatherRisk}) conflicts with live data (${liveWeatherRisk})`)
    if (sim.berthWaitEnabled && aisConnected) {
      const diff = Math.abs(sim.berthWait - waitMetrics.estimatedWaitHours)
      if (diff > 8)
        newConflicts.push(`Simulated berth wait (${sim.berthWait}h) differs from AIS-derived (${waitMetrics.estimatedWaitHours}h) by ${diff}h`)
    }

    setMetrics({
      berthOccupancy,
      ...waitMetrics,
      effectiveBerthWait,
      liveWeatherRisk,
      effectiveWeatherRisk,
      riskScore: total,
      riskLevel: level,
      riskComponents: { portScore, weatherScore, invScore, urgencyScore }
    })

    setConflicts(newConflicts)

  }, [vessels, weather, sim, activeScenario, aisConnected])

  // --- Scenario change effect ---
  useEffect(() => {
    const scenario = SCENARIOS[activeScenario]
    setSim({
      berthWaitEnabled:   false,
      berthWait:          scenario.berthWait,
      weatherRiskEnabled: false,
      weatherRisk:        'Low',
      inventoryDays:      scenario.inventoryDays,
      cargoUrgency:       scenario.cargoUrgency,
      rerouteCost:        scenario.rerouteCost
    })
    setEscalationBrief(null)
    setAgentSections(null)
    setChatHistory([])
  }, [activeScenario])

  // --- Weather fetch effect ---
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

  // --- News fetch effect ---
  useEffect(() => {
    async function fetchNews() {
      try {
        const res = await fetch('/api/news')
        const data = await res.json()
        setNews(data.articles ?? [])
      } catch {
        // silent fail
      }
    }
    fetchNews()
    const interval = setInterval(fetchNews, 30 * 60 * 1000)
    return () => clearInterval(interval)
  }, [])

  // --- Chat send handler ---
  async function handleSend(userMessage) {
    const userMsg = { role: 'user', content: userMessage }
    setChatHistory(prev => [...prev, userMsg])
    setAiLoading(true)

    try {
      const context = buildContext(metrics, sim, weather, vessels, activeScenario)
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [...chatHistory, userMsg],
          context
        })
      })
      const data = await res.json()
      const assistantContent = data.content
      const parsed = parseAgentResponse(assistantContent)
      setAgentSections(parsed)
      setChatHistory(prev => [...prev, { role: 'assistant', content: assistantContent }])
    } catch {
      setChatHistory(prev => [...prev, {
        role: 'assistant',
        content: '[ERROR] Unable to reach AI — please try again.'
      }])
    } finally {
      setAiLoading(false)
    }
  }

  // --- Escalation handler ---
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
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [{ role: 'user', content: escalationPrompt }],
          context
        })
      })
      const data = await res.json()
      setEscalationBrief(data.content)
    } catch {
      setEscalationBrief('[ERROR] Unable to generate brief — please try again.')
    } finally {
      setEscalationLoading(false)
    }
  }

  // --- Advisory fetch ---
  async function fetchAdvisory(weatherData) {
    setAdvisoryLoading(true)
    try {
      const res = await fetch('/api/advisory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          wind_kmh: weatherData.strait.wind_kmh,
          wave_m: weatherData.strait.wave_m,
          swell_m: weatherData.strait.swell_m,
          sg_wind_kmh: weatherData.sg.wind_kmh
        })
      })
      const data = await res.json()
      setAdvisory(data.advisory)
    } catch {
      // silent fail
    } finally {
      setAdvisoryLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="text-center">
        <h1 className="text-2xl font-bold text-gray-800">PortSentinel AI</h1>
        <p className="mt-2 text-sm text-gray-500">
          Risk score: <strong>{metrics.riskScore}</strong> — {metrics.riskLevel}
        </p>
        <p className="text-sm text-gray-500">
          Scenario: {activeScenario} | AIS: {aisConnected ? 'connected' : 'offline'} ({vessels.length} vessels)
        </p>
      </div>
    </div>
  )
}
