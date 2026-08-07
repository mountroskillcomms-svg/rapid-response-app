/* ============================================================
   KNOWLEDGE FOLDER LOADER — reads /knowledge/* (public folder,
   editable outside the app, e.g. as an Obsidian vault).

   Design rules:
   - Preload once at app start (initKnowledge). All block
     builders are then SYNCHRONOUS string getters so system
     prompts can be built without async plumbing.
   - Every getter degrades to "" if the folder or file is
     missing — the app must work with no knowledge folder.
   - Blocks are COMPACT on purpose: they replace web searches
     (cost) and ground facts (quality), so only what earns its
     tokens goes into a prompt.
   ============================================================ */

const cache = {
  index: null,
  electorates: null,
  partyLists: null,
  roles: null,
  tone: "",
  narratives: "",
  mmp: "",
  policies: [], // approved policy entries
  swingVoter: "",
  interviewers: {}, // key -> { label, show, styleGuide }
  polling: "",
  lines: [], // message-discipline memory: [{ slug, issue, angles, updatedAt }]
  loaded: false,
};

const getJson = async (path) => {
  try {
    const r = await fetch(path, { cache: "no-store" });
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
};
const getText = async (path) => {
  try {
    const r = await fetch(path, { cache: "no-store" });
    if (!r.ok) return "";
    return await r.text();
  } catch { return ""; }
};

export async function initKnowledge() {
  const [index, electorates, partyLists, roles, tone, narratives, mmp] = await Promise.all([
    getJson("/knowledge/index.json"),
    getJson("/knowledge/electorates.json"),
    getJson("/knowledge/party-lists.json"),
    getJson("/knowledge/roles.json"),
    getText("/knowledge/tone/labour-press-release-tone.md"),
    getText("/knowledge/elections-narratives.md"),
    getText("/knowledge/mmp-electoral-system.md"),
  ]);
  cache.index = index;
  cache.electorates = electorates;
  cache.partyLists = partyLists;
  cache.roles = roles;
  cache.tone = tone;
  cache.narratives = narratives;
  cache.mmp = mmp;
  cache.swingVoter = await getText("/knowledge/profiles/swing-voter-2026.md");
  const polling = await getText("/knowledge/polling.md");
  // The polling file ships as a template; it only becomes prompt context
  // once someone has actually filled it in and removed the marker line.
  cache.polling = polling.includes("STATUS: not yet populated") ? "" : polling;
  await loadInterviewers();
  await refreshPolicies();
  await refreshLines();
  cache.loaded = !!index;
  return cache.loaded;
}

export async function refreshLines() {
  const idx = await getJson("/knowledge/lines/index.json");
  const files = idx?.lines || [];
  const baked = (await Promise.all(files.map((f) => getJson(`/knowledge/lines/${f}`)))).filter(Boolean);
  // Hosted build: overlay KV-added line entries (functions/kb/lines GET) on top
  // of the repo-baked static ones. In dev, writes go to files, so no overlay.
  const overlay = import.meta.env.PROD ? (await getJson("/kb/lines"))?.lines || [] : [];
  const bySlug = new Map();
  for (const l of baked) if (l?.slug) bySlug.set(l.slug, l);
  for (const l of overlay) if (l?.slug) bySlug.set(l.slug, l); // KV wins / adds
  cache.lines = [...bySlug.values()];
  return cache.lines;
}

/* Interviewer profile files: minimal frontmatter (key/label/show) + body. */
async function loadInterviewers() {
  const idx = await getJson("/knowledge/profiles/interviewers/index.json");
  const files = idx?.files || [];
  const texts = await Promise.all(files.map((f) => getText(`/knowledge/profiles/interviewers/${f}`)));
  const out = {};
  for (const raw of texts) {
    const m = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
    if (!m) continue;
    const fm = {};
    for (const line of m[1].split("\n")) {
      const kv = line.match(/^(\w+):\s*(.+)$/);
      if (kv) fm[kv[1]] = kv[2].trim();
    }
    if (fm.key) out[fm.key] = { label: fm.label || fm.key, show: fm.show || "", styleGuide: m[2].trim() };
  }
  cache.interviewers = out;
}

export async function refreshPolicies() {
  const pidx = await getJson("/knowledge/policies/index.json");
  const files = pidx?.policies || [];
  const baked = (await Promise.all(files.map((f) => getJson(`/knowledge/policies/${f}`)))).filter(Boolean);
  // Hosted build: overlay KV-added entries (functions/kb/policies GET) on top of
  // the repo-baked static ones. In dev, writes go to files, so no overlay.
  const overlay = import.meta.env.PROD ? (await getJson("/kb/policies"))?.policies || [] : [];
  const byId = new Map();
  for (const p of baked) if (p?.id) byId.set(p.id, p);
  for (const p of overlay) if (p?.id) byId.set(p.id, p); // KV wins / adds
  cache.policies = [...byId.values()];
  invalidateStableContext(); // policies feed the cached prefix
  return cache.policies;
}

export const kbLoaded = () => cache.loaded;
export const kbAsOf = () => cache.index?._meta?.lastUpdated || "";
export const kbPolicies = () => cache.policies;
export const kbLines = () => cache.lines;
export const kbHasPolling = () => !!cache.polling;

/* ---- lookup helpers (structured data) ---- */

const norm = (s) => (s || "").trim().toLowerCase()
  .normalize("NFD").replace(/[̀-ͯ]/g, ""); // strip macrons for matching

/** Find the Labour candidate record + electorate for a person's name. */
export function kbLabourCandidate(name) {
  const els = cache.electorates?.electorates;
  if (!els || !name) return null;
  const n = norm(name);
  for (const el of els) {
    for (const c of el.candidates || []) {
      if (c.status === "active" && c.party?.includes("Labour") && norm(c.name) === n) {
        return { electorate: el.name, electorateType: el.type, ...c };
      }
    }
  }
  return null;
}

/** One electorate's full candidate slate, as a compact prompt block. */
export function kbElectorateBlock(name) {
  const els = cache.electorates?.electorates;
  if (!els || !name) return "";
  const n = norm(name);
  const el = els.find((e) => norm(e.name) === n);
  if (!el) return "";
  const lines = (el.candidates || [])
    .filter((c) => c.status === "active")
    .map((c) => `- ${c.name} (${c.party})${c.incumbentMP ? " [incumbent MP]" : ""}${c.listRank ? ` [list #${c.listRank}]` : ""}${c.notes ? ` — ${c.notes}` : ""}`);
  if (!lines.length) return "";
  return `VERIFIED 2026 CANDIDATES FOR ${el.name.toUpperCase()} (from the campaign knowledge base, as of ${cache.electorates?._meta?.asOf || "n/a"} — selections ongoing, absence means not yet selected):\n${lines.join("\n")}`;
}

/** One line per electorate: Labour's candidate + who holds the seat. Compact
    grounding for the war-room electorate scanner (replaces candidate searches). */
export function kbSeatSummaryBlock() {
  const els = cache.electorates?.electorates;
  if (!els) return "";
  const lines = els.map((el) => {
    const act = (el.candidates || []).filter((c) => c.status === "active");
    const lab = act.find((c) => c.party?.includes("Labour"));
    const inc = act.find((c) => c.incumbentMP);
    return `- ${el.name}: Labour=${lab ? lab.name : "not yet selected"}${inc ? ` | incumbent standing: ${inc.name} (${inc.party})` : ""}`;
  });
  return `VERIFIED 2026 CANDIDATE STATUS PER ELECTORATE (from the campaign knowledge base as of ${cache.electorates?._meta?.asOf || "n/a"} — use this instead of searching for candidate names; only search for campaign DYNAMICS, never to re-derive candidates):\n${lines.join("\n")}`;
}

/** Compact Labour spokesperson roster — replaces web searches for MP/portfolio assignment. */
export function kbRolesBlock() {
  const sp = cache.roles?.labourSpokespersons;
  if (!sp?.length) return "";
  const lines = sp.map((s) => `${s.rank}. ${s.name}: ${(s.roles || []).join("; ")}`);
  return `VERIFIED LABOUR SPOKESPERSON LIST (as at the 11 March 2026 reshuffle — use this for portfolio/MP assignment instead of searching; only search if a person or portfolio is NOT on this list):\n${lines.join("\n")}`;
}

/** Compact current-ministers roster. */
export function kbMinistersBlock() {
  const ms = cache.roles?.currentMinisters;
  if (!ms?.length) return "";
  const lines = ms.map((m) => `- ${m.portfolio}: ${m.name} (${m.party})`);
  return `VERIFIED CURRENT MINISTERS (incl. April 2026 reshuffle — use instead of searching):\n${lines.join("\n")}`;
}

/** Approved policy database as a prompt block ("" if empty). */
export function kbPoliciesBlock() {
  if (!cache.policies.length) return "";
  const lines = cache.policies.map((p) =>
    `- [${p.party}] ${p.title} (${p.date}): ${p.summary}${p.source_url ? ` — ${p.source_url}` : ""}`);
  return `APPROVED POLICY DATABASE (human-verified entries from the campaign knowledge base — treat as accurate; still cite the source_url when used):\n${lines.join("\n")}`;
}

/* ---- markdown section extraction (tone + narratives are large;
        only ship the sections a given feature needs) ---- */

function mdSection(md, heading) {
  if (!md) return "";
  const re = new RegExp(`^##\\s+${heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[^\\n]*$`, "m");
  const m = re.exec(md);
  if (!m) return "";
  const rest = md.slice(m.index + m[0].length);
  const next = rest.search(/^##\s+/m);
  return (next === -1 ? rest : rest.slice(0, next)).trim();
}

/** Condensed tone guidance for the press-release scaffold (client-side, zero
    tokens). Only the numbered rigour checklist, one line each — the writer
    can open the full tone doc for everything else. */
export function kbToneScaffoldSection() {
  const rigour = mdSection(cache.tone, "The rigour bar");
  if (!rigour) return "";
  const items = [];
  for (const raw of rigour.split("\n")) {
    const m = raw.match(/^(\d+)\.\s+\*{0,2}(.+?)\*{0,2}\s*$/) || raw.match(/^(\d+)\.\s+(.*)$/);
    if (m) {
      // first sentence only, markdown stripped
      const text = m[2].replace(/\*\*/g, "").split(/(?<=[.!])\s/)[0].trim();
      items.push(`${m[1]}. ${text}`);
    }
  }
  if (!items.length) return "";
  return `RIGOUR CHECKLIST — from the Labour tone guide (full doc: knowledge/tone)\n${items.join("\n")}`;
}

/** Full tone doc for prompts that generate press-statement structure. */
export function kbToneBlock() {
  return cache.tone ? `LABOUR PRESS-RELEASE TONE GUIDE (derived from 20 real May–Jul 2026 releases — follow its structure, frames, rigour bar and anti-patterns):\n${cache.tone}` : "";
}

/** Narratives doc for strategy/war-room prompts. */
export function kbNarrativesBlock() {
  return cache.narratives
    ? `BACKGROUND — LAST THREE ELECTIONS (interpretive analysis to reason from, never to quote as fact; respect the "no longer applies" flags):\n${cache.narratives}`
    : "";
}

/** MMP explainer for electoral-mechanics prompts. */
export function kbMmpBlock() {
  return cache.mmp ? `NZ ELECTORAL SYSTEM REFERENCE (verified):\n${cache.mmp}` : "";
}

/** Swing-voter profile as a prompt block ("" if not authored). */
export function kbSwingVoterBlock() {
  return cache.swingVoter
    ? `CRITICAL SWING VOTER PROFILE (constructed persuasion target from the campaign knowledge base — score persuasion and salience against this persona, not the party base):\n${cache.swingVoter}`
    : "";
}

/** Pinned polling reference ("" until the template is filled in). */
export function kbPollingBlock() {
  return cache.polling
    ? `PINNED POLLING REFERENCE (manually curated in the campaign knowledge base — use as the polling basis for persuasiveness/salience ratings before spending searches):\n${cache.polling}`
    : "";
}

/* ---- STABLE CONTEXT PREFIX ----
   One deterministic, byte-identical block shared by every KB-aware call
   (sweep, terrain, triage, angles, position, electorate scan). Marked
   with cache_control by callClaude, so within Anthropic's cache window
   repeat calls read these tokens at ~10x discount. Order is fixed;
   content changes only when the underlying files change (which
   correctly busts the cache). */
let stablePrefix = null;
export function kbStableContext() {
  if (stablePrefix === null) {
    stablePrefix = [
      kbRolesBlock(),
      kbMinistersBlock(),
      kbPoliciesBlock(),
      kbPollingBlock(),
      kbNarrativesBlock(),
      kbSwingVoterBlock(),
    ].filter(Boolean).join("\n\n");
  }
  return stablePrefix;
}
export function invalidateStableContext() { stablePrefix = null; }

/** Roles held by a named Labour spokesperson (null if not on the roster). */
export function kbSpokespersonRoles(name) {
  const sp = cache.roles?.labourSpokespersons;
  if (!sp || !name) return null;
  const n = norm(name);
  const hit = sp.find((s) => norm(s.name) === n);
  return hit ? hit.roles || [] : null;
}

/* ---- MESSAGE-DISCIPLINE MEMORY ----
   Established lines per issue: saved from finished briefs (human click),
   injected into later angle generation on the same ground so the tool
   reinforces yesterday's frame instead of inventing a fresh one. */

const tokenise = (s) => new Set(
  (s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9\s]/g, " ").split(/\s+/)
    .filter((w) => w.length > 3 &&
      !["that", "this", "with", "from", "have", "will", "would", "their", "about", "under", "government", "labour", "national", "party"].includes(w))
);

/** Established lines relevant to a topic ("" if none match). */
export function kbLinesFor(topicText) {
  if (!cache.lines.length || !topicText) return "";
  const topic = tokenise(topicText);
  const matches = cache.lines.filter((l) => {
    const lt = tokenise(`${l.issue} ${(l.angles || []).join(" ")}`);
    let overlap = 0;
    for (const w of topic) if (lt.has(w)) overlap++;
    return overlap >= 2;
  });
  if (!matches.length) return "";
  const blocks = matches.slice(0, 3).map((l) =>
    `Issue: ${l.issue} (saved ${(l.updatedAt || "").slice(0, 10)})\n${(l.angles || []).map((a) => `- ${a}`).join("\n")}`);
  return `ESTABLISHED LINES ON THIS GROUND (from the campaign's message-discipline memory — repetition wins: REINFORCE these frames where the evidence still supports them rather than inventing fresh ones; flag if any has become unsupportable):\n${blocks.join("\n\n")}`;
}

export async function saveLinesToKb(entry) {
  const r = await fetch("/kb/lines", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(entry),
  });
  if (!r.ok) throw new Error(`Lines save failed (${r.status}): ${await r.text()}`);
  const out = await r.json();
  await refreshLines();
  return out;
}

/** Interviewer profiles loaded from the knowledge base. */
export const kbInterviewers = () => cache.interviewers;
export const kbInterviewer = (key) => cache.interviewers[key] || null;

/* ---- policy DB write API (dev-server middleware in vite.config.js) ---- */

export async function savePolicyToKb(entry) {
  const r = await fetch("/kb/policies", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(entry),
  });
  if (!r.ok) throw new Error(`Policy save failed (${r.status}): ${await r.text()}`);
  const out = await r.json();
  await refreshPolicies();
  return out;
}

export async function deletePolicyFromKb(id) {
  const r = await fetch(`/kb/policies/${encodeURIComponent(id)}`, { method: "DELETE" });
  if (!r.ok) throw new Error(`Policy delete failed (${r.status})`);
  await refreshPolicies();
}
