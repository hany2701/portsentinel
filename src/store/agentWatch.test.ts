import { describe, it, expect, vi, beforeEach } from "vitest";

// AIF-2 coverage: the agent must review a severe disruption on its own, exactly
// once per incident, and must never execute anything without human approval.
vi.mock("../services/chatClient", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/chatClient")>();
  return { ...actual, streamChat: vi.fn() };
});

import { streamChat, type StreamHandlers, type ChatRequest } from "../services/chatClient";
import { useSimStore } from "./simStore";
import { reviewPromptFor, SEVERE_DISRUPTION_SEVERITY } from "../hooks/useAgentWatch";

const mockStream = vi.mocked(streamChat);

beforeEach(() => {
  mockStream.mockReset();
  useSimStore.setState({ reviewedDisruptionIds: [], chatOpenSignal: 0 });
});

describe("proactive agent review (AIF-2)", () => {
  it("dispatches the review without the manager pressing Send, and opens the chat", async () => {
    const store = useSimStore.getState();
    store.reset(20260724);

    mockStream.mockImplementationOnce(async (_body: ChatRequest, h: StreamHandlers) => {
      h.onText("Assessment: two vessels exposed.");
      h.onDone([], "end_turn");
    });

    const before = useSimStore.getState().chatOpenSignal;
    await store.runAgentReview("Assess the storm now.");

    const state = useSimStore.getState();
    expect(state.chatOpenSignal).toBeGreaterThan(before);
    expect(mockStream).toHaveBeenCalledTimes(1);
    expect(state.chat.messages.some((m) => m.role === "user" && m.content === "Assess the storm now.")).toBe(true);
    expect(state.chat.status).toBe("idle");
  });

  it("reviews each disruption only once (dedup guard)", () => {
    const store = useSimStore.getState();
    expect(store.claimDisruptionReview("DIS-1")).toBe(true);
    expect(store.claimDisruptionReview("DIS-1")).toBe(false);
    expect(useSimStore.getState().claimDisruptionReview("DIS-2")).toBe(true);
  });

  it("never auto-executes: an agent review leaves proposals pending approval", async () => {
    const store = useSimStore.getState();
    store.reset(20260724);
    const approvedBefore = useSimStore
      .getState()
      .sim.recommendations.filter((r) => r.status === "approved").length;

    mockStream.mockImplementationOnce(async (_body: ChatRequest, h: StreamHandlers) => {
      h.onText("Proposing a hold.");
      h.onDone([], "end_turn");
    });
    await store.runAgentReview("Review now.");

    const recs = useSimStore.getState().sim.recommendations;
    expect(recs.filter((r) => r.status === "approved").length).toBe(approvedBefore);
  });

  it("builds a grounded, incident-specific prompt", () => {
    const prompt = reviewPromptFor({
      id: "DIS-7",
      type: "storm",
      targetIds: ["B3", "B4"],
      startTick: 40,
      durationTicks: 30,
      severity: SEVERE_DISRUPTION_SEVERITY,
    });
    expect(prompt).toContain("DIS-7");
    expect(prompt).toContain("storm");
    expect(prompt).toContain("B3, B4");
    expect(prompt.toLowerCase()).toContain("no action is warranted");
  });
});
