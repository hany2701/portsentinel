import { describe, it, expect, vi, beforeEach } from "vitest";

// Regression coverage for the P0 rubric-audit finding: a resumed session with
// a disconnected saved route crashes buildChatContext() before streamChat()
// is entered, and with no outer try/catch the store was left with
// chat.status === "streaming" forever (input permanently disabled). See
// TUAS_RUBRIC_AUDIT.md §5.2 "Chat context failure leaves the assistant
// permanently locked".
vi.mock("../services/chatClient", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/chatClient")>();
  return { ...actual, streamChat: vi.fn() };
});

vi.mock("../utils/contextBuilder", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../utils/contextBuilder")>();
  return { ...actual, buildChatContext: vi.fn(actual.buildChatContext) };
});

import { streamChat, type StreamHandlers, type ChatRequest } from "../services/chatClient";
import { buildChatContext } from "../utils/contextBuilder";
import { useSimStore } from "./simStore";
import { saveSession, loadSession, clearSession } from "./persistence";
import { isConnectedSequence } from "../maritime/graph";

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
const mockContext = vi.mocked(buildChatContext);

beforeEach(() => {
  mockStream.mockReset();
  mockContext.mockClear();
  mem.clear();
});

describe("chat deadlock regression (P0)", () => {
  it("never leaves chat.status stuck on streaming when context building throws", async () => {
    const store = useSimStore.getState();
    store.reset(20260724);

    mockContext.mockImplementationOnce(() => {
      throw new Error("Route sequence is not connected at PORT-HONGKONG→WPT-TAIWAN-STRAIT");
    });

    await store.sendChatMessage("Which vessels are waiting at anchorage?");

    const chat = useSimStore.getState().chat;
    expect(chat.status).not.toBe("streaming");
    expect(chat.status).toBe("error");
    expect(chat.messages.every((m) => !m.streaming)).toBe(true);
  });

  it("recovers cleanly on the next send after a context-build failure", async () => {
    const store = useSimStore.getState();
    store.reset(20260724);

    mockContext.mockImplementationOnce(() => {
      throw new Error("boom");
    });
    await store.sendChatMessage("first message");
    expect(useSimStore.getState().chat.status).toBe("error");

    mockStream.mockImplementationOnce(async (_body: ChatRequest, h: StreamHandlers) => {
      h.onText("Grounded answer.");
      h.onDone([], "end_turn");
    });
    await store.sendChatMessage("second message");
    expect(useSimStore.getState().chat.status).toBe("idle");
  });
});

describe("saved-session route validation (P0)", () => {
  it("rejects a disconnected node pair used by the regression above (sanity check)", () => {
    expect(isConnectedSequence(["PORT-HONGKONG", "WPT-TAIWAN-STRAIT"])).toBe(false);
  });

  it("discards a saved session whose active route plan is disconnected", () => {
    const store = useSimStore.getState();
    store.reset(20260724);
    const sim = useSimStore.getState().sim;
    const plan = sim.maritime.routePlans.find((p) => p.status === "active");
    expect(plan).toBeDefined();

    const brokenSim = {
      ...sim,
      maritime: {
        ...sim.maritime,
        routePlans: sim.maritime.routePlans.map((p) =>
          p.id === plan!.id ? { ...p, nodeIds: ["PORT-HONGKONG", "WPT-TAIWAN-STRAIT"] } : p,
        ),
      },
    };

    saveSession(brokenSim, []);
    expect(loadSession()).toBeNull();
  });

  it("keeps a saved session whose routes are all connected", () => {
    const store = useSimStore.getState();
    store.reset(20260724);
    for (let i = 0; i < 15; i++) store.tickOnce();
    const sim = useSimStore.getState().sim;
    saveSession(sim, []);
    expect(loadSession()).not.toBeNull();
    clearSession();
  });
});
