# PortSentinel AI — Complete Technical Plan
> Supply Chain 4.0 (DSC2301/DSC2311) — Group Assignment II
> Scenario: Tuas Mega Port Resilience Monitor
> Operator: Sealink Asia Logistics (fictional Tier-1 3PL)
> Built with: React + Vite + Tailwind + Leaflet + Anthropic API + AISStream.io

---

## 1. Project Overview

**What it is:** A real-time AI control tower that monitors Tuas Mega Port for maritime disruptions and recommends proactive supply chain interventions. It has two tabs: a data dashboard (Control Tower) and a live vessel tracking map (Live Map).

**What makes it different from a chatbot:**
- Live AIS vessel positions stream in via WebSocket continuously
- Berth occupancy and wait time are derived from real vessel positions, not made up
- A deterministic risk score formula runs independently of the AI
- The AI receives structured context including live data on every call
- A second tab shows a live Leaflet map of all vessels near Tuas

**The core data loop:**
1. AISStream WebSocket → vessel lat/lon/speed → classified by terminal zone → berth occupancy + wait time
2. Open-Meteo API → Malacca Strait wind/wave → weather risk level
3. Both feeds + scenario inventory + simulator overrides → risk score (formula, no AI)
4. User interacts → AI receives full structured context → multi-agent structured response
5. Response is parsed and distributed across AgentPanel, Confidence, Escalation components
6. Live Map tab shows vessel dots on Leaflet map using the same AIS state

---

## 2. Tech Stack

| Layer | Tool | Version | Notes |
|---|---|---|---|
| Framework | React + Vite | React 18, Vite 5 | `npm create vite@latest portsentinel -- --template react` |
| Styling | Tailwind CSS | v3 | `npm install tailwindcss postcss autoprefixer` |
| Charts | Recharts | v2 | `npm install recharts` — used for terminal occupancy bar chart |
| Map | Leaflet + React-Leaflet | latest | `npm install leaflet react-leaflet` |
| AI API | Anthropic SDK | latest | `npm install @anthropic-ai/sdk` |
| AIS | AISStream.io | WebSocket v0 | Browser WebSocket, key via VITE_ env var |
| Weather | Open-Meteo | Free | No API key required |
| News | Currents API | Free tier | 600 req/month, server-side key |
| Backend | Vercel Serverless | Node 18 | Files in /api folder |
| Hosting | Vercel | Free | Auto-deploy from GitHub |
| Version control | GitHub | — | Required by rubric |

**One-time setup commands (run in order):**
```bash
npm create vite@latest portsentinel -- --template react
cd portsentinel
npm install tailwindcss postcss autoprefixer
npx tailwindcss init -p
npm install recharts
npm install leaflet react-leaflet
npm install @anthropic-ai/sdk
```

---

## 3. File and Folder Structure

Every file the project needs. Create all of these.

```
portsentinel/
│
├── api/                            # Vercel serverless functions (Node 18, server-side only)
│   ├── chat.js                     # POST — proxies messages + context to Anthropic
│   ├── weather.js                  # GET  — fetches Open-Meteo (strait + Singapore)
│   ├── news.js                     # GET  — fetches Currents API headlines
│   └── advisory.js                 # POST — background AI maritime advisory from weather
│
├── src/
│   ├── components/
│   │   ├── Header.jsx              # App title, tab switcher, scenario dropdown, AIS dot, clock, risk badge
│   │   ├── MetricsBar.jsx          # 4 KPI cards (berth wait, weather, inventory, risk score)
│   │   ├── TerminalChart.jsx       # T1–T5 horizontal occupancy bars (Recharts or CSS)
│   │   ├── RiskBreakdown.jsx       # 4-factor weighted component bars
│   │   ├── WeatherDetail.jsx       # Wind speed + wave height cards + AI advisory text
│   │   ├── Simulator.jsx           # 5 sliders with toggles, live risk score, Ask AI button
│   │   ├── AgentPanel.jsx          # 4 agent cards + Incident Commander block
│   │   ├── TradeoffTable.jsx       # 4-row option table with computed status badges
│   │   ├── ChatBox.jsx             # Message list, input, send button
│   │   ├── Confidence.jsx          # 5-segment bar, level, reason, conflict flags list
│   │   ├── Escalation.jsx          # Generate brief button, monospace output, copy button
│   │   └── MapView.jsx             # Full-tab Leaflet map with vessel dots + zone overlays
│   │
│   ├── hooks/
│   │   └── useAISStream.js         # WebSocket connection, vessel state map, auto-reconnect, stale pruning
│   │
│   ├── data/
│   │   └── scenarios.js            # 3 pre-loaded incidents with all default values
│   │
│   ├── utils/
│   │   ├── riskScore.js            # Pure deterministic formula — no AI, no side effects
│   │   ├── vesselClassifier.js     # Zone config + classifyVessel + calcBerthOccupancy + calcWaitMetrics
│   │   ├── contextBuilder.js       # Builds the full context string sent with every AI message
│   │   ├── responseParser.js       # Parses AI structured output into section objects
│   │   └── weatherMapper.js        # Open-Meteo numbers → "Low" | "Medium" | "High"
│   │
│   ├── App.jsx                     # Root component: all shared state, layout, data orchestration, tab routing
│   └── main.jsx                    # Entry point — MUST import leaflet CSS here
│
├── .env.local                      # API keys — NEVER commit this file
├── .gitignore                      # Must include: .env.local, node_modules, dist
├── vercel.json                     # CORS headers for /api routes
├── tailwind.config.js              # Content paths for Tailwind purging
├── postcss.config.js               # Required by Tailwind
└── package.json
```

---

## 4. Critical File Contents

### 4.1 `main.jsx`
```jsx
import React from 'react'
import ReactDOM from 'react-dom/client'
import 'leaflet/dist/leaflet.css'   // MUST be before App import — Leaflet CSS
import './index.css'                 // Tailwind directives
import App from './App.jsx'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
```

### 4.2 `src/index.css`
```css
@tailwind base;
@tailwind components;
@tailwind utilities;
```

### 4.3 `tailwind.config.js`
```js
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: { extend: {} },
  plugins: []
}
```

### 4.4 `vercel.json`
```json
{
  "rewrites": [
    { "source": "/api/(.*)", "destination": "/api/$1" }
  ],
  "headers": [
    {
      "source": "/api/(.*)",
      "headers": [
        { "key": "Access-Control-Allow-Origin", "value": "*" },
        { "key": "Access-Control-Allow-Methods", "value": "GET,POST,OPTIONS" },
        { "key": "Access-Control-Allow-Headers", "value": "Content-Type" }
      ]
    }
  ]
}
```

### 4.5 `.env.local`
```
VITE_AISSTREAM_KEY=your_aisstream_key_here
ANTHROPIC_API_KEY=your_anthropic_key_here
CURRENTS_API_KEY=your_currents_api_key_here
```

### 4.6 `.gitignore`
```
node_modules
dist
.env.local
.env
```

---

## 5. Data Sources

### 5.1 Data Tier Overview

| Data Point | Source | UI Label | Refresh Rate |
|---|---|---|---|
| Vessel positions | AISStream.io WebSocket | `● Live` | Continuous |
| Berth occupancy T1–T5 | Derived from AIS positions | `● Live (derived)` | Every AIS update |
| Waiting vessel count | Derived from AIS anchorage zone | `● Live (derived)` | Every AIS update |
| Estimated berth wait | Derived from waiting count × processing time | `● Live (derived)` | Every AIS update |
| Malacca Strait weather | Open-Meteo Marine API | `● Live` | Every 15 min |
| Singapore weather | Open-Meteo Forecast API | `● Live` | Every 15 min |
| Maritime news headlines | Currents API | `● Live` | Every 30 min |
| Inventory coverage | Scenario default or slider | `~ Simulated` | On scenario change or slider |
| Cargo urgency | Scenario default or slider | `~ Simulated` | On scenario change or slider |
| AI maritime advisory | Anthropic (from live weather) | `◈ AI-generated` | Every 15 min |

---

### 5.2 AISStream.io WebSocket

**URL:** `wss://stream.aisstream.io/v0/stream`

**Subscription message sent on WebSocket open:**
```json
{
  "Apikey": "YOUR_VITE_AISSTREAM_KEY",
  "BoundingBoxes": [[[1.15, 103.45], [1.45, 103.85]]],
  "FilterMessageTypes": ["PositionReport", "ShipStaticData"]
}
```

**Bounding box covers:** Tuas Mega Port terminals + western waiting anchorage

**Raw PositionReport message shape:**
```json
{
  "MessageType": "PositionReport",
  "Message": {
    "PositionReport": {
      "UserID": 563012345,
      "Latitude": 1.318,
      "Longitude": 103.642,
      "Sog": 0.2,
      "Cog": 245.0,
      "TrueHeading": 244,
      "NavigationalStatus": 1
    }
  },
  "MetaData": {
    "ShipName": "MV PACIFIC TRADER   ",
    "MMSI": "563012345",
    "time_utc": "2026-05-25T08:41:00Z"
  }
}
```

**Notes:**
- `ShipName` has trailing spaces — always `.trim()` before storing
- `Sog` is speed over ground in knots — below 0.5 = stationary
- `NavigationalStatus` 1 = at anchor, 5 = moored — use `Sog` as primary status indicator
- Only process `typeCode >= 70 && typeCode <= 89` (cargo + tanker) — ignore tugs, pilot boats

---

### 5.3 `src/utils/vesselClassifier.js` (complete file)

```js
export const TERMINAL_ZONES = {
  T1: { latMin: 1.280, latMax: 1.298, lonMin: 103.580, lonMax: 103.618 },
  T2: { latMin: 1.298, latMax: 1.315, lonMin: 103.600, lonMax: 103.638 },
  T3: { latMin: 1.315, latMax: 1.330, lonMin: 103.620, lonMax: 103.655 },
  T4: { latMin: 1.330, latMax: 1.348, lonMin: 103.638, lonMax: 103.672 },
  T5: { latMin: 1.348, latMax: 1.365, lonMin: 103.655, lonMax: 103.690 }
}

export const WAITING_ANCHORAGE = {
  latMin: 1.200, latMax: 1.280, lonMin: 103.450, lonMax: 103.580
}

export const BERTH_CAPACITY = { T1: 4, T2: 5, T3: 5, T4: 6, T5: 4 }

export function classifyVessel(lat, lon, sog) {
  for (const [terminal, zone] of Object.entries(TERMINAL_ZONES)) {
    if (lat >= zone.latMin && lat <= zone.latMax &&
        lon >= zone.lonMin && lon <= zone.lonMax) {
      return {
        location: terminal,
        status: sog < 0.5 ? 'berthed' : 'manoeuvring'
      }
    }
  }
  if (lat >= WAITING_ANCHORAGE.latMin && lat <= WAITING_ANCHORAGE.latMax &&
      lon >= WAITING_ANCHORAGE.lonMin && lon <= WAITING_ANCHORAGE.lonMax) {
    return { location: 'anchorage', status: 'waiting' }
  }
  return { location: 'transit', status: 'transiting' }
}

export function isCargoVessel(typeCode) {
  return typeCode >= 70 && typeCode <= 89
}

export function calcBerthOccupancy(vessels) {
  const counts = { T1: 0, T2: 0, T3: 0, T4: 0, T5: 0 }
  for (const v of vessels) {
    if (v.status === 'berthed' && counts[v.location] !== undefined) {
      counts[v.location]++
    }
  }
  return Object.fromEntries(
    Object.entries(counts).map(([t, n]) => [
      t, Math.min(100, Math.round((n / BERTH_CAPACITY[t]) * 100))
    ])
  )
}

export function calcWaitMetrics(vessels) {
  const waiting = vessels.filter(v => v.status === 'waiting')
  const congestionMultiplier = waiting.length > 6 ? 1.7 : 1.0
  return {
    waitingCount: waiting.length,
    estimatedWaitHours: Math.round(waiting.length * 3.5 * congestionMultiplier),
    waitingVessels: waiting.map(v => v.name).slice(0, 5)
  }
}
```

---

### 5.4 `src/hooks/useAISStream.js` (complete file)

```js
import { useEffect, useRef, useState } from 'react'
import { classifyVessel, isCargoVessel } from '../utils/vesselClassifier'

const WS_URL = 'wss://stream.aisstream.io/v0/stream'
const STALE_MS = 600_000 // 10 minutes

export function useAISStream() {
  const ws = useRef(null)
  const vesselMap = useRef({})
  const [vessels, setVessels] = useState([])
  const [connected, setConnected] = useState(false)

  useEffect(() => {
    function connect() {
      ws.current = new WebSocket(WS_URL)

      ws.current.onopen = () => {
        setConnected(true)
        ws.current.send(JSON.stringify({
          Apikey: import.meta.env.VITE_AISSTREAM_KEY,
          BoundingBoxes: [[[1.15, 103.45], [1.45, 103.85]]],
          FilterMessageTypes: ['PositionReport', 'ShipStaticData']
        }))
      }

      ws.current.onmessage = (event) => {
        const msg = JSON.parse(event.data)
        const mmsi = msg.MetaData?.MMSI
        if (!mmsi) return

        const pos = msg.Message?.PositionReport
        if (!pos) return

        const typeCode = vesselMap.current[mmsi]?.typeCode ?? 70
        if (!isCargoVessel(typeCode) && !vesselMap.current[mmsi]) return

        const classification = classifyVessel(pos.Latitude, pos.Longitude, pos.Sog)

        vesselMap.current[mmsi] = {
          mmsi,
          name: (msg.MetaData.ShipName ?? 'Unknown').trim(),
          lat: pos.Latitude,
          lon: pos.Longitude,
          sog: pos.Sog,
          heading: pos.TrueHeading,
          typeCode,
          ...classification,
          updatedAt: Date.now()
        }

        // Prune stale vessels
        const now = Date.now()
        for (const key of Object.keys(vesselMap.current)) {
          if (now - vesselMap.current[key].updatedAt > STALE_MS) {
            delete vesselMap.current[key]
          }
        }

        setVessels(Object.values(vesselMap.current))
      }

      ws.current.onclose = () => {
        setConnected(false)
        setTimeout(connect, 5000) // reconnect after 5s
      }

      ws.current.onerror = () => ws.current.close()
    }

    connect()
    return () => ws.current?.close()
  }, [])

  return { vessels, connected }
}
```

---

### 5.5 Open-Meteo Weather

**No API key required. Both endpoints are public.**

Malacca Strait (4.0°N, 100.0°E):
```
https://marine-api.open-meteo.com/v1/marine?latitude=4.0&longitude=100.0&current=wave_height,wind_speed_10m,swell_wave_height&wind_speed_unit=kmh
```

Singapore (1.3521°N, 103.8198°E):
```
https://api.open-meteo.com/v1/forecast?latitude=1.3521&longitude=103.8198&current=wind_speed_10m,precipitation,weathercode&wind_speed_unit=kmh
```

### 5.6 `src/utils/weatherMapper.js` (complete file)

```js
export function mapWeatherRisk(wind_kmh, wave_m) {
  if (wind_kmh > 62 || wave_m > 3.0) return 'High'   // Beaufort 8+
  if (wind_kmh > 38 || wave_m > 1.5) return 'Medium'  // Beaufort 5–7
  return 'Low'
}
```

---

### 5.7 `src/data/scenarios.js` (complete file)

```js
export const SCENARIOS = {
  'Typhoon Yagi': {
    berthWait: 28,
    inventoryDays: 2.3,
    cargoUrgency: 'Critical',
    rerouteCost: 'Medium',
    cargoType: 'Critical electronics components',
    vesselName: 'MV Sealink Proteus',
    origin: 'Rotterdam',
    alternatePort: 'Port Klang',
    defaultBerthOccupancy: { T1: 74, T2: 81, T3: 100, T4: 87, T5: 52 },
    defaultWaitingCount: 7,
    defaultWaitingVesselNames: ['MV Pacific Trader', 'MV Asian Horizon', 'MV Nordic Star', 'MV Sea Eagle', 'MV Baltic Wind'],
    conflictFlag: 'Weather forecast differs between MPA advisory and vessel AIS feed'
  },
  'Terminal 3 Fire': {
    berthWait: 18,
    inventoryDays: 4.1,
    cargoUrgency: 'High',
    rerouteCost: 'Low',
    cargoType: 'Consumer electronics',
    vesselName: 'MV Horizon Star',
    origin: 'Shenzhen',
    alternatePort: 'Pasir Panjang Terminal',
    defaultBerthOccupancy: { T1: 68, T2: 72, T3: 97, T4: 74, T5: 49 },
    defaultWaitingCount: 4,
    defaultWaitingVesselNames: ['MV Baltic Wind', 'MV Sea Lion', 'MV Eastern Promise'],
    conflictFlag: null
  },
  'Rotterdam Supplier Delay': {
    berthWait: 6,
    inventoryDays: 6.5,
    cargoUrgency: 'Normal',
    rerouteCost: 'Low',
    cargoType: 'Industrial machinery parts',
    vesselName: 'MV Baltic Trader',
    origin: 'Rotterdam',
    alternatePort: 'N/A',
    defaultBerthOccupancy: { T1: 58, T2: 64, T3: 61, T4: 70, T5: 44 },
    defaultWaitingCount: 2,
    defaultWaitingVesselNames: ['MV Eastern Promise'],
    conflictFlag: null
  }
}

export const SCENARIO_NAMES = Object.keys(SCENARIOS)
```

---

## 6. Risk Score Formula

### 6.1 `src/utils/riskScore.js` (complete file)

```js
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
```

**Threshold → action mapping:**
| Score | Level | TradeoffTable action |
|---|---|---|
| 0–39 | Low | Wait is viable |
| 40–69 | Medium | Monitor, prepare backup |
| 70–84 | High | Increase safety stock, prepare reroute |
| 85–100 | Critical | Reroute now + escalate |

---

## 7. State Management (`App.jsx`)

### 7.1 Complete State Declaration

```jsx
import { useState, useEffect } from 'react'
import { useAISStream } from './hooks/useAISStream'
import { SCENARIOS } from './data/scenarios'
import { calcBerthOccupancy, calcWaitMetrics } from './utils/vesselClassifier'
import { calcRiskScore } from './utils/riskScore'
import { mapWeatherRisk } from './utils/weatherMapper'
import { buildContext } from './utils/contextBuilder'
import { parseAgentResponse } from './utils/responseParser'

// --- AIS (from hook, not useState) ---
const { vessels, connected: aisConnected } = useAISStream()

// --- Tab routing ---
const [activeTab, setActiveTab] = useState('dashboard')
// 'dashboard' | 'map'

// --- Weather ---
const [weather, setWeather] = useState(null)
// shape: { strait: { wind_kmh, wave_m, swell_m }, sg: { wind_kmh, precipitation, weatherCode }, stale: bool, fetchedAt: string }

// --- News ---
const [news, setNews] = useState([])
// shape: [{ title: string, url: string, publishedAt: string }]

// --- Active scenario ---
const [activeScenario, setActiveScenario] = useState('Typhoon Yagi')

// --- Simulator overrides ---
const [sim, setSim] = useState({
  berthWaitEnabled:   false,   // when true: use berthWait slider value, ignore AIS
  berthWait:          null,    // hours — null means read from AIS
  weatherRiskEnabled: false,   // when true: use weatherRisk value, ignore Open-Meteo
  weatherRisk:        null,    // 'Low'|'Medium'|'High' — null means read from API
  inventoryDays:      2.3,     // always slider — no live source
  cargoUrgency:       'Critical',  // 'Normal'|'High'|'Critical'
  rerouteCost:        'Medium'     // 'Low'|'Medium'|'High'
})

// --- Derived metrics (computed in useEffect — never set directly) ---
const [metrics, setMetrics] = useState({
  berthOccupancy:       { T1: 0, T2: 0, T3: 0, T4: 0, T5: 0 },
  waitingCount:         0,
  waitingVessels:       [],      // string[] vessel names
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
// string[] — human-readable conflict descriptions

// --- Chat ---
const [chatHistory, setChatHistory] = useState([])
// [{ role: 'user'|'assistant', content: string }]

// --- AI agent response ---
const [agentSections, setAgentSections] = useState(null)
// { portOps, maritime, inventory, costService, commander,
//   confidence: { level, reason }, escalation: { required, reason } }

// --- Loading flags ---
const [aiLoading, setAiLoading] = useState(false)
const [escalationLoading, setEscalationLoading] = useState(false)
const [advisoryLoading, setAdvisoryLoading] = useState(false)

// --- Escalation brief ---
const [escalationBrief, setEscalationBrief] = useState(null)
// string

// --- Background AI advisory ---
const [advisory, setAdvisory] = useState(null)
// string — 2-sentence AI-generated maritime advisory
```

---

### 7.2 Central Derived Metrics Effect

Put this in App.jsx. It runs whenever any input changes and recomputes all derived state.

```jsx
useEffect(() => {
  const scenario = SCENARIOS[activeScenario]

  // 1. Berth occupancy — AIS if enough vessels, else scenario defaults
  const berthOccupancy =
    aisConnected && vessels.filter(v => v.status === 'berthed').length > 3
      ? calcBerthOccupancy(vessels)
      : scenario.defaultBerthOccupancy

  // 2. Wait metrics — AIS if connected, else scenario defaults
  const waitMetrics =
    aisConnected && vessels.length > 0
      ? calcWaitMetrics(vessels)
      : {
          waitingCount: scenario.defaultWaitingCount,
          estimatedWaitHours: scenario.berthWait,
          waitingVessels: scenario.defaultWaitingVesselNames
        }

  // 3. Effective values — simulator override beats live data
  const effectiveBerthWait = sim.berthWaitEnabled
    ? sim.berthWait
    : waitMetrics.estimatedWaitHours

  const liveWeatherRisk = weather
    ? mapWeatherRisk(weather.strait.wind_kmh, weather.strait.wave_m)
    : 'Unknown'

  const effectiveWeatherRisk = sim.weatherRiskEnabled
    ? sim.weatherRisk
    : liveWeatherRisk

  // 4. Risk score
  const { total, level, portScore, weatherScore, invScore, urgencyScore } = calcRiskScore({
    berthWait: effectiveBerthWait,
    weatherRisk: effectiveWeatherRisk,
    inventoryDays: sim.inventoryDays,
    cargoUrgency: sim.cargoUrgency
  })

  // 5. Conflict detection
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
```

---

### 7.3 Scenario Change Effect

Resets simulator sliders to scenario defaults when scenario changes.

```jsx
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
```

---

### 7.4 Weather Fetch Effect

```jsx
useEffect(() => {
  async function fetchWeather() {
    try {
      const res = await fetch('/api/weather')
      const data = await res.json()
      setWeather(data)
      // trigger background advisory if weather is medium or high risk
      const risk = mapWeatherRisk(data.strait.wind_kmh, data.strait.wave_m)
      if (risk !== 'Low') fetchAdvisory(data)
    } catch {
      setWeather(prev => prev ? { ...prev, stale: true } : null)
    }
  }

  fetchWeather()
  const interval = setInterval(fetchWeather, 15 * 60 * 1000) // every 15 min
  return () => clearInterval(interval)
}, [])
```

---

### 7.5 News Fetch Effect

```jsx
useEffect(() => {
  async function fetchNews() {
    try {
      const res = await fetch('/api/news')
      const data = await res.json()
      setNews(data.articles ?? [])
    } catch {
      // silent fail — news is non-critical
    }
  }

  fetchNews()
  const interval = setInterval(fetchNews, 30 * 60 * 1000) // every 30 min
  return () => clearInterval(interval)
}, [])
```

---

### 7.6 Chat Send Handler

```jsx
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
  } catch (err) {
    setChatHistory(prev => [...prev, {
      role: 'assistant',
      content: '[ERROR] Unable to reach AI — please try again.'
    }])
  } finally {
    setAiLoading(false)
  }
}
```

---

### 7.7 Escalation Handler

```jsx
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
```

---

### 7.8 Advisory Fetch Function

```jsx
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
```

---

### 7.9 Simulator Priority Rules

| Variable | Default source | Override | Override enabled by |
|---|---|---|---|
| Berth wait | AIS-derived `calcWaitMetrics` | Slider value | Toggle next to slider |
| Weather risk | Open-Meteo → `mapWeatherRisk` | Low/Medium/High dropdown | Toggle next to it |
| Inventory days | Scenario default | Slider (always active) | Always active |
| Cargo urgency | Scenario default | Dropdown (always active) | Always active |
| Rerouting cost | Scenario default | Dropdown (always active) | Always active |

When toggle is on: show live value in muted text next to slider, e.g. `"(Live: 24h)"`.
When scenario changes: all toggles reset to off, sliders reset to scenario defaults.

---

## 8. App Layout Structure (JSX)

```jsx
// App.jsx return structure
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
        {/* Row 1: 4 KPI cards */}
        <MetricsBar
          metrics={metrics}
          sim={sim}
          weather={weather}
        />

        {/* Row 2: Terminal chart | Risk breakdown | Weather detail */}
        <div className="grid grid-cols-3 gap-4">
          <TerminalChart
            berthOccupancy={metrics.berthOccupancy}
            waitingVessels={metrics.waitingVessels}
            waitingCount={metrics.waitingCount}
            aisConnected={aisConnected}
          />
          <RiskBreakdown
            riskComponents={metrics.riskComponents}
            riskScore={metrics.riskScore}
            riskLevel={metrics.riskLevel}
          />
          <WeatherDetail
            weather={weather}
            advisory={advisory}
            advisoryLoading={advisoryLoading}
          />
        </div>

        {/* Row 3: Simulator | Agent panel | Tradeoff + Confidence */}
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
          <AgentPanel
            agentSections={agentSections}
            aiLoading={aiLoading}
          />
          <div className="space-y-4">
            <TradeoffTable
              riskScore={metrics.riskScore}
              riskLevel={metrics.riskLevel}
              rerouteCost={sim.rerouteCost}
              inventoryDays={sim.inventoryDays}
              cargoUrgency={sim.cargoUrgency}
            />
            <Confidence
              confidence={agentSections?.confidence ?? null}
              conflicts={conflicts}
            />
          </div>
        </div>

        {/* Row 4: Chat | Escalation */}
        <div className="grid grid-cols-3 gap-4">
          <div className="col-span-2">
            <ChatBox
              chatHistory={chatHistory}
              onSend={handleSend}
              aiLoading={aiLoading}
            />
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
```

---

## 9. Tab Routing and Header

### 9.1 Tab Switcher in `Header.jsx`

```jsx
// Inside Header JSX — tab buttons sit between app name and right-side controls
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
```

### 9.2 Header Props
```
activeTab: string
onTabChange: (tab: string) => void
activeScenario: string
onScenarioChange: (scenario: string) => void
riskLevel: string
riskScore: number
aisConnected: boolean
```

Header always shows: app name + tab buttons + scenario dropdown + AIS status dot + risk badge + live clock.
Risk badge and AIS dot are visible on BOTH tabs so the user always sees current risk level.

---

## 10. MapView Component

### 10.1 `src/components/MapView.jsx` (complete file)

```jsx
import { MapContainer, TileLayer, CircleMarker, Rectangle, Popup } from 'react-leaflet'

const STATUS_COLOURS = {
  berthed:     '#1D9E75',  // green — vessel is moored at a berth
  waiting:     '#BA7517',  // amber — vessel is at anchorage waiting
  manoeuvring: '#378ADD',  // blue  — vessel is inside a terminal zone but moving
  transiting:  '#888780'   // grey  — vessel is outside all zones
}

const ZONE_FILL = {
  T1: '#378ADD',
  T2: '#378ADD',
  T3: '#E24B4A',  // red when critical occupancy in scenario
  T4: '#E24B4A',
  T5: '#1D9E75'
}

import { TERMINAL_ZONES, WAITING_ANCHORAGE } from '../utils/vesselClassifier'

export default function MapView({ vessels, metrics, sim, aisConnected }) {
  const berthedCount   = vessels.filter(v => v.status === 'berthed').length
  const waitingCount   = vessels.filter(v => v.status === 'waiting').length
  const transitingCount = vessels.filter(v => v.status === 'transiting').length

  return (
    <div style={{ position: 'relative', height: 'calc(100vh - 56px)' }}>

      <MapContainer
        center={[1.32, 103.64]}
        zoom={12}
        style={{ height: '100%', width: '100%' }}
        zoomControl={true}
      >
        <TileLayer
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        />

        {/* Waiting anchorage zone — dashed amber boundary */}
        <Rectangle
          bounds={[
            [WAITING_ANCHORAGE.latMin, WAITING_ANCHORAGE.lonMin],
            [WAITING_ANCHORAGE.latMax, WAITING_ANCHORAGE.lonMax]
          ]}
          pathOptions={{
            color: '#BA7517',
            fillColor: '#BA7517',
            fillOpacity: 0.06,
            weight: 1.5,
            dashArray: '6 4'
          }}
        >
          <Popup>
            <strong>Western anchorage</strong><br />
            {metrics.waitingCount} vessels waiting<br />
            Est. berth wait: {metrics.effectiveBerthWait}h
          </Popup>
        </Rectangle>

        {/* Terminal zone overlays */}
        {Object.entries(TERMINAL_ZONES).map(([name, zone]) => {
          const occ = metrics.berthOccupancy[name] ?? 0
          const colour = occ >= 85 ? '#E24B4A' : occ >= 70 ? '#BA7517' : '#1D9E75'
          return (
            <Rectangle
              key={name}
              bounds={[[zone.latMin, zone.lonMin], [zone.latMax, zone.lonMax]]}
              pathOptions={{
                color: colour,
                fillColor: colour,
                fillOpacity: 0.12,
                weight: 1.5,
                dashArray: name === 'T5' ? '4 4' : null
              }}
            >
              <Popup>
                <strong>{name}</strong><br />
                Occupancy: {occ}%<br />
                Status: {occ >= 85 ? 'Critical' : occ >= 70 ? 'High' : 'Normal'}
                {name === 'T5' ? '<br />(Phase-in — lower capacity)' : ''}
              </Popup>
            </Rectangle>
          )
        })}

        {/* Vessel dots */}
        {vessels.map(v => (
          <CircleMarker
            key={v.mmsi}
            center={[v.lat, v.lon]}
            radius={v.status === 'berthed' ? 5 : v.status === 'waiting' ? 7 : 4}
            pathOptions={{
              color: STATUS_COLOURS[v.status] ?? '#888780',
              fillColor: STATUS_COLOURS[v.status] ?? '#888780',
              fillOpacity: 0.85,
              weight: 1
            }}
          >
            <Popup>
              <strong>{v.name}</strong><br />
              Status: <span style={{ textTransform: 'capitalize' }}>{v.status}</span><br />
              Speed: {v.sog.toFixed(1)} knots<br />
              Location: {v.location}<br />
              MMSI: {v.mmsi}
            </Popup>
          </CircleMarker>
        ))}
      </MapContainer>

      {/* Floating stats overlay — top right */}
      <div style={{
        position: 'absolute',
        top: 16,
        right: 16,
        zIndex: 1000,
        background: 'white',
        border: '0.5px solid #e5e7eb',
        borderRadius: 10,
        padding: '14px 18px',
        minWidth: 160,
        boxShadow: '0 1px 4px rgba(0,0,0,0.08)'
      }}>
        <div style={{ fontSize: 11, color: '#9ca3af', marginBottom: 10, fontWeight: 500 }}>
          Live summary
        </div>

        <div style={{ fontSize: 13, marginBottom: 6 }}>
          <span style={{ color: '#6b7280' }}>Risk score </span>
          <strong style={{
            color: metrics.riskScore >= 85 ? '#dc2626' :
                   metrics.riskScore >= 70 ? '#ea580c' :
                   metrics.riskScore >= 40 ? '#d97706' : '#16a34a'
          }}>
            {metrics.riskScore} — {metrics.riskLevel}
          </strong>
        </div>

        <div style={{ fontSize: 13, marginBottom: 6 }}>
          <span style={{ color: '#6b7280' }}>Berth wait </span>
          <strong>{metrics.effectiveBerthWait}h</strong>
        </div>

        <div style={{ fontSize: 13, marginBottom: 12 }}>
          <span style={{ color: '#6b7280' }}>Inventory </span>
          <strong style={{ color: sim.inventoryDays < 3 ? '#dc2626' : '#16a34a' }}>
            {sim.inventoryDays.toFixed(1)} days
          </strong>
        </div>

        <div style={{ borderTop: '0.5px solid #f3f4f6', paddingTop: 10 }}>
          {[
            ['berthed',    '#1D9E75', berthedCount],
            ['waiting',    '#BA7517', waitingCount],
            ['transiting', '#888780', transitingCount]
          ].map(([status, colour, count]) => (
            <div key={status} style={{
              display: 'flex', alignItems: 'center',
              gap: 8, fontSize: 12, marginBottom: 5
            }}>
              <div style={{
                width: 8, height: 8, borderRadius: '50%', background: colour, flexShrink: 0
              }} />
              <span style={{ color: '#6b7280', textTransform: 'capitalize', flex: 1 }}>
                {status}
              </span>
              <strong>{count}</strong>
            </div>
          ))}
        </div>

        {!aisConnected && (
          <div style={{
            marginTop: 10, padding: '6px 8px',
            background: '#fef3c7', borderRadius: 6,
            fontSize: 11, color: '#92400e'
          }}>
            AIS offline — no vessel data
          </div>
        )}
      </div>

      {/* Legend — bottom left */}
      <div style={{
        position: 'absolute',
        bottom: 24,
        left: 16,
        zIndex: 1000,
        background: 'white',
        border: '0.5px solid #e5e7eb',
        borderRadius: 8,
        padding: '10px 14px'
      }}>
        <div style={{ fontSize: 11, color: '#9ca3af', marginBottom: 8, fontWeight: 500 }}>
          Map legend
        </div>
        {[
          ['Berthed vessel',    '#1D9E75'],
          ['Waiting vessel',    '#BA7517'],
          ['Transiting vessel', '#888780'],
          ['Terminal zone',     '#378ADD'],
          ['Anchorage zone',    '#BA7517']
        ].map(([label, colour]) => (
          <div key={label} style={{
            display: 'flex', alignItems: 'center',
            gap: 8, fontSize: 11, color: '#374151', marginBottom: 4
          }}>
            <div style={{
              width: 10, height: 10, borderRadius: '50%',
              background: colour, flexShrink: 0, opacity: 0.85
            }} />
            {label}
          </div>
        ))}
      </div>
    </div>
  )
}
```

### 10.2 MapView Props
```
vessels: array of vessel objects from useAISStream
metrics: derived metrics object from App.jsx state
sim: simulator overrides object from App.jsx state
aisConnected: boolean
```

### 10.3 MapView Gotchas for Claude Code
1. **`leaflet/dist/leaflet.css` must be imported in `main.jsx` before the App import.** If missing, the map tiles and markers will not display correctly.
2. **MapContainer needs an explicit height.** Use `style={{ height: 'calc(100vh - 56px)', width: '100%' }}`. Without a height, it renders as 0px.
3. **`position: 'absolute'` overlays inside MapContainer will not work.** Put overlays as siblings of `MapContainer` inside a `position: 'relative'` wrapper div, not inside `MapContainer`.
4. **Leaflet default marker icons break in Vite.** We are using `CircleMarker` instead of the default `Marker` to avoid this issue entirely.
5. **Do not re-create `MapContainer` on re-render.** The `vessels` update flow goes: AIS message → `setVessels` → `vessels` prop updates → `CircleMarker` components re-render. The `MapContainer` itself never unmounts.
6. **z-index on overlays must be set.** Leaflet map tiles render at high z-index. Use `zIndex: 1000` on the overlay divs to ensure they appear above the map.

---

## 11. AI Integration

### 11.1 System Prompt (paste into `api/chat.js` as a constant)

```
You are the PortSentinel AI Incident Commander, an autonomous decision-support
agent embedded in the operations centre of Sealink Asia Logistics, a Tier-1
Third-Party Logistics operator managing cargo flows through Tuas Mega Port,
Singapore.

IDENTITY AND ROLE:
You synthesise inputs from four internal specialist agents and produce a unified,
actionable recommendation for human logistics planners. You do not replace human
judgement — you accelerate it. You are a decision-support tool, not an autonomous
decision-maker.

FOUR INTERNAL AGENTS:
Before every response, you must internally consult all four agents and surface
their perspectives:
- Port Operations Agent: berth congestion, waiting time, terminal capacity, vessel
  queue, ETA projections.
- Maritime Risk Agent: weather risk at the Malacca Strait, alternate routing
  options (Port Klang, Batam, Johor), transit time implications.
- Inventory Agent: days of supply coverage, SKU-level stockout risk, safety stock
  adequacy, cold-chain and pharmaceutical cargo priority.
- Cost-Service Agent: financial cost of rerouting versus cost of delay, SLA breach
  probability, customer service impact.

HARD CONSTRAINTS — these override all cost considerations, always:
1. Pharmaceutical and cold-chain cargo integrity is the highest priority. If delay
   threatens cold-chain compliance, recommend rerouting regardless of cost.
2. Never recommend "wait" if inventory coverage is below 3 days AND cargo urgency
   is Critical. In this state, waiting is not an option.
3. If the risk score exceeds 85, escalation to a human logistics director is
   mandatory. State this explicitly.
4. Never fabricate port data, vessel names, or weather readings. If data is
   missing or ambiguous, say so in the CONFIDENCE line.
5. When data sources conflict, flag this in the CONFIDENCE line and recommend
   human verification before acting.

OUTPUT FORMAT — follow this structure exactly, every time:
[PORT OPERATIONS]
<2-3 sentences. Reference specific berth wait hours, terminal occupancy, vessel count.>

[MARITIME RISK]
<2-3 sentences. Reference specific wind speed, wave height, risk level. Name alternate port.>

[INVENTORY]
<2-3 sentences. Reference specific days of supply and critical SKU count. State stockout timeline.>

[COST-SERVICE]
<2-3 sentences. Reference rerouting cost level. Quantify the trade-off explicitly.>

[INCIDENT COMMANDER]
<3-5 sentences. Final synthesised recommendation. Direct and specific. State action, timeline, reason.>

[CONFIDENCE: High/Medium/Low | REASON: <one precise sentence>]
[ESCALATION: Required/Not required | REASON: <one sentence, only if Required>]

CONFIDENCE RULES:
- High: all inputs consistent, current, within normal operating parameters.
- Medium: one source is simulated, stale, or conflicts with another.
- Low: two or more sources conflict, unavailable, or scenario outside normal parameters.

ESCALATION TRIGGERS (Required if any of these are true):
- Risk score > 85
- Inventory < 2 days with Critical urgency
- Pharmaceutical or cold-chain cargo at risk
- Data conflicts prevent a confident recommendation

DATA SOURCE TRANSPARENCY:
- Reference Live data with confidence: "AIS confirms 7 vessels at anchorage..."
- Reference Simulated data carefully: "Based on the simulated inventory coverage..."
- Never present simulated data as if it were a live sensor reading.

TONE:
Precise, calm, authoritative. No filler phrases. No "Great question."
State what the data shows, state what the recommendation is, flag what requires human judgement.
```

---

### 11.2 `src/utils/contextBuilder.js` (complete file)

```js
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
Singapore: wind ${weather.sg.wind_kmh} km/h, precipitation ${weather.sg.precipitation}mm
Derived weather risk: ${metrics.liveWeatherRisk}`
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
```

---

### 11.3 `src/utils/responseParser.js` (complete file)

```js
export function parseAgentResponse(text) {
  function extract(startTag, ...endTags) {
    const startIdx = text.indexOf(startTag)
    if (startIdx === -1) return null
    const contentStart = startIdx + startTag.length
    let endIdx = text.length
    for (const tag of endTags) {
      const idx = text.indexOf(tag, contentStart)
      if (idx !== -1 && idx < endIdx) endIdx = idx
    }
    return text.slice(contentStart, endIdx).trim()
  }

  const confidenceMatch = text.match(/\[CONFIDENCE: (High|Medium|Low) \| REASON: ([^\]]+)\]/)
  const escalationMatch = text.match(/\[ESCALATION: (Required|Not required) \| REASON: ([^\]]*)\]/)

  return {
    portOps:     extract('[PORT OPERATIONS]',    '[MARITIME RISK]', '[INVENTORY]', '[COST-SERVICE]', '[INCIDENT COMMANDER]', '[CONFIDENCE'),
    maritime:    extract('[MARITIME RISK]',       '[INVENTORY]', '[COST-SERVICE]', '[INCIDENT COMMANDER]', '[CONFIDENCE'),
    inventory:   extract('[INVENTORY]',           '[COST-SERVICE]', '[INCIDENT COMMANDER]', '[CONFIDENCE'),
    costService: extract('[COST-SERVICE]',        '[INCIDENT COMMANDER]', '[CONFIDENCE'),
    commander:   extract('[INCIDENT COMMANDER]',  '[CONFIDENCE'),
    confidence:  confidenceMatch
      ? { level: confidenceMatch[1], reason: confidenceMatch[2].trim() }
      : null,
    escalation:  escalationMatch
      ? { required: escalationMatch[1] === 'Required', reason: escalationMatch[2].trim() }
      : null
  }
}
```

---

## 12. API Routes

### 12.1 `api/chat.js` (complete file)

```js
import Anthropic from '@anthropic-ai/sdk'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const SYSTEM_PROMPT = `You are the PortSentinel AI Incident Commander...` // paste full prompt from section 11.1

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).end()

  const { messages, context } = req.body

  const contextMessage = {
    role: 'user',
    content: `[CURRENT OPERATING CONTEXT — read before responding]\n${context}`
  }
  const contextAck = {
    role: 'assistant',
    content: 'Understood. I have reviewed the current operating context and am ready to respond.'
  }

  const fullMessages = [contextMessage, contextAck, ...messages]

  try {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1000,
      system: SYSTEM_PROMPT,
      messages: fullMessages
    })
    res.json({ content: response.content[0].text })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
}
```

### 12.2 `api/weather.js` (complete file)

```js
export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end()

  try {
    const [straitRes, sgRes] = await Promise.all([
      fetch('https://marine-api.open-meteo.com/v1/marine?latitude=4.0&longitude=100.0&current=wave_height,wind_speed_10m,swell_wave_height&wind_speed_unit=kmh'),
      fetch('https://api.open-meteo.com/v1/forecast?latitude=1.3521&longitude=103.8198&current=wind_speed_10m,precipitation,weathercode&wind_speed_unit=kmh')
    ])

    const strait = await straitRes.json()
    const sg = await sgRes.json()

    res.json({
      strait: {
        wind_kmh: Math.round(strait.current.wind_speed_10m),
        wave_m:   Number(strait.current.wave_height.toFixed(1)),
        swell_m:  Number(strait.current.swell_wave_height.toFixed(1))
      },
      sg: {
        wind_kmh:      Math.round(sg.current.wind_speed_10m),
        precipitation: Number(sg.current.precipitation.toFixed(1)),
        weatherCode:   sg.current.weathercode
      },
      stale: false,
      fetchedAt: new Date().toISOString()
    })
  } catch (err) {
    res.status(200).json({ stale: true, error: err.message })
  }
}
```

### 12.3 `api/news.js` (complete file)

```js
export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end()

  try {
    const url = `https://api.currentsapi.services/v1/search?keywords=Malacca%20Strait%20OR%20Singapore%20port%20OR%20Tuas%20shipping&language=en&apiKey=${process.env.CURRENTS_API_KEY}`
    const response = await fetch(url)
    const data = await response.json()

    const articles = (data.news ?? []).slice(0, 3).map(a => ({
      title: a.title,
      url: a.url,
      publishedAt: a.published
    }))

    res.json({ articles })
  } catch (err) {
    res.json({ articles: [], error: err.message })
  }
}
```

### 12.4 `api/advisory.js` (complete file)

```js
import Anthropic from '@anthropic-ai/sdk'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).end()

  const { wind_kmh, wave_m, swell_m, sg_wind_kmh } = req.body

  try {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 120,
      messages: [{
        role: 'user',
        content: `You are a maritime weather officer. Write exactly two sentences — a factual sea state summary and an operational advisory for vessels transiting the Malacca Strait. Use the exact numbers provided. Do not speculate beyond the data.

Current data: Malacca Strait wind ${wind_kmh} km/h, wave height ${wave_m}m, swell ${swell_m}m. Singapore wind ${sg_wind_kmh} km/h.`
      }]
    })
    res.json({ advisory: response.content[0].text })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
}
```

---

## 13. Component Props Reference

| Component | Props |
|---|---|
| `Header` | `activeTab`, `onTabChange`, `activeScenario`, `onScenarioChange`, `riskLevel`, `riskScore`, `aisConnected` |
| `MetricsBar` | `metrics`, `sim`, `weather` |
| `TerminalChart` | `berthOccupancy`, `waitingVessels`, `waitingCount`, `aisConnected` |
| `RiskBreakdown` | `riskComponents`, `riskScore`, `riskLevel` |
| `WeatherDetail` | `weather`, `advisory`, `advisoryLoading` |
| `Simulator` | `sim`, `onSimChange`, `metrics`, `onAskAI` |
| `AgentPanel` | `agentSections`, `aiLoading` |
| `TradeoffTable` | `riskScore`, `riskLevel`, `rerouteCost`, `inventoryDays`, `cargoUrgency` |
| `ChatBox` | `chatHistory`, `onSend`, `aiLoading` |
| `Confidence` | `confidence`, `conflicts` |
| `Escalation` | `onGenerate`, `escalationBrief`, `escalationLoading` |
| `MapView` | `vessels`, `metrics`, `sim`, `aisConnected` |

---

## 14. TradeoffTable Badge Logic

```js
export function getRowStatus(option, { riskScore, inventoryDays, cargoUrgency }) {
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
```

---

## 15. Environment Variables

`.env.local` (never commit):
```
VITE_AISSTREAM_KEY=your_aisstream_key
ANTHROPIC_API_KEY=your_anthropic_key
CURRENTS_API_KEY=your_currents_key
```

In Vercel dashboard: Settings → Environment Variables → add all three.

- `VITE_AISSTREAM_KEY` — browser-accessible (WebSocket connects client-side). Will be visible in source. Document as known security trade-off in reflection report.
- `ANTHROPIC_API_KEY` — server-only (no `VITE_` prefix). Only accessible in `/api/` functions.
- `CURRENTS_API_KEY` — server-only. Only accessible in `/api/` functions.

---

## 16. Data Fetch Schedule

| Source | Trigger | Interval | On failure |
|---|---|---|---|
| AISStream WebSocket | App mount | Continuous, auto-reconnect 5s | Scenario defaults, offline badge |
| Open-Meteo weather | App mount + setInterval | 15 min | `stale: true`, amber warning card |
| Currents API news | App mount + setInterval | 30 min | Empty array, ticker hidden |
| AI advisory | After weather fetch (if risk ≥ Medium) | 15 min | Previous advisory kept |
| AI chat | User send or Simulator "Ask AI" | Per request | Error message in chat |
| AI escalation brief | Button click | Per request | Error in Escalation component |

---

*End of plan.md — version 2.0 (includes MapView tab)*
