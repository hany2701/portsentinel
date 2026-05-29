import { SCENARIOS } from '../data/scenarios'

export function buildContext(metrics, sim, weather, vessels, activeScenario) {
  const scenario = SCENARIOS[activeScenario]
  const now = new Date().toLocaleTimeString('en-SG', { hour: '2-digit', minute: '2-digit' })
  const hasOverrides = sim.berthWaitEnabled || sim.weatherRiskEnabled

  const aisBlock = vessels.length > 0
    ? `Vessels tracked in Tuas zone: ${vessels.length}
Berth occupancy: T1 ${metrics.berthOccupancy.T1}% | T2 ${metrics.berthOccupancy.T2}% | T3 ${metrics.berthOccupancy.T3}% | T4 ${metrics.berthOccupancy.T4}% | T5 ${metrics.berthOccupancy.T5}%
Vessels waiting at anchorage: ${metrics.waitingCount}
Known waiting vessels: ${metrics.waitingVessels.join(', ') || 'None identified'}
AIS-derived berth wait: ${metrics.estimatedWaitHours}h`
    : `AIS feed offline — scenario defaults in use
Default berth occupancy: T1 ${scenario.defaultBerthOccupancy.T1}% | T2 ${scenario.defaultBerthOccupancy.T2}% | T3 ${scenario.defaultBerthOccupancy.T3}% | T4 ${scenario.defaultBerthOccupancy.T4}% | T5 ${scenario.defaultBerthOccupancy.T5}%
Scenario default berth wait: ${scenario.berthWait}h`

  const weatherBlock = weather && !weather.stale
    ? `Malacca Strait: wind ${weather.strait.wind_kmh} km/h, wave ${weather.strait.wave_m}m, swell ${weather.strait.swell_m}m
Singapore Strait: wind ${weather.sgStrait?.wind_kmh ?? 'N/A'} km/h, wave ${weather.sgStrait?.wave_m ?? 'N/A'}m
Singapore: wind ${weather.sg.wind_kmh} km/h, precipitation ${weather.sg.precipitation}mm
Derived weather risk (worst-case across straits): ${metrics.liveWeatherRisk}`
    : weather?.stale
    ? `STALE DATA — weather API unreachable. Last known: wind ${weather.strait.wind_kmh} km/h, wave ${weather.strait.wave_m}m`
    : 'Weather data unavailable — API unreachable'

  const overrideLines = []
  if (sim.berthWaitEnabled)
    overrideLines.push(`Berth wait overridden to ${sim.berthWait}h (AIS-derived: ${metrics.estimatedWaitHours}h)`)
  if (sim.weatherRiskEnabled)
    overrideLines.push(`Weather risk overridden to ${sim.weatherRisk} (live: ${metrics.liveWeatherRisk})`)

  const overrideBlock = hasOverrides
    ? `[WHAT-IF SIMULATION ACTIVE]\n${overrideLines.join('\n')}\nTreat overridden values as hypothetical scenario inputs.`
    : '[NO SIMULATION OVERRIDES — all values reflect live or scenario data]'

  return `[LIVE AIS DATA — ${now} SGT]
${aisBlock}

[LIVE WEATHER — Open-Meteo]
${weatherBlock}

[EFFECTIVE OPERATING VALUES]
Berth wait (effective): ${metrics.effectiveBerthWait}h
Weather risk (effective): ${metrics.effectiveWeatherRisk}
Inventory coverage: ${sim.inventoryDays} days [SIMULATED — no live source]
Cargo urgency: ${sim.cargoUrgency} [SCENARIO INPUT]
Rerouting cost: ${sim.rerouteCost} [SCENARIO INPUT]
Risk score: ${metrics.riskScore} — ${metrics.riskLevel}

[SCENARIO CONTEXT]
Active incident: ${activeScenario}
Cargo type: ${scenario.cargoType}
Vessel of concern: ${scenario.vesselName} (origin: ${scenario.origin})
Alternate port: ${scenario.alternatePort}
${scenario.conflictFlag ? `Known data conflict: ${scenario.conflictFlag}` : 'No known data conflicts in this scenario'}

${overrideBlock}`.trim()
}
