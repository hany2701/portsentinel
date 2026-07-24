import { safetyStockShortfallDays, validateEffect } from "../sim";
import { rerouteReason, routeCandidates } from "../maritime/routeEngine";
import type { Recommendation, RecommendationImpact, SimulationEffect, SimState } from "../sim";

// A JSON tool schema (Anthropic tool shape) kept SDK-free so it can ride in the client
// bundle and the request body; the serverless handler casts it to the SDK's Tool type.
export type AgentTool = {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
};

// The agent's proposable actions mirror the rule-engine families and the one
// decision queue (D-34). holdVessel joined in INT-5 (D-55 agent parity — holds
// are validated against a future tick like any rule-engine hold); closeBerth
// stays deliberately excluded — the agent advises operational moves, it does
// not inject scenarios.
const KIND_TO_TYPE = {
  reassignBerth: "reberth",
  divertVessel: "reroute",
  holdVessel: "hold",
  reallocateYard: "yardRealloc",
  safetyStockAdvisory: "safetyStock",
  // GR-9: voyage rerouting. The agent may only nominate a route it was SHOWN in
  // the reroute-advisory context — the validator rejects anything else, so it
  // cannot invent a path.
  rerouteVoyage: "reroute",
} as const;

type AgentKind = keyof typeof KIND_TO_TYPE;

export const PROPOSE_ACTION_TOOL: AgentTool = {
  name: "propose_action",
  description:
    "Propose ONE operational recommendation for the duty manager to approve. Only call this when doctrine thresholds are breached or trending toward breach, the action maps to a listed kind, and no equivalent recommendation is already pending. The rationale MUST cite specific state values and the relevant doctrine section (e.g. [OPS-BERTH §3]). Do not claim the action was executed — the human approves it.",
  input_schema: {
    type: "object",
    properties: {
      kind: {
        type: "string",
        enum: Object.keys(KIND_TO_TYPE),
        description: "reassignBerth (move a waiting vessel to an available berth), divertVessel (send an approaching/anchored vessel to an alternate port — only when its projected wait exceeds the extra sailing time), holdVessel (hold an approaching/anchored vessel at sea until a future tick — prefer this over diverting when waiting is cheaper than sailing), reallocateYard (move cargo lots to another block), safetyStockAdvisory (advise a customer raise safety stock), rerouteVoyage (change a sailing vessel's route to the SAME destination port — only using a route listed in the reroute advisories; see MAR-ROUTE §1 for reroute vs hold vs divert).",
      },
      title: { type: "string", description: "Short imperative title, e.g. 'Re-berth Tanjong Maru to B4'." },
      rationale: { type: "string", description: "Why, citing state values and a doctrine section." },
      vesselId: { type: "string", description: "Required for reassignBerth, divertVessel and holdVessel." },
      toBerthId: { type: "string", description: "Target berth id for reassignBerth." },
      toPortId: { type: "string", description: "Alternate port id for divertVessel." },
      untilTick: { type: "number", description: "Future tick to hold until, for holdVessel. Must be greater than the current tick." },
      toNodeIds: {
        type: "array",
        items: { type: "string" },
        description:
          "Route node ids for rerouteVoyage, in order. Must be a route offered in the reroute advisories — do not compose your own. It must start at the node immediately ahead of the vessel and end at its CURRENT destination; the validator rejects any other path.",
      },
      lotIds: { type: "array", items: { type: "string" }, description: "Cargo lot ids for reallocateYard." },
      toBlockId: { type: "string", description: "Target yard block id for reallocateYard." },
      customerId: { type: "string", description: "Customer id for safetyStockAdvisory. The safety-stock quantity (days) is computed by the system from the customer's cover and worst shipment delay — you cannot set it (OPS-CARGO §4)." },
      note: { type: "string", description: "Advisory note for safetyStockAdvisory." },
      impact: {
        type: "object",
        description: "Estimated impact where known.",
        properties: {
          waitHoursSaved: { type: "number" },
          teuProtected: { type: "number" },
          utilizationDeltaPct: { type: "number" },
        },
      },
    },
    required: ["kind", "title", "rationale"],
  },
};

// D-67: agentic retrieval. Resolved server-side inside api/chat.ts (TF-IDF over
// the doctrine corpus); each call surfaces as an SSE `tool` event in the trace.
export const SEARCH_DOCTRINE_TOOL: AgentTool = {
  name: "search_doctrine",
  description:
    "Search the operational doctrine corpus for a rule NOT already present in the retrieved sections of the system prompt. The always-on doctrine index lists every document title — use this only to fetch the body of a section you need but were not given. Do not re-search sections already provided. Each search is shown to the duty manager in the reply's trace.",
  input_schema: {
    type: "object",
    properties: {
      query: { type: "string", description: "Free-text query, e.g. 'dwell escalation thresholds'." },
    },
    required: ["query"],
  },
};

type ToolInput = Record<string, unknown>;

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

function buildEffect(state: SimState, input: ToolInput): SimulationEffect | { error: string } {
  const kind = input.kind as AgentKind;
  switch (kind) {
    case "reassignBerth": {
      const vesselId = str(input.vesselId);
      const toBerthId = str(input.toBerthId);
      if (!vesselId || !toBerthId) return { error: "reassignBerth needs vesselId and toBerthId." };
      return { kind, vesselId, toBerthId };
    }
    case "divertVessel": {
      const vesselId = str(input.vesselId);
      const toPortId = str(input.toPortId);
      if (!vesselId || !toPortId) return { error: "divertVessel needs vesselId and toPortId." };
      return { kind, vesselId, toPortId };
    }
    case "holdVessel": {
      const vesselId = str(input.vesselId);
      const untilTick = typeof input.untilTick === "number" && Number.isFinite(input.untilTick) ? Math.round(input.untilTick) : undefined;
      if (!vesselId || untilTick === undefined) return { error: "holdVessel needs vesselId and a numeric untilTick." };
      return { kind, vesselId, untilTick };
    }
    case "reallocateYard": {
      const lotIds = Array.isArray(input.lotIds) ? input.lotIds.filter((x): x is string => typeof x === "string") : [];
      const toBlockId = str(input.toBlockId);
      if (lotIds.length === 0 || !toBlockId) return { error: "reallocateYard needs lotIds and toBlockId." };
      return { kind, lotIds, toBlockId };
    }
    case "rerouteVoyage": {
      const vesselId = str(input.vesselId);
      const toNodeIds = Array.isArray(input.toNodeIds)
        ? input.toNodeIds.filter((x): x is string => typeof x === "string")
        : [];
      if (!vesselId || toNodeIds.length < 2) {
        return { error: "rerouteVoyage needs vesselId and a toNodeIds route of at least two nodes." };
      }
      // GR-9 hallucination boundary, mirroring the safety-stock rule above: the
      // route must be one the ROUTING SERVICE produced for this vessel. A path
      // the model composed itself is rejected here rather than being handed to
      // the validator, so an invented route can never reach the decision queue
      // even if it happens to be graph-connected.
      const offered = routeCandidates(state, vesselId).map((c) => c.nodeIds.join(">"));
      if (!offered.includes(toNodeIds.join(">"))) {
        return {
          error:
            "Proposed route is not among the alternatives the routing service generated for this vessel. " +
            "Choose one of the listed reroute advisories (MAR-ROUTE §8).",
        };
      }
      // The reason is deterministic — it is why the route degraded, not the
      // model's characterisation of it.
      const reason = rerouteReason(state, vesselId) ?? "weather";
      const decisionId = state.maritime.rerouteDecisions.find(
        (d) => d.vesselId === vesselId && d.approvalStatus === "pending",
      )?.id;
      return { kind, vesselId, toNodeIds, reason, decisionId };
    }
    case "safetyStockAdvisory": {
      const customerId = str(input.customerId);
      if (!customerId) return { error: "safetyStockAdvisory needs customerId." };
      // D-56 hallucination boundary: the quantity has exactly one author — the
      // shared shortfall calculation. Any days the LLM sends are ignored.
      const days = safetyStockShortfallDays(state, customerId);
      return { kind, customerId, days, note: str(input.note) ?? `Raise safety stock by ${days} days.` };
    }
    default:
      return { error: `Unknown action kind '${String(kind)}'.` };
  }
}

function parseImpact(raw: unknown): RecommendationImpact {
  const impact: RecommendationImpact = {};
  if (raw && typeof raw === "object") {
    const o = raw as Record<string, unknown>;
    if (typeof o.waitHoursSaved === "number") impact.waitHoursSaved = o.waitHoursSaved;
    if (typeof o.teuProtected === "number") impact.teuProtected = o.teuProtected;
    if (typeof o.utilizationDeltaPct === "number") impact.utilizationDeltaPct = o.utilizationDeltaPct;
  }
  return impact;
}

/**
 * Turn one agent `propose_action` tool call into a validated Recommendation. Mirrors the
 * rule-engine pipeline: build the typed effect, validate against current state, and stamp
 * provenance `ai_generated`. Only a `valid` result carries a validatedEffect; approval
 * re-validates before anything executes (D-24).
 */
export function parseAgentToolUse(state: SimState, input: ToolInput, id: string): Recommendation {
  const kind = (str(input.kind) ?? "") as AgentKind;
  const type = KIND_TO_TYPE[kind] ?? "reberth";
  const built = buildEffect(state, input);

  const base: Omit<Recommendation, "proposedEffect" | "validationStatus" | "validatedEffect" | "validationMessage"> = {
    id,
    source: "agent",
    type,
    title: str(input.title) ?? "Agent recommendation",
    rationale: str(input.rationale) ?? "",
    impact: parseImpact(input.impact),
    status: "pending",
    createdTick: state.clock.tick,
    provenance: "ai_generated",
  };

  if ("error" in built) {
    return { ...base, proposedEffect: { kind: "safetyStockAdvisory", customerId: "", days: 1, note: "" }, validationStatus: "invalid", validationMessage: built.error };
  }

  const validation = validateEffect(state, built);
  return {
    ...base,
    proposedEffect: built,
    validationStatus: validation.status,
    validatedEffect: validation.status === "valid" ? built : undefined,
    validationMessage: validation.status === "valid" ? undefined : validation.message,
  };
}
