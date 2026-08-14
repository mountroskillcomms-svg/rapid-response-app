/* Zero-cost unit test for the SSE reassembler (src/anthropicStream.js).
   Feeds canned Anthropic streaming transcripts through createSSEReassembler and
   asserts the reconstructed { content, stop_reason, usage } — including the
   nasty cases: a web-search (server_tool_use + tool_result) turn, a pause_turn
   stop_reason, split-mid-event chunk boundaries, CRLF line endings, and an
   error event. Run: node scripts/test-anthropic-stream.mjs */
import { createSSEReassembler } from "../src/anthropicStream.js";
import assert from "node:assert";

let passed = 0;
const check = (name, cond) => { assert.ok(cond, name); console.log(`  ✓ ${name}`); passed++; };

/* Helper: turn an array of event objects into an SSE wire string. */
const wire = (events) => events.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join("");

/* Feed a wire string to a fresh reassembler in arbitrary-sized slices, to prove
   event parsing survives chunk boundaries that fall mid-event / mid-line. */
const feed = (text, sliceLen) => {
  const acc = createSSEReassembler();
  for (let i = 0; i < text.length; i += sliceLen) acc.push(text.slice(i, i + sliceLen));
  return acc.result();
};

/* ---------- Case 1: plain text, whole-string ---------- */
{
  const events = [
    { type: "message_start", message: { usage: { input_tokens: 100, cache_read_input_tokens: 40, output_tokens: 1 } } },
    { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
    { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Hello " } },
    { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "world" } },
    { type: "content_block_stop", index: 0 },
    { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 7 } },
    { type: "message_stop" },
  ];
  const r = feed(wire(events), 9999);
  console.log("Case 1 — plain text:");
  check("text reassembled", r.content[0].text === "Hello world");
  check("stop_reason end_turn", r.stop_reason === "end_turn");
  check("input_tokens kept from message_start", r.usage.input_tokens === 100);
  check("cache_read kept", r.usage.cache_read_input_tokens === 40);
  check("output_tokens overlaid from message_delta", r.usage.output_tokens === 7);
}

/* ---------- Case 2: web search (server_tool_use + result) + pause_turn,
     fed 7 bytes at a time to stress chunk boundaries ---------- */
{
  const events = [
    { type: "message_start", message: { usage: { input_tokens: 500, output_tokens: 1 } } },
    { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
    { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Let me check. " } },
    { type: "content_block_stop", index: 0 },
    // server_tool_use: input arrives as streamed partial JSON
    { type: "content_block_start", index: 1, content_block: { type: "server_tool_use", id: "srvtoolu_1", name: "web_search", input: {} } },
    { type: "content_block_delta", index: 1, delta: { type: "input_json_delta", partial_json: '{"query":"NZ ' } },
    { type: "content_block_delta", index: 1, delta: { type: "input_json_delta", partial_json: 'election 2026"}' } },
    { type: "content_block_stop", index: 1 },
    // web_search_tool_result: full block delivered at start (server-side)
    { type: "content_block_start", index: 2, content_block: { type: "web_search_tool_result", tool_use_id: "srvtoolu_1", content: [{ type: "web_search_result", url: "https://x", title: "X" }] } },
    { type: "content_block_stop", index: 2 },
    { type: "message_delta", delta: { stop_reason: "pause_turn" }, usage: { output_tokens: 55, server_tool_use: { web_search_requests: 1 } } },
    { type: "message_stop" },
  ];
  const r = feed(wire(events), 7);
  console.log("Case 2 — web search + pause_turn (7-byte chunks):");
  check("text block intact", r.content[0].text === "Let me check. ");
  check("server_tool_use id preserved", r.content[1].id === "srvtoolu_1");
  check("server_tool_use name preserved", r.content[1].name === "web_search");
  check("tool input JSON reassembled", r.content[1].input.query === "NZ election 2026");
  check("tool_result tool_use_id preserved", r.content[2].tool_use_id === "srvtoolu_1");
  check("tool_result content preserved", r.content[2].content[0].url === "https://x");
  check("stop_reason pause_turn", r.stop_reason === "pause_turn");
  check("web_search_requests counted", r.usage.server_tool_use.web_search_requests === 1);
  // The sanitizeContinuation logic keys off these fields — prove they survive:
  const resultIds = new Set(r.content.filter((b) => b.type?.endsWith("_tool_result")).map((b) => b.tool_use_id));
  check("continuation would keep resolved server_tool_use", resultIds.has(r.content[1].id));
}

/* ---------- Case 3: CRLF line endings ---------- */
{
  const events = [
    { type: "message_start", message: { usage: { input_tokens: 10, output_tokens: 1 } } },
    { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
    { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "crlf ok" } },
    { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 3 } },
  ];
  const crlf = wire(events).replace(/\n/g, "\r\n");
  const r = feed(crlf, 5);
  console.log("Case 3 — CRLF endings:");
  check("text parsed despite CRLF", r.content[0].text === "crlf ok");
  check("stop_reason parsed despite CRLF", r.stop_reason === "end_turn");
}

/* ---------- Case 4: error event surfaces ---------- */
{
  const events = [
    { type: "message_start", message: { usage: { input_tokens: 10, output_tokens: 1 } } },
    { type: "error", error: { type: "overloaded_error", message: "Overloaded" } },
  ];
  const r = feed(wire(events), 9999);
  console.log("Case 4 — error event:");
  check("error surfaced", r.error && r.error.type === "overloaded_error");
  check("error message surfaced", r.error.message === "Overloaded");
}

/* ---------- Case 5: [DONE] sentinel and ping are ignored ---------- */
{
  const acc = createSSEReassembler();
  acc.push("event: ping\ndata: {\"type\":\"ping\"}\n\n");
  acc.push("data: [DONE]\n\n");
  acc.push(wire([
    { type: "message_start", message: { usage: { input_tokens: 1, output_tokens: 1 } } },
    { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
    { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "ok" } },
    { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 1 } },
  ]));
  const r = acc.result();
  console.log("Case 5 — ping / [DONE] ignored:");
  check("text still parsed", r.content[0].text === "ok");
  check("no phantom blocks", r.content.length === 1);
}

console.log(`\nAll ${passed} assertions passed.`);
