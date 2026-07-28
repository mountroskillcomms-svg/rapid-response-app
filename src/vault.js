/* ============================================================
   LABOUR SECOND BRAIN LOADER — reads the shared Obsidian vault
   via the dev-server's /vault.json + /vault/doc endpoints
   (vault-api.mjs). The vault is maintained independently (git +
   a weekly research agent); this module is strictly READ-ONLY.

   Same design rules as knowledge.js:
   - Preload once (initVault). All block builders are then
     SYNCHRONOUS string getters.
   - Every getter degrades to "" — the app must work with no
     vault clone present.
   - Blocks are compact and carry the vault's honesty flags:
     provenance, status: needs-review, last_updated, and nulls
     rendered as "not reported", never zero.

   VAULT_CHANNELS below is the single source of truth for WHICH
   vault documents feed WHICH feature and HOW — it drives both
   the prompt injection in this file and the UI panel.
   ============================================================ */

/* The app is built against Vault Data Contract schema 1.3. A moved
   schema is flagged loudly in the UI (red chip + panel banner) but the
   app keeps running — contract changes are additive by rule, and a
   comms tool that bricks itself mid-campaign on a version bump would
   be worse than one that flags it. */
export const EXPECTED_SCHEMA = "1.3";

const cache = {
  data: null,       // parsed /vault.json
  docs: {},         // rel path -> { title, body, status, last_updated, type }
  loaded: false,
  schemaOk: true,
};

const getJson = async (path) => {
  try {
    const r = await fetch(path, { cache: "no-store" });
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
};

/* ---- WHICH PARTS OF THE SECOND BRAIN ARE USED WHERE ----
   Rendered verbatim in the vault panel so the team can see the
   plumbing; each entry's builder does the actual injection. */
export const VAULT_CHANNELS = [
  {
    id: "poll-of-record",
    source: "03-Data/Polls/ — every national poll, frontmatter",
    feeds: "Every AI call (stable cached prefix)",
    how: "Compact poll table, provenance-labelled (✓ verified / ~ aggregator), nulls kept as 'not reported'. Kills searches for party-vote numbers: calls only search for polls NEWER than the vault's latest.",
  },
  {
    id: "seat-board",
    source: "03-Data/Electorate Markers/ — 71 seats",
    feeds: "Every AI call (stable cached prefix); War Room map colouring",
    how: "Team-set campaign_status (defend/hold/target/stretch) + notional margins and swing-to-flip as supplied fact. The map colours seats from this instead of model output.",
  },
  {
    id: "target-board",
    source: "03-Data/Electorate Markers/ + 09-Electorates/ profiles",
    feeds: "War Room — Target board tab (ZERO AI calls)",
    how: "The seat board rendered as a ranked battle plan: offence targets by swing-to-flip, defences, Māori-roll seats — pure vault data, no tokens spent. Clicking a seat jumps to the map scan.",
  },
  {
    id: "seat-strategy",
    source: "03-Data/Electorate Markers/ + 09-Electorates/ — the MP's own seat",
    feeds: "Rapid Response — angles/strategy stage",
    how: "The responding MP's electorate status (target/defend + notional margin + non-voter pool) injected as strategic context, so a thin-margin high-non-voter seat weights mobilisation angles and a safe seat weights reinforcement — the brief is seat-aware, not one-size-fits-all.",
  },
  {
    id: "mobilisation",
    source: "09-Electorates/ profiles — enrolled/non-voter fields",
    feeds: "War Room — Target board + single-seat panel (GOTV lens)",
    how: "Non-voter pool (and under-35 share) shown against an estimated votes-to-flip, so a thin notional margin reads next to the mobilisable headroom behind it. Labelled 2026-boundary estimates, never targets.",
  },
  {
    id: "seat-profiles",
    source: "09-Electorates/<seat>/ — deep-dive profiles + candidates",
    feeds: "War Room — single-seat scan",
    how: "Full structured profile injected as fixed fact (notional_* labelled as 2026-boundary ESTIMATES, never results); searches go only to current local dynamics.",
  },
  {
    id: "state-of-race",
    source: "08-Analysis/State of the Race.md",
    feeds: "War Room — issue terrain",
    how: "Strategic synthesis injected whole, dated; the terrain call reasons FROM it and spends searches only on movement newer than its last_updated.",
  },
  {
    id: "issue-briefs",
    source: "02-Issues/ — live issue briefs",
    feeds: "War Room terrain (one-line digests) · dossier + angles (full brief when the topic matches)",
    how: "Terrain gets the index with dates so it knows what the vault already covers; response stages get the 1–2 briefs matching the live topic, status flags attached.",
  },
  {
    id: "attack-register",
    source: "08-Analysis/Attack and Rebuttal Register.md",
    feeds: "Rapid Response — angles (attack mode) · Interview prep",
    how: "Known attack lines with Labour's response and the facts-to-verify column, topic-matched. Angles reinforce prepared rebuttal ground instead of inventing from scratch.",
  },
  {
    id: "party-platforms",
    source: "01-Policy/<Party> Platform 2026.md",
    feeds: "Rapid Response — dossier + position stages",
    how: "The attacking/moving party's own platform injected so their policy is characterised from the vault's verified summary, not from searches.",
  },
  {
    id: "labour-policy",
    source: "01-Policy/ topic docs (tax, health, housing, climate, economy, transport)",
    feeds: "Rapid Response — Labour position stage",
    how: "Topic-matched policy docs ground Labour's stated position before any search is spent.",
  },
  {
    id: "labour-record",
    source: "08-Analysis/Labour Record 2017-2023.md",
    feeds: "Rapid Response — angles, when the attack targets the record",
    how: "Defensive grounding for 2017–23 record attacks, matched by topic.",
  },
  {
    id: "govt-ministers",
    source: "06-People-Orgs/Coalition Government Key Ministers.md",
    feeds: "Rapid Response — attacker dossier",
    how: "Maintained roster of the coalition's current portfolios. The attacker-dossier confirms the attacker's CURRENT role from this (accurate through reshuffles the model's memory misses) rather than searching Hansard — so its searches go to the cuts and controversies. Trims the dossier's search budget when the attacker is on the roster.",
  },
  {
    id: "party-comparison",
    source: "08-Analysis/Party Comparison Matrix.md",
    feeds: "Portfolio mode + Interview prep",
    how: "Cross-party position matrix for contrast lines, injected whole (it is small).",
  },
];

/* Analysis docs fetched by fixed path; issue/policy docs discovered from
   the export's notes index so new vault notes flow in without app edits. */
const ANALYSIS_DOCS = [
  "08-Analysis/State of the Race.md",
  "08-Analysis/Attack and Rebuttal Register.md",
  "08-Analysis/Party Comparison Matrix.md",
  "08-Analysis/Labour Record 2017-2023.md",
  // maintained who's-who rosters (06-People-Orgs) — the government ministers
  // one lets the attacker-dossier confirm portfolios from the vault instead
  // of searching Hansard for the role.
  "06-People-Orgs/Coalition Government Key Ministers.md",
];

export async function initVault() {
  const v = await getJson("/vault.json");
  if (!v || !Array.isArray(v.notes)) {
    cache.loaded = false;
    cache.data = null;
    invalidateVaultContext();
    return false;
  }
  cache.data = v;
  cache.schemaOk = v.schema_version === EXPECTED_SCHEMA;
  if (!cache.schemaOk)
    console.warn(`Second brain schema moved: expected ${EXPECTED_SCHEMA}, got ${v.schema_version} — re-check field usage against the Vault Data Contract.`);

  const discovered = v.notes
    .filter((n) => (n.type === "issue" || n.type === "policy" || n.type === "analysis") && !/-MOC\.md$/.test(n.file))
    .map((n) => n.file);
  const wanted = [...new Set([...ANALYSIS_DOCS, ...discovered])];
  const fetched = await Promise.all(wanted.map((f) =>
    getJson(`/vault/doc?file=${encodeURIComponent(f)}`)));
  cache.docs = {};
  for (const d of fetched) {
    if (!d?.body) continue;
    const note = v.notes.find((n) => n.file === d.file);
    cache.docs[d.file] = {
      title: d.frontmatter?.title || note?.title || d.file,
      body: d.body.trim(),
      status: d.frontmatter?.status || note?.status || null,
      last_updated: d.frontmatter?.last_updated || note?.last_updated || null,
      type: d.frontmatter?.type || note?.type || null,
    };
  }
  cache.loaded = true;
  invalidateVaultContext();
  return true;
}

export const vaultLoaded = () => cache.loaded;
export const vaultStatus = () => ({
  loaded: cache.loaded,
  schemaOk: cache.schemaOk,
  schemaVersion: cache.data?.schema_version || null,
  commit: (cache.data?.vault_commit || "").slice(0, 8),
  generatedAt: cache.data?.generated_at || null,
  counts: cache.data?.counts || null,
  warnings: cache.data?.warnings || [],
});

/* ---- honesty helpers (Vault Data Contract §Golden rules) ---- */

const nr = (v) => (v == null ? "n/r" : String(v)); // null = not reported, NEVER zero
const flag = (doc) =>
  `${doc.last_updated ? `last updated ${doc.last_updated}` : "undated"}${doc.status === "needs-review" ? " · ⚠ NEEDS-REVIEW: a human has not verified this note — do not present its contents as settled" : ""}`;

export const PARTY_LABELS = { labour: "Lab", national: "Nat", act: "ACT", green: "Grn", nz_first: "NZF", te_pati_maori: "TPM", opportunity: "TOP" };
export const PARTY_ORDER = Object.keys(PARTY_LABELS);
/* Chart/table party colours. Lives here (not Charts.jsx) so the poll table in
   the main bundle can use it without static-importing the lazy chart module. */
export const PARTY_COLORS = { labour: "#ef4444", national: "#3b82f6", act: "#eab308", green: "#10b981", nz_first: "#a8a29e", te_pati_maori: "#c084fc", opportunity: "#14b8a6" };

/* ---- topic matching (same approach as knowledge.js kbLinesFor) ---- */

/* Stopwords: pronouns/connectors/filler that carry no topical signal but
   otherwise sneak through as "meaningful" tokens (the old list let "while"
   count as a match hook). Domain words are deliberately NOT here. */
const STOP = new Set([
  "that", "this", "with", "from", "have", "will", "would", "their", "about", "under",
  "government", "labour", "national", "party", "policy", "2026",
  "while", "when", "then", "than", "them", "they", "were", "been", "into", "over",
  "more", "most", "some", "such", "also", "both", "each", "very", "much", "many",
  "other", "these", "those", "here", "there", "what", "which", "your", "only", "even",
  "just", "like", "make", "made", "need", "want", "does", "done", "said", "says",
  "being", "after", "before", "still", "back", "down", "upon", "amid", "because",
  "could", "should", "against", "between", "across", "around", "through", "within",
  "without", "toward", "onto", "cannot",
]);
/* Crude singular fold so a topic saying "hospitals / landlords / emissions"
   matches a doc saying "hospital / landlord / emission" — recovers genuine
   hooks that strict exact-matching would miss. Trailing -s only (len>4, not -ss). */
const stem = (w) => (w.length > 4 && w.endsWith("s") && !w.endsWith("ss")) ? w.slice(0, -1) : w;
const tokenise = (s) => new Set(
  (s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9\s]/g, " ").split(/\s+/)
    .filter((w) => w.length > 3 && !STOP.has(w)).map(stem)
);

/* ---- distinctiveness index (memoised per vault load) ----
   The old matcher kept any doc sharing ≥2 meaningful tokens with the topic.
   Long docs game that: they contain so many words that they incidentally
   share 2+ *common* tokens ("budget", "services", "report") with almost any
   topic — the climate report matching a tax attack. So we build a document-
   frequency index and score matches by inverse document frequency: a token
   in few vault docs (e.g. "landlord", "climate") weighs far more than one in
   many ("services", "funding"). A match must clear the same 2-token floor AND
   share at least one *distinctive* token — a real topical hook, not just
   common words in a big document. Genuine matches always have that hook, so
   this tightens without dropping useful hits. */
let matchIndex = null; // { tokensByFile: Map<file,Set>, df: Map<token,count>, N }
function ensureMatchIndex() {
  if (matchIndex) return matchIndex;
  const tokensByFile = new Map();
  const df = new Map();
  for (const [f, d] of Object.entries(cache.docs)) {
    const set = tokenise(`${d.title} ${d.body}`);
    tokensByFile.set(f, set);
    for (const w of set) df.set(w, (df.get(w) || 0) + 1);
  }
  matchIndex = { tokensByFile, df, N: tokensByFile.size || 1 };
  return matchIndex;
}

/* A token is "distinctive" if it appears in at most ~30% of vault docs (min 2);
   idf weight is higher the rarer the token. */
const idfOf = (ix, w) => Math.log((ix.N + 1) / ((ix.df.get(w) || 0) + 1)) + 1;
const distinctiveCutoff = (ix) => Math.max(2, Math.round(ix.N * 0.25));

/** Score a topic against a token set: weighted overlap, distinct-hit count,
    and whether any shared token is distinctive (a genuine topical hook). */
function scoreTokens(topic, docSet, ix) {
  const cut = distinctiveCutoff(ix);
  let sum = 0, hits = 0, distinctive = false;
  for (const w of topic) {
    if (!docSet.has(w)) continue;
    hits++;
    sum += idfOf(ix, w);
    if ((ix.df.get(w) || 0) <= cut) distinctive = true;
  }
  return { sum, hits, distinctive };
}

/** Top matching docs from a path-filtered set for a topic; [] if none clear.
    Keeps a doc only if it shares ≥2 meaningful tokens AND at least one is
    distinctive; ranks by idf-weighted score. */
function matchDocs(topicText, pathFilter, max) {
  if (!cache.loaded || !topicText) return [];
  const topic = tokenise(topicText);
  if (topic.size < 2) return [];
  const ix = ensureMatchIndex();
  return Object.entries(cache.docs)
    .filter(([f]) => pathFilter.test(f))
    .map(([f, d]) => {
      const set = ix.tokensByFile.get(f) || tokenise(`${d.title} ${d.body}`);
      const { sum, hits, distinctive } = scoreTokens(topic, set, ix);
      return { f, d, score: sum, hits, distinctive };
    })
    .filter((x) => x.hits >= 2 && x.distinctive)
    .sort((a, b) => b.score - a.score)
    .slice(0, max);
}

/** Does a topic clear the match bar against ONE specific doc (≥2 shared
    meaningful tokens including a distinctive one)? For single-doc grounding
    like the Labour record, where a long doc otherwise over-matches. */
function topicMatchesDoc(topicText, file, minHits = 2) {
  if (!cache.loaded || !topicText) return false;
  const topic = tokenise(topicText);
  if (topic.size < 2) return false;
  const ix = ensureMatchIndex();
  const set = ix.tokensByFile.get(file);
  if (!set) return false;
  const { hits, distinctive } = scoreTokens(topic, set, ix);
  return hits >= minHits && distinctive;
}

/* ============================================================
   BLOCK BUILDERS
   ============================================================ */

/** Poll-of-record table — the vault's canonical national poll series. */
export function vbPollTrendBlock() {
  const polls = cache.data?.polls;
  if (!polls?.length) return "";
  const line = (p) => {
    const votes = Object.entries(p.party_vote)
      .map(([k, v]) => `${PARTY_LABELS[k]} ${nr(v)}`).join(", ");
    const mark = p.provenance === "original-report" ? "✓" : "~";
    return `- ${p.fieldwork_end || "date n/r"} ${p.pollster}${p.sponsor ? ` (${p.sponsor})` : ""} ${mark}${p.sample_size ? ` n=${p.sample_size}` : ""}${p.margin_of_error ? ` ±${p.margin_of_error}` : ""}: ${votes}`;
  };
  const latest = polls[polls.length - 1];
  const pm = latest?.preferred_pm
    ? `Latest preferred-PM (${latest.pollster}, ${latest.fieldwork_end}): ${Object.entries(latest.preferred_pm).map(([k, v]) => `${k[0].toUpperCase()}${k.slice(1)} ${nr(v)}`).join(", ")}.`
    : "";
  return `POLL OF RECORD — every national poll in the shared second brain, oldest→newest (✓ = verified against the pollster's own release; ~ = via an aggregator, unverified — say which kind you are citing; "n/r" = not reported by that poll — NEVER treat as zero or interpolate):
${polls.map(line).join("\n")}
${pm}
These figures are supplied fact. Never spend a search re-deriving national party-vote numbers — search only for polls with fieldwork ENDING AFTER ${latest.fieldwork_end || "the latest above"}, and issue-level polling the table does not carry.`;
}

/** Seat board — all 71 electorate markers: team-set status + notional margins. */
export function vbSeatBoardBlock() {
  const markers = cache.data?.markers;
  if (!markers?.length) return "";
  const line = (m) =>
    `- ${m.electorate} [${m.campaign_status || "unset"}]: notional leader ${m.leader || "n/r"}, Lab margin ${nr(m.lab_margin)}${m.swing_to_flip != null ? `, swing to flip ${m.swing_to_flip}` : ""}${m.roll === "maori" ? " (Māori roll)" : ""}`;
  return `SEAT BOARD — all ${markers.length} electorates from the shared second brain. campaign_status is set BY THE CAMPAIGN TEAM (defend/hold/target/stretch/left-bloc/none) — treat it as the team's current priority call, not a prediction. Margins are NOTIONAL: 2023 results recomputed on 2026 boundaries — estimates, never actual results. "n/r" = not recorded, never zero:
${markers.map(line).join("\n")}`;
}

/** One seat's deep-dive profile (or marker fallback) as fixed fact. */
export function vbSeatProfileBlock(name) {
  if (!cache.loaded || !name) return "";
  const norm = (s) => (s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\bmt\b/g, "mount").replace(/[^a-z0-9]/g, "");
  const p = (cache.data?.electorates || []).find((e) => norm(e.electorate) === norm(name));
  if (p) {
    const rows = [
      `campaign_status (team-set): ${p.campaign_status || "unset"}`,
      `incumbent: ${p.incumbent || "n/r"}${p.incumbent_party ? ` (${p.incumbent_party})` : ""}`,
      `Labour candidate: ${p.labour_candidate || "n/r"}`,
      `notional 2026-boundary ESTIMATES (2023 votes recomputed — label as estimates, never results): leader ${p.notional_leader || "n/r"}, Lab margin ${nr(p.notional_lab_margin_pct)}pts, swing to flip ${nr(p.swing_to_flip)}pts, party vote Lab ${nr(p.notional_lab_pv)} / Nat ${nr(p.notional_nat_pv)} / Grn ${nr(p.notional_grn_pv)}, left bloc ${nr(p.notional_left_bloc)} vs right bloc ${nr(p.notional_right_bloc)}`,
      `mobilisation: enrolled 2023 ${nr(p.enrolled_2023)}, non-voters ${nr(p.nonvoters_2023)} (${nr(p.nonvoter_rate_pct)}%), non-voters under 35 ${nr(p.nonvoters_under35)}`,
      p.predecessors ? `boundary predecessors: ${p.predecessors}` : "",
      p.candidates?.length ? `known 2026 candidates on file: ${p.candidates.join(", ")}` : "",
      p.sub_notes?.length ? `vault deep-dive notes exist on: ${p.sub_notes.map((s) => s.subtype).join(", ")}` : "",
    ].filter(Boolean);
    return `SECOND-BRAIN SEAT PROFILE — ${p.electorate} (${flag(p)}). Supplied fact; do not search to re-derive any of it:\n${rows.map((r) => `- ${r}`).join("\n")}`;
  }
  const m = (cache.data?.markers || []).find((x) => norm(x.electorate) === norm(name));
  if (!m) return "";
  return `SECOND-BRAIN SEAT MARKER — ${m.electorate}: campaign_status (team-set) ${m.campaign_status || "unset"}; notional leader ${m.leader || "n/r"}, Lab margin ${nr(m.lab_margin)}pts, swing to flip ${nr(m.swing_to_flip)}pts (2023-on-2026-boundaries estimates, not results). Supplied fact — do not re-derive.`;
}

const normSeat = (s) => (s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\bmt\b/g, "mount").replace(/[^a-z0-9]/g, "");

/** Compact, STRATEGY-framed seat context for the response pipeline — makes a
    brief seat-aware: a thin-margin target/defend seat with a big non-voter pool
    should weight mobilisation angles, a safe seat reinforcement. Empty for List
    MPs / seats not on the board. Uses vaultSeatInfo (defined below). */
export function vbSeatStrategyBlock(name) {
  const s = vaultSeatInfo(name);
  if (!s || !s.campaign_status || s.campaign_status === "none") return "";
  const parts = [`${name} is a ${s.campaign_status.toUpperCase()} seat — the campaign team's own priority call.`];
  if (s.lab_margin != null)
    parts.push(`Notional Labour margin ${s.lab_margin > 0 ? "+" : ""}${s.lab_margin}pts${s.swing_to_flip != null ? `, swing to flip ${s.swing_to_flip}pts` : ""} (2023 votes on 2026 boundaries — estimates, not results).`);
  if (s.nonvoters_2023 != null) {
    const mult = s.votes_to_flip_est ? Math.round(s.nonvoters_2023 / Math.max(1, s.votes_to_flip_est)) : null;
    parts.push(`Mobilisation pool: ${s.nonvoters_2023.toLocaleString()} non-voters${s.nonvoters_under35 != null ? ` (${s.nonvoters_under35.toLocaleString()} under 35)` : ""}${mult ? ` — roughly ${mult}× the estimated votes that decide the seat` : ""}.`);
  }
  return `SECOND-BRAIN SEAT CONTEXT — ${name} (supplied fact; do not search to re-derive):
- ${parts.join("\n- ")}
- STRATEGY WEIGHTING: a thin-margin target/defend seat with a large non-voter pool rewards turnout and mobilisation angles as much as persuading the undecided; a safe seat rewards reinforcement and base energy. Reflect this seat's status in which angles you prioritise — but keep every angle nationally framed and locally grounded.`;
}

/* Rough, honestly-labelled "votes to change hands" from a notional margin:
   uniform-swing arithmetic on 2023-boundary estimates. votes cast ≈ enrolled −
   non-voters; a margin of M points is M% of votes cast, and flipping needs
   half of that switched. Returns null unless both inputs are present — never
   guesses. The UI labels the result an ESTIMATE, never a target. */
function votesToFlipEst(marginPct, enrolled, nonvoters) {
  if (marginPct == null || enrolled == null || nonvoters == null) return null;
  const cast = enrolled - nonvoters;
  if (!(cast > 0)) return null;
  return Math.round((Math.abs(marginPct) / 100) * cast / 2);
}

/** Structured seat record for the UI (marker + profile merged), null if none.
    Not a prompt block — the map and seat panel render from this directly. */
export function vaultSeatInfo(name) {
  if (!cache.loaded || !name) return null;
  const m = (cache.data?.markers || []).find((x) => normSeat(x.electorate) === normSeat(name)) || null;
  const p = (cache.data?.electorates || []).find((e) => normSeat(e.electorate) === normSeat(name)) || null;
  if (!m && !p) return null;
  const lab_margin = p?.notional_lab_margin_pct ?? m?.lab_margin ?? null;
  return {
    campaign_status: p?.campaign_status ?? m?.campaign_status ?? null,
    notional_leader: p?.notional_leader ?? m?.leader ?? null,
    lab_margin,
    swing_to_flip: p?.swing_to_flip ?? m?.swing_to_flip ?? null,
    labour_candidate: p?.labour_candidate ?? null,
    incumbent: p?.incumbent ?? null,
    incumbent_party: p?.incumbent_party ?? null,
    roll: m?.roll ?? p?.roll ?? null,
    /* mobilisation / GOTV — profile-only (2026-boundary estimates) */
    enrolled_2023: p?.enrolled_2023 ?? null,
    nonvoters_2023: p?.nonvoters_2023 ?? null,
    nonvoters_under35: p?.nonvoters_under35 ?? null,
    nonvoter_rate_pct: p?.nonvoter_rate_pct ?? null,
    votes_to_flip_est: votesToFlipEst(lab_margin, p?.enrolled_2023, p?.nonvoters_2023),
    has_profile: !!p,
    last_updated: p?.last_updated ?? m?.last_updated ?? null,
  };
}

/** Candidate roster + deep-dive sub-notes for one seat, for the seat panel.
    Pure vault data; empty arrays when nothing is on file. Kept separate from
    vaultSeatInfo so the map's 71×-per-render hot path stays lean. */
export function vaultSeatDetail(name) {
  if (!cache.loaded || !name) return { candidates: [], sub_notes: [] };
  const p = (cache.data?.electorates || []).find((e) => normSeat(e.electorate) === normSeat(name)) || null;
  const candidates = (cache.data?.candidates || [])
    .filter((c) => normSeat(c.electorate) === normSeat(name))
    .map((c) => ({ name: c.name, party: c.party, role: c.role_2026, incumbent: !!c.incumbent, former_mp: !!c.former_mp }));
  const sub_notes = (p?.sub_notes || []).map((s) => ({ file: s.file, subtype: s.subtype, title: s.title, last_updated: s.last_updated }));
  return { candidates, sub_notes };
}

/** Fetch one vault note's body on demand (sub-note bodies aren't in the cached
    export — only issues/policy/analysis are). Uses the dev-server /vault/doc
    endpoint; returns "" on any failure. Read-only. */
export async function vaultFetchDocBody(file) {
  if (!file) return "";
  const d = await getJson(`/vault/doc?file=${encodeURIComponent(file)}`);
  return d?.body ? d.body.trim() : "";
}

/* ---- RELATED-NOTE GRAPH (the `related` [[wikilinks]] between notes) ---- */

/* Resolve a wikilink string to its target: strip [[ ]], an |alias, and a
   #heading, leaving the note title or path. */
const wikiTarget = (link) => String(link || "").replace(/^\s*\[\[/, "").replace(/\]\]\s*$/, "").split("|")[0].split("#")[0].trim();
const baseName = (s) => (s || "").replace(/\.md$/i, "").replace(/^.*\//, "").toLowerCase();

/** Find the note a wikilink target points to — by title, full path, or (for
    path-style links like `02-Issues/Housing`) basename. Null if none. */
function noteByLink(target) {
  if (!cache.loaded || !target) return null;
  const notes = cache.data?.notes || [];
  const t = target.toLowerCase();
  const tb = baseName(target);
  return notes.find((n) => (n.title || "").toLowerCase() === t)
    || notes.find((n) => n.file.replace(/\.md$/i, "").toLowerCase() === t)
    || notes.find((n) => baseName(n.file) === tb)
    || notes.find((n) => (n.title || "").toLowerCase() === tb)
    || null;
}

/** Forward links (this note's `related`) + backlinks (notes that link to it),
    resolved to browsable {file, title, type, last_updated, status} rows — the
    knowledge-graph navigation for the reader. Pure vault data. */
export function vaultRelatedFor(file) {
  if (!cache.loaded || !file) return { forward: [], backlinks: [] };
  const notes = cache.data?.notes || [];
  const self = notes.find((n) => n.file === file);
  if (!self) return { forward: [], backlinks: [] };
  const meta = (n) => ({ file: n.file, title: n.title || baseName(n.file), type: n.type, last_updated: n.last_updated, status: n.status });

  const forward = [];
  const seen = new Set([file]);
  for (const link of self.related || []) {
    const n = noteByLink(wikiTarget(link));
    if (n && !seen.has(n.file)) { seen.add(n.file); forward.push(meta(n)); }
  }

  const selfTitle = (self.title || "").toLowerCase();
  const selfBase = baseName(file);
  const backlinks = notes.filter((n) => n.file !== file && (n.related || []).some((link) => {
    const tgt = wikiTarget(link).toLowerCase();
    const tb = baseName(tgt);
    return tgt === selfTitle || tb === selfBase || tgt === selfBase || tb === selfTitle;
  })).map(meta);

  return { forward, backlinks };
}

/** Every seat as a UI row (marker + profile merged), for the Target Board.
    Pure vault data — the board renders with ZERO AI calls. campaign_status
    is the team's own priority call; all margins are 2026-boundary estimates. */
export function vaultSeatBoard() {
  if (!cache.loaded) return [];
  const profByName = new Map((cache.data?.electorates || []).map((p) => [normSeat(p.electorate), p]));
  return (cache.data?.markers || []).map((m) => {
    const p = profByName.get(normSeat(m.electorate)) || null;
    const lab_margin = p?.notional_lab_margin_pct ?? m.lab_margin ?? null;
    return {
      electorate: m.electorate,
      campaign_status: p?.campaign_status ?? m.campaign_status ?? null,
      roll: m.roll ?? p?.roll ?? null,
      leader: p?.notional_leader ?? m.leader ?? null,
      lab_margin,
      swing_to_flip: p?.swing_to_flip ?? m.swing_to_flip ?? null,
      labour_candidate: p?.labour_candidate ?? null,
      has_profile: !!p,
      enrolled_2023: p?.enrolled_2023 ?? null,
      nonvoters_2023: p?.nonvoters_2023 ?? null,
      nonvoters_under35: p?.nonvoters_under35 ?? null,
      nonvoter_rate_pct: p?.nonvoter_rate_pct ?? null,
      votes_to_flip_est: votesToFlipEst(lab_margin, p?.enrolled_2023, p?.nonvoters_2023),
      last_updated: p?.last_updated ?? m.last_updated ?? null,
    };
  });
}

/** Seats the team flagged for offence, ranked by how little swing flips them —
    drives vault-prioritised seat scanning so AI budget goes where it matters.
    Returns electorate-name strings, easiest-to-flip first. */
export function vaultPriorityTargets(max = 8) {
  return vaultSeatBoard()
    .filter((s) => s.campaign_status === "target" || s.campaign_status === "stretch")
    .filter((s) => s.swing_to_flip != null)
    .sort((a, b) => a.swing_to_flip - b.swing_to_flip)
    .slice(0, max)
    .map((s) => s.electorate);
}

/* ============================================================
   SECOND-BRAIN EXPLORER GETTERS — structured reads for the
   read-only in-app vault browser + Home pulse. All zero-token.
   ============================================================ */

const firstPara = (body) =>
  (body || "").split("\n").find((l) => {
    const t = l.trim();
    return t && !t.startsWith("#") && !t.startsWith("*") && !t.startsWith("|") && !t.startsWith(">") && !t.startsWith("-");
  }) || "";

/** National poll series oldest→newest, one row per poll, for the trend chart
    and poll-of-record table. party_vote nulls are preserved (never zeroed). */
export function vaultPollSeries() {
  const polls = cache.data?.polls;
  if (!polls?.length) return [];
  return polls.map((p) => ({
    date: p.fieldwork_end || null,
    pollster: p.pollster || null,
    sponsor: p.sponsor || null,
    provenance: p.provenance || null,
    sample_size: p.sample_size ?? null,
    margin_of_error: p.margin_of_error ?? null,
    ...Object.fromEntries(PARTY_ORDER.map((k) => [k, p.party_vote?.[k] ?? null])),
  }));
}

/** Most recent national poll (for the Home pulse). */
export function vaultLatestPoll() {
  const polls = cache.data?.polls;
  return polls?.length ? polls[polls.length - 1] : null;
}

/** Docs of a given type (issue|policy|analysis) as browsable cards, newest
    first. Bodies were already cached in initVault, so this spends nothing. */
export function vaultDocsByType(type) {
  if (!cache.loaded) return [];
  return Object.entries(cache.docs)
    .filter(([, d]) => d.type === type)
    .map(([file, d]) => ({
      file, title: d.title, status: d.status, last_updated: d.last_updated,
      type: d.type, excerpt: firstPara(d.body).slice(0, 220),
    }))
    .sort((a, b) => String(b.last_updated || "").localeCompare(String(a.last_updated || "")));
}

/** One doc's full body (cached) for the reader panel. */
export function vaultDocBody(file) { return cache.docs[file]?.body || ""; }

/** Free-text search across every cached vault doc body — the explorer's
    "search the whole vault" box. Plain substring scoring (title-weighted) with
    a snippet around the first hit; intuitive for a search box, unlike the
    distinctive-token matcher used for prompt grounding. */
export function vaultSearchDocs(query) {
  if (!cache.loaded || !query || query.trim().length < 2) return [];
  const terms = query.toLowerCase().trim().split(/\s+/).filter((w) => w.length > 1);
  if (!terms.length) return [];
  return Object.entries(cache.docs).map(([file, d]) => {
    const title = (d.title || "").toLowerCase();
    const body = (d.body || "").toLowerCase();
    let score = 0;
    for (const t of terms) {
      score += (body.split(t).length - 1) + (title.includes(t) ? 6 : 0);
    }
    if (!score) return null;
    const idx = body.indexOf(terms[0]);
    const snippet = idx >= 0
      ? (idx > 60 ? "…" : "") + d.body.slice(Math.max(0, idx - 60), idx + 140).replace(/\s+/g, " ").trim() + "…"
      : firstPara(d.body).slice(0, 170);
    return { file, title: d.title, type: d.type, status: d.status, last_updated: d.last_updated, score, snippet };
  }).filter(Boolean).sort((a, b) => b.score - a.score).slice(0, 25);
}

/** Compact snapshot for the Home "second brain pulse" widget. Everything the
    landing page needs to show the vault is alive, in one zero-token call. */
export function vaultPulse() {
  if (!cache.loaded) return null;
  const latest = vaultLatestPoll();
  const board = vaultSeatBoard();
  const lead = latest?.party_vote?.labour != null && latest?.party_vote?.national != null
    ? +(latest.party_vote.labour - latest.party_vote.national).toFixed(1) : null;
  return {
    latest: latest ? {
      pollster: latest.pollster, date: latest.fieldwork_end,
      labour: latest.party_vote?.labour ?? null, national: latest.party_vote?.national ?? null,
      lead, provenance: latest.provenance,
    } : null,
    targets: board.filter((s) => s.campaign_status === "target").length,
    stretch: board.filter((s) => s.campaign_status === "stretch").length,
    defence: board.filter((s) => s.campaign_status === "defend" || s.campaign_status === "hold").length,
    issues: vaultDocsByType("issue").length,
    policies: vaultDocsByType("policy").length,
    analysis: vaultDocsByType("analysis").length,
    generatedAt: cache.data?.generated_at || null,
    warnings: (cache.data?.warnings || []).length,
  };
}

/* ---- GROUNDING PREVIEW / PROVENANCE / SWEEP COVERAGE ----
   The SAME topic-matching the prompt builders use (matchDocs / attack-register
   split), surfaced as structured metadata. Lets the intake screen preview what
   the vault will inject before a run, the finished brief cite what grounded it,
   and the daily sweep flag items the vault already covers. All zero-token. */

const docMeta = (f, d) => ({ file: f, title: d.title, last_updated: d.last_updated, status: d.status });

/** Attack-register section headings matching a topic (for coverage + preview). */
export function vaultAttackMatches(topicText) {
  const d = cache.docs["08-Analysis/Attack and Rebuttal Register.md"];
  if (!d || !topicText) return [];
  const topic = tokenise(topicText);
  if (topic.size < 2) return [];
  const ix = ensureMatchIndex();
  return d.body.split(/^### /m).slice(1)
    .map((s) => {
      const { sum, hits, distinctive } = scoreTokens(topic, tokenise("### " + s), ix);
      return { heading: s.split("\n")[0].trim(), score: sum, hits, distinctive };
    })
    .filter((x) => x.hits >= 2 && x.distinctive)
    .sort((a, b) => b.score - a.score)
    .map((x) => x.heading);
}

/** Everything the second brain WOULD inject for a topic, structured — for the
    intake grounding preview and the finished-brief provenance footer. `party`
    is the attacking/moving party (drives platform match); `coversRecord`
    gates the Labour-record check to attack-style runs. Honest preview: it runs
    the exact matchers the pipeline stages use. */
export function vaultGroundingFor(topicText, { party = "", coversRecord = true } = {}) {
  if (!cache.loaded) return null;
  const issues = matchDocs(topicText, /^02-Issues\//, 2).map(({ f, d }) => docMeta(f, d));
  const policy = matchDocs(topicText, /^01-Policy\/(?!.*Platform 2026)/, 2).map(({ f, d }) => docMeta(f, d));
  const pf = platformFileFor(party);
  const platform = pf ? { file: pf, party, ...(cache.docs[pf] ? { title: cache.docs[pf].title, last_updated: cache.docs[pf].last_updated } : { title: `${party} Platform 2026`, missing: true }) } : null;
  const attack = vaultAttackMatches(topicText);
  const record = !!(coversRecord && topicMatchesDoc(topicText, "08-Analysis/Labour Record 2017-2023.md", 3));
  return {
    pollOfRecord: !!(cache.data?.polls || []).length,
    seatBoard: !!(cache.data?.markers || []).length,
    issues, policy, platform, attack, record,
    matched: issues.length + policy.length + (platform && !platform.missing ? 1 : 0) + (attack.length ? 1 : 0) + (record ? 1 : 0),
  };
}

/** Does the vault already cover a sweep item's topic? Best issue brief +
    matching attack-register lines — for the daily-sweep "2B covers this" badge,
    so the team can see redundant research before spending a run. */
export function vaultCoverageFor(topicText) {
  if (!cache.loaded || !topicText) return null;
  const hit = matchDocs(topicText, /^02-Issues\//, 1)[0];
  const attack = vaultAttackMatches(topicText);
  const policy = matchDocs(topicText, /^01-Policy\/(?!.*Platform 2026)/, 1)[0];
  if (!hit && !attack.length && !policy) return null;
  return {
    issue: hit ? docMeta(hit.f, hit.d) : null,
    policy: policy ? docMeta(policy.f, policy.d) : null,
    attack: attack.slice(0, 2),
  };
}

/* Age of a doc in days from its last_updated ISO date; null if undated. */
const docAgeDays = (iso) => {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : Math.max(0, (Date.now() - t) / 86400000);
};

/** Live-search budget for a RESEARCH stage after vault grounding. `base` is the
    tier's search cap; `docs` are the matched vault docs (with last_updated) that
    already supply this stage's background. Cuts the budget up to 40%, scaled by
    how fresh the coverage is (full ≤45 days old, tapering to none by 120 days,
    half if undated) and by how much matched — but NEVER below 60% of base, so
    there is always budget for developments newer than the vault. Returns base
    unchanged when nothing relevant matched. Verification stages never call this,
    so the "no live URL → claim dropped" rule is untouched. */
export function vaultSearchBudget(base, docs) {
  if (!base || base <= 1 || !docs || !docs.length) return base;
  const ages = docs.map((d) => docAgeDays(d?.last_updated)).filter((a) => a != null);
  const freshest = ages.length ? Math.min(...ages) : null;
  const fresh = freshest == null ? 0.4 : Math.max(0, Math.min(1, 1 - (freshest - 45) / 75));
  const strength = Math.min(docs.length, 2) / 2; // 1 doc = half weight, 2+ = full
  const discount = 0.4 * fresh * strength;
  return Math.max(Math.ceil(base * 0.6), Math.round(base * (1 - discount)));
}

/** last_updated/status/title for one cached doc, for freshness-based budgeting
    (e.g. the War Room terrain call discounting against State of the Race). */
export function vaultDocMetaFor(file) {
  const d = cache.docs[file];
  return d ? { file, title: d.title, last_updated: d.last_updated, status: d.status } : null;
}

const docBlock = (label, file, extra = "") => {
  const d = cache.docs[file];
  if (!d) return "";
  return `${label} (from the shared second brain, ${flag(d)}${extra}):\n${d.body}`;
};

/** State of the Race — strategic backdrop for the War Room terrain call. */
export function vbStateOfRaceBlock() {
  return docBlock(
    "STATE OF THE RACE — the campaign's own weekly synthesis. Reason FROM it; never quote it as external fact; spend searches only on movement SINCE its date",
    "08-Analysis/State of the Race.md"
  );
}

/** One-line digests of every issue brief — tells terrain what the vault covers. */
export function vbIssueDigestBlock() {
  if (!cache.loaded) return "";
  const issues = Object.values(cache.docs).filter((d) => d.type === "issue");
  if (!issues.length) return "";
  const lines = issues.map((d) => {
    const para = d.body.split("\n").find((l) => l.trim() && !l.startsWith("#") && !l.startsWith("*")) || "";
    return `- ${d.title} (${flag(d)}): ${para.trim().slice(0, 160)}`;
  });
  return `SECOND-BRAIN ISSUE BRIEFS ON FILE — the campaign already holds maintained briefs on these issues (dates shown; do not search to re-establish this background, only for developments since):\n${lines.join("\n")}`;
}

/** Full issue brief(s) matching a live topic, for dossier/angles grounding. */
export function vbIssueBriefsFor(topicText, max = 2) {
  const hits = matchDocs(topicText, /^02-Issues\//, max);
  return hits.map(({ d }) =>
    `SECOND-BRAIN ISSUE BRIEF — ${d.title} (${flag(d)}). Maintained background; verify anything time-sensitive against its date:\n${d.body}`
  ).join("\n\n");
}

/** Attack-register sections matching a live topic (attack mode angles / interview). */
export function vbAttackRegisterFor(topicText) {
  const d = cache.docs["08-Analysis/Attack and Rebuttal Register.md"];
  if (!d || !topicText) return "";
  const topic = tokenise(topicText);
  if (topic.size < 2) return "";
  const ix = ensureMatchIndex();
  const sections = d.body.split(/^### /m).slice(1)
    .map((s) => "### " + s.trim())
    .filter((s) => { const r = scoreTokens(topic, tokenise(s), ix); return r.hits >= 2 && r.distinctive; });
  if (!sections.length) return "";
  return `ATTACK & REBUTTAL REGISTER — matched entries from the shared second brain (${flag(d)}). This is rebuttal-PREP: "attack" and "response" are each party's framing; the facts-to-verify lines are the substance. Reinforce this prepared ground rather than inventing fresh rebuttals, and respect its disputed/unverified flags:\n${sections.join("\n\n")}`;
}

/** Party name → their 2026 platform doc path (null if unrecognised). Shared
    by the prompt builder and the UI grounding preview. */
export function platformFileFor(partyName) {
  const n = (partyName || "").toLowerCase();
  if (!n) return null;
  return n.includes("national") ? "01-Policy/National Party Platform 2026.md"
    : n.includes("act") ? "01-Policy/ACT Platform 2026.md"
    : n.includes("green") ? "01-Policy/Green Party Platform 2026.md"
    : n.includes("first") || n === "nzf" ? "01-Policy/NZ First Platform 2026.md"
    : n.includes("māori") || n.includes("maori") ? "01-Policy/Te Pati Maori Platform 2026.md"
    : n.includes("opportunit") || n === "top" ? "01-Policy/Opportunity Party Platform 2026.md"
    : null;
}

/** A party's 2026 platform doc, for dossier/position grounding. */
export function vbPartyPlatformBlock(partyName) {
  if (!cache.loaded || !partyName) return "";
  const fileFor = platformFileFor(partyName);
  if (!fileFor) return "";
  return docBlock(
    `${partyName.toUpperCase()} PLATFORM 2026 — the second brain's verified summary of their programme. Characterise their policy from this before spending searches; search only for announcements NEWER than its date`,
    fileFor
  );
}

/** Labour topic-policy docs matching a topic, for the Labour-position stage. */
export function vbLabourPolicyFor(topicText, max = 2) {
  const hits = matchDocs(topicText, /^01-Policy\/(?!.*Platform 2026)/, max);
  return hits.map(({ d }) =>
    `SECOND-BRAIN POLICY DOC — ${d.title} (${flag(d)}). Ground Labour's position here first; search only to update or for what this does not cover:\n${d.body}`
  ).join("\n\n");
}

/** Labour 2017–23 record grounding, when the attack targets the record. */
export function vbLabourRecordFor(topicText) {
  const d = cache.docs["08-Analysis/Labour Record 2017-2023.md"];
  if (!d || !topicText) return "";
  if (!topicMatchesDoc(topicText, "08-Analysis/Labour Record 2017-2023.md", 3)) return "";
  return docBlock(
    "LABOUR RECORD 2017–2023 — the second brain's defensive brief on the record in government. Use for context on record attacks; its disputed-point flags are part of the content",
    "08-Analysis/Labour Record 2017-2023.md"
  );
}

/** Cross-party comparison matrix (portfolio + interview prep). */
export function vbComparisonBlock() {
  return docBlock(
    "PARTY COMPARISON MATRIX — cross-party positions from the shared second brain, for contrast lines",
    "08-Analysis/Party Comparison Matrix.md"
  );
}

/** Current government ministers roster — for the attacker-dossier to confirm the
    attacker's CURRENT portfolio/role from the vault (maintained through the
    latest reshuffle) instead of spending searches on Hansard/parliament.nz. */
export function vbGovtMinistersBlock() {
  return docBlock(
    "CURRENT GOVERNMENT MINISTERS — the second brain's maintained roster of the National–ACT–NZ First coalition's portfolios (kept current through reshuffles). Confirm the attacker's CURRENT role and portfolio from THIS before searching Hansard/parliament.nz — the model's own memory predates recent reshuffles. Spend searches only on what this does not carry: the cuts they have presided over and any controversies",
    "06-People-Orgs/Coalition Government Key Ministers.md"
  );
}

/** Is a person on the government ministers roster? Used to trim the
    attacker-dossier's search budget when the role is vault-confirmed. Returns
    the matched line (portfolio) or null. */
export function vaultMinisterMeta(name) {
  const d = cache.docs["06-People-Orgs/Coalition Government Key Ministers.md"];
  if (!d || !name) return null;
  const n = name.trim().toLowerCase();
  if (!n || n.length < 3) return null;
  const line = d.body.split("\n").find((l) => l.toLowerCase().includes(n) && l.includes("|"));
  return line ? { file: d.file, last_updated: d.last_updated, status: d.status, line: line.trim() } : null;
}

/* ---- STABLE VAULT CONTEXT ----
   Joined with the knowledge folder's stable prefix in withKb(), so
   every KB-aware call shares one byte-identical cached block. Content
   changes only when the vault changes — which correctly busts the
   Anthropic prompt cache. */
let stableVault = null;
export function vaultStableContext() {
  if (stableVault === null) {
    stableVault = [vbPollTrendBlock(), vbSeatBoardBlock()].filter(Boolean).join("\n\n");
  }
  return stableVault;
}
export function invalidateVaultContext() { stableVault = null; matchIndex = null; }
