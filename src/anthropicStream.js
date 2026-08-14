/* ============================================================
   ANTHROPIC STREAMING CLIENT — reassembles a streamed (SSE)
   /v1/messages response back into the non-streaming shape the
   caller expects: { content, stop_reason, usage }.

   Why stream at all: a web-search turn can run far longer than
   Cloudflare's ~100s edge timeout. A buffered response sends no
   bytes until the turn ends, so Cloudflare 524s it; an SSE stream
   keeps bytes flowing (deltas + pings) so the connection never
   idles out. The proxy (functions/anthropic + the Vite dev proxy)
   already pipes the stream through untouched — this is the client
   half that puts it back together.

   Deliberately React-free and dependency-free (only fetch /
   AbortController / TextDecoder, all standard in the browser AND
   in Node ≥18) so the reassembler can be unit-tested directly.
   ============================================================ */

/* Incremental SSE reader. Feed it raw text chunks via push(); it
   splits on blank-line event boundaries, parses each `data:` JSON
   payload, and folds it into the running message. result() returns
   { content, stop_reason, usage } — or { error } if the stream
   carried an error event. Rebuilds every block faithfully (text,
   server_tool_use, web_search_tool_result) so the pause_turn
   continuation that echoes content back stays API-valid. */
export function createSSEReassembler() {
  let buf = "";
  const content = [];  // reconstructed blocks, by index
  const jsonBuf = {};  // index -> accumulated input_json_delta (tool inputs)
  let stop_reason = null;
  let usage = {};
  let streamErr = null;

  const handle = (ev) => {
    switch (ev.type) {
      case "message_start":
        usage = { ...(ev.message?.usage || {}) };
        break;
      case "content_block_start":
        content[ev.index] = { ...(ev.content_block || {}) };
        if (content[ev.index].type === "text" && content[ev.index].text == null) content[ev.index].text = "";
        break;
      case "content_block_delta": {
        const b = content[ev.index] || (content[ev.index] = {});
        const d = ev.delta || {};
        if (d.type === "text_delta") b.text = (b.text || "") + (d.text || "");
        else if (d.type === "input_json_delta") jsonBuf[ev.index] = (jsonBuf[ev.index] || "") + (d.partial_json || "");
        else if (d.type === "thinking_delta") b.thinking = (b.thinking || "") + (d.thinking || "");
        else if (d.type === "signature_delta") b.signature = (b.signature || "") + (d.signature || "");
        break;
      }
      case "content_block_stop": {
        const b = content[ev.index];
        if (b && jsonBuf[ev.index] != null) {
          try { b.input = JSON.parse(jsonBuf[ev.index]); } catch { /* keep whatever parsed */ }
        }
        break;
      }
      case "message_delta":
        if (ev.delta?.stop_reason) stop_reason = ev.delta.stop_reason;
        if (ev.usage) usage = { ...usage, ...ev.usage }; // final output_tokens + server_tool_use land here
        break;
      case "error":
        streamErr = ev.error || { type: "api_error", message: "stream error" };
        break;
      default:
        break; // ping / message_stop / unknown — ignore
    }
  };

  return {
    push(text) {
      buf += String(text).replace(/\r/g, ""); // normalise CRLF → LF
      let sep;
      while ((sep = buf.indexOf("\n\n")) >= 0) {
        const evtChunk = buf.slice(0, sep);
        buf = buf.slice(sep + 2);
        for (const line of evtChunk.split("\n")) {
          const s = line.replace(/^\s+/, "");
          if (!s.startsWith("data:")) continue;
          const payload = s.slice(5).trim();
          if (!payload || payload === "[DONE]") continue;
          let ev;
          try { ev = JSON.parse(payload); } catch { continue; }
          handle(ev);
        }
      }
    },
    result() {
      if (streamErr) return { error: streamErr };
      return { content: content.filter(Boolean), stop_reason, usage };
    },
  };
}

/* Streaming POST to the Anthropic proxy. Errors are thrown with the SAME flags
   the caller's isTransientErr keys off (cancelled / transient / status /
   apiType), so the retry/backoff logic around it is unchanged.

   `idleMs` is an IDLE deadline, not a total one: it resets on every chunk, so a
   long-but-active turn is fine and only a genuinely stalled stream aborts. */
export async function streamClaudeMessage(url, bodyObj, externalSignal, idleMs = 300000) {
  const local = new AbortController();
  let idledOut = false;
  let idleTimer = null;
  const resetIdle = () => {
    if (idleTimer) clearTimeout(idleTimer);
    if (idleMs > 0) idleTimer = setTimeout(() => { idledOut = true; local.abort(); }, idleMs);
  };
  const onAbort = () => local.abort();
  if (externalSignal) externalSignal.addEventListener("abort", onAbort);
  const cleanup = () => {
    if (idleTimer) clearTimeout(idleTimer);
    if (externalSignal) externalSignal.removeEventListener("abort", onAbort);
  };
  // Cancel (external signal) is a hard stop; an idle abort or raw network drop
  // is transient so the caller's retry path takes over.
  const abortError = () => {
    if (externalSignal?.aborted) { const e = new Error("Run cancelled"); e.cancelled = true; return e; }
    const e = new Error(idledOut ? `Stream idle for ${Math.round(idleMs / 1000)}s` : "Network error");
    e.transient = true;
    return e;
  };

  resetIdle();
  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
      body: JSON.stringify(bodyObj),
      signal: local.signal,
    });
  } catch {
    cleanup();
    throw abortError();
  }

  // Errors arrive as a normal JSON body, not a stream: the proxy's own error
  // envelope (missing key), an Anthropic 4xx refused before the stream opens, or
  // a Cloudflare HTML page. Shape them like the old res.json() path did.
  const ct = res.headers.get("content-type") || "";
  if (!res.ok || !ct.includes("text/event-stream") || !res.body) {
    cleanup();
    let obj = null;
    try { obj = await res.json(); } catch { /* non-JSON (e.g. a 524 HTML page) */ }
    if (obj?.error) {
      const e = new Error(obj.error.message || "API error");
      e.status = res.status;
      e.apiType = obj.error.type;
      throw e;
    }
    const e = new Error(`Unexpected response (${res.status})`);
    e.status = res.status;
    if (res.status >= 500 || res.status === 429) e.transient = true;
    throw e;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  const acc = createSSEReassembler();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      resetIdle();
      acc.push(decoder.decode(value, { stream: true }));
    }
  } catch {
    cleanup();
    throw abortError();
  }
  cleanup();

  const out = acc.result();
  if (out.error) {
    const e = new Error(out.error.message || "API error");
    e.apiType = out.error.type; // overloaded_error / api_error → transient via isTransientErr
    throw e;
  }
  return out;
}
