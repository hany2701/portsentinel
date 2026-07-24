import Anthropic from "@anthropic-ai/sdk";
import type { IncomingMessage, ServerResponse } from "node:http";
import { searchDoctrine } from "../src/sim/searchIndex";

// Streaming chat proxy (D-14, D-36). Runs as a Vercel Node serverless function in prod and,
// via a dev-server middleware (see vite.config.ts), locally under `vite dev` — same handler
// both places, so the API key never reaches the browser. Emits SSE: `text` deltas, `tool`
// events for server-side search_doctrine calls (D-67), then a terminal `done` carrying any
// propose_action calls, or `error` on failure.
//
// D-67 tool loop: search_doctrine is stateless (TF-IDF over the doctrine corpus, imported
// from src — bundled by Vite's ssrLoadModule in dev and Vercel's nft tracer in prod), so it
// resolves here without a client round-trip. The loop continues only while the stop reason
// is tool_use AND every tool call is search_doctrine (cap 3 per request); propose_action or
// end_turn terminates as before. Tool exchanges stay local to this request — the client's
// sliding message window never contains tool blocks (D-35).

// D-13: owner chose Claude Sonnet. Overridable so the model can be changed
// without a code edit, with the shipped default preserved.
const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-5";
const MAX_SEARCHES = 3;
/** The assembled system prompt is large but bounded; anything past this is not ours. */
export const MAX_BODY_BYTES = 1_000_000;

type ChatBody = {
  system: string;
  messages: Anthropic.MessageParam[];
  tools?: Anthropic.Tool[];
};

/** Returns null when the parsed body is a well-formed chat turn, else why it is not. */
export function validateChatBody(parsed: unknown): string | null {
  if (typeof parsed !== "object" || parsed === null) return "Body must be a JSON object.";
  const b = parsed as Partial<ChatBody>;
  if (typeof b.system !== "string" || b.system.length === 0) return "`system` must be a non-empty string.";
  if (!Array.isArray(b.messages) || b.messages.length === 0) return "`messages` must be a non-empty array.";
  for (const m of b.messages) {
    if (typeof m !== "object" || m === null) return "Each message must be an object.";
    const role = (m as { role?: unknown }).role;
    if (role !== "user" && role !== "assistant") return "Each message needs role 'user' or 'assistant'.";
    if (!("content" in m)) return "Each message needs content.";
  }
  if (b.tools !== undefined && !Array.isArray(b.tools)) return "`tools` must be an array when present.";
  return null;
}

async function readBody(req: IncomingMessage): Promise<ChatBody> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) throw new Error("Request body too large.");
    chunks.push(chunk as Buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

export default async function handler(req: IncomingMessage & { method?: string }, res: ServerResponse): Promise<void> {
  if (req.method !== "POST") {
    res.statusCode = 405;
    res.end("Method Not Allowed");
    return;
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    res.statusCode = 503;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ error: "Assistant offline: ANTHROPIC_API_KEY is not configured." }));
    return;
  }

  let body: ChatBody;
  try {
    body = await readBody(req);
  } catch {
    res.statusCode = 400;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ error: "Invalid request body." }));
    return;
  }

  const invalid = validateChatBody(body);
  if (invalid) {
    res.statusCode = 400;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ error: invalid }));
    return;
  }

  res.statusCode = 200;
  res.setHeader("content-type", "text/event-stream");
  res.setHeader("cache-control", "no-cache");
  res.setHeader("connection", "keep-alive");
  const send = (event: string, data: unknown) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

  const client = new Anthropic(); // reads ANTHROPIC_API_KEY from env; SDK retries 429/5xx/network
  try {
    const messages: Anthropic.MessageParam[] = [...body.messages];
    let searches = 0;
    for (;;) {
      const stream = client.messages.stream({
        model: MODEL,
        max_tokens: 2048,
        thinking: { type: "disabled" }, // snappy chat; grounding lives in the system prompt
        system: body.system,
        messages,
        tools: body.tools,
      });
      stream.on("text", (delta) => send("text", { text: delta }));
      const final = await stream.finalMessage();
      const toolUses = final.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
      const searchCalls = toolUses.filter((b) => b.name === "search_doctrine");

      const continueLoop =
        final.stop_reason === "tool_use" &&
        searchCalls.length > 0 &&
        searchCalls.length === toolUses.length &&
        searches + searchCalls.length <= MAX_SEARCHES;

      if (!continueLoop) {
        const toolCalls = toolUses
          .filter((b) => b.name !== "search_doctrine")
          .map((b) => ({ id: b.id, name: b.name, input: b.input }));
        send("done", { toolCalls, stopReason: final.stop_reason });
        break;
      }

      searches += searchCalls.length;
      const results: Anthropic.ToolResultBlockParam[] = searchCalls.map((call) => {
        const query = typeof (call.input as { query?: unknown }).query === "string" ? (call.input as { query: string }).query : "";
        const hits = searchDoctrine(query);
        send("tool", { query, results: hits.map((h) => ({ sectionId: h.section.sectionId, score: Math.round(h.score * 10) / 10 })) });
        return {
          type: "tool_result",
          tool_use_id: call.id,
          content: hits.length
            ? hits.map((h) => `[${h.section.sectionId}] ${h.section.body}`).join("\n")
            : "No doctrine section matched that query.",
        };
      });
      messages.push({ role: "assistant", content: final.content });
      messages.push({ role: "user", content: results });
    }
  } catch (err) {
    send("error", { message: err instanceof Error ? err.message : "Assistant request failed." });
  } finally {
    res.end();
  }
}
