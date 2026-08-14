/* Deterministic, CONFIRM-ONLY portfolio matcher for the hallucination sweep's
   vault pre-pass. Kept in its own dependency-free module (no Vite import.meta)
   so it can be unit-tested directly under Node. */

/* Portfolio-title noise words: rank/qualifier tokens that carry no portfolio
   signal, so "Minister of Health" and "Associate Minister for Health" both
   reduce to the distinctive noun "health". */
const PORTFOLIO_STOP = new Set([
  "minister", "associate", "deputy", "assistant", "under", "secretary",
  "parliamentary", "private", "hon", "the", "and", "for", "of", "to",
]);

/** Does a maintained ministers-roster row (the `line` from vaultMinisterMeta)
    corroborate a claimed portfolio `title`? The row is already scoped to one
    named person, so its portfolio nouns are that person's actual portfolios.
    Requires EVERY distinctive title token (≥4 chars, non-stopword) to appear
    in the row — strict on purpose, because a match lets the sweep SKIP a
    search: a loose match that wrongly confirmed a fabricated portfolio would
    defeat the point. A non-match means only "not confirmed here", never
    "contradicted" (the roster need not list every portfolio a person holds). */
export function rosterConfirmsPortfolio(rosterLine, title) {
  if (!rosterLine || !title) return false;
  const line = rosterLine.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  const tokens = title.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9\s]/g, " ").split(/\s+/)
    .filter((w) => w.length >= 4 && !PORTFOLIO_STOP.has(w));
  if (!tokens.length) return false;
  return tokens.every((w) => line.includes(w));
}
