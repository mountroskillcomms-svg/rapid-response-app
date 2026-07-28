/* ============================================================
   EXPORT / IMPORT — PDF and JSON export for briefs, sweeps and
   War Room data, plus JSON import so a saved sweep can be loaded
   into a fresh session without re-spending tokens.

   PDF: text-based (selectable, small files) via jspdf, driven by
   the same markdown-ish serialization the Copy buttons use:
     "# "  title   · "## " section · "### " subsection
     "- "  bullet  · "> "  callout · plain lines = paragraphs
   URLs become live links. Labour-red accents, page footer.

   JSON: every payload is stamped {app, kind, version} and
   validated on import. Kinds: brief | interview | sweep |
   portfolio_sweep | warroom | bundle (an array of the above).

   jspdf (~350 kB) is loaded on demand inside the PDF builder, not at
   module load — it stays out of the initial bundle and only downloads
   the first time someone exports a PDF.
   ============================================================ */

export const EXPORT_APP = "nz-rapid-response";
export const EXPORT_VERSION = 1;

/* ---------------- filenames & downloads ---------------- */
export const sanitizeFilename = (s) =>
  (s || "export")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "_")
    .slice(0, 60) || "export";

const stamp = () => new Date().toISOString().slice(0, 10);

export function downloadBlob(filename, blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export function downloadJson(basename, payload) {
  downloadBlob(
    `${sanitizeFilename(basename)}_${stamp()}.json`,
    new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" })
  );
}

/* ---------------- PDF engine ---------------- */
const PDF = {
  margin: 46,
  red: [185, 28, 28],
  ink: [28, 25, 23],
  gray: [120, 113, 108],
  lightGray: [168, 162, 158],
  linkBlue: [29, 78, 216],
  amber: [180, 83, 9],
};

const URL_RE = /https?:\/\/[^\s)"'\]]+/g;

export async function markdownishToPdf({ title, subtitle, body, filename }) {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "pt", format: "a4", compress: true });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = PDF.margin;
  const maxW = W - M * 2;
  let y = 0;

  const ensure = (needed) => {
    if (y + needed > H - M - 18) {
      doc.addPage();
      y = M;
    }
  };

  // Title band
  doc.setFillColor(...PDF.red);
  doc.rect(0, 0, W, 6, "F");
  y = M + 6;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(17);
  doc.setTextColor(...PDF.ink);
  const titleLines = doc.splitTextToSize(title || "Export", maxW);
  doc.text(titleLines, M, y);
  y += titleLines.length * 20 + 2;
  if (subtitle) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9.5);
    doc.setTextColor(...PDF.gray);
    const subLines = doc.splitTextToSize(subtitle, maxW);
    doc.text(subLines, M, y);
    y += subLines.length * 12 + 4;
  }
  doc.setDrawColor(220, 215, 210);
  doc.line(M, y, W - M, y);
  y += 16;

  const writeWrapped = (text, { size, style, color, indent = 0, gapAfter = 4, lineH }) => {
    doc.setFont("helvetica", style);
    doc.setFontSize(size);
    doc.setTextColor(...color);
    const lh = lineH || size * 1.38;
    const lines = doc.splitTextToSize(text, maxW - indent);
    for (const ln of lines) {
      ensure(lh);
      doc.text(ln, M + indent, y);
      // Make any URL in this rendered line clickable across its actual span.
      const m = ln.match(URL_RE);
      if (m) {
        const url = m[0];
        const before = ln.slice(0, ln.indexOf(url));
        const x0 = M + indent + doc.getTextWidth(before);
        const w = doc.getTextWidth(url);
        doc.link(x0, y - size, w, size + 2, { url });
      }
      y += lh;
    }
    y += gapAfter;
  };

  const lines = (body || "").split("\n");
  for (let raw of lines) {
    const line = raw.replace(/\*\*/g, ""); // strip bold markers; layout carries the weight
    if (!line.trim()) { y += 5; continue; }

    if (line.startsWith("# ")) {
      // In-body H1 (rare — the title band already carries it); render as big heading.
      ensure(30);
      writeWrapped(line.slice(2), { size: 14, style: "bold", color: PDF.ink, gapAfter: 6 });
    } else if (line.startsWith("## ")) {
      ensure(34);
      y += 8;
      doc.setFillColor(...PDF.red);
      doc.rect(M, y - 9, 3, 12, "F");
      writeWrapped(line.slice(3).toUpperCase(), { size: 11, style: "bold", color: PDF.red, indent: 10, gapAfter: 5 });
    } else if (line.startsWith("### ")) {
      ensure(24);
      y += 3;
      writeWrapped(line.slice(4), { size: 10.5, style: "bold", color: PDF.ink, gapAfter: 3 });
    } else if (line.startsWith("> ")) {
      writeWrapped(line.slice(2), { size: 8.7, style: "italic", color: PDF.gray, indent: 10, gapAfter: 3 });
    } else if (/^\s*- /.test(line)) {
      const indentDepth = (line.match(/^\s*/)[0].length >= 2 ? 12 : 0);
      const txt = line.replace(/^\s*- /, "");
      const isWarn = /^⚠|^NOTE|could not|NOT |unverified|Struck|Dropped|Excluded/i.test(txt);
      ensure(14);
      doc.setFillColor(...(isWarn ? PDF.amber : PDF.red));
      doc.circle(M + 4 + indentDepth, y - 3, 1.6, "F");
      writeWrapped(txt, { size: 9.3, style: "normal", color: isWarn ? PDF.amber : PDF.ink, indent: 12 + indentDepth, gapAfter: 2.5 });
    } else if (line.startsWith("⚠")) {
      writeWrapped(line, { size: 9.5, style: "bold", color: PDF.amber, gapAfter: 4 });
    } else {
      writeWrapped(line, { size: 9.3, style: "normal", color: PDF.ink, gapAfter: 4 });
    }
  }

  // Footer on every page
  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(...PDF.lightGray);
    doc.text(`Guidance and links only — a human writes every word · generated ${new Date().toLocaleString("en-NZ")}`, M, H - 22);
    doc.text(`${p} / ${pages}`, W - M, H - 22, { align: "right" });
  }

  doc.save(`${sanitizeFilename(filename || title)}_${stamp()}.pdf`);
}

/* ---------------- serializers (markdown-ish) ---------------- */

export function sweepToMarkdown({ items, gaps, days, tier }) {
  const L = [];
  L.push(`Window: last ${days} day${days === 1 ? "" : "s"} · ${items.length} item${items.length === 1 ? "" : "s"} · tier: ${tier}`);
  L.push(`> Scans NZ media, Beehive, Parliament, and party press pages. Items are sorted by priority.`);
  for (const it of items) {
    const typeLabel = it.type === "policy" ? "POLICY" : it.type === "other" ? "IMPORTANT" : "ATTACK";
    L.push(`\n## ${typeLabel} — ${it.headline || "(no headline)"}`);
    L.push(`- Priority: ${it.priority || "low"}${it.battleground ? " · BATTLEGROUND" : ""}${it.specificity === "hyper_specific" ? " · hyper-specific" : ""}`);
    L.push(`- ${it.outlet || "unknown outlet"} · ${it.date || "no date"} · via ${it.platform || "?"}`);
    if (it.who) L.push(`- Who: ${it.who}${it.party ? ` (${it.party})` : ""}${it.role ? ` · ${it.role}` : ""}`);
    if (it.summary) L.push(`${it.summary}`);
    if (it.priority_reason) L.push(`> ${it.priority_reason}`);
    if (it.source_url) L.push(`- Source: ${it.source_url}`);
    (it.assigned_mps || []).forEach((m) =>
      L.push(`- Assigned MP: ${m.name}${m.portfolio ? ` (${m.portfolio})` : ""}${m.reason ? ` — ${m.reason}` : ""}`));
    if ((it.supplementary_mps || []).length)
      L.push(`- Supplementary MPs: ${(it.supplementary_mps || []).map((m) => m.name || m).join(", ")}`);
  }
  const g = (gaps || []).filter(Boolean);
  if (g.length) {
    L.push(`\n## Gaps`);
    g.forEach((x) => L.push(`- ${x}`));
  }
  return L.join("\n");
}

export function portfolioSweepToMarkdown({ items, gaps, days, tier, portfolioLabel }) {
  const L = [];
  L.push(`Portfolio: ${portfolioLabel} · last ${days} day${days === 1 ? "" : "s"} · ${items.length} item${items.length === 1 ? "" : "s"} · tier: ${tier}`);
  L.push(`> Neutral, decision-support briefing — both sides of contested claims are stated.`);
  const TYPE_LABEL = {
    international_event: "International event",
    policy_development: "Policy development",
    party_statement: "Party statement",
    mp_statement: "MP statement",
  };
  for (const it of items) {
    L.push(`\n## ${TYPE_LABEL[it.type] || it.type || "Item"} — ${it.headline || "(no headline)"}`);
    if (it.risk_level) L.push(`- Risk: ${it.risk_level}${it.risk_note ? ` — ${it.risk_note}` : ""}`);
    L.push(`- ${it.outlet || "unknown outlet"} · ${it.date || "no date"}`);
    if (it.who) L.push(`- Who: ${it.who}${it.party ? ` (${it.party})` : ""}`);
    if (it.summary) L.push(`${it.summary}`);
    if (it.so_what) L.push(`> So what: ${it.so_what}`);
    if (it.source_url) L.push(`- Source: ${it.source_url}`);
  }
  const g = (gaps || []).filter(Boolean);
  if (g.length) {
    L.push(`\n## Gaps`);
    g.forEach((x) => L.push(`- ${x}`));
  }
  return L.join("\n");
}

export function terrainToMarkdown({ data, electorateData, days, tier }) {
  const L = [];
  L.push(`Window: last ${days} day${days === 1 ? "" : "s"} · ${(data.issues || []).length} issues · tier: ${tier}`);
  if (data.benchmark) L.push(`> Polling benchmark: ${data.benchmark}`);
  for (const i of data.issues || []) {
    L.push(`\n## ${i.issue || "Issue"}`);
    L.push(`- Leader: ${i.leader || "contested"}${typeof i.gap_points === "number" ? ` by ${Math.abs(i.gap_points)} pts` : ""} · Salience: ${i.salience || "?"}${typeof i.salience_score === "number" ? ` (${i.salience_score})` : ""}${i.trend && i.trend !== "unclear" ? ` · Labour ${i.trend}` : ""}`);
    L.push(`- Labour persuasion: ${i.labour_persuasiveness || "?"} · Opposition: ${i.opposition_persuasiveness || "?"}${i.gap_basis ? ` · ${i.gap_basis}` : ""}`);
    if (i.summary) L.push(`${i.summary}`);
    if (i.strategy_guidance) L.push(`> Strategy: ${i.strategy_guidance}`);
    (i.assigned_mps || []).forEach((m) => L.push(`- Assigned: ${m.name}${m.portfolio ? ` (${m.portfolio})` : ""}`));
    (i.source_urls || []).filter(Boolean).forEach((u) => L.push(`- Source: ${u}`));
  }
  const eData = electorateData?.electorates || [];
  if (eData.length) {
    L.push(`\n## Battleground electorates (scan)`);
    for (const e of eData) {
      L.push(`\n### ${e.electorate || e.name || "Seat"}`);
      if (e.status) L.push(`- Status: ${String(e.status).replace(/_/g, " ")}`);
      if (e.held_by) L.push(`- Held by: ${e.held_by}`);
      if (e.labour_candidate?.name || e.labour_candidate) L.push(`- Labour candidate: ${e.labour_candidate?.name || e.labour_candidate}`);
      if (e.opposition_incumbent?.name) L.push(`- Opposition incumbent: ${e.opposition_incumbent.name} (${e.opposition_incumbent.party || "?"})`);
      if (e.notes) L.push(`${e.notes}`);
      if (e.evidence_url) L.push(`- Source: ${e.evidence_url}`);
    }
  }
  const g = [...(data.gaps || []), ...((electorateData?.gaps) || [])].filter(Boolean);
  if (g.length) {
    L.push(`\n## Gaps`);
    g.forEach((x) => L.push(`- ${x}`));
    L.push(`> Null numbers mean nothing was found — never invented.`);
  }
  return L.join("\n");
}

export function interviewToMarkdown({ data, brief, portfolioLabel, interviewerLabel }) {
  const L = [];
  L.push(`Portfolio: ${portfolioLabel} · Interviewer register: ${interviewerLabel}`);
  L.push(`> Anticipated, hypothetical questions for preparation — never real quotes.`);
  for (const iss of data?.issues || []) {
    L.push(`\n## ${iss.issue || "Issue"}`);
    if (iss.why_likely) L.push(`> Why now: ${iss.why_likely}`);
    (iss.questions || []).forEach((q, qi) => L.push(`- Q${qi + 1}: ${q}`));
    if ((iss.facts || []).length) {
      L.push(`\n### Briefing facts`);
      iss.facts.forEach((f) => L.push(`- ${f.fact}${f.source_url ? ` — ${f.source_url}` : ""}`));
    }
    if (iss.source_url) L.push(`- Issue source: ${iss.source_url}`);
    (iss.gaps || []).filter(Boolean).forEach((gp) => L.push(`- ⚠ Gap: ${gp}`));
  }
  if (brief?.issues?.length) {
    L.push(`\n## Interview prep brief`);
    for (const iss of brief.issues) {
      L.push(`\n### ${iss.issue || "Issue"}`);
      (iss.facts || []).forEach((f) => L.push(`- Fact: ${f.fact}${f.source_url ? ` — ${f.source_url}` : ""}`));
      (iss.suggested_angles || []).forEach((a) => L.push(`- Angle (guidance): ${a}`));
      (iss.interviewer_handling || []).forEach((h) => L.push(`- Handling: ${h}`));
      (iss.statement_funnel || []).forEach((s) => L.push(`- Statement funnel: ${s}`));
    }
  }
  const g = [...(data?.gaps || []), ...((brief?.gaps) || [])].filter(Boolean);
  if (g.length) {
    L.push(`\n## Gaps`);
    g.forEach((x) => L.push(`- ${x}`));
  }
  return L.join("\n");
}

/* ---------------- JSON payloads ---------------- */

const basePayload = (kind) => ({
  app: EXPORT_APP,
  version: EXPORT_VERSION,
  kind,
  exportedAt: new Date().toISOString(),
});

/** entry: a folder entry (brief/interview/sweep/portfolio_sweep/warroom). */
export function entryToPayload(entry) {
  const { id, savedAt, ...rest } = entry;
  return {
    ...basePayload(entry.kind || "brief"),
    savedAt: savedAt instanceof Date ? savedAt.toISOString() : savedAt,
    entry: { ...rest, kind: entry.kind || "brief" },
  };
}

export function bundlePayload(entries) {
  return {
    ...basePayload("bundle"),
    entries: entries.map((e) => entryToPayload(e)),
  };
}

/** Validate + normalize an imported object. Returns {ok, kind, entries?, error?}.
    Bundles flatten to their entry list; single files become a one-entry list. */
export function parseImport(obj) {
  if (!obj || typeof obj !== "object") return { ok: false, error: "Not a JSON object" };
  if (obj.app !== EXPORT_APP) return { ok: false, error: "Not a Rapid Response export file" };
  if (typeof obj.version !== "number" || obj.version > EXPORT_VERSION)
    return { ok: false, error: `Unsupported export version (${obj.version})` };

  const KINDS = ["brief", "interview", "sweep", "portfolio_sweep", "warroom"];
  const normalizeOne = (p) => {
    const entry = p.entry;
    if (!entry || typeof entry !== "object") return null;
    const kind = entry.kind || p.kind;
    if (!KINDS.includes(kind)) return null;
    if (kind === "brief" && !(entry.form && entry.results)) return null;
    if (kind === "interview" && !entry.data) return null;
    if ((kind === "sweep" || kind === "portfolio_sweep") && !Array.isArray(entry.data?.items)) return null;
    if (kind === "warroom" && !entry.data?.terrain) return null;
    return {
      ...entry,
      kind,
      savedAt: p.savedAt ? new Date(p.savedAt) : new Date(),
      imported: true,
    };
  };

  if (obj.kind === "bundle") {
    const entries = (obj.entries || []).map(normalizeOne).filter(Boolean);
    if (!entries.length) return { ok: false, error: "Bundle contained no valid entries" };
    return { ok: true, kind: "bundle", entries };
  }
  const one = normalizeOne(obj);
  if (!one) return { ok: false, error: `Unrecognized or corrupt export (kind: ${obj.kind || "?"})` };
  return { ok: true, kind: one.kind, entries: [one] };
}

export function readImportFiles(fileList, onDone) {
  const files = [...fileList].filter((f) => /\.json$/i.test(f.name) || f.type === "application/json");
  if (!files.length) {
    onDone({ entries: [], errors: ["No .json files in the drop — export files are JSON."] });
    return;
  }
  const entries = [];
  const errors = [];
  let pending = files.length;
  for (const f of files) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const res = parseImport(JSON.parse(reader.result));
        if (res.ok) entries.push(...res.entries);
        else errors.push(`${f.name}: ${res.error}`);
      } catch {
        errors.push(`${f.name}: not valid JSON`);
      }
      if (--pending === 0) onDone({ entries, errors });
    };
    reader.onerror = () => {
      errors.push(`${f.name}: could not read file`);
      if (--pending === 0) onDone({ entries, errors });
    };
    reader.readAsText(f);
  }
}
