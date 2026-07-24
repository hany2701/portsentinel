import type { AgentTool } from "../utils/responseParser";

export type ChatToolCall = { id: string; name: string; input: Record<string, unknown> };
// D-67/D-68: server-side search_doctrine calls surface as SSE "tool" events so the
// response trace can show what the agent looked up mid-answer.
export type ChatToolEvent = { query: string; results: { sectionId: string; score: number }[] };
export type ChatRole = "user" | "assistant";

export type ChatRequest = {
  system: string;
  messages: { role: ChatRole; content: string }[];
  tools?: AgentTool[];
};

export type StreamHandlers = {
  onText: (delta: string) => void;
  onDone: (toolCalls: ChatToolCall[], stopReason: string | null) => void;
  onError: (message: string) => void;
  onTool?: (event: ChatToolEvent) => void;
};

function parseEvent(block: string): { event: string; data: unknown } | null {
  let event = "message";
  const dataLines: string[] = [];
  for (const line of block.split("\n")) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
  }
  if (dataLines.length === 0) return null;
  try {
    return { event, data: JSON.parse(dataLines.join("\n")) };
  } catch {
    return null;
  }
}

/**
 * POST a chat turn to the serverless proxy and dispatch its SSE stream. Any transport or
 * service failure lands on onError so the UI can show the degraded state (the rule engine
 * keeps the decision queue populated regardless — D-12).
 */
export async function streamChat(body: ChatRequest, handlers: StreamHandlers, signal?: AbortSignal): Promise<void> {
  let res: Response;
  try {
    res = await fetch("/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
  } catch {
    handlers.onError("Can't reach the assistant. Check your connection and retry.");
    return;
  }

  if (!res.ok || !res.body) {
    let message = `Assistant unavailable (${res.status}).`;
    try {
      const j = (await res.json()) as { error?: string };
      if (j.error) message = j.error;
    } catch {
      /* keep default */
    }
    handlers.onError(message);
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  // Every turn MUST end on exactly one terminal handler. A stream that stops
  // early (upstream timeout, dropped connection, truncated proxy response)
  // would otherwise resolve with neither `done` nor `error`, leaving the caller
  // believing it is still streaming — the same class of deadlock as an
  // uncaught context error.
  let terminated = false;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const blocks = buffer.split("\n\n");
      buffer = blocks.pop() ?? "";
      for (const block of blocks) {
        const parsed = parseEvent(block);
        if (!parsed) continue;
        if (parsed.event === "text") handlers.onText((parsed.data as { text: string }).text);
        else if (parsed.event === "done") {
          const d = parsed.data as { toolCalls: ChatToolCall[]; stopReason: string | null };
          terminated = true;
          handlers.onDone(d.toolCalls ?? [], d.stopReason ?? null);
        } else if (parsed.event === "tool") handlers.onTool?.(parsed.data as ChatToolEvent);
        else if (parsed.event === "error") {
          terminated = true;
          handlers.onError((parsed.data as { message: string }).message);
        }
      }
    }
    if (!terminated) handlers.onError("The assistant response ended unexpectedly. Please retry.");
  } catch {
    if (!terminated) handlers.onError("The assistant response was interrupted.");
  }
}
