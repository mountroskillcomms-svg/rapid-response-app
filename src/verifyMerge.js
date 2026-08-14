/* Merge the JSON outputs of the parallelised verification stage back into the
   single shape the rest of the pipeline consumes. The verify stage is split
   into concurrent calls (angle groups + a no-search text-hygiene call); each
   returns the same shape over a DISJOINT subset of items, so the arrays merge
   by concatenation with every item keeping its original index. React-free and
   dependency-free so it can be unit-tested directly.

   Consumed downstream: unsupported_angles, drafted_text_violations (where+index),
   tone_flags (where+index+issue), amplification_warning, verdict, rework_notes. */
export function mergeVerify(runs) {
  const list = (runs || []).filter(Boolean);
  const cat = (k) => list.flatMap((r) => (Array.isArray(r?.[k]) ? r[k] : []));
  const joinText = (k) =>
    list.map((r) => r?.[k]).filter((s) => typeof s === "string" && s.trim()).join(" ");
  return {
    unsupported_angles: cat("unsupported_angles"),
    drafted_text_violations: cat("drafted_text_violations"),
    tone_flags: cat("tone_flags"),
    amplification_warning: joinText("amplification_warning"),
    // Conservative: if ANY part wants rework, the whole brief does.
    verdict: list.some((r) => r?.verdict === "needs_rework") ? "needs_rework" : "ready_for_human_review",
    rework_notes: joinText("rework_notes"),
  };
}
