# Setup guide — Rapid Response app

This runs **on your own computer**, not on a website. There's no server to pay
for, nothing is exposed to the internet, and it only listens on your own machine
(`127.0.0.1`) — so it's private by default. Each person on the team follows this
guide once, then just runs it whenever they need it.

You need to be comfortable running a couple of commands in a terminal. If you get
stuck, ping Ethan.

---

## What it costs

- **Hosting: $0.** It runs locally on your machine.
- **The AI itself is pay-as-you-go.** Every brief/sweep/War-Room run makes calls
  to Anthropic's API, which bills your account per use (roughly a few cents to
  ~$0.80 per brief depending on the tier — the app shows a `≈$` estimate on the
  Build button before you run, and the exact spend afterwards). There is no free
  way around this — it's the actual work the tool does. Use the **UI test** and
  **fast** tiers for anything low-stakes to keep it cheap.

---

## One-time setup

### 1. Install the prerequisites

- **Node.js 20 or newer** — https://nodejs.org (the "LTS" download). This also
  installs `npm`.
- **Git** — https://git-scm.com/downloads
- Check both worked, in a terminal:
  ```bash
  node --version
  git --version
  ```

### 2. Get access to the two repositories

Ask Ethan to add you as a collaborator on **both** private GitHub repos, and
accept the email invites:

- **the app** — `rapid-response-app` (this program)
- **the second brain** — `newera2040/labour-second-brain` (the shared political
  data the app reads: polls, electorates, policy, issues)

The app still runs without the second brain, but you lose the vault features
(target board, grounding, explorer, etc.), so get access to both.

### 3. Clone both, side by side

Put them in the **same parent folder** — the app looks for the vault as a
sibling folder next to it:

```bash
cd ~/code                 # or wherever you keep projects
git clone <rapid-response-app repo URL>
git clone git@github.com:newera2040/labour-second-brain.git
```

You should end up with:

```
code/
├── rapid-response-app/
└── labour-second-brain/
```

> If you keep the vault somewhere else, set `LABOUR_VAULT` in your `.env`
> (step 5) to its full path instead.

### 4. Install the app's dependencies

```bash
cd rapid-response-app
npm install
```

### 5. Add your Anthropic API key

```bash
cp .env.example .env
```

Open the new `.env` file and replace the placeholder with a real key (see
**"The API key"** below for how to get one):

```
ANTHROPIC_API_KEY=sk-ant-...your key...
```

`.env` is gitignored — it stays on your machine and is never committed or shared.
The key is used **server-side only** (the app proxies API calls), so it never
reaches the browser.

### 6. Run it

```bash
npm run dev
```

Then open **http://127.0.0.1:5173** in your browser. That's it — leave the
terminal running while you use it; press `Ctrl+C` to stop.

---

## The API key — how each person sets it up

Each person needs an Anthropic API key in their own `.env`. There are two ways to
do it; pick one as a team:

**Option A — everyone uses their own key (recommended).**
Each person creates their own account at https://console.anthropic.com, adds a
small amount of credit (Plans & Billing → buy credits), and creates a key under
**API Keys**. Then paste it into their `.env`.
- ✅ Each person's usage is billed to *their* account — no one foots the whole bill.
- ✅ No shared secret; if one key leaks, only that person's is affected.
- ➖ Three accounts to set up.

**Option B — one shared key for the team.**
One person creates a single key (with credits on that account) and shares it with
the other two through a secure channel (a password manager, not email/Slack).
Everyone pastes the **same** key into their own `.env`.
- ✅ One setup, one bill, simplest.
- ➖ The key sits on all three machines — rotate it (make a new one, delete the
  old) if anyone leaves the team.

Either way the key lives only in each person's local `.env` and is only ever sent
from their machine to Anthropic. It is never in the app's code and never pushed
to GitHub.

> The app also shows a running **token/cost meter** and a per-run cost estimate,
> and it warns loudly (a red banner) if a key is out of credits or rejected.

---

## Getting updated versions

The app is a git repository, so updates come the same way the code was shared:
**`git pull`.** When Ethan improves the app and pushes the change, each person
updates like this:

```bash
cd rapid-response-app
git pull            # get the new code
npm install         # only strictly needed if dependencies changed — safe to run every time
```

Then **restart** the app (`Ctrl+C` in the terminal, then `npm run dev` again).

Your `.env` (API key) and your local sweep cache are gitignored, so pulling
updates never touches or overwrites them.

**Keep the second brain fresh too** — it's a separate repo that's updated
independently (new polls, issues, electorate data). Pull it whenever you want the
latest data:

```bash
cd ../labour-second-brain
git pull
```

(The app re-reads the vault automatically — no restart needed for vault updates,
just reload the browser tab.)

> **Tip:** a quick "update everything" habit — from the `rapid-response-app`
> folder: `git pull && npm install && git -C ../labour-second-brain pull`, then
> restart the app.

---

## Everyday use

- Start it: `cd rapid-response-app` → `npm run dev` → open http://127.0.0.1:5173
- Stop it: `Ctrl+C` in the terminal
- Your saved briefs/sweeps live in the in-app **Folder** (stored in your browser,
  survives restarts). Use **Export** to back them up or move them to another
  machine.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| `npm run dev` says port 5173 is in use | You already have it running in another terminal, or another app grabbed the port. Close the other one, or stop it and re-run. |
| Red **"API billing / key"** banner | Your Anthropic key is out of credits or wrong. Top up at console.anthropic.com, or fix the key in `.env`, then restart. |
| `2B —` grey chip (second brain not found) | The vault isn't a sibling folder. Clone `labour-second-brain` next to the app, or set `LABOUR_VAULT` in `.env`, then restart. |
| Styles look broken / plain | Make sure `npm install` completed without errors, then hard-refresh the browser (Ctrl+Shift+R). |
| It worked before, broke after a `git pull` | A dependency changed — run `npm install` and restart. |
| Anything else | Send Ethan the terminal output and a screenshot. |

---

*Runs locally, stays private, updates with `git pull`. No servers, no hosting
bills — just the pay-as-you-go API usage the tool needs to do its work.*
