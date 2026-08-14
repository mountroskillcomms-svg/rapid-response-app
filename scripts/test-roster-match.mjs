/* Unit test for rosterConfirmsPortfolio — the deterministic, confirm-only
   matcher behind the hallucination sweep's vault pre-pass. The risk it must
   avoid is a FALSE confirm (which would let the sweep skip a search on a
   possibly-fabricated portfolio), so the strict "every distinctive token must
   appear" rule is what's under test. Run: node scripts/test-roster-match.mjs */
import { rosterConfirmsPortfolio } from "../src/portfolioMatch.js";
import assert from "node:assert";

let n = 0;
const t = (name, cond) => { assert.ok(cond, name); console.log(`  ✓ ${name}`); n++; };

// A realistic roster row is a markdown table line scoped to one person.
const row = "| Simeon Brown | Health, Auckland, Statistics | National | 2024-12-01 |";

t("single-noun portfolio confirmed", rosterConfirmsPortfolio(row, "Minister of Health") === true);
t("rank words ignored (Associate/Minister/of)", rosterConfirmsPortfolio(row, "Associate Minister of Health") === true);
t("portfolio NOT on the row is not confirmed", rosterConfirmsPortfolio(row, "Minister of Education") === false);
t("case-insensitive", rosterConfirmsPortfolio(row, "MINISTER OF HEALTH") === true);

// Multi-noun titles require EVERY distinctive token — guards the classic
// "Economic Development" vs "Social Development" false-match.
const socRow = "| Louise Upston | Social Development and Employment | National |";
t("multi-noun fully corroborated", rosterConfirmsPortfolio(socRow, "Minister for Social Development") === true);
const ecoRow = "| Someone Else | Economic Development | National |";
t("shared token alone does NOT confirm (social≠economic)", rosterConfirmsPortfolio(ecoRow, "Minister of Social Development") === false);

// Macron / diacritic folding on BOTH sides.
const maoriRow = "| Tama Potaka | Māori Development, Whānau Ora | National |";
t("macron-folded match", rosterConfirmsPortfolio(maoriRow, "Minister for Maori Development") === true);
t("macron in title vs macron in row", rosterConfirmsPortfolio(maoriRow, "Minister for Māori Development") === true);

// Edge cases.
t("all-stopword title → not confirmed", rosterConfirmsPortfolio(row, "Minister") === false);
t("empty title → false", rosterConfirmsPortfolio(row, "") === false);
t("empty/undefined line → false", rosterConfirmsPortfolio("", "Minister of Health") === false && rosterConfirmsPortfolio(null, "Health") === false);
t("short tokens (<4 chars) ignored, no spurious confirm", rosterConfirmsPortfolio("| X | Arts, Sport | Y |", "Minister of Tax") === false);

console.log(`\nAll ${n} assertions passed.`);
