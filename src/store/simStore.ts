import { create } from "zustand";
import {
  generateWorld,
  tick,
  clone,
  applyEffect,
  validateEffect,
  assertInvariants,
  refreshWeather,
  stepMarineEnvironment,
  syncCalibrationMode,
  WEATHER_STALE_MS,
  WEATHER_MAX_FAILURES,
} from "../sim";
import type { CalibrationMode, DisruptionType, EntityRef, Recommendation, SimState, SimulationEffect } from "../sim";
import { formatSimTime, projectedBerthWaitHours } from "../sim";
import { routeNodeById } from "../maritime/network";
import { fetchRawWeather } from "../services/weatherClient";
import { fetchLightningRaw, fetchPsiRaw } from "../services/marineFeeds";
import { mapWeather, type WeatherForecastPoint } from "../utils/weatherMapper";
import { mapLightning, mapHaze } from "../utils/marineMapper";
import { buildChatContext } from "../utils/contextBuilder";
import { PROPOSE_ACTION_TOOL, SEARCH_DOCTRINE_TOOL, parseAgentToolUse } from "../utils/responseParser";
import { streamChat, type ChatToolEvent } from "../services/chatClient";
import { showToast } from "../components/ToastStack";
import { saveSession, clearSession, type SavedSession } from "./persistence";
import { buildCustomerNotice } from "../utils/reports";

// D-68: per-assistant-message response trace — what the agent saw (tick-stamped
// snapshot + retrieved doctrine with scores), what it looked up (search_doctrine
// calls, D-67), and what it proposed (tool calls with validation outcomes).
export type ChatTrace = {
  tick: number;
  simTime: string;
  retrieved: { sectionId: string; score: number; forced: boolean }[];
  searches: ChatToolEvent[];
  toolCalls: { title: string; kind: string; validationStatus: "pending" | "valid" | "invalid"; validationMessage?: string }[];
  revision?: boolean; // D-74: this reply revises a rejected proposal
};

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  recommendationIds: string[];
  streaming?: boolean;
  trace?: ChatTrace;
  responseMs?: number; // UIX-1: measured end-to-end reply latency (real, not fabricated)
};

type ChatState = {
  messages: ChatMessage[];
  status: "idle" | "streaming" | "error";
  llmHealth: "unknown" | "ok" | "down";
  error?: string;
};

const CHAT_WINDOW = 12; // sliding conversation window (D-35)
const MAX_VALIDATION_RETRIES = 1; // D-74: one bounded revision turn after a rejected proposal
const AUTOSAVE_EVERY_TICKS = 10; // D-76: refresh survival, not a database

const DEFAULT_SEED = 20260710;

// Wall-clock feed counters, held outside sim state (the engine stays deterministic).
let weatherFailures = 0;
let weatherLastSuccessMs = 0;
// REAL-5 (D-83): the two new external feeds track their own D-31 staleness
// independently — a lightning outage shouldn't flip haze stale, or vice versa.
let lightningFailures = 0;
let lightningLastSuccessMs = 0;
let hazeFailures = 0;
let hazeLastSuccessMs = 0;

const DISRUPTION_DURATION: Record<DisruptionType, number> = {
  storm: 60,
  arrivalSurge: 1,
  craneFailure: 40,
  berthClosure: 40,
};

type SimStore = {
  sim: SimState;
  weatherForecast: WeatherForecastPoint[];
  weatherFeedError: string | null;
  marineFeedError: string | null;
  chat: ChatState;
  interpretation: { text: string; status: "idle" | "streaming" | "error" };
  // Twin selection (§7): the picked entity lives in the store so the inspector and
  // other panels can react. chatPrefill queues a prompt for the chat drawer ("Ask
  // PortSentinel about this"); App opens the drawer when it turns non-null.
  selection: EntityRef | null;
  chatPrefill: string | null;
  /**
   * The alert the Alerts view should scroll to and flash, set when one is opened
   * from the header bell. Same handoff shape as chatPrefill: the sender sets it,
   * the receiving view consumes it once and clears it, so a re-visit does not
   * replay the highlight.
   */
  alertFocus: string | null;
  focusAlert: (alertId: string) => void;
  consumeAlertFocus: () => void;
  // D-77: generated advisory notice for an approved safety-stock rec — shown in
  // a modal with copy/download so the approval visibly produces an artifact.
  customerNotice: string | null;
  dismissNotice: () => void;
  select: (ref: EntityRef | null) => void;
  askAbout: (text: string) => void;
  consumeChatPrefill: () => void;
  init: (seed?: number) => void;
  resumeSaved: (saved: SavedSession) => void;
  discardSaved: () => void;
  tickOnce: () => void;
  play: () => void;
  pause: () => void;
  setSpeed: (speed: SimState["clock"]["speed"]) => void;
  reset: (seed?: number) => void;
  /** `atNodeId` (storms only, D-91) places the storm on a route node instead of over Singapore. */
  injectDisruption: (type: DisruptionType, severity: 1 | 2 | 3, durationTicks?: number, atNodeId?: string) => void;
  proposeUserAction: (effect: SimulationEffect, title: string) => void;
  approveRecommendation: (id: string) => void;
  dismissRecommendation: (id: string) => void;
  acknowledgeAlert: (id: string) => void;
  acknowledgeAllAlerts: () => void;
  pollWeather: () => Promise<void>;
  pollMarineFeeds: () => Promise<void>;
  setCalibrationMode: (mode: CalibrationMode) => void;
  sendChatMessage: (text: string) => Promise<void>;
  interpretScore: () => Promise<void>;
  /** Bumped whenever the agent needs the chat drawer visible (App opens it). */
  chatOpenSignal: number;
  /** Disruption ids the agent has already reviewed — the proactive-review dedup key. */
  reviewedDisruptionIds: string[];
  /** Open the chat and send `prompt` immediately, without waiting for the manager to press Send. */
  runAgentReview: (prompt: string) => Promise<void>;
  /** Records a disruption as reviewed; returns false when it was already claimed. */
  claimDisruptionReview: (disruptionId: string) => boolean;
};

function advance(sim: SimState): SimState {
  const next = tick(sim);
  if (import.meta.env.DEV) assertInvariants(next);
  return next;
}

export const useSimStore = create<SimStore>((set, get) => ({
  sim: generateWorld(DEFAULT_SEED),
  weatherForecast: [],
  weatherFeedError: null,
  marineFeedError: null,
  chat: { messages: [], status: "idle", llmHealth: "unknown" },
  interpretation: { text: "", status: "idle" },
  selection: null,
  chatOpenSignal: 0,
  reviewedDisruptionIds: [],
  chatPrefill: null,
  alertFocus: null,
  customerNotice: null,
  dismissNotice: () => set({ customerNotice: null }),
  select: (ref) => set({ selection: ref }),
  askAbout: (text) => set({ chatPrefill: text }),
  consumeChatPrefill: () => set({ chatPrefill: null }),
  focusAlert: (alertId) => set({ alertFocus: alertId }),
  consumeAlertFocus: () => set({ alertFocus: null }),
  init: (seed = DEFAULT_SEED) => set({ sim: generateWorld(seed) }),

  // D-76: restore a saved session. The clock resumes PAUSED so the manager
  // consciously presses Play; weather freshness re-degrades naturally (the
  // saved reading's age triggers the normal stale rules until the next poll).
  resumeSaved: (saved) => {
    syncCalibrationMode(saved.sim.calibrationMode);
    set((s) => ({
      sim: { ...saved.sim, clock: { ...saved.sim.clock, running: false } },
      chat: { ...s.chat, messages: saved.chatMessages },
      selection: null,
    }));
  },
  discardSaved: () => clearSession(),

  tickOnce: () => {
    const sim = advance(get().sim);
    set({ sim });
    if (sim.clock.tick % AUTOSAVE_EVERY_TICKS === 0) saveSession(sim, get().chat.messages);
  },
  play: () => set((s) => ({ sim: { ...s.sim, clock: { ...s.sim.clock, running: true } } })),
  pause: () => set((s) => ({ sim: { ...s.sim, clock: { ...s.sim.clock, running: false } } })),
  setSpeed: (speed) => set((s) => ({ sim: { ...s.sim, clock: { ...s.sim.clock, speed } } })),
  reset: (seed) => set((s) => ({ sim: generateWorld(seed ?? s.sim.clock.seed), selection: null })),

  // REAL-6 (D-84): flip the live regime without regenerating the world — only
  // FUTURE thresholds/cadence change (syncCalibrationMode rebuilds DOCTRINE +
  // the doctrine corpus + search index immediately, so the header/chat/UI
  // never show a stale mode even before the next tick).
  setCalibrationMode: (mode) => {
    syncCalibrationMode(mode);
    set((s) => ({ sim: { ...s.sim, calibrationMode: mode } }));
    showToast(`Calibration mode: ${mode === "production" ? "PRODUCTION (real-world thresholds)" : "DEMO (compressed thresholds)"}.`, "info");
  },

  injectDisruption: (type, severity, durationTicks, atNodeId) => {
    const cur = get().sim;
    let targetIds: string[] = [];
    if (type === "craneFailure") {
      const berth = cur.berths.find((b) => b.status === "occupied" && b.craneIds.length > 0);
      if (!berth) return showToast("No active berth for a crane failure.", "error");
      targetIds = berth.craneIds.slice(0, severity === 1 ? 1 : 2);
    } else if (type === "berthClosure") {
      const berth = cur.berths.find((b) => b.status === "available");
      if (!berth) return showToast("No available berth to close.", "error");
      targetIds = [berth.id];
    } else if (type === "storm" && atNodeId) {
      // D-91: a storm may be placed on a route node, and then its weather sits
      // THERE rather than over Singapore. An untargeted storm is unchanged.
      const node = routeNodeById(atNodeId);
      if (!node) return showToast(`Unknown location "${atNodeId}".`, "error");
      targetIds = [atNodeId];
    }
    set((s) => {
      const sim = clone(s.sim);
      sim.disruptions.push({
        id: `DIS-${sim.seq++}`,
        type,
        targetIds,
        startTick: sim.clock.tick + 1,
        durationTicks: durationTicks ?? DISRUPTION_DURATION[type],
        severity,
      });
      return { sim };
    });
    const where = type === "storm" && atNodeId ? ` at ${routeNodeById(atNodeId)?.name ?? atNodeId}` : "";
    showToast(`Scenario injected: ${type}${where} (severity ${severity}).`, "info");
  },

  // D-69: a manual re-berth/divert from the Operations view. Identical pipeline
  // to rule/agent proposals — build effect → validate → queue as a pending
  // Recommendation → the card's preview + double-validated Approve do the rest.
  proposeUserAction: (effect, title) => {
    const sim = clone(get().sim);
    const validation = validateEffect(sim, effect);
    let rationale = "Manually initiated by the duty manager.";
    if (effect.kind === "reassignBerth" || effect.kind === "divertVessel") {
      const vessel = sim.vessels.find((v) => v.id === effect.vesselId);
      if (vessel) rationale += ` Current projected berth wait ${projectedBerthWaitHours(sim, vessel)} h [calculated].`;
    }
    const rec: Recommendation = {
      id: `REC-U-${sim.seq++}`,
      source: "user",
      type: effect.kind === "reassignBerth" ? "reberth" : "reroute",
      title,
      rationale,
      impact: {},
      proposedEffect: effect,
      validationStatus: validation.status,
      validatedEffect: validation.status === "valid" ? effect : undefined,
      validationMessage: validation.status === "valid" ? undefined : validation.message,
      status: "pending",
      createdTick: sim.clock.tick,
      provenance: "user_input",
    };
    sim.recommendations.push(rec);
    set({ sim });
    if (validation.status === "valid") showToast(`Move planned: ${title} — review it in the decision queue.`, "info");
    else showToast(`Planned move is invalid: ${validation.message}`, "error");
  },

  approveRecommendation: (id) => {
    const sim = clone(get().sim);
    const rec = sim.recommendations.find((r) => r.id === id);
    if (!rec || rec.status !== "pending") return;
    const validation = validateEffect(sim, rec.proposedEffect);
    if (validation.status !== "valid") {
      rec.validationStatus = "invalid";
      rec.validatedEffect = undefined;
      rec.validationMessage = validation.message;
      set({ sim });
      showToast(`Cannot apply: ${validation.message}`, "error");
      return;
    }
    // D-77: build the customer notice from the pre-apply state (the outlook's
    // delay/cover figures are what justified the advisory).
    const notice = rec.proposedEffect.kind === "safetyStockAdvisory" ? buildCustomerNotice(sim, rec) : null;
    applyEffect(sim, rec.proposedEffect);
    rec.status = "approved";
    rec.validatedEffect = rec.proposedEffect;
    rec.resolvedTick = sim.clock.tick; // D-76 action log
    if (import.meta.env.DEV) assertInvariants(sim);
    set(notice ? { sim, customerNotice: notice } : { sim });
    saveSession(sim, get().chat.messages); // D-76: decisions survive a refresh immediately
    showToast(`Approved: ${rec.title}`, "success");
  },

  dismissRecommendation: (id) => {
    set((s) => {
      const sim = clone(s.sim);
      const rec = sim.recommendations.find((r) => r.id === id);
      if (rec && rec.status === "pending") {
        rec.status = "dismissed";
        rec.resolvedTick = sim.clock.tick; // D-76 action log
      }
      return { sim };
    });
    saveSession(get().sim, get().chat.messages);
  },

  acknowledgeAlert: (id) =>
    set((s) => {
      const sim = clone(s.sim);
      const alert = sim.alerts.find((a) => a.id === id);
      if (alert) alert.acknowledged = true;
      return { sim };
    }),

  acknowledgeAllAlerts: () =>
    set((s) => {
      const sim = clone(s.sim);
      sim.alerts.forEach((a) => (a.acknowledged = true));
      return { sim };
    }),

  // Wall-clock weather poll (D-31). On success, feed the last-good reading into the sim
  // and refresh the resolved view immediately (so it updates even while paused). On
  // failure, flip to stale only after 3 consecutive misses or 30 min without success;
  // if no poll ever succeeded, the engine stays on its simulated fallback.
  pollWeather: async () => {
    try {
      const { reading, forecast } = mapWeather(await fetchRawWeather());
      weatherFailures = 0;
      weatherLastSuccessMs = Date.now();
      set((s) => {
        const sim = clone(s.sim);
        sim.weatherFeed = { reading, freshness: "live" };
        refreshWeather(sim);
        return { sim, weatherForecast: forecast, weatherFeedError: null };
      });
    } catch {
      weatherFailures += 1;
      const goStale =
        weatherFailures >= WEATHER_MAX_FAILURES ||
        (weatherLastSuccessMs > 0 && Date.now() - weatherLastSuccessMs > WEATHER_STALE_MS);
      set((s) => {
        const sim = clone(s.sim);
        if (goStale && sim.weatherFeed.reading) {
          sim.weatherFeed = { ...sim.weatherFeed, freshness: "stale" };
          refreshWeather(sim);
        }
        const plural = weatherFailures === 1 ? "poll" : "polls";
        const msg = sim.weatherFeed.reading
          ? `Weather feed unreachable — showing last-good reading (${weatherFailures} failed ${plural}).`
          : `Weather feed unreachable — using simulated fallback (${weatherFailures} failed ${plural}).`;
        return { sim, weatherFeedError: msg };
      });
    }
  },

  // Wall-clock lightning + haze poll (REAL-5, D-83). Same D-31 staleness rule as
  // pollWeather, tracked independently per source so one feed's outage doesn't
  // mask the other's freshness. Both requests fire together (one poll cycle);
  // each source's success/failure is handled on its own — Promise.allSettled so
  // one throwing never drops the other's result.
  pollMarineFeeds: async () => {
    const [lightningResult, hazeResult] = await Promise.allSettled([fetchLightningRaw(), fetchPsiRaw()]);
    const now = Date.now();
    const errors: string[] = [];

    set((s) => {
      const sim = clone(s.sim);
      let changed = false;

      if (lightningResult.status === "fulfilled") {
        lightningFailures = 0;
        lightningLastSuccessMs = now;
        sim.lightningFeed = { reading: mapLightning(lightningResult.value, now), freshness: "live" };
        changed = true;
      } else {
        lightningFailures += 1;
        const goStale = lightningFailures >= WEATHER_MAX_FAILURES || (lightningLastSuccessMs > 0 && now - lightningLastSuccessMs > WEATHER_STALE_MS);
        if (goStale && sim.lightningFeed.reading) {
          sim.lightningFeed = { ...sim.lightningFeed, freshness: "stale" };
          changed = true;
        }
        errors.push(sim.lightningFeed.reading ? "Lightning feed unreachable — showing last-good reading." : "Lightning feed unreachable — using precipitation-proxy fallback.");
      }

      if (hazeResult.status === "fulfilled") {
        hazeFailures = 0;
        hazeLastSuccessMs = now;
        sim.hazeFeed = { reading: mapHaze(hazeResult.value, now), freshness: "live" };
        changed = true;
      } else {
        hazeFailures += 1;
        const goStale = hazeFailures >= WEATHER_MAX_FAILURES || (hazeLastSuccessMs > 0 && now - hazeLastSuccessMs > WEATHER_STALE_MS);
        if (goStale && sim.hazeFeed.reading) {
          sim.hazeFeed = { ...sim.hazeFeed, freshness: "stale" };
          changed = true;
        }
        errors.push(sim.hazeFeed.reading ? "Haze feed unreachable — showing last-good reading." : "Haze feed unreachable — using calm-air fallback.");
      }

      if (changed) stepMarineEnvironment(sim);
      return { sim, marineFeedError: errors.length > 0 ? errors.join(" ") : null };
    });
  },

  // Send a chat turn: freeze a tick-stamped snapshot into the system prompt, stream the
  // reply, and route any tool call through the validator into the shared decision queue
  // (D-24, D-34). An LLM failure degrades the chat only — the rule engine keeps the queue
  // alive (D-12). D-74: a proposal that fails validation triggers ONE ephemeral feedback
  // turn so the model revises visibly instead of dead-ending; the [VALIDATION] message
  // rides only in the API exchange, never in the visible transcript (same ephemerality
  // as the D-67 tool exchanges).
  sendChatMessage: async (text) => {
    const trimmed = text.trim();
    if (!trimmed || get().chat.status === "streaming") return;

    const userMsg: ChatMessage = { id: `MSG-${Date.now()}-u`, role: "user", content: trimmed, recommendationIds: [] };
    const history = [...get().chat.messages, userMsg];
    set((s) => ({ chat: { ...s.chat, messages: history, status: "streaming", error: undefined } }));
    const startedAt = performance.now();

    let apiMessages: { role: "user" | "assistant"; content: string }[] = history
      .slice(-CHAT_WINDOW)
      .map((m) => ({ role: m.role, content: m.content }));
    let contextText = trimmed;

    // Everything in this loop can throw synchronously (buildChatContext walks
    // live route/berth/customer state) or asynchronously (streamChat). Either
    // way chat.status was already flipped to "streaming" above, so an
    // uncaught throw here would leave the input permanently disabled — this
    // is the P0 deadlock the rubric audit flagged. The outer try/catch
    // guarantees a recoverable "error" status no matter where the failure
    // originates.
    try {
    for (let depth = 0; depth <= MAX_VALIDATION_RETRIES; depth++) {
      const sim = get().sim;
      const { system, retrieved } = buildChatContext(sim, contextText, get().weatherForecast);
      const trace: ChatTrace = {
        tick: sim.clock.tick,
        simTime: formatSimTime(sim.clock.simMinutes),
        retrieved: retrieved.map((r) => ({ sectionId: r.section.sectionId, score: r.score, forced: r.forced })),
        searches: [],
        toolCalls: [],
        revision: depth > 0 ? true : undefined,
      };
      const asstId = `MSG-${Date.now()}-a${depth}`;
      const asstMsg: ChatMessage = { id: asstId, role: "assistant", content: "", recommendationIds: [], streaming: true, trace };
      set((s) => ({ chat: { ...s.chat, messages: [...s.chat.messages, asstMsg], status: "streaming" } }));

      const patchAsst = (fn: (m: ChatMessage) => ChatMessage) =>
        set((s) => ({ chat: { ...s.chat, messages: s.chat.messages.map((m) => (m.id === asstId ? fn(m) : m)) } }));

      let feedback: string | null = null;

      await streamChat(
        { system, messages: apiMessages, tools: [PROPOSE_ACTION_TOOL, SEARCH_DOCTRINE_TOOL] },
        {
          onText: (delta) => patchAsst((m) => ({ ...m, content: m.content + delta })),
          onTool: (event) =>
            patchAsst((m) => (m.trace ? { ...m, trace: { ...m.trace, searches: [...m.trace.searches, event] } } : m)),
          onDone: (toolCalls) => {
            const simClone = clone(get().sim);
            const recIds: string[] = [];
            const tracedCalls: ChatTrace["toolCalls"] = [];
            const rejected: { title: string; message: string }[] = [];
            for (const call of toolCalls) {
              if (call.name !== "propose_action") continue;
              const rec = parseAgentToolUse(simClone, call.input, `REC-A-${simClone.seq++}`);
              simClone.recommendations.push(rec);
              recIds.push(rec.id);
              tracedCalls.push({
                title: rec.title,
                kind: rec.proposedEffect.kind,
                validationStatus: rec.validationStatus,
                validationMessage: rec.validationMessage,
              });
              if (rec.validationStatus === "invalid") rejected.push({ title: rec.title, message: rec.validationMessage ?? "invalid" });
            }
            const willRetry = rejected.length > 0 && depth < MAX_VALIDATION_RETRIES;
            if (willRetry) {
              const accepted = recIds.length - rejected.length;
              feedback =
                `[VALIDATION] ${rejected.map((r) => `Your proposal "${r.title}" was REJECTED: ${r.message}`).join(" ")} ` +
                `Revise with a currently-valid target (e.g. a berth marked "free now"), propose holdVessel until one frees, ` +
                `or state that no action is possible right now. Never repeat a rejected proposal.` +
                (accepted > 0 ? " Your other proposal(s) were accepted — do not re-propose them." : "");
            }
            set((s) => ({
              sim: recIds.length ? simClone : s.sim,
              chat: {
                ...s.chat,
                status: willRetry ? "streaming" : "idle",
                llmHealth: "ok",
                messages: s.chat.messages.map((m) =>
                  m.id === asstId
                    ? { ...m, streaming: false, recommendationIds: recIds, responseMs: willRetry ? m.responseMs : performance.now() - startedAt, trace: m.trace && { ...m.trace, toolCalls: tracedCalls } }
                    : m,
                ),
              },
            }));
            if (recIds.length) showToast(`Operations Assistant proposed ${recIds.length} action${recIds.length > 1 ? "s" : ""} — approve in chat or from the decision queue.`, "info");
          },
          onError: (message) => {
            patchAsst((m) => ({ ...m, streaming: false }));
            set((s) => ({ chat: { ...s.chat, status: "error", llmHealth: "down", error: message } }));
          },
        },
      );

      if (!feedback) break;
      const asstText = get().chat.messages.find((m) => m.id === asstId)?.content ?? "";
      apiMessages = [
        ...apiMessages,
        { role: "assistant", content: asstText || "(proposed an action)" },
        { role: "user", content: feedback },
      ];
      contextText = feedback;
    }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      set((s) => ({
        chat: {
          ...s.chat,
          status: "error",
          llmHealth: "down",
          error: `Could not prepare a response (${message}).`,
          messages: s.chat.messages.map((m) => (m.streaming ? { ...m, streaming: false } : m)),
        },
      }));
    }
  },

  // One-off streamed interpretation of the resilience score for the cockpit (D-42). No
  // tools — the agent explains the calculated score, it never proposes or adjusts it.
  interpretScore: async () => {
    if (get().interpretation.status === "streaming") return;
    set({ interpretation: { text: "", status: "streaming" } });

    try {
      const sim = get().sim;
      const { system } = buildChatContext(sim, "interpret the resilience score weather berth yard crane", get().weatherForecast);
      await streamChat(
        {
          system,
          messages: [
            {
              role: "user",
              content:
                "In 2-3 sentences for the duty manager, interpret the current resilience score: the main stressors dragging it down right now and the single most useful next action. Cite specific KPI values and the relevant doctrine section. Do not call any tool.",
            },
          ],
        },
        {
          onText: (delta) => set((s) => ({ interpretation: { ...s.interpretation, text: s.interpretation.text + delta } })),
          onDone: () => set((s) => ({ interpretation: { ...s.interpretation, status: "idle" }, chat: { ...s.chat, llmHealth: "ok" } })),
          onError: (message) => set((s) => ({ interpretation: { text: message, status: "error" }, chat: { ...s.chat, llmHealth: "down" } })),
        },
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      set((s) => ({ interpretation: { text: message, status: "error" }, chat: { ...s.chat, llmHealth: "down" } }));
    }
  },

  // AIF-2: the agent acts as a monitor, not only an on-demand chatbot. A review
  // is dispatched immediately (the manager no longer has to press Send), while
  // every proposal it produces still goes through deterministic validation and
  // explicit human approval — the AI advises, the duty manager decides.
  runAgentReview: async (prompt) => {
    if (get().chat.status === "streaming") return;
    set((s) => ({ chatOpenSignal: s.chatOpenSignal + 1 }));
    await get().sendChatMessage(prompt);
  },

  // Dedup guard for the proactive watcher: one review per disruption id, so a
  // long-running incident cannot re-trigger the agent every tick.
  claimDisruptionReview: (disruptionId) => {
    if (get().reviewedDisruptionIds.includes(disruptionId)) return false;
    set((s) => ({ reviewedDisruptionIds: [...s.reviewedDisruptionIds, disruptionId] }));
    return true;
  },
}));
