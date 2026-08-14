/* Unit test for mergeVerify — recombining the parallelised verification stage.
   The risk is a lossy or double-counting merge, or a verdict that wrongly reads
   "ready" when a part flagged rework. Run: node scripts/test-verify-merge.mjs */
import { mergeVerify } from "../src/verifyMerge.js";
import assert from "node:assert";

let n = 0;
const t = (name, cond) => { assert.ok(cond, name); console.log(`  ✓ ${name}`); n++; };

// Two angle-group runs + one text-hygiene run, each over disjoint items.
const angleGroupA = {
  unsupported_angles: [{ angle_index: 0, why: "source stale" }],
  drafted_text_violations: [{ where: "angle", index: 0, why: "reads as copy" }],
  tone_flags: [],
  amplification_warning: "",
  verdict: "ready_for_human_review",
  rework_notes: "",
};
const angleGroupB = {
  unsupported_angles: [],
  drafted_text_violations: [],
  tone_flags: [{ where: "angle", index: 2, issue: "mocks opponent" }],
  amplification_warning: "angle 2 could amplify the attack",
  verdict: "needs_rework",
  rework_notes: "tighten angle 2",
};
const textRun = {
  unsupported_angles: [],
  drafted_text_violations: [{ where: "strategy_note", index: 1, why: "publishable sentence" }],
  tone_flags: [],
  amplification_warning: "",
  verdict: "ready_for_human_review",
  rework_notes: "",
};

const m = mergeVerify([angleGroupA, angleGroupB, textRun]);

t("unsupported_angles concatenated", m.unsupported_angles.length === 1 && m.unsupported_angles[0].angle_index === 0);
t("drafted_text_violations from angle + text merged", m.drafted_text_violations.length === 2);
t("angle index preserved", m.drafted_text_violations.some((v) => v.where === "angle" && v.index === 0));
t("text-item index preserved", m.drafted_text_violations.some((v) => v.where === "strategy_note" && v.index === 1));
t("tone_flags carried with original index", m.tone_flags.length === 1 && m.tone_flags[0].index === 2);
t("verdict is needs_rework if ANY part is", m.verdict === "needs_rework");
t("amplification_warning joined (non-empty only)", m.amplification_warning === "angle 2 could amplify the attack");
t("rework_notes joined", m.rework_notes === "tighten angle 2");

// All-clean case.
const clean = mergeVerify([
  { unsupported_angles: [], drafted_text_violations: [], tone_flags: [], verdict: "ready_for_human_review" },
  { unsupported_angles: [], drafted_text_violations: [], tone_flags: [], verdict: "ready_for_human_review" },
]);
t("all-clean → ready verdict", clean.verdict === "ready_for_human_review");
t("all-clean → empty arrays", clean.unsupported_angles.length === 0 && clean.drafted_text_violations.length === 0);

// Robustness: nulls / missing fields / empty input.
const robust = mergeVerify([null, {}, { drafted_text_violations: [{ where: "angle", index: 0, why: "x" }] }]);
t("ignores null/empty runs, keeps real flags", robust.drafted_text_violations.length === 1);
t("empty input → clean default", mergeVerify([]).verdict === "ready_for_human_review");
t("undefined input → clean default", mergeVerify(undefined).verdict === "ready_for_human_review");

console.log(`\nAll ${n} assertions passed.`);
