import { describe, it, expect, vi, beforeEach } from "vitest";

// The evaluator journey the rubric audit found untested end-to-end:
// inject crisis → agent review → grounded proposal → deterministic validation
// → human approval → visible state change. Covers the seam between the
// simulation, the agent pipeline and the decision queue in one pass.
vi.mock("../services/chatClient", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/chatClient")>();
  return { ...actual, streamChat: vi.fn() };
});

import { streamChat, type StreamHandlers, type ChatRequest } from "../services/chatClient";
import { useSimStore } from "./simStore";

const mockStream = vi.mocked(streamChat);

beforeEach(() => {
  mockStream.mockReset();
  useSimStore.setState({ reviewedDisruptionIds: [], chatOpenSignal: 0 });
});

describe("crisis → recommendation → approval journey", () => {
  it("runs the full loop and leaves the simulation visibly changed", async () => {
    const store = useSimStore.getState();
    store.reset(20260724);

    // 1. A severe disruption is injected.
    store.injectDisruption("storm", 3);
    const withCrisis = useSimStore.getState().sim;
    expect(withCrisis.disruptions.some((d) => d.severity === 3)).toBe(true);

    // 2. The agent proposes a hold on a real anchored vessel — a proposal the
    //    deterministic validator can accept.
    const vessel = withCrisis.vessels.find((v) => v.status === "anchored");
    expect(vessel).toBeDefined();

    mockStream.mockImplementationOnce(async (_body: ChatRequest, h: StreamHandlers) => {
      h.onText("Recommend holding the vessel until the corridor clears [OPS-BERTH §3].");
      h.onDone(
        [
          {
            id: "t1",
            name: "propose_action",
            input: {
              kind: "holdVessel",
              vesselId: vessel!.id,
              untilTick: withCrisis.clock.tick + 12,
              title: `Hold ${vessel!.name}`,
              rationale: "Storm on the approach [OPS-BERTH §3]",
            },
          },
        ],
        "tool_use",
      );
    });

    await store.runAgentReview("Assess the storm and propose action.");

    // 3. The proposal is queued and validated, NOT executed.
    const afterReview = useSimStore.getState();
    expect(afterReview.chat.status).toBe("idle");
    const rec = afterReview.sim.recommendations[afterReview.sim.recommendations.length - 1];
    expect(rec.source).toBe("agent");
    expect(rec.status).toBe("pending");
    expect(rec.validationStatus).toBe("valid");

    // 4. The manager approves — only now does state change.
    store.approveRecommendation(rec.id);

    const afterApproval = useSimStore.getState().sim;
    const approved = afterApproval.recommendations.find((r) => r.id === rec.id)!;
    expect(approved.status).toBe("approved");
    const held = afterApproval.vessels.find((v) => v.id === vessel!.id)!;
    expect(held.heldUntilTick).toBeGreaterThan(afterApproval.clock.tick);
  });

  it("rejects a hallucinated target before it can reach the queue as valid", async () => {
    const store = useSimStore.getState();
    store.reset(20260724);

    mockStream.mockImplementation(async (_body: ChatRequest, h: StreamHandlers) => {
      h.onText("Proposing.");
      h.onDone(
        [
          {
            id: "t1",
            name: "propose_action",
            input: {
              kind: "reassignBerth",
              vesselId: "V-DOES-NOT-EXIST",
              toBerthId: "B1",
              title: "Re-berth phantom",
              rationale: "test [OPS-BERTH §3]",
            },
          },
        ],
        "tool_use",
      );
    });

    await store.runAgentReview("Re-berth the phantom vessel.");

    const recs = useSimStore.getState().sim.recommendations;
    const phantom = recs[recs.length - 1];
    expect(phantom.validationStatus).toBe("invalid");
    expect(phantom.status).toBe("pending");
  });

  it("stays usable when the assistant is unavailable mid-crisis", async () => {
    const store = useSimStore.getState();
    store.reset(20260724);
    store.injectDisruption("storm", 3);

    mockStream.mockImplementationOnce(async (_body: ChatRequest, h: StreamHandlers) => {
      h.onError("Assistant offline: ANTHROPIC_API_KEY is not configured.");
    });

    await store.runAgentReview("Assess the storm.");

    const state = useSimStore.getState();
    expect(state.chat.status).toBe("error");
    expect(state.chat.status).not.toBe("streaming");
    // The deterministic surfaces keep working — the manager can still act.
    expect(state.sim.disruptions.some((d) => d.severity === 3)).toBe(true);
  });
});
