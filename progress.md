# PortSentinel AI — Build Progress Tracker
> Update this file as you work. Never skip a gate — it will cost more time later.
> Last updated: 2026-05-29
> Current phase: 4
> Vercel URL: https://portsentinel-nine.vercel.app
> GitHub repo: —

---

## Phase Overview

| Phase | Focus | Est. Time | Gate condition |
|---|---|---|---|
| 0 | Project setup + deploy pipeline | 1–2h | Empty app live on Vercel, /api/chat stub works |
| 1 | Data layer — AIS + weather + news | 3–4h | Console shows live vessels + real weather numbers |
| 2 | Business logic — state, formula, classifiers | 2–3h | Risk score updates live when values change |
| 3 | UI components — dashboard panels | 4–5h | Full dashboard visible, all panels render with data |
| 4 | MapView tab | 1–2h | Map shows vessel dots + zone overlays, tab switch works |
| 5 | AI integration | 2–3h | Chat returns structured multi-agent response |
| 6 | Simulator + live data wiring | 1–2h | Sliders override live data correctly |
| 7 | Error handling + fallbacks | 1–2h | App works gracefully when APIs are unreachable |
| 8 | Polish + final deploy | 1–2h | Live Vercel URL, clean GitHub, all scenarios work |

**Total estimate: 16–23 hours**

---

## Phase 0 — Project Setup and Deploy Pipeline

**Goal:** A blank React app is running locally and deployed to Vercel. The serverless function pipeline is confirmed working before any real code is written.

**Why this first:** If Vercel routing is broken or env vars are misconfigured, you want to know now — not after 15 hours of building.

### 0.1 Repository

- [ ] Create a new GitHub repository named `portsentinel`
- [ ] Clone it locally: `git clone https://github.com/YOUR_USERNAME/portsentinel.git`
- [ ] `cd portsentinel`

### 0.2 Project initialisation

- [x] `npm create vite@latest . -- --template react`  ← note the `.` to init in current folder
- [x] `npm install tailwindcss postcss autoprefixer`
- [x] `npx tailwindcss init -p`
- [x] `npm install recharts`
- [x] `npm install leaflet react-leaflet`
- [x] `npm install @anthropic-ai/sdk`
- [x] Confirm `package.json` has all five dependencies listed above

### 0.3 Config files

- [x] Replace contents of `src/index.css` with:
  ```css
  @tailwind base;
  @tailwind components;
  @tailwind utilities;
  ```
- [x] Replace contents of `tailwind.config.js` with:
  ```js
  export default {
    content: ["./index.html", "./src/**/*.{js,jsx}"],
    theme: { extend: {} },
    plugins: []
  }
  ```
- [x] Create `vercel.json` in the project root (copy from plan.md section 4.4)
- [x] Create `.env.local` in the project root with all three API keys (copy from plan.md section 4.5)
- [x] Create `.gitignore` with these lines:
  ```
  node_modules
  dist
  .env.local
  .env
  ```
- [x] Confirm `.gitignore` is working: `git status` must NOT show `.env.local`

### 0.4 Leaflet CSS — critical step

- [x] Open `src/main.jsx`
- [x] Add `import 'leaflet/dist/leaflet.css'` as the FIRST import, before everything else
- [x] Final `main.jsx` should look exactly like plan.md section 4.1

### 0.5 Vercel connection

- [x] `git add .`
- [x] `git commit -m "chore: project initialisation"`
- [x] `git push origin main`
- [x] Go to vercel.com → New Project → import your GitHub repo
- [x] In Vercel project settings → Environment Variables → add:
  - `VITE_AISSTREAM_KEY` = your AISStream key
  - `ANTHROPIC_API_KEY` = your Anthropic key
  - `CURRENTS_API_KEY` = your Currents API key
- [x] Trigger first deploy → confirm it succeeds (green checkmark)
- [x] Visit the Vercel URL → confirm the blank React app loads

### 0.6 Serverless function smoke test

- [x] Create `api/chat.js` with ONLY a stub response — no real Anthropic call yet:
  ```js
  export default async function handler(req, res) {
    res.json({ content: 'stub response — API route working' })
  }
  ```
- [x] Push to GitHub → Vercel auto-deploys
- [x] Open browser console on the Vercel URL and run:
  ```js
  fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages: [], context: 'test' })
  }).then(r => r.json()).then(console.log)
  ```
- [x] Confirm you see `{ content: 'stub response — API route working' }` in the console
- [ ] If you see a CORS error: check `vercel.json` headers are correct and redeploy

**Phase 0 gate:** Vercel URL loads blank app. `/api/chat` returns stub response. No errors in console. `.env.local` is NOT in git.

---

## Phase 1 — Data Layer

**Goal:** All three live data sources are confirmed working. Vessel objects and weather numbers are visible in the console before any UI is built.

**Why before UI:** You need to see what AIS data actually looks like for your bounding box before you build components to display it. Vessel density and zone accuracy cannot be assumed.

### 1.1 Vessel classifier utilities

- [x] Create `src/utils/vesselClassifier.js` — copy the complete file from plan.md section 5.3
- [x] Confirm the file exports: `TERMINAL_ZONES`, `WAITING_ANCHORAGE`, `BERTH_CAPACITY`, `classifyVessel`, `isCargoVessel`, `calcBerthOccupancy`, `calcWaitMetrics`

### 1.2 AIS WebSocket hook

- [x] Create `src/hooks/useAISStream.js` — copy the complete file from plan.md section 5.4
- [x] In `src/App.jsx`, add at the top of the component:
  ```jsx
  import { useAISStream } from './hooks/useAISStream'
  const { vessels, connected } = useAISStream()
  console.log('AIS vessels:', vessels.length, 'connected:', connected)
  ```
- [x] `npm run dev` and open localhost
- [x] Wait 30–60 seconds — watch the console for vessel objects appearing
- [x] Confirm vessel objects have these fields: `mmsi`, `name`, `lat`, `lon`, `sog`, `location`, `status`
- [x] Confirm `status` values are one of: `berthed`, `waiting`, `manoeuvring`, `transiting`
- [x] If `connected` stays `false`: check your `VITE_AISSTREAM_KEY` in `.env.local`
- [x] If all vessels show `status: 'transiting'`: your zone boundaries may need widening — expand each zone by 0.005 degrees in all directions in `TERMINAL_ZONES`
- [x] If fewer than 3 vessels appear after 2 minutes: the bounding box is correct but traffic is low — this is expected for Tuas during off-peak hours, scenario defaults will cover it
- [x] Remove the `console.log` line from App.jsx after confirming

### 1.3 Weather mapper utility

- [x] Create `src/utils/weatherMapper.js` — copy from plan.md section 5.6
- [x] Test it manually in browser console (after importing): `mapWeatherRisk(47, 2.1)` → should return `'Medium'`
- [x] Test edge cases: `mapWeatherRisk(70, 4.0)` → `'High'`, `mapWeatherRisk(10, 0.5)` → `'Low'`

### 1.4 Weather API route

- [x] Create `api/weather.js` — copy the complete file from plan.md section 12.2
- [x] Push to GitHub and wait for Vercel deploy
- [x] Test by visiting `YOUR_VERCEL_URL/api/weather` in the browser
- [x] Confirm response has: `strait.wind_kmh`, `strait.wave_m`, `strait.swell_m`, `sg.wind_kmh`, `stale: false`
- [x] If either fetch fails: check Open-Meteo API URLs are correct, they are public and require no key

### 1.5 News API route

- [x] Create `api/news.js` — copy the complete file from plan.md section 12.3
- [x] Confirm `CURRENTS_API_KEY` is set in Vercel environment variables
- [x] Push and test `YOUR_VERCEL_URL/api/news`
- [x] Confirm `articles` array is returned (may be empty if no relevant results — that is fine)
- [x] If 401 error: API key is missing or wrong in Vercel env vars

### 1.6 Advisory API route

- [x] Create `api/advisory.js` — copy the complete file from plan.md section 12.4
- [x] Push to GitHub
- [x] Test with a POST request from browser console:
  ```js
  fetch('/api/advisory', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ wind_kmh: 47, wave_m: 2.1, swell_m: 1.8, sg_wind_kmh: 22 })
  }).then(r => r.json()).then(console.log)
  ```
- [x] Confirm you receive `{ advisory: "Two sentence maritime advisory..." }`

### 1.7 Wire weather and news fetches in App.jsx

- [x] Add `weather` state and `news` state to App.jsx (see plan.md section 7.1)
- [x] Add the weather fetch useEffect from plan.md section 7.4
- [x] Add the news fetch useEffect from plan.md section 7.5
- [x] Add temporary `console.log(weather, news)` to confirm both arrive
- [x] Confirm in console: weather object has real numbers, news has articles
- [x] Remove console.log after confirming

**Phase 1 gate:** AIS vessels populate within 60 seconds. `/api/weather` returns real numbers. `/api/news` returns without error. `/api/advisory` returns two-sentence text. All confirmed via console or direct URL test.

---

## Phase 2 — Business Logic

**Goal:** All utility functions work correctly in isolation. Complete state shape is declared in App.jsx. Risk score responds to input changes.

### 2.1 Scenarios data file

- [x] Create `src/data/scenarios.js` — copy the complete file from plan.md section 5.7
- [x] Confirm it exports: `SCENARIOS` (object with 3 keys) and `SCENARIO_NAMES` (array of 3 strings)

### 2.2 Risk score utility

- [x] Create `src/utils/riskScore.js` — copy the complete file from plan.md section 6.1
- [x] Test in browser console (after importing in App.jsx temporarily):
  ```js
  // Expected: { total: 86, level: 'Critical', portScore: 58, weatherScore: 90, invScore: 86, urgencyScore: 100 }
  calcRiskScore({ berthWait: 28, weatherRisk: 'High', inventoryDays: 2.3, cargoUrgency: 'Critical' })
  ```
- [x] Test minimum: `calcRiskScore({ berthWait: 0, weatherRisk: 'Low', inventoryDays: 10, cargoUrgency: 'Normal' })` → total should be 4 (Low)
- [x] Test maximum: `calcRiskScore({ berthWait: 48, weatherRisk: 'High', inventoryDays: 1, cargoUrgency: 'Critical' })` → total should be 100 (Critical)

### 2.3 Context builder utility

- [x] Create `src/utils/contextBuilder.js` — copy the complete file from plan.md section 11.2
- [x] Import and test in App.jsx temporarily
- [x] Confirm the output string contains all 5 sections: LIVE AIS DATA, LIVE WEATHER, EFFECTIVE OPERATING VALUES, SCENARIO CONTEXT, override block
- [x] Remove the console.log after confirming

### 2.4 Response parser utility

- [x] Create `src/utils/responseParser.js` — copy the complete file from plan.md section 11.3
- [x] Confirm all 7 keys are present: `portOps`, `maritime`, `inventory`, `costService`, `commander`, `confidence`, `escalation`

### 2.5 Complete App.jsx state + central useEffect

- [x] Declare ALL state variables from plan.md section 7.1 in App.jsx
- [x] Add the central derived metrics useEffect from plan.md section 7.2
- [x] Add the scenario change useEffect from plan.md section 7.3
- [x] Add `activeTab` state: `const [activeTab, setActiveTab] = useState('dashboard')`
- [x] Verify: risk score 47 (Medium) confirmed live on Vercel with real AIS data

### 2.6 Implement all handlers in App.jsx

- [x] Add `handleSend` from plan.md section 7.6
- [x] Add `handleEscalation` from plan.md section 7.7
- [x] Add `fetchAdvisory` from plan.md section 7.8

**Phase 2 gate:** All utility functions tested. All state declared. Risk score changes when scenario changes. `buildContext` produces a valid string. `parseAgentResponse` correctly parses all 7 sections.

---

## Phase 3 — Dashboard UI Components

**Goal:** The full dashboard is visible with real data. All panels render correctly. No AI connected yet.

**Build order:** Header → MetricsBar → TerminalChart → RiskBreakdown → WeatherDetail → Simulator → AgentPanel → TradeoffTable → Confidence → ChatBox → Escalation

### 3.1 App layout skeleton

- [x] In `App.jsx` return statement, set up the full layout structure from plan.md section 8
- [x] Use placeholder `<div className="p-4 text-gray-400">ComponentName</div>` for each component
- [x] Confirm the layout grid renders correctly with no overlap or overflow at 1440px width

### 3.2 Header.jsx

- [x] Create `src/components/Header.jsx`
- [x] Renders: app name (PortSentinel AI), tab switcher (Control tower | Live map), scenario dropdown, AIS status dot, risk badge, live clock
- [x] Tab switcher code: copy from plan.md section 9.1
- [x] AIS status dot: green pulsing circle when `aisConnected = true`, grey static when false
- [x] Risk badge colour: red for Critical, orange for High, amber for Medium, green for Low
- [x] Live clock: use `setInterval` in a `useEffect` that calls `new Date().toLocaleTimeString('en-SG', { hour: '2-digit', minute: '2-digit', second: '2-digit' })`
- [x] Scenario dropdown: map over `SCENARIO_NAMES` from `scenarios.js` to render options
- [x] Confirm: clicking tab buttons calls `onTabChange` correctly
- [x] Confirm: changing scenario dropdown calls `onScenarioChange`
- [x] Confirm: clock ticks every second

### 3.3 MetricsBar.jsx

- [x] Create `src/components/MetricsBar.jsx`
- [x] Renders 4 KPI cards in a 4-column grid: Berth wait, Weather risk, Inventory coverage, Risk score
- [x] Each card has: source label tag (● Live or ~ Simulated), metric name, large value, colour progress bar, subtitle
- [x] Bar fill width = percentage of max: berth wait max 48h, risk score max 100, inventory max 14 days
- [x] Colour logic per card implemented
- [x] Confirm all 4 cards show real values from `metrics` and `sim` props

### 3.4 TerminalChart.jsx

- [x] Create `src/components/TerminalChart.jsx`
- [x] Renders 5 horizontal bars labelled T1–T5
- [x] Bar colour: green < 70%, amber 70–84%, red ≥ 85%
- [x] Below bars: list of waiting vessel names (show first 3, then "+ N more")
- [x] Show `aisConnected` status tag

### 3.5 RiskBreakdown.jsx

- [x] Create `src/components/RiskBreakdown.jsx`
- [x] Renders 4 labelled horizontal bars with weights
- [x] Below bars: total weighted score and level label
- [x] Footnote: "Port 30% · Weather 25% · Inventory 25% · Urgency 20%"

### 3.6 WeatherDetail.jsx

- [x] Create `src/components/WeatherDetail.jsx`
- [x] Wind speed + wave height cards, AI advisory block
- [x] Loading / stale / null states implemented

### 3.7 Simulator.jsx

- [x] Create `src/components/Simulator.jsx`
- [x] 5 controls with toggles/selectors
- [x] Live risk score display with colour coding
- [x] Formula footnote + Ask AI button
- [x] Confirm: moving any slider immediately updates risk score

### 3.8 AgentPanel.jsx

- [x] Create `src/components/AgentPanel.jsx`
- [x] 4 agent cards + loading skeleton + empty state
- [x] Incident Commander block with escalation banner

### 3.9 TradeoffTable.jsx

- [x] Create `src/components/TradeoffTable.jsx`
- [x] 4-row table with dynamic status badges using getRowStatus

### 3.10 Confidence.jsx

- [x] Create `src/components/Confidence.jsx`
- [x] 5-segment bar, confidence level/reason, conflicts list

### 3.11 ChatBox.jsx

- [x] Create `src/components/ChatBox.jsx`
- [x] Message list, input, send, auto-scroll, loading dots

### 3.12 Escalation.jsx

- [x] Create `src/components/Escalation.jsx`
- [x] Generate button (red), monospace output, copy button

**Phase 3 gate:** Full dashboard renders with real data. All 12 components visible. Scenario dropdown changes displayed values. Risk score updates when simulator sliders move. AIS status dot reflects real connection state.

---

## Phase 4 — MapView Tab

**Goal:** The Live Map tab shows vessel dots on a Leaflet map with zone overlays. Tab switching works cleanly.

**Do this phase last — after the dashboard is fully working.**

### 4.1 Dependency confirmation

- [ ] Confirm `leaflet` and `react-leaflet` are in `package.json` (installed in Phase 0)
- [ ] Confirm `import 'leaflet/dist/leaflet.css'` is the FIRST import in `main.jsx`
- [ ] If not: add it now and confirm no existing import comes before it

### 4.2 MapView component

- [ ] Create `src/components/MapView.jsx` — copy the complete file from plan.md section 10.1
- [ ] Confirm all imports at top of file: `MapContainer, TileLayer, CircleMarker, Rectangle, Popup` from `'react-leaflet'`
- [ ] Confirm `TERMINAL_ZONES` and `WAITING_ANCHORAGE` are imported from `'../utils/vesselClassifier'`

### 4.3 Wire MapView into App.jsx

- [ ] Import `MapView` in App.jsx
- [ ] In the App return statement, add the conditional from plan.md section 8:
  ```jsx
  {activeTab === 'map' && (
    <MapView
      vessels={vessels}
      metrics={metrics}
      sim={sim}
      aisConnected={aisConnected}
    />
  )}
  ```
- [ ] Ensure the dashboard content is also conditional on `activeTab === 'dashboard'`

### 4.4 Confirm Header tab buttons are wired

- [ ] "Control tower" button calls `onTabChange('dashboard')`
- [ ] "Live map" button calls `onTabChange('map')`
- [ ] Active tab button has distinct styling (dark bg, white text)
- [ ] Inactive tab button has light styling

### 4.5 Map rendering verification

- [ ] Run `npm run dev` locally
- [ ] Click "Live map" tab
- [ ] Confirm: map appears centred on Tuas (lat 1.32, lon 103.64) at zoom 12
- [ ] Confirm: OpenStreetMap tiles load (you should see Singapore coastline and Tuas Port)
- [ ] Confirm: 5 terminal zone rectangles appear as coloured overlays in the Tuas area
- [ ] Confirm: anchorage zone appears as a dashed amber rectangle west of the terminals
- [ ] Confirm: vessel dots appear (may take 30–60 seconds for AIS data)
- [ ] Click a vessel dot → confirm popup shows name, status, speed, location, MMSI
- [ ] Click a terminal zone → confirm popup shows terminal name and occupancy %
- [ ] Click anchorage zone → confirm popup shows waiting vessel count and berth wait

### 4.6 Floating overlay verification

- [ ] Floating stats card is visible in top-right corner
- [ ] Shows: risk score with correct colour, berth wait hours, inventory days with correct colour
- [ ] Shows: vessel counts for berthed, waiting, transiting
- [ ] If AIS offline: shows amber "AIS offline — no vessel data" warning

### 4.7 Legend verification

- [ ] Legend card is visible in bottom-left corner
- [ ] Shows 5 items: Berthed vessel (green), Waiting vessel (amber), Transiting vessel (grey), Terminal zone (blue), Anchorage zone (amber)

### 4.8 Tab switch verification

- [ ] Switch from map to dashboard: dashboard renders correctly, no blank panels
- [ ] Switch from dashboard back to map: map is still centred on Tuas, vessel dots still present
- [ ] Risk badge and AIS status dot in Header are visible on BOTH tabs

### 4.9 Known MapView gotchas — check if anything is broken

- [ ] If map renders as a grey square with no tiles: CSS import is missing in main.jsx
- [ ] If overlays appear behind map tiles: add `zIndex: 1000` to the overlay div styles
- [ ] If vessel dots don't update: confirm `vessels` prop is being passed from App.jsx correctly
- [ ] If map height is 0: confirm `style={{ height: 'calc(100vh - 56px)' }}` is on the wrapper div, not `MapContainer`

**Phase 4 gate:** Live map tab shows tiles, vessel dots, zone overlays, and legend. Tab switching between dashboard and map works without errors. Floating stats overlay shows correct live values.

---

## Phase 5 — AI Integration

**Goal:** ChatBox sends real messages to Anthropic. Responses are parsed and distributed to AgentPanel and Confidence. Escalation generates. Advisory appears.

### 5.1 Replace chat API stub with real implementation

- [ ] Open `api/chat.js`
- [ ] Replace the stub with the complete implementation from plan.md section 12.1
- [ ] Paste the FULL system prompt from plan.md section 11.1 as the `SYSTEM_PROMPT` constant
- [ ] Push to GitHub and wait for Vercel deploy
- [ ] Test directly via browser console:
  ```js
  fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages: [{ role: 'user', content: 'What is the current situation at Tuas?' }],
      context: 'Test context — berth wait 28h, risk Critical'
    })
  }).then(r => r.json()).then(d => console.log(d.content))
  ```
- [ ] Confirm response contains all 5 section headers: `[PORT OPERATIONS]`, `[MARITIME RISK]`, `[INVENTORY]`, `[COST-SERVICE]`, `[INCIDENT COMMANDER]`
- [ ] Confirm response contains `[CONFIDENCE:` and `[ESCALATION:` lines

### 5.2 Wire ChatBox to handleSend

- [ ] In App.jsx, pass `handleSend` to `ChatBox` as the `onSend` prop
- [ ] Pass `chatHistory` and `aiLoading` to `ChatBox`
- [ ] Type a question in the chat and send it
- [ ] Confirm: user message appears in chat immediately
- [ ] Confirm: loading indicator appears while AI is responding
- [ ] Confirm: assistant response appears after AI call completes
- [ ] Confirm: `aiLoading` resets to `false` after response (even if there's an error)

### 5.3 Wire AgentPanel to parsed response

- [ ] Confirm `handleSend` calls `parseAgentResponse` on the AI response and sets `agentSections`
- [ ] Pass `agentSections` to `AgentPanel`
- [ ] Send a question in the chat
- [ ] Confirm: all 4 agent cards populate with text from the response
- [ ] Confirm: Incident Commander block shows the commander section text
- [ ] Confirm: if `escalation.required = true`, red banner appears in Incident Commander block

### 5.4 Wire Confidence to parsed response

- [ ] Pass `agentSections?.confidence` to `Confidence` component
- [ ] Pass `conflicts` array from App.jsx state to `Confidence`
- [ ] Confirm: confidence level and reason display after first AI response
- [ ] Confirm: 5-segment bar fills correctly for High, Medium, Low

### 5.5 Wire Simulator "Ask AI" button

- [ ] Confirm `onAskAI` in Simulator calls `handleSend` with the pre-built message (see plan.md section 7.1 — the Simulator `onAskAI` prop in App.jsx)
- [ ] Click the button
- [ ] Confirm: the simulator state is included in the message that goes to the AI
- [ ] Confirm: AI response references the simulator values (e.g., mentions the berth wait hours you set)

### 5.6 Wire Escalation

- [ ] Pass `handleEscalation` to `Escalation` as `onGenerate`
- [ ] Pass `escalationBrief` and `escalationLoading`
- [ ] Click the Generate button
- [ ] Confirm: brief appears in monospace format
- [ ] Confirm: brief contains all expected sections (see plan.md section 7.7 for format)
- [ ] Confirm: copy button copies the text to clipboard

### 5.7 Wire Advisory

- [ ] Confirm `fetchAdvisory` is called after weather loads (in the weather useEffect from plan.md section 7.4)
- [ ] Pass `advisory` and `advisoryLoading` to `WeatherDetail`
- [ ] Confirm: advisory text appears in WeatherDetail with `◈ AI-generated` label
- [ ] Confirm: advisory is NOT re-fetched every render — only every 15 minutes

**Phase 5 gate:** Full AI loop works end-to-end. Chat → AgentPanel → Confidence works. Escalation brief generates correctly. Advisory appears from live weather data.

---

## Phase 6 — Simulator and Live Data Wiring

**Goal:** Simulator overrides correctly interact with live data. Toggle mechanism works. Derived values update correctly.

### 6.1 Berth wait override

- [ ] Note the AIS-derived berth wait value in MetricsBar
- [ ] Enable the berth wait toggle in Simulator
- [ ] Drag slider to 36h
- [ ] Confirm: MetricsBar shows 36h (not the AIS value)
- [ ] Confirm: risk score increases from the original value
- [ ] Confirm: live value label "(Live: Xh)" appears next to the slider
- [ ] Click "Ask AI about this scenario"
- [ ] Confirm: AI context includes `"Berth wait overridden to 36h (AIS-derived: Xh)"`
- [ ] Disable the toggle
- [ ] Confirm: berth wait returns to AIS-derived value and risk score reverts

### 6.2 Weather risk override

- [ ] Note the live weather risk from WeatherDetail (e.g., Medium)
- [ ] Enable the weather risk toggle in Simulator
- [ ] Change to High
- [ ] Confirm: risk score increases
- [ ] Confirm: live value label shows "(Live: Medium)"
- [ ] Confirm: conflict flag appears in Confidence: "Weather override (High) conflicts with live data (Medium)"

### 6.3 Scenario switch reset

- [ ] Switch from Typhoon Yagi to Terminal 3 Fire
- [ ] Confirm: all sliders reset to Terminal 3 Fire defaults
- [ ] Confirm: all override toggles reset to off
- [ ] Confirm: risk score recalculates immediately for the new scenario
- [ ] Confirm: chat history is cleared on scenario switch
- [ ] Confirm: escalation brief is cleared on scenario switch

### 6.4 Map reflects sim values

- [ ] Switch to Live Map tab
- [ ] Note the risk score in the floating overlay
- [ ] Switch back to dashboard and move inventory slider to 1.5 days
- [ ] Switch to Live Map tab
- [ ] Confirm: risk score in floating overlay has increased
- [ ] Confirm: inventory days in floating overlay shows 1.5d in red

**Phase 6 gate:** All simulator overrides interact with live data correctly. Scenario switch resets everything. Map floating overlay reflects current effective values.

---

## Phase 7 — Error Handling and Fallbacks

**Goal:** The app degrades gracefully when external APIs are unreachable. No crashes, no blank screens, no unhandled promise rejections.

### 7.1 AIS offline

- [ ] Temporarily change `VITE_AISSTREAM_KEY` in `.env.local` to an invalid value
- [ ] Restart dev server
- [ ] Confirm: AIS status dot turns grey and shows "offline"
- [ ] Confirm: berth occupancy falls back to scenario defaults (T3 at 100% for Typhoon Yagi)
- [ ] Confirm: conflict flag "AIS feed offline — using scenario default berth data" appears in Confidence
- [ ] Confirm: AI context includes "AIS feed offline — scenario defaults in use"
- [ ] Confirm: map tab shows "AIS offline — no vessel data" in the floating overlay
- [ ] Confirm: map tab still renders with zone overlays (just no vessel dots)
- [ ] Restore correct key, restart dev server

### 7.2 Weather stale

- [ ] Temporarily break the `/api/weather` route (add `throw new Error('test')` at the top)
- [ ] Refresh the app
- [ ] Confirm: weather cards show amber "Data unavailable" warning
- [ ] Confirm: `stale: true` appears in weather state (check via React DevTools or console)
- [ ] Confirm: conflict flag appears in Confidence
- [ ] Restore the weather route

### 7.3 AI errors

- [ ] Temporarily remove `ANTHROPIC_API_KEY` from Vercel env vars (or set it to invalid)
- [ ] Deploy and test sending a chat message
- [ ] Confirm: error message appears in chat: "[ERROR] Unable to reach AI — please try again."
- [ ] Confirm: `aiLoading` resets to `false` (button becomes clickable again)
- [ ] Confirm: escalation button shows error state on failure
- [ ] Restore API key in Vercel

### 7.4 Loading states

- [ ] Confirm AgentPanel shows skeleton while AI is responding
- [ ] Confirm Escalation button shows spinner while brief is generating
- [ ] Confirm WeatherDetail shows loading state before first weather fetch completes
- [ ] Confirm ChatBox send button is disabled during AI response

### 7.5 Null safety

- [ ] Confirm app does not crash when `agentSections = null` (before first AI response)
- [ ] Confirm app does not crash when `weather = null` (before first weather fetch)
- [ ] Confirm app does not crash when `vessels = []` (no AIS data yet)
- [ ] Check browser console — no unhandled promise rejections, no "cannot read property of null" errors

**Phase 7 gate:** All failure modes confirmed. App remains usable and informative in each case. Zero unhandled exceptions in console.

---

## Phase 8 — Polish and Final Deploy

**Goal:** Clean, professional final version deployed. GitHub is ready to submit.

### 8.1 Visual consistency

- [ ] Check all three scenarios — switch between them several times, confirm everything updates
- [ ] Check risk score badge colour transitions: Low (green) → Medium (amber) → High (orange) → Critical (red)
- [ ] Check all data source labels are visible: ● Live, ~ Simulated, ◈ AI-generated
- [ ] Check escalation brief is formatted correctly in monospace, all sections present
- [ ] Check Simulator live value labels appear when toggles are on
- [ ] Check tab switcher active state is visually distinct

### 8.2 Map final checks

- [ ] Map is centred on Tuas at correct zoom
- [ ] All 5 terminal zones visible with correct colours
- [ ] Anchorage zone visible with dashed border
- [ ] Vessel popup shows all 5 fields: name, status, speed, location, MMSI
- [ ] Zone popups show occupancy percentage
- [ ] Legend is readable and accurate
- [ ] Floating overlay updates when switching from dashboard after changing simulator values

### 8.3 Layout check

- [ ] No horizontal overflow at 1440px viewport width
- [ ] No horizontal overflow at 1280px viewport width
- [ ] No component overflows its card at any reasonable content length

### 8.4 GitHub cleanup

- [ ] Run `git status` — confirm `.env.local` is NOT shown
- [ ] Run `git status` — confirm `node_modules` is NOT shown
- [ ] Confirm no hardcoded API keys anywhere in source files (search for your actual key strings)
- [ ] Create `README.md` with:
  - Project name and description (1–2 sentences)
  - Tech stack list
  - How to run locally (clone, npm install, add .env.local, npm run dev)
  - Environment variables required (names only, not values)
  - Vercel deployment URL
- [ ] Final commit: `git add . && git commit -m "feat: PortSentinel AI complete — all phases"` 
- [ ] `git push origin main`

### 8.5 Final Vercel deploy verification

- [ ] Push triggers automatic Vercel deploy — confirm it succeeds
- [ ] Visit live Vercel URL — confirm app loads without errors
- [ ] Confirm AIS stream connects on the deployed URL (not just localhost)
- [ ] Confirm all 3 API routes work on deployed URL: `/api/weather`, `/api/news`, `/api/chat`
- [ ] Test all 3 scenarios on deployed URL
- [ ] Test full chat loop on deployed URL — send a message, confirm structured response
- [ ] Test escalation brief on deployed URL
- [ ] Test "Live map" tab on deployed URL — confirm tiles load, vessel dots appear
- [ ] Copy the final Vercel URL — this is your submission link

### 8.6 Final checklist before submission

- [ ] Risk score formula weights visible in the UI (footer of RiskBreakdown or Simulator)
- [ ] All data source labels present and accurate on dashboard
- [ ] Confidence indicator updates after every AI response
- [ ] Conflict flags appear when expected (test by enabling a weather override that differs from live)
- [ ] Escalation brief copy button works
- [ ] Tab switching works with no console errors
- [ ] GitHub repo link is accessible (set to public if not already)

---

## Known Risks and Mitigations

| Risk | Likelihood | Mitigation |
|---|---|---|
| AIS shows fewer than 5 vessels | Medium | Widen bounding box by 0.05 degrees; scenario defaults cover it; document in reflection |
| Terminal zone boundaries don't match actual Tuas layout | High | Zone coords are in a config object — tune without touching logic; confirm visually on map |
| Leaflet CSS missing → map renders grey | Medium | Confirmed in Phase 0 checklist; `main.jsx` import is first step |
| `MapContainer` height 0 → blank area | Medium | Wrapper div needs `height: calc(100vh - 56px)`, not MapContainer itself |
| Currents API returns no maritime news | Medium | Hide ticker if empty; don't crash |
| Anthropic API slow → chat feels unresponsive | Low | `max_tokens: 1000` keeps responses fast; show loading state clearly |
| AIS WebSocket key visible in browser bundle | Certain | Known trade-off — document in reflection report |
| Vercel cold start on first API call | Low | First response may be 2–3s slower; subsequent calls are fast |

---

## Reflection Report Notes — Collect These During Build

Write these down as they happen. Do not try to reconstruct from memory at the end.

- [ ] Note: how many vessels actually appeared in your AIS bounding box, and what time of day — this tells you something real about Tuas traffic patterns
- [ ] Note: any case where the AI gave an overconfident or wrong recommendation — this is your hallucination risk example
- [ ] Note: a moment where the deterministic risk score and the AI's recommendation disagreed — why they diverged
- [ ] Note: what happens to AI confidence level when you activate conflicting weather/AIS overrides — this is the human escalation argument
- [ ] Note: the AIS coverage limitation (vessels with disabled transponders, small craft) — link this to why the escalation feature exists
- [ ] Note: what data you would add if this were a real production system — MPA berth management API, ERP inventory feed, carrier ETD/ETA API, Lloyd's maritime intelligence feed

---

*Progress tracker version 2.0 — includes MapView tab (Phase 4)*
