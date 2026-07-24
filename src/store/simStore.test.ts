import { describe, it, expect, vi, beforeEach } from "vitest";

// D-68/D-74 tests: stub the SSE client so chat turns run the real store pipeline
// (buildChatContext → trace stamp → onTool → onDone validation → D-74 feedback
// retry) without a network or an API key. Implementations are set per test.
vi.mock("../services/chatClient", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/chatClient")>();
  return { ...actual, streamChat: vi.fn() };
});

import { streamChat, type StreamHandlers, type ChatRequest } from "../services/chatClient";
import { useSimStore } from "./simStore";
import { saveSession, loadSession, clearSession } from "./persistence";

// D-76: node has no localStorage — back it with a Map for the persistence tests.
const mem = new Map<string, string>();
(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, v),
  removeItem: (k: string) => void mem.delete(k),
  clear: () => mem.clear(),
  key: () => null,
  get length() {
    return mem.size;
  },
} as Storage;

const mockStream = vi.mocked(streamChat);

const GHOST_PROPOSAL = {
  id: "t1",
  name: "propose_action",
  input: { kind: "reassignBerth", vesselId: "V-NOPE", toBerthId: "B1", title: "Re-berth ghost", rationale: "test [OPS-BERTH §3]" },
};

beforeEach(() => {
  mockStream.mockReset();
});

describe("chat response trace (D-68)", () => {
  it("stamps tick + retrieved doctrine, records searches, and captures tool-call validation outcomes", async () => {
    mockStream
      .mockImplementationOnce(async (_body: ChatRequest, h: StreamHandlers) => {
        h.onTool?.({ query: "dwell", results: [{ sectionId: "OPS-CARGO §2", score: 2.4 }] });
        h.onText("Grounded answer.");
        h.onDone([GHOST_PROPOSAL], "tool_use");
      })
      .mockImplementationOnce(async (_body: ChatRequest, h: StreamHandlers) => {
        h.onText("Revised: hold instead.");
        h.onDone([], "end_turn");
      });

    const store = useSimStore.getState();
    store.reset(20260710);
    const before = useSimStore.getState().chat.messages.length;
    await store.sendChatMessage("what are the dwell rules for cargo?");

    const turn = useSimStore.getState().chat.messages.slice(before);
    const asst = turn[1];
    expect(asst.role).toBe("assistant");
    expect(asst.streaming).toBe(false);
    expect(asst.content).toBe("Grounded answer.");

    const trace = asst.trace!;
    expect(trace.tick).toBe(useSimStore.getState().sim.clock.tick);
    expect(trace.simTime).toBeTruthy();
    // "dwell" is a body-only term — retrieved via TF-IDF scoring, not forced.
    expect(trace.retrieved.some((r) => r.sectionId === "OPS-CARGO §2" && !r.forced && r.score > 0)).toBe(true);
    expect(trace.searches).toEqual([{ query: "dwell", results: [{ sectionId: "OPS-CARGO §2", score: 2.4 }] }]);
    // The ghost vessel fails validation; the trace records the outcome verbatim.
    expect(trace.toolCalls).toHaveLength(1);
    expect(trace.toolCalls[0].kind).toBe("reassignBerth");
    expect(trace.toolCalls[0].validationStatus).toBe("invalid");
    expect(trace.toolCalls[0].validationMessage).toBeTruthy();
    expect(asst.recommendationIds).toHaveLength(1);
  });
});

describe("validation feedback loop (D-74)", () => {
  it("sends one ephemeral feedback turn and streams a revision bubble after a rejected proposal", async () => {
    mockStream
      .mockImplementationOnce(async (_body: ChatRequest, h: StreamHandlers) => {
        h.onText("Proposing.");
        h.onDone([GHOST_PROPOSAL], "tool_use");
      })
      .mockImplementationOnce(async (_body: ChatRequest, h: StreamHandlers) => {
        h.onText("Revised: hold the vessel until B11 frees.");
        h.onDone([], "end_turn");
      });

    const store = useSimStore.getState();
    store.reset(20260710);
    const before = useSimStore.getState().chat.messages.length;
    await store.sendChatMessage("re-berth the ghost vessel");

    const turn = useSimStore.getState().chat.messages.slice(before);
    // user + first assistant + revision assistant; the [VALIDATION] feedback is
    // NEVER a visible transcript message.
    expect(turn.map((m) => m.role)).toEqual(["user", "assistant", "assistant"]);
    const revision = turn[2];
    expect(revision.content).toBe("Revised: hold the vessel until B11 frees.");
    expect(revision.trace?.revision).toBe(true);
    expect(revision.streaming).toBe(false);
    expect(useSimStore.getState().chat.status).toBe("idle");

    expect(mockStream).toHaveBeenCalledTimes(2);
    const retryBody = mockStream.mock.calls[1][0];
    const last = retryBody.messages[retryBody.messages.length - 1];
    expect(last.role).toBe("user");
    expect(last.content).toContain("[VALIDATION]");
    expect(last.content).toContain("REJECTED");
    expect(last.content).toContain("Re-berth ghost");
  });

  it("caps at one retry — a still-invalid revision never triggers a third call", async () => {
    mockStream.mockImplementation(async (_body: ChatRequest, h: StreamHandlers) => {
      h.onText("Proposing the ghost again.");
      h.onDone([GHOST_PROPOSAL], "tool_use");
    });

    const store = useSimStore.getState();
    store.reset(20260710);
    await store.sendChatMessage("keep proposing the ghost");

    expect(mockStream).toHaveBeenCalledTimes(2); // initial + exactly one retry
    expect(useSimStore.getState().chat.status).toBe("idle");
  });
});

describe("manual re-berth/divert (D-69)", () => {
  it("routes a valid user move through validate → queue → approve", () => {
    const store = useSimStore.getState();
    store.reset(20260710);
    let sim = useSimStore.getState().sim;
    const vessel = sim.vessels.find((v) => v.status === "anchored" && v.class !== "neopanamax")!;
    const berth = sim.berths.find((b) => b.status === "available")!;

    store.proposeUserAction({ kind: "reassignBerth", vesselId: vessel.id, toBerthId: berth.id }, `Re-berth ${vessel.name} to ${berth.id}`);
    sim = useSimStore.getState().sim;
    const rec = sim.recommendations[sim.recommendations.length - 1];
    expect(rec.source).toBe("user");
    expect(rec.provenance).toBe("user_input");
    expect(rec.validationStatus).toBe("valid");
    expect(rec.rationale).toContain("[calculated]");

    store.approveRecommendation(rec.id);
    sim = useSimStore.getState().sim;
    const approved = sim.recommendations.find((r) => r.id === rec.id)!;
    expect(approved.status).toBe("approved");
    expect(approved.resolvedTick).toBe(sim.clock.tick); // D-76 action log stamp
    expect(sim.vessels.find((v) => v.id === vessel.id)!.berthId).toBe(berth.id);
  });

  it("queues an illegal user move as invalid — unapprovable", () => {
    const store = useSimStore.getState();
    store.reset(20260710);
    let sim = useSimStore.getState().sim;
    const vessel = sim.vessels.find((v) => v.status === "anchored")!;
    const occupied = sim.berths.find((b) => b.status === "occupied")!;

    store.proposeUserAction({ kind: "reassignBerth", vesselId: vessel.id, toBerthId: occupied.id }, "Bad move");
    sim = useSimStore.getState().sim;
    const rec = sim.recommendations[sim.recommendations.length - 1];
    expect(rec.validationStatus).toBe("invalid");
    expect(rec.validationMessage).toBeTruthy();
    expect(rec.validatedEffect).toBeUndefined();
  });

  it("stamps resolvedTick on dismiss too (D-76)", () => {
    const store = useSimStore.getState();
    store.reset(20260710);
    let sim = useSimStore.getState().sim;
    const vessel = sim.vessels.find((v) => v.status === "anchored" && v.class !== "neopanamax")!;
    const berth = sim.berths.find((b) => b.status === "available")!;
    store.proposeUserAction({ kind: "reassignBerth", vesselId: vessel.id, toBerthId: berth.id }, "To dismiss");
    sim = useSimStore.getState().sim;
    const rec = sim.recommendations[sim.recommendations.length - 1];
    store.dismissRecommendation(rec.id);
    sim = useSimStore.getState().sim;
    const dismissed = sim.recommendations.find((r) => r.id === rec.id)!;
    expect(dismissed.status).toBe("dismissed");
    expect(dismissed.resolvedTick).toBe(sim.clock.tick);
  });
});

describe("session persistence (D-76)", () => {
  it("round-trips the full sim + chat through localStorage byte-identically", () => {
    clearSession();
    const store = useSimStore.getState();
    store.reset(20260710);
    for (let i = 0; i < 15; i++) store.tickOnce(); // crosses the autosave interval
    const sim = useSimStore.getState().sim;

    const auto = loadSession();
    expect(auto).not.toBeNull(); // tick 10 autosaved
    saveSession(sim, [{ id: "m1", role: "user", content: "hello", recommendationIds: [] }]);
    const loaded = loadSession()!;
    expect(loaded.sim).toEqual(JSON.parse(JSON.stringify(sim))); // JSON-stable state
    expect(loaded.sim.clock.tick).toBe(15);
    expect(loaded.chatMessages).toHaveLength(1);

    store.resumeSaved(loaded);
    const resumed = useSimStore.getState();
    expect(resumed.sim.clock.tick).toBe(15);
    expect(resumed.sim.clock.running).toBe(false); // resumes paused
    expect(resumed.chat.messages[resumed.chat.messages.length - 1].content).toBe("hello");

    // A resumed world stays deterministic: ticking it matches ticking the original.
    const a = JSON.parse(JSON.stringify(useSimStore.getState().sim));
    store.tickOnce();
    const afterResume = useSimStore.getState().sim.clock.tick;
    expect(afterResume).toBe(16);
    expect(a.rng).toEqual(JSON.parse(JSON.stringify(sim)).rng);

    store.discardSaved();
    expect(loadSession()).toBeNull();
  });
});
