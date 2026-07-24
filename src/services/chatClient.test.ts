import { describe, it, expect, vi, afterEach } from "vitest";
import { streamChat, type StreamHandlers } from "./chatClient";
import { validateChatBody, MAX_BODY_BYTES } from "../../api/chat";

// Seam coverage the unit suite did not have: the SSE contract between the
// browser client and the serverless proxy, including the failure modes that
// previously left the chat input disabled forever.

function sseResponse(chunks: string[]): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(encoder.encode(c));
      controller.close();
    },
  });
  return new Response(stream, { status: 200, headers: { "content-type": "text/event-stream" } });
}

function handlers() {
  const calls = { text: [] as string[], done: 0, error: [] as string[], tools: [] as unknown[] };
  const h: StreamHandlers = {
    onText: (d) => calls.text.push(d),
    onDone: () => void calls.done++,
    onError: (m) => calls.error.push(m),
    onTool: (e) => calls.tools.push(e),
  };
  return { h, calls };
}

const REQ = { system: "s", messages: [{ role: "user" as const, content: "hi" }] };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("SSE client contract", () => {
  it("dispatches text, tool and done events in order", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        sseResponse([
          'event: text\ndata: {"text":"Hello "}\n\n',
          'event: tool\ndata: {"query":"dwell","results":[]}\n\n',
          'event: text\ndata: {"text":"world"}\n\n',
          'event: done\ndata: {"toolCalls":[],"stopReason":"end_turn"}\n\n',
        ]),
      ),
    );
    const { h, calls } = handlers();
    await streamChat(REQ, h);
    expect(calls.text.join("")).toBe("Hello world");
    expect(calls.tools).toHaveLength(1);
    expect(calls.done).toBe(1);
    expect(calls.error).toHaveLength(0);
  });

  it("reassembles events split across chunk boundaries", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        sseResponse(['event: te', 'xt\ndata: {"text":"split"}', "\n\n", 'event: done\ndata: {"toolCalls":[]}\n\n']),
      ),
    );
    const { h, calls } = handlers();
    await streamChat(REQ, h);
    expect(calls.text.join("")).toBe("split");
    expect(calls.done).toBe(1);
  });

  it("reports an interrupted stream that never sends a terminal event", async () => {
    // The regression that would otherwise leave chat.status === "streaming".
    vi.stubGlobal("fetch", vi.fn(async () => sseResponse(['event: text\ndata: {"text":"partial"}\n\n'])));
    const { h, calls } = handlers();
    await streamChat(REQ, h);
    expect(calls.done).toBe(0);
    expect(calls.error).toHaveLength(1);
  });

  it("surfaces a missing API key as a readable error, not a hang", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: "Assistant offline: ANTHROPIC_API_KEY is not configured." }), {
            status: 503,
            headers: { "content-type": "application/json" },
          }),
      ),
    );
    const { h, calls } = handlers();
    await streamChat(REQ, h);
    expect(calls.error[0]).toContain("ANTHROPIC_API_KEY");
  });

  it("surfaces a network failure without throwing", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("network down");
    }));
    const { h, calls } = handlers();
    await expect(streamChat(REQ, h)).resolves.toBeUndefined();
    expect(calls.error).toHaveLength(1);
  });

  it("ignores malformed SSE blocks without ending the turn early", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        sseResponse(["event: text\ndata: {not json}\n\n", 'event: done\ndata: {"toolCalls":[]}\n\n']),
      ),
    );
    const { h, calls } = handlers();
    await streamChat(REQ, h);
    expect(calls.done).toBe(1);
    expect(calls.error).toHaveLength(0);
  });
});

describe("API request validation", () => {
  it("accepts a well-formed turn", () => {
    expect(validateChatBody(REQ)).toBeNull();
  });

  it("rejects malformed bodies with a reason", () => {
    expect(validateChatBody(null)).toBeTruthy();
    expect(validateChatBody({})).toBeTruthy();
    expect(validateChatBody({ system: "s", messages: [] })).toBeTruthy();
    expect(validateChatBody({ system: "", messages: [{ role: "user", content: "x" }] })).toBeTruthy();
    expect(validateChatBody({ system: "s", messages: [{ role: "root", content: "x" }] })).toBeTruthy();
    expect(validateChatBody({ system: "s", messages: [{ role: "user", content: "x" }], tools: "no" })).toBeTruthy();
  });

  it("caps request size so an oversized body cannot be buffered unbounded", () => {
    expect(MAX_BODY_BYTES).toBeGreaterThan(0);
    expect(MAX_BODY_BYTES).toBeLessThanOrEqual(5_000_000);
  });
});
