# Deploy to Cloudflare — free, private, phone-installable

This hosts the app on **Cloudflare Pages** so the three of you can open it from a
URL (and install it to your phone home screen) instead of each running
`npm run dev`. It stays **private** (only your logins get in) and **free** for
your usage — you still pay only the pay-as-you-go Anthropic API bill.

You do the Cloudflare account clicks; the code is already set up for it.

---

## How it works (30-second version)

- **Pages** serves the built app (the same `dist/` that `npm run build` makes).
- **Pages Functions** (`functions/`) are the backend: the `/anthropic` API-key
  proxy, the daily sweep, the URL check, and the policy/line database. They're
  the hosted twin of what the Vite dev server does locally — the shared logic in
  `server/` runs in both places, so nothing drifts.
- **The API key** lives as an encrypted Cloudflare **secret**, never in the code
  or the browser.
- **KV** (a tiny key-value store) holds the shared policy DB, the message-line
  memory, and the sweep's state.
- **The vault** (second brain) is **baked into each deploy** as static files by a
  build step — no database, no live GitHub calls at runtime. When the vault
  changes, a **deploy hook** rebuilds the site so it stays fresh.
- **Cloudflare Access** puts a login wall in front of everything, limited to your
  three emails.

---

## Before you start

- A **Cloudflare account** (free): https://dash.cloudflare.com/sign-up
- The two private GitHub repos already exist:
  - app — `mountroskillcomms-svg/rapid-response-app`
  - vault — `newera2040/labour-second-brain`
- Everything below is in the Cloudflare dashboard unless noted.

---

## Step 1 — Create the Pages project

1. Cloudflare dashboard → **Workers & Pages** → **Create** → **Pages** →
   **Connect to Git**.
2. Authorise GitHub and pick **`rapid-response-app`**.
3. Build settings:
   - **Framework preset:** None
   - **Build command:** `npm run build`
   - **Build output directory:** `dist` (also pinned in `wrangler.toml`, so this
     may auto-fill — leave it as `dist`)
   - **Root directory:** *(leave blank)*

   > The repo's `wrangler.toml` pins the runtime **compatibility date** and the
   > build output dir. You don't need to touch it — it just makes local testing
   > and the deployed runtime behave consistently.
4. Click **Save and Deploy**. The first build will **fail or show an empty
   vault** — that's expected; we haven't added the key/KV/vault-token yet. Keep
   going.

> The build runs `scripts/export-vault-snapshot.mjs` (bakes the vault) then
> `vite build`. Without the vault token (Step 4) it just bakes an *empty* vault
> and the app still builds.

---

## Step 2 — Add the Anthropic API key (secret)

This is **one shared team key** with a spend cap.

1. In the Anthropic console (https://console.anthropic.com) create an API key and,
   under **Plans & Billing → Limits**, set a **monthly spend cap** so a runaway or
   leak can't drain the account.
2. Pages project → **Settings → Variables and secrets** →
   **Add** → type **Secret** (encrypted):
   - Name: `ANTHROPIC_API_KEY`
   - Value: your `sk-ant-…` key
3. Add it to **Production** (and Preview if you want preview deploys to work).

---

## Step 3 — Create the KV namespace (shared policy/line DB + sweep state)

1. **Workers & Pages → KV → Create a namespace**, e.g. `rapid-response`.
2. Pages project → **Settings → Bindings** (or *Functions → KV namespace
   bindings*) → **Add** → **KV namespace**:
   - **Variable name:** `KV`  ← must be exactly `KV`
   - **Namespace:** the one you just made
3. Add it to **Production**.

> Without this binding the app still runs, but "approve policy" / "save line" and
> the sweep's delta memory won't persist. The code degrades gracefully (returns
> empty) until it's bound.

---

## Step 4 — Let the build bake the vault (build variables)

The build needs read access to the private vault repo to snapshot it.

1. Create a **fine-grained Personal Access Token** on GitHub
   (https://github.com/settings/personal-access-tokens/new):
   - **Resource owner:** `newera2040`
   - **Repository access:** Only select repositories → `labour-second-brain`
   - **Permissions:** Repository → **Contents: Read-only**
   - Generate and copy the `github_pat_…` token.
2. Pages project → **Settings → Variables and secrets** → add these as
   **build** (a.k.a. build-time) variables — mark the token as a **Secret**:
   - `VAULT_REPO` = `newera2040/labour-second-brain`
   - `VAULT_REF` = `main`
   - `GITHUB_TOKEN` = *(the PAT — Secret)*
3. Pages project → **Deployments → Retry deployment** (or push a commit) to
   rebuild. The build log should say
   `✓ vault snapshot from tarball … NNN notes`.

> This token is **build-time only** — it's never in the deployed app and makes no
> runtime calls. It only reads the vault so the snapshot can be baked.

---

## Step 5 — Auto-redeploy when the vault changes

So the baked vault stays fresh without you clicking anything.

1. Pages project → **Settings → Builds & deployments → Deploy hooks** →
   **Add deploy hook**: name it `vault-changed`, branch `main`. Copy the URL it
   gives you (looks like `https://api.cloudflare.com/client/v4/pages/webhooks/deploy_hooks/…`).
2. In the **vault repo** (`labour-second-brain`), add a GitHub Actions workflow so
   every push to `main` pings that hook. Create
   `.github/workflows/redeploy-app.yml`:
   ```yaml
   name: Redeploy Rapid Response app
   on:
     push:
       branches: [main]
   jobs:
     ping:
       runs-on: ubuntu-latest
       steps:
         - run: curl -fsS -X POST "${{ secrets.PAGES_DEPLOY_HOOK }}"
   ```
3. In the vault repo → **Settings → Secrets and variables → Actions → New
   repository secret**: name `PAGES_DEPLOY_HOOK`, value = the deploy-hook URL.

Now: edit the vault → push → Pages rebuilds → the app has the new data within a
few minutes. (Freshness is "as of the last deploy," not instant — which is the
design.)

---

## Step 6 — Lock it down with Cloudflare Access (this is what makes it private)

Until you do this, the URL is public and anyone with it could run up API spend.

1. Cloudflare dashboard → **Zero Trust** (set up the free plan if prompted —
   choose the free tier, up to 50 users).
2. **Access → Applications → Add an application → Self-hosted.**
   - **Application domain:** your Pages domain (e.g.
     `rapid-response-app.pages.dev`), or your custom domain from Step 8.
3. **Add a policy:**
   - Name: `team`, Action: **Allow**
   - Include → **Emails** → add the three team emails.
4. Save. Now visiting the site requires a one-time email code (or Google login if
   you add that identity provider) — only your three emails get through.

> Test it in a private/incognito window: you should hit a Cloudflare login before
> the app loads.

---

## Step 7 — Install it on your phone

Open the (now Access-gated) URL on your phone and sign in, then:

- **iPhone (Safari):** Share → **Add to Home Screen**.
- **Android (Chrome):** ⋮ menu → **Install app** / **Add to Home Screen**.

It launches full-screen with the red icon, like a native app.

---

## Step 8 (optional) — Custom domain

Pages project → **Custom domains → Set up a domain** (needs a domain on
Cloudflare). Remember to point the Access application (Step 6) at the custom
domain too.

---

## The free-tier reality (worth knowing)

The **core app is fully free**: the brief pipeline (Anthropic proxy), the vault,
the War Room, and the policy DB all sit comfortably inside Cloudflare's free
limits.

Two features fan out to lots of news sites in one request — the **daily media
sweep** and the **URL-liveness check** — and can bump into the free plan's
per-request limits (50 subrequests, 10 ms CPU). The app is built to handle this:

- If the sweep can't build a full digest, it **falls back to the model's own
  search-driven sweep** (through the proxy) — still works, just spends a few more
  Anthropic tokens.
- The URL check is **additive only** — if it's capped, unchecked links are simply
  read by the model as normal (never wrongly flagged).

If you want those two to run at full efficiency, turning on the **Workers Paid
plan ($5/month)** lifts the limits (1,000 subrequests, 30 s CPU) with **no code
change** — same Functions, they just get to finish. Optional; the app is useful
without it.

---

## Testing the hosted build locally (optional)

You can run the exact Functions locally before deploying:

```bash
cp .dev.vars.example .dev.vars     # put your ANTHROPIC_API_KEY in it
npm run build
npx wrangler pages dev --kv KV
```

That serves `dist/` (from `wrangler.toml`) with the Functions and a **local** KV
namespace bound as `KV`. Exercise a brief, a sweep, and "approve a policy" to
confirm the round-trip. (Verified working: `/urlcheck`, the vault snapshot, and a
full policy KV POST→GET→DELETE round-trip all run in the local Workers runtime.)

---

## Updating / redeploys

- **App code:** push to `main` on `rapid-response-app` → Pages auto-builds and
  deploys.
- **Vault data:** push to `main` on `labour-second-brain` → the deploy hook
  (Step 5) rebuilds the app with the new snapshot.
- **The API key / KV data** persist across deploys — you don't re-enter them.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| Build log: `wrote an empty vault snapshot` | `VAULT_REPO` / `GITHUB_TOKEN` missing or the PAT can't read the vault repo. Re-check Step 4, then retry the deployment. |
| App loads but vault chip is grey / counts are 0 | Same as above — the snapshot baked empty. Check the build log. |
| "Approve policy" / "save line" does nothing when hosted | KV isn't bound as `KV` (Step 3), or it's only on Preview not Production. |
| Red **API billing / key** banner | The `ANTHROPIC_API_KEY` secret is missing, wrong, or out of credits. |
| Sweep says lots of sources "uncovered" | Expected on the free plan (subrequest cap) — it falls back to search. See "free-tier reality". Warms up over subsequent runs; Workers Paid removes it. |
| The URL is reachable without logging in | Access (Step 6) isn't covering this domain. Add/adjust the Access application to the exact Pages/custom domain. |

---

*Free hosting, private by login, fresh vault on every deploy. The only bill is the
pay-as-you-go Anthropic usage the tool needs to do its work.*
