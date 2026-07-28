# Rapid Response — NZ Labour campaign research tool

Local research-brief builder for the Mt Roskill Rapid Response Team. It runs as a
Vite dev server on your own machine; Anthropic API calls are proxied server-side so
the API key never reaches the browser.

> **Guidance, not copy.** The tool outputs briefs, angles, and scaffolds — never
> finished statements. A human writes every published word.

## Prerequisites

- **Node.js 20.19+ or 22+** (LTS recommended). Check with `node -v`.
  Install from <https://nodejs.org> (Windows: the LTS `.msi`), or via winget:
  `winget install OpenJS.NodeJS.LTS`
- **An Anthropic API key.** Get your own at <https://console.anthropic.com> →
  *API Keys*. The key that runs the app pays for its usage, so use your own key
  rather than someone else's.

## Setup (first time)

From the project folder, in a terminal:

```bash
npm install            # installs dependencies (one-time, ~1 min)
```

Then create a file named `.env` in the project root (copy `.env.example`) and put
your key in it:

```
ANTHROPIC_API_KEY=sk-ant-...your-key...
```

> `.env` is gitignored and must never be shared or committed — it is your secret key.

## Run

```bash
npm run dev
```

Open the URL it prints — **http://127.0.0.1:5173**. The server is loopback-only
(not exposed to your network). Stop it with `Ctrl+C`. Re-running is just
`npm run dev` again; you only `npm install` once.

If you change `.env`, restart `npm run dev` — the key is read at startup.

## Notes

- **Costs money.** Every sweep/brief calls the Anthropic API on your key. Use the
  **UI test** / **fast** tiers (top bar) for cheap trial runs; **deep** costs the most.
- **Your work is saved in the browser.** The Folder persists to this browser's
  local storage and survives refreshes/restarts. Use **Export all** for a backup or
  to move work to another machine (drag the exported `.json` back in to restore).
- **Knowledge base** lives in `public/knowledge/` and ships with the app — verified
  electorate/candidate data, tone docs, and narratives that ground the briefs.

## Troubleshooting

- **Blank page / API errors:** check `.env` exists, the key is valid, and you
  restarted `npm run dev` after creating it.
- **`node` not found:** install Node.js (above) and open a fresh terminal.
- **Port 5173 in use:** stop the other process, or Vite will offer another port.
