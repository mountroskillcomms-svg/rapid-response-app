/* LIVE end-to-end check of the streaming client against the REAL Anthropic API
   through the running dev proxy (127.0.0.1:5173/anthropic). Uses the actual
   streamClaudeMessage from src/anthropicStream.js and mirrors callClaude's
   pause_turn continuation (echoing reconstructed content back) — so if a rebuilt
   block were malformed, Anthropic would 400 the continuation and this fails.
   Cheap: fast model, one search, 512 max_tokens. Run the dev server first. */
import { streamClaudeMessage } from "../src/anthropicStream.js";

const PROXY = "http://127.0.0.1:5173/anthropic/v1/messages";
const MODEL_FAST = "claude-haiku-4-5-20251001";

// Mirror of callClaude's sanitizeContinuation.
const sanitizeContinuation = (content) => {
  const resultIds = new Set(content.filter((b) => b.type?.endsWith("_tool_result")).map((b) => b.tool_use_id));
  const kept = content.filter((b) => !((b.type === "server_tool_use" || b.type === "tool_use") && !resultIds.has(b.id)));
  return kept.length ? kept : [{ type: "text", text: "(continuing)" }];
};

const body = (messages) => ({
  model: MODEL_FAST,
  max_tokens: 512,
  stream: true,
  system: "You are a concise test assistant.",
  messages,
  tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 1 }],
});

const run = async () => {
  let messages = [{ role: "user", content: "Search the web for one recent New Zealand political news item and reply with a single sentence that cites it." }];
  let data = await streamClaudeMessage(PROXY, body(messages), null, 120000);
  console.log(`turn 0: stop_reason=${data.stop_reason} blocks=${data.content.length} types=[${data.content.map((b) => b.type).join(",")}] searches=${data.usage?.server_tool_use?.web_search_requests ?? 0}`);

  let pauses = 0;
  for (let i = 0; i < 3 && data.stop_reason === "pause_turn" && data.content.length; i++) {
    pauses++;
    messages = [...messages, { role: "assistant", content: sanitizeContinuation(data.content) }];
    data = await streamClaudeMessage(PROXY, body(messages), null, 120000);
    console.log(`turn ${i + 1}: stop_reason=${data.stop_reason} blocks=${data.content.length} types=[${data.content.map((b) => b.type).join(",")}]`);
  }

  const text = data.content.filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();
  console.log("\n--- reconstructed final text ---\n" + text.slice(0, 500));
  console.log("\n--- final usage ---\n" + JSON.stringify(data.usage));

  const ok = text.length > 0 && data.stop_reason && data.stop_reason !== "pause_turn";
  console.log(`\nRESULT: ${ok ? `PASS — completed after ${pauses} pause_turn continuation(s); got text + terminal stop_reason "${data.stop_reason}"` : "CHECK — no terminal text; see above"}`);
  process.exit(ok ? 0 : 2);
};

run().catch((e) => {
  console.error(`FAILED: status=${e.status || "-"} apiType=${e.apiType || "-"} transient=${!!e.transient} msg=${e.message}`);
  process.exit(1);
});
