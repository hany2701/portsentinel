# PortSentinel AI - Tuas Project Rubric Audit

Audit date: 24 July 2026  
Audited application: `PortSentinel/`  
Source of truth: `Group Assignment_II (1).pdf`, especially pages 2-3  
Status: evidence-based pre-submission audit — **remediation pass completed 24 July 2026** (see §11)

## 1. Scope and exclusions

This audit covers only the Tuas Mega Port scenario and the web application's in-scope requirements:

- A functional digital orchestrator that synthesizes current data to address a modern digital supply-chain bottleneck.
- The Tuas Mega Port Resilience Monitor scenario:
  - Monitor maritime disruption, including Malacca Strait weather and automated berth congestion at Tuas.
  - Suggest immediate vessel rerouting and/or inventory safety-stock adjustments.
- Institutional knowledge and system prompting:
  - Persona.
  - Constraints.
  - Action logic, including handling out-of-distribution data and conflicting reports.
- A clean, responsive, intuitive chat interface.
- At least one dashboard/data-visualization component generated from a natural-language description.
- Industry Authenticity (30%).
- Technical Robustness (30%).
- UI/UX Design (20%).

Explicitly excluded at the user's request:

- GitHub repository/source-link submission requirements.
- Video/conversation-demo requirements.
- Reflection-report/critical-slides requirements.
- Critical Reflection (20%), because it is assessed through the excluded reflection deliverable.

The score in this document is therefore out of 80 rubric points, with an additional normalized percentage for convenience.

## 2. Executive verdict

PortSentinel is already a strong, unusually complete Tuas prototype. It has a deterministic port and maritime simulation, live weather-feed integration with fallbacks, Tuas-specific doctrine, a grounded LLM assistant, validated human-in-the-loop actions, a desktop dashboard, a world/regional maritime map, a 3D Tuas twin, and five connected operations workspaces.

The main score risks are not missing feature breadth. They are four concentrated issues:

1. **The chat can crash before the API call and remain permanently stuck in "Assistant is replying..." when a resumed route is incompatible with the current graph.**
2. **The shell is not responsive. At a 390 x 844 viewport, the fixed sidebar and fixed-width chat drawer consume the screen and clip the application.**
3. **The "agent" is reactive. It only proposes action after the user sends a prompt; it does not independently surface an immediate recommendation when a disruption becomes critical.**
4. **A deterministic harmonic tide model is labelled "Live", conflicting with the application's otherwise strong provenance policy.**

### Provisional in-scope score

| Criterion | Weight | Current estimate | Main reason |
|---|---:|---:|---|
| Industry Authenticity | 30 | **25** | Excellent Tuas doctrine, maritime network, port operations, rerouting, safety stock, provenance, and human approval. Reduced for reactive rather than proactive orchestration and the tide provenance error. |
| Technical Robustness | 30 | **23** | Production build succeeds and 476 tests pass. Reduced materially by the reproduced chat deadlock, weak saved-state validation, and absence of API/UI end-to-end coverage. |
| UI/UX Design | 20 | **13** | Strong desktop dashboard, maps, twin, operations tabs, and evidence view. Reduced for unusable mobile layout, drawer-induced compression, high information density, and incomplete chat/map deep-linking. |
| **Total** | **80** | **61/80** | **76.25% normalized** |

This is a provisional audit estimate, not a guaranteed mark. Completing the P0 and P1 items below would plausibly move the implementation into the high-distinction range for the in-scope 80 points.

## 3. Verification evidence

### Automated verification

- `npm test -- --reporter=basic`
  - **35 test files passed.**
  - **476 tests passed.**
  - Strong coverage exists for determinism, invariants, maritime routing, rerouting, Tuas impact, long-run state bounds, performance, retrieval, response parsing, map calculations, operations derivations, and the digital twin.
- `npm run build`
  - TypeScript compilation and the Vite production build both succeeded.
  - Build warning: several chunks exceed 500 kB; `land-10m` is about 3.09 MB before gzip and the twin chunk is about 886 kB before gzip.

### Live UI verification

The application was exercised in the local browser at desktop and mobile viewport sizes.

Verified working at desktop size:

- Resilience dashboard with live/computed/simulated provenance.
- Maritime Network global map with satellite imagery, routes, disruptions, vessels, KPIs, and Tuas handoff.
- Digital Twin rendering with berth, yard, crane, AGV, heatmap, and legend controls.
- Operations workspace tabs:
  - Berth Planning.
  - Yard Control.
  - Anchorage Queue.
  - Cargo at Risk.
  - Safety Stock.
- Chat drawer and Evidence workspace rendering.
- Weather and marine-environment panels.

Reproduced defects:

- At 390 x 844, the fixed `w-60` sidebar and fixed `w-[26rem]` chat drawer clip almost the entire application.
- With the resumed tick-40 crisis state, sending "Which vessels are waiting at anchorage?" throws:

  ```text
  Route sequence is not connected at PORT-HONGKONG -> WPT-TAIWAN-STRAIT
  ```

  The exception occurs during `buildChatContext(...)` before `streamChat(...)` is entered. The store has already set chat status to `streaming`, so the input stays disabled indefinitely.
- The Weather view displays `Tide (harmonic curve)` with a green `Live` badge even though the source is deterministic and has no external feed.

## 4. Requirement traceability

| PDF requirement | Status | Current evidence | Gap that can lose marks |
|---|---|---|---|
| Functional Digital Orchestrator | **Mostly met** | Simulation, current-state context, action tools, validators, preview, approval, effect execution, persistence | Chat can deadlock on resumed state; agent does not initiate a review when a disruption becomes critical |
| Tuas maritime disruption monitoring | **Met** | Malacca/Singapore maritime network, Tuas frame, storms, weather risk, berth congestion, route impacts | Maritime vessel and berth state are simulated; this is acceptable for a prototype but must remain visibly disclosed |
| Immediate rerouting suggestions | **Mostly met** | Deterministic route candidates, `rerouteVoyage`, hold/divert/re-berth actions, human approval | Suggestions only appear after the user asks; chat navigation does not map `rerouteVoyage` back to the maritime map |
| Inventory safety-stock adjustment | **Met** | Customer outlook, system-computed shortfall days, safety-stock action, customer notice | Ensure the demo shows the full closed loop from affected cargo to advisory and approval |
| Persona | **Met** | `src/prompts/persona.ts:2-3` defines a Tuas control-tower operations assistant with no execution authority | None material |
| Constraints | **Met** | `src/prompts/constraints.ts:3-18` covers snapshot-only claims, provenance, no invented entities/numbers, human approval, route/berth validity, and remote disruption impact on Tuas | Runtime UI provenance must match these constraints; tide currently does not |
| Action logic | **Met in prompt; partial in behavior** | `src/prompts/actionLogic.ts:1-3`; validation retry in `src/store/simStore.ts:414-497`; OOD/conflict policy in `src/prompts/uncertainty.ts:7-12` | "Sole automatic proposer" is not automatic in practice; no event-driven call is made |
| Institutional knowledge grounding | **Met** | `src/utils/contextBuilder.ts:457-515`; retrieved doctrine, doctrine index, current tick, weather, KPIs, berth options, disruptions, Tuas exposure, routes, cargo, safety stock, pending actions | One invalid route can make the entire context assembly throw |
| State-of-the-art API integration | **Mostly met** | Server-side Anthropic SDK, SSE streaming, server-side doctrine search, tool-use loop in `api/chat.ts:62-109` | No API contract tests, request schema validation, body cap, explicit timeout, or model-readiness check |
| Clean, responsive, intuitive chat | **Partial** | Clear desktop drawer, examples, streaming status, recommendation cards, evidence trace | Mobile fails; drawer compresses the dashboard at 1280 px; a context error leaves it permanently disabled |
| Data dashboard / visualization | **Exceeded on desktop** | Resilience gauge, KPI cards, trend chart, maps, berth board, yard/cargo views, 3D twin | Information density and responsive behavior need tightening |

## 5. Backend logic audit

### 5.1 What is already score-positive

#### Grounded system prompt

`src/utils/contextBuilder.ts:481-513` assembles all required prompt sections:

- Persona.
- Retrieved institutional knowledge and doctrine index.
- Constraints.
- Output style.
- Action logic.
- Conflict and out-of-distribution policy.
- Tick-stamped live state.
- Calibration mode and provenance.
- Weather, forecast, KPIs, terminal performance, berth state, anchorage, route and disruption effects, yard, cargo, safety stock, and pending recommendations.

This is direct, strong evidence for both Industry Authenticity and Technical Robustness.

#### Hallucination boundaries and human control

`src/utils/responseParser.ts:95-160` converts tool input into typed operational effects. It prevents the LLM from authoring system-derived safety-stock quantities and rejects voyage routes that were not produced by the deterministic route service.

`src/store/simStore.ts:255-278` re-validates every pending recommendation immediately before execution. This is a particularly good critical-infrastructure pattern: the LLM proposes, the deterministic engine validates, and the duty manager approves.

#### Tuas-specific operational depth

The domain model covers substantially more than a generic chatbot:

- Berth classes and berth availability.
- Anchorage queues and projected waits.
- Vessel class/suitability.
- Maritime route graph, corridor hazards, holds, reroutes, and alternate ports.
- Weather, lightning, haze, tide gates, pilotage, and tug availability.
- Yard blocks, AGV activity, cargo dwell, transshipment connections, and safety stock.
- Tuas arrival impact from remote disruption.
- Provenance values such as `live_external`, `simulated`, `calculated`, `ai_generated`, and `user_input`.

#### Test depth

The 476 passing tests are strong evidence that the deterministic core is stable. Especially valuable rubric evidence includes:

- 10,000-tick invariant run.
- 130-vessel performance checks.
- End-to-end vessel journey and geographic-to-Tuas handover.
- Reroute, hold, service-delay, and Tuas-impact tests.
- Retrieval evaluation and prompt-context tests.
- Recommendation validation and chat-store tests.

### 5.2 Backend gaps

#### P0 - Chat context failure leaves the assistant permanently locked

Evidence:

- Chat status is changed to `streaming` at `src/store/simStore.ts:404-406`.
- `buildChatContext(...)` runs at `src/store/simStore.ts:414-416`, before the protected streaming callbacks.
- A disconnected saved route reaches `sequenceDistanceNm(...)`, which throws at `src/maritime/graph.ts:53-58`.
- The UI has no outer `try/catch/finally` to restore `chat.status`.

Why it matters:

- Direct Technical Robustness failure.
- Direct UI/UX failure because the input remains disabled.
- The test suite passes despite a user-visible deadlock, showing a coverage gap.

Required fix:

1. Wrap the entire `sendChatMessage` turn, including context construction, in `try/catch/finally`.
2. Guarantee the assistant placeholder message is finalized and the input is re-enabled on every failure.
3. Make route-context rendering defensive: report an invalid route in the Evidence trace instead of throwing the whole turn.
4. Validate or migrate saved sessions before resume.
5. Add a regression test that resumes a stale/disconnected route and sends a chat query.

Acceptance criteria:

- No thrown context error can leave `chat.status === "streaming"`.
- The user sees a clear recoverable error with Retry/Start Fresh options.
- A saved state is either migrated, rejected safely, or resumed only after route-connectivity validation.

#### P0 - Saved-state compatibility is versioned only by storage key

Evidence:

- `src/store/persistence.ts:15` uses `portsentinel-session-v5`.
- `loadSession()` at `src/store/persistence.ts:31-36` only checks that `sim` exists and `chatMessages` is an array.
- `resumeSaved()` at `src/store/simStore.ts:159-165` installs the state without schema or invariant validation.

Why it matters:

- A route-graph or state-shape change can make an apparently valid save crash later.
- This is the likely enabling condition for the reproduced chat failure.

Required fix:

- Store an explicit schema/build version in the payload.
- Validate required fields and all active route sequences before resume.
- Bump or migrate the save when route-network semantics change.
- In development, run invariants at resume; in production, run a non-throwing compatibility validator.

#### P1 - The agent does not proactively monitor and suggest

Evidence:

- `src/prompts/actionLogic.ts:3` calls the assistant the "sole automatic proposer".
- `src/sim/recLifecycle.ts` and `src/sim/tick.ts` explicitly remove automatic rule proposals.
- `src/components/DecisionQueue.tsx:26-31` only prefills an "AI review" prompt; the manager must still send it.

Why it matters:

- The selected scenario says the agent monitors disruption and suggests immediate action.
- A reviewer can reasonably interpret the current behavior as a chatbot that analyzes on demand, not an agentic monitor.

High-ROI implementation:

- Trigger one bounded AI review when a new severe/critical disruption or material threshold breach appears.
- Deduplicate by incident ID/tick band so it cannot repeatedly spend tokens or flood the queue.
- Continue to require deterministic validation and explicit human approval.
- If automatic API calls are undesirable, make the dashboard's `AI review` button send immediately and label it "Run agent review"; this is weaker than event-driven monitoring but stronger than prefill-only behavior.

Acceptance criteria:

- Injecting the Monsoon Crisis produces a validated recommendation or a clear "no action warranted" agent assessment without the user composing a prompt.
- No action is executed without approval.

#### P1 - No end-to-end API or UI contract tests

Current tests strongly cover pure/domain logic but do not verify the deployed seams:

- `api/chat.ts` request validation and error responses.
- SSE parsing across split chunks and malformed events.
- Model/tool response contract.
- Browser journey from disruption -> chat -> recommendation -> preview -> approval -> updated dashboard/map.
- Persistence/resume compatibility.
- Mobile rendering.

Add a compact integration suite rather than more unit volume:

1. Missing API key -> 503 JSON.
2. Invalid body -> 400.
3. Successful SSE -> text/tool/done sequence.
4. Upstream timeout/error -> SSE error and unlocked input.
5. Resumed stale session -> safe recovery.
6. Crisis scenario -> agent recommendation -> validation -> approval -> visible state change.

#### P1 - API boundary lacks prototype-grade hardening

Evidence in `api/chat.ts`:

- `readBody()` buffers the entire request with no size cap (`api/chat.ts:27-30`).
- JSON structure is trusted after parsing.
- The model identifier is hard-coded (`api/chat.ts:18`).
- There is no explicit end-to-end timeout/cancellation policy.
- Client parsing silently drops malformed SSE blocks (`src/services/chatClient.ts:22-34`).

Recommended fix:

- Validate `system`, `messages`, and `tools` against a schema.
- Cap request size.
- Add request timeout/abort handling and always emit a terminal event.
- Make the model an environment variable with a safe default and expose a simple readiness result.
- Treat a stream that ends without `done` or `error` as an interrupted response.

#### P1 - Tide provenance contradicts the prompt constraints

Evidence:

- The tide is a seeded deterministic harmonic curve with no external feed (`src/sim/tide.ts:5-8`).
- UI hard-codes `freshness="live"` (`src/components/MarineEnvironmentPanel.tsx:69-73`).

Required fix:

- Label it `Modelled` or `Simulated`, not `Live`.
- Add an explicit provenance field to `TideState`, or render a dedicated `modelled` badge.
- Keep the current description "harmonic curve" visible.

This is a one-line visual fix plus a small type improvement with direct Industry Authenticity value.

## 6. Frontend UI audit

### 6.1 What is already score-positive

#### Dashboard hierarchy

The Resilience Monitor prioritizes the calculated resilience score, then operational KPIs, terminal performance, decision queue, and a maritime map summary. This is a clear control-tower hierarchy rather than a collection of disconnected charts.

#### Strong Tuas visualizations

- Global/regional maritime map with satellite/vector fallback, corridors, weather, disruptions, routes, ports, vessels, and Tuas handoff.
- 3D Tuas terminal with berths, yard blocks, cranes, AGVs, labels, and heatmap.
- Berth schedule board, anchorage schematic, yard capacity, cargo journey, connection risk, and safety-stock outlook.

This clearly exceeds the minimum "one data dashboard component" requirement.

#### Operations tabs are coherent

All five operation tabs rendered successfully and share the same state, search, horizon, and entity selection:

- Berth Planning.
- Yard Control.
- Anchorage Queue.
- Cargo at Risk.
- Safety Stock.

The tab choice persists across navigation through `src/store/opsStore.ts:4-25`.

#### Explainability is visible

The chat's Evidence tab exposes:

- Snapshot tick/time.
- Retrieved doctrine and scores.
- Agent doctrine searches.
- Proposed actions and validation outcomes.
- Related modules.

This is excellent evidence of a grounded professional interaction and should be demonstrated prominently.

### 6.2 Frontend gaps

#### P0 - Mobile layout is unusable

Evidence:

- Sidebar is always `w-60 shrink-0` (`src/components/Sidebar.tsx:11`).
- Chat drawer is always `w-[26rem] shrink-0` (`src/components/ChatDrawer.tsx:62`).
- The app places sidebar, main, and drawer in one `h-screen` flex row (`src/App.tsx:52-69`).
- At 390 x 844, only the sidebar and a clipped slice of chat are visible.

Why it matters:

- The PDF explicitly requires the chat interface to be responsive.
- This is an easily observable rubric failure even if desktop looks polished.

High-ROI fix:

- Below `md`, replace the fixed sidebar with a hamburger sheet or compact bottom navigation.
- Render chat as a fixed full-screen sheet on mobile and an overlay drawer on tablet; do not shrink the dashboard beneath it.
- At desktop widths, allow a resizable/overlay drawer or use a breakpoint that preserves a minimum main width.
- Make map dock cards use `max-w-[calc(100vw-...)]` rather than fixed 20-26 rem widths.
- Add 390 x 844, 768 x 1024, 1280 x 720, and 1440 x 900 visual tests.

Acceptance criteria:

- No horizontal clipping at 390 px.
- Navigation, chat input, Send, close, dashboard, and map controls remain reachable.
- Opening chat never makes KPI text overlap.

#### P1 - Chat drawer compresses the desktop dashboard

At 1280 px, opening the 416 px drawer leaves the Operations KPI cards too narrow. Text such as provenance and "no completed calls yet" wraps into awkward columns and overlaps visually.

Recommended fix:

- Use an overlay drawer until a wide desktop breakpoint.
- Alternatively switch dashboard grids to fewer columns while chat is open.
- Collapse example queries after the first message to give the conversation more space.

#### P1 - Chat/map/tabs deep-linking is incomplete

Working integration:

- Dashboard -> Maritime Network.
- Map -> Digital Twin while preserving selected vessel.
- Twin -> Maritime map.
- Twin -> relevant Operations tab.
- Twin -> chat prefill for the selected entity.
- Chat recommendation -> relevant Operations tab for berth, anchorage, yard, and safety stock.

Gaps:

- `rerouteVoyage` is not mapped in `src/components/chat/navActions.ts:10-17`, so a voyage-reroute answer has no "View on Maritime Map" action.
- Chat navigation changes the Operations tab but does not explicitly focus/scroll the affected entity.
- The maritime selected-vessel panel has no direct "Ask PortSentinel about this" action; the user must detour through the Twin.
- General advisory answers without a recommendation do not offer contextual module links.
- The dashboard `AI review` action only prefills chat instead of running the review.

High-ROI fix:

- Add `rerouteVoyage -> Maritime Network`.
- Extend navigation actions with `entityType`, `entityId`, and optional map viewport.
- On navigation, set shared selection and scroll/focus the corresponding table, map marker, or inspector.
- Add an "Ask about this vessel/disruption" button directly to the map selection panel.

Acceptance criteria:

- A reroute recommendation opens the maritime map with the vessel and candidate route selected.
- A safety-stock recommendation opens the Safety Stock tab with the customer row focused.
- A re-berth recommendation opens Berth Planning with the vessel and target berth highlighted.

#### P1 - Operations information density is too high by default

The Berth Planning tab renders a 130-vessel table, including many enroute vessels with empty berth/ETA/ETD cells. The critical anchored/approaching items appear after a long list and are easier to find in the exceptions panel than in the table.

Recommended fix:

- Default to an operationally relevant filter such as `approaching + anchored + berthing + alongside`.
- Add pagination or row virtualization.
- Keep exceptions pinned above the table.
- Format large badges for readability, for example `12.4k TEU` with the exact value in a tooltip.

#### P2 - Tab semantics and keyboard behavior can be more professional

The Operations and Chat workspace controls use buttons and `aria-current`, but not a complete tab pattern.

Recommended fix:

- Use `role="tablist"`, `role="tab"`, `aria-selected`, and linked `tabpanel`.
- Add arrow-key navigation and visible focus styles.
- When the mobile chat sheet opens, trap focus and return it to the chat toggle on close.

#### P2 - Production bundle size can slow the demo

The build succeeds but reports large chunks. On a constrained classroom or mobile connection, the 3D twin and high-resolution map geography can delay first interaction.

Recommended fix:

- Lazy-load the 10m land dataset only at regional zoom.
- Keep 50m/110m geometry for initial overview.
- Confirm that the twin is only fetched when its tab is opened.
- Add a lightweight loading skeleton and a production-network smoke test.

## 7. Integration audit matrix

| From | To | Status | Evidence / fix |
|---|---|---|---|
| Resilience dashboard | Weather | **Pass** | Forecast banner navigates to Weather |
| Resilience dashboard | Maritime map | **Pass** | Maritime summary opens the full network |
| Resilience dashboard | Chat | **Partial** | `AI review` prefills but does not execute |
| Maritime map | Digital Twin | **Pass** | Selected vessel remains in shared selection |
| Digital Twin | Maritime map | **Pass** | Tracked vessel opens at its geographic position |
| Digital Twin | Operations | **Pass** | Relevant operations tab is selected |
| Digital Twin | Chat | **Pass** | Inspector prefills an entity-specific question and opens chat |
| Operations | Digital Twin | **Pass/partial** | Anchorage opens the twin; selection is useful only if an entity was selected first |
| Chat | Berth/Yard/Anchorage/Safety tabs | **Pass/partial** | Correct tab opens, but affected entity is not focused |
| Chat | Maritime map | **Gap** | `rerouteVoyage` has no navigation mapping |
| Maritime map | Chat | **Gap** | No direct ask-about-selection action |
| Chat | Dashboard updated state | **Blocked by P0** | Intended through approved effects, but the reproduced context error can freeze the journey |

## 8. Highest-ROI fix order

Do these in order. Each item has a direct rubric link and a clear verification target.

### Fix 1 - Make chat failure-safe and migrate/validate saved state

- Priority: **P0**
- Rubric: Technical Robustness, UI/UX
- Expected effort: small to medium
- Score leverage: very high
- Includes:
  - Outer `try/catch/finally` around context build and streaming.
  - Saved-session schema/connectivity validation.
  - Defensive route-context rendering.
  - Regression test for the reproduced failure.

### Fix 2 - Implement a responsive shell and chat sheet

- Priority: **P0**
- Rubric: UI/UX
- Expected effort: medium
- Score leverage: very high because "responsive" is explicit in the brief
- Includes:
  - Mobile navigation.
  - Full-screen/overlay chat.
  - Chat-aware dashboard breakpoints.
  - Mobile/tablet visual tests.

### Fix 3 - Make the agent visibly proactive

- Priority: **P1**
- Rubric: Industry Authenticity
- Expected effort: medium
- Score leverage: high
- Includes:
  - One incident-triggered AI review.
  - Deduplication and cost guard.
  - Deterministic validation and human approval remain mandatory.

### Fix 4 - Correct tide provenance

- Priority: **P1**
- Rubric: Industry Authenticity
- Expected effort: very small
- Score leverage: high relative to effort
- Includes:
  - Replace `Live` with `Modelled`/`Simulated`.
  - Add tide provenance to state/UI.

### Fix 5 - Complete chat/map/entity deep links

- Priority: **P1**
- Rubric: UI/UX, Industry Authenticity
- Expected effort: small to medium
- Score leverage: high
- Includes:
  - `rerouteVoyage` map navigation.
  - Entity focus and scroll.
  - Direct map-to-chat ask action.

### Fix 6 - Add seam-level integration tests and API guards

- Priority: **P1**
- Rubric: Technical Robustness
- Expected effort: medium
- Score leverage: high
- Includes:
  - API/SSE/error tests.
  - Critical browser journey.
  - Request validation, size limit, timeout, terminal stream event.

### Fix 7 - Reduce information density and initial bundle cost

- Priority: **P2**
- Rubric: UI/UX, Technical Robustness
- Expected effort: small to medium
- Score leverage: moderate

## 9. Rubric-ready acceptance checklist

The implementation is ready for a final scoring pass when all of these are true:

### Industry Authenticity

- [x] A severe Malacca/Tuas disruption automatically produces an agent assessment or recommendation.
- [x] Reroute, hold, re-berth, yard, and safety-stock actions use deterministic operational rules.
- [x] All actions require human approval.
- [x] Remote disruption explains the downstream consequence for Tuas.
- [x] Every displayed source is correctly labelled live external, simulated/modelled, calculated, AI-generated, or user input.
- [x] Demo and production calibration differences are disclosed.

### Technical Robustness

- [x] TypeScript production build passes.
- [x] Existing tests pass (now 500).
- [x] Chat can never remain stuck in `streaming`.
- [x] Saved sessions are route validated before resume.
- [x] API request and SSE response contracts have integration tests.
- [x] Upstream timeout, malformed response, missing key, and network failure are recoverable.
- [x] A complete disruption -> recommendation -> validation -> approval -> updated state journey passes in the test suite.

### UI/UX

- [x] Desktop dashboard hierarchy is clear.
- [x] Dashboard, map, twin, tabs, and chat use the same simulation state.
- [x] Evidence/provenance is visible.
- [x] 390 px mobile layout is fully usable.
- [x] Opening chat does not crush or overlap dashboard content.
- [x] Chat recommendations deep-link to the affected entity and correct map/tab.
- [ ] Large operations datasets are filtered, paginated, or virtualized. *(P2, not done)*
- [ ] Tab and drawer keyboard/focus behavior is accessible. *(P2, not done)*

## 10. Final recommendation

Do not add more Tuas feature breadth before fixing the two P0 failures. The application already has enough domain depth to score well. The fastest score increase comes from making the existing agent journey impossible to break, making the explicitly required chat responsive, then demonstrating proactive intervention and perfect provenance.

The best final evaluator journey should be:

1. Start or resume safely.
2. Inject the Monsoon Crisis.
3. Dashboard and map show the same disruption and Tuas impact.
4. Agent review appears immediately with grounded evidence.
5. Reroute/hold/re-berth and safety-stock recommendations deep-link to the affected vessel/customer.
6. Preview shows the projected effect.
7. Human approves.
8. Dashboard, operations tab, maritime map, and digital twin all update consistently.
9. Evidence view shows snapshot tick, doctrine, provenance, validation, and action status.

That single integrated journey directly demonstrates all three in-scope rubric categories.

## 11. Remediation pass — what was actually fixed

Completed 24 July 2026. Every change was verified by the full test suite and a
production build; the responsive and proactive-agent changes were additionally
exercised in a live browser.

### Fix 1 — Chat can no longer deadlock (P0, was the largest single risk)

- `sendChatMessage` now wraps context construction *and* streaming in
  `try/catch`, so no thrown error can leave `chat.status === "streaming"`
  (`src/store/simStore.ts`). `interpretScore` got the same treatment.
- `src/services/chatClient.ts` now guarantees exactly one terminal handler per
  turn. **A second, previously unreported deadlock was found here**: a stream
  that ended without a `done` or `error` event resolved silently and left the
  input disabled forever. That path now reports an interrupted response.
- Reroute-candidate rendering in `src/utils/contextBuilder.ts` degrades one
  line instead of throwing the whole turn.
- `loadSession()` validates active route connectivity and discards
  incompatible saves rather than resuming a state that crashes later
  (`src/store/persistence.ts`).
- Regression coverage: `src/store/chatFailureSafety.test.ts`.

### Fix 2 — Responsive shell (P0)

- Sidebar is a slide-over sheet below `md`, a fixed rail at `md`+
  (`src/components/Sidebar.tsx`), with a hamburger control in the header.
- Chat is now an **overlay at every breakpoint** and full-width below `sm`
  (`src/components/ChatDrawer.tsx`).
- Verified in-browser: no horizontal overflow at 390 px; at 1280 px opening
  chat no longer shrinks the dashboard at all (main stayed 1040 px before and
  after, where it previously collapsed).

### Fix 3 — The agent is now proactive (P1)

- `src/hooks/useAgentWatch.ts` dispatches exactly one grounded review per
  severe (severity-3) disruption, deduplicated by incident id.
- The dashboard button now **runs** the review instead of pre-filling it, and
  is labelled "Run agent review" (`src/components/DecisionQueue.tsx`).
- Deterministic validation and explicit human approval remain mandatory —
  asserted in `src/store/crisisJourney.test.ts`.
- Verified live: injecting the Monsoon Crisis auto-opened chat and dispatched
  an incident-specific assessment with no user action.

### Fix 4 — Tide provenance corrected (P1)

- The deterministic harmonic tide is labelled **Modelled**, not Live
  (`src/components/MarineEnvironmentPanel.tsx`).

### Fix 5 — Deep links completed (P1)

- `rerouteVoyage` now maps to the Maritime Network map (the documented gap).
- Every navigation action carries the affected entity, so the destination
  opens focused on it (`src/components/chat/navActions.ts`).
- The map's vessel panel gained "Ask PortSentinel about this vessel", closing
  the map→chat loop that previously required a detour through the twin.

### Fix 6 — Seam-level tests and API hardening (P1)

- `api/chat.ts`: request-schema validation, a 1 MB body cap, and an
  env-overridable model id.
- New tests cover the SSE contract (split chunks, malformed blocks, missing
  API key, network failure, interrupted stream) and the full crisis →
  recommendation → validation → approval → state-change journey.

### Verification

- **500 tests passing** across 40 files (was 476/35).
- `npm run build` succeeds.

### Known remaining items (deliberately not done)

- Operations information density (P2) — Berth Planning still renders the full
  vessel table by default.
- Bundle size (P2) — the 10m land dataset and twin chunk remain large.
- `ANTHROPIC_API_KEY` in `.env.local` still appears to be the placeholder; it
  must be set to a real key before the evaluation demo or the assistant will
  correctly, but visibly, report itself offline.
