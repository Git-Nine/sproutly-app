# Runbook — Self-Hosting n8n

A step-by-step guide to moving Sproutly's two n8n workflows onto your own small server,
and cutting the n8n Cloud subscription. Written to be followed top to bottom in one
sitting (~1 hour, most of it waiting for DNS).

**Why:** the only thing the hosted plan buys you here is the server. Two workflows, a
handful of executions a day, no queue mode, no team seats. A €4–5/month VPS does the same
job. **Model spend is unchanged** — the OpenRouter tokens are identical either way.

**The key safety property:** both AI features already fail gracefully (`/api/classify-vision`
→ blank manual form, `/api/curate-plan` → pure rule-engine plan). So there is **no
user-facing outage** during this migration and **no maintenance window needed**. The flip
side: an outage is *invisible* — nothing errors, the features just quietly stop enriching.
That's why every stage below ends with an explicit check instead of "looks fine".

---

## What changes, and what doesn't

| | Change needed |
|---|---|
| `src/` (app code) | **None.** Both routes read the URL from env (`classify-vision/route.ts:91`, `curate-plan/route.ts:106`). No host is hardcoded anywhere. |
| `docs/n8n/*.workflow.json` | **None.** The webhook paths (`scan-vision`, `plan-curation`) survive the import; only the origin changes. |
| Vercel env | Two URLs — `N8N_CLASSIFY_WEBHOOK_URL`, `N8N_CURATE_WEBHOOK_URL` — **plus a redeploy**. |
| `.env.local` | Same two URLs, for local dev. |
| Credentials | Re-entered by hand. Exports never carry credential *values* (they're encrypted at rest), so this is manual no matter where you migrate from. |
| Model spend | Unchanged. |

---

## Before you start

- [ ] **A VPS.** 2 GB RAM is plenty (Hetzner CX22 ≈ €4–5/mo; any provider works). Ubuntu
      LTS, Docker + Docker Compose installed.
- [ ] **A subdomain you control** — `n8n.sproutly-green.de` is assumed throughout.
- [ ] **The two webhook secrets**, copied out of Vercel (`N8N_CLASSIFY_SECRET`,
      `N8N_CURATE_SECRET`). Keep the same values so only the host changes.
- [ ] **Your OpenRouter API key** (`sk-or-…`).
- [ ] **The two workflow files** from this repo: `docs/n8n/scan-vision.workflow.json`,
      `docs/n8n/plan-curation.workflow.json`.
- [ ] **The old instance still running.** Don't cancel anything until Stage 8.

> ⚠ The webhook must be reachable **from Vercel's servers** over public HTTPS. Docker on
> your laptop can't serve production, tunnel or not — that's local-dev only.

---

## Stage 1 — DNS first (then wait)

Add an **A record**: `n8n` → your VPS IP.

```bash
dig +short n8n.sproutly-green.de    # must print your VPS IP before Stage 2
```

**Do this first and actually wait for it.** Caddy requests a Let's Encrypt certificate the
moment it boots; if DNS isn't resolving yet the request fails and you'll be debugging TLS
instead of n8n. Let's Encrypt also rate-limits repeated failures.

---

## Stage 2 — The server

Three files in `/opt/n8n/` on the VPS.

**`docker-compose.yml`**

```yaml
services:
  caddy:
    image: caddy:2-alpine
    restart: unless-stopped
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy_data:/data
      - caddy_config:/config

  n8n:
    # Pin the tag you install — see hub.docker.com/r/n8nio/n8n/tags — and bump
    # deliberately. `:latest` means an unattended restart can change n8n under you.
    image: docker.n8n.io/n8nio/n8n:1.XX.Y
    restart: unless-stopped
    env_file: .env
    expose:
      - "5678"          # internal only — deliberately NOT published to the host
    volumes:
      - n8n_data:/home/node/.n8n

volumes:
  caddy_data:
  caddy_config:
  n8n_data:
```

**`Caddyfile`** (TLS is automatic — no certbot, no renewal cron)

```
n8n.sproutly-green.de {
    reverse_proxy n8n:5678
}
```

**`.env`**

```bash
N8N_HOST=n8n.sproutly-green.de
N8N_PORT=5678
N8N_PROTOCOL=https

# ⚠ The #1 self-host trip-up. Without these, n8n builds webhook URLs from its
# container hostname and the "Production URL" it shows you is wrong — the app then
# calls an address that doesn't exist, and both features silently stop enriching.
WEBHOOK_URL=https://n8n.sproutly-green.de/
N8N_EDITOR_BASE_URL=https://n8n.sproutly-green.de/

# ⚠ Generate with `openssl rand -hex 32` and BACK IT UP SEPARATELY.
# Lose this key and every stored credential becomes unreadable — you'd re-enter the
# OpenRouter key and both webhook secrets from scratch.
N8N_ENCRYPTION_KEY=<openssl rand -hex 32>

# One reverse proxy in front of n8n; lets it trust X-Forwarded-* for client IPs.
N8N_PROXY_HOPS=1

GENERIC_TIMEZONE=Europe/Berlin
TZ=Europe/Berlin

# Code nodes run in a separate task-runner process (and this silences a deprecation
# warning). Safe here: neither of our Code nodes imports an npm module.
N8N_RUNNERS_ENABLED=true

# Executions accumulate forever by default and will eventually fill a small disk.
EXECUTIONS_DATA_PRUNE=true
EXECUTIONS_DATA_MAX_AGE=168     # hours (7 days) — long enough to debug a bad run

N8N_DIAGNOSTICS_ENABLED=false
```

Then:

```bash
chmod 600 /opt/n8n/.env          # it holds the encryption key
cd /opt/n8n && docker compose up -d
docker compose logs -f n8n       # watch for "Editor is now accessible via..."
```

**Firewall:** allow only 22, 80, 443. Port 5678 is never published — Caddy reaches n8n over
the internal Compose network.

**Check before moving on:** `https://n8n.sproutly-green.de` loads over HTTPS with a valid
certificate.

---

## Stage 3 — Owner account

First visit asks you to create the owner account. Set a strong password and store it in
your password manager.

(There is no `N8N_BASIC_AUTH_*` any more — that was removed in n8n 1.x. The owner account
*is* the access control, which is why this page must not be left unclaimed on a public
host. Do it immediately.)

---

## Stage 4 — Credentials

Create these under **Credentials → New**, all of type **Header Auth**:

| Name | Header name | Header value |
|---|---|---|
| `OpenRouter API (Authorization: Bearer sk-or-...)` | `Authorization` | `Bearer sk-or-…` |
| `Sproutly webhook secret (x-sproutly-secret)` | `x-sproutly-secret` | your `N8N_CLASSIFY_SECRET` |

If `N8N_CURATE_SECRET` differs from `N8N_CLASSIFY_SECRET`, create a second webhook-secret
credential for the curation workflow. If they're the same value, one credential serves both.

---

## Stage 5 — Import the workflows

For each of `docs/n8n/scan-vision.workflow.json` and `docs/n8n/plan-curation.workflow.json`:

1. **Workflows → ⋯ → Import from File.**
2. Attach the credentials — the exports carry `REPLACE_WITH_…` placeholder ids, so each
   node needs its credential picked by hand (Webhook → the secret; the OpenRouter HTTP
   Request node → the OpenRouter credential).
3. Open **Build request** and confirm `MODEL` is a slug that exists on your OpenRouter
   account (<https://openrouter.ai/models> — slugs are `vendor/model` and do change).
4. **Activate** the workflow. The production webhook URL only exists while active.
5. Open the **Webhook** node and read its **Production URL**.

**Check before moving on:** that Production URL must read
`https://n8n.sproutly-green.de/webhook/scan-vision` (resp. `plan-curation`). If the origin
is anything else — a container id, `localhost`, `0.0.0.0` — `WEBHOOK_URL` in `.env` is
wrong or wasn't picked up. Fix it and `docker compose up -d` again before continuing.

Node-level details for both workflows: `docs/n8n-scan-vision-workflow.md`,
`docs/n8n-plan-curation-workflow.md`.

---

## Stage 6 — Prove the new instance works (production still on the old one)

This is the whole reason the migration is low-risk: you can fully validate the new
instance while the live app still points at the old one. Run these from your laptop.

**Scan vision** — a non-garden image is the *correct* smoke test; it exercises webhook auth
→ OpenRouter call → parse → fallback branch end to end:

```bash
curl -sS -X POST https://n8n.sproutly-green.de/webhook/scan-vision \
  -H 'Content-Type: application/json' \
  -H 'x-sproutly-secret: <N8N_CLASSIFY_SECRET>' \
  -d '{"scan_draft_id":null,"photo_url":"https://picsum.photos/640/480","postcode":"10115"}'
```

Expect `{"status":"low_confidence"|"rejected","fields":null,...}`. A *garden* photo would
answer `"status":"ok"` with four fields — but it needs a URL the model provider can fetch
server-side (see the fetch gotcha in the scan-vision doc; Wikimedia blocks it).

**Plan curation:**

```bash
curl -sS -X POST https://n8n.sproutly-green.de/webhook/plan-curation \
  -H 'Content-Type: application/json' \
  -H 'x-sproutly-secret: <N8N_CURATE_SECRET>' \
  -d '{
    "site": {"sun":"full","area_sqm":20,"surface":"soil","space_type":"back_garden",
             "soil":"loam","zone":7,"maintenance_preference":"low"},
    "bounds": {"min_picks":2,"max_picks":3},
    "limits": {"intro_max_chars":600,"why_max_chars":200},
    "plants": [
      {"id":"plant-a","common_name":"Yarrow","latin_name":"Achillea millefolium","native":true,
       "plant_type":"perennial","maintenance_level":"low","soil_compatibility":["loam"],"moisture":"normal"},
      {"id":"plant-b","common_name":"Thyme","latin_name":"Thymus serpyllum","native":true,
       "plant_type":"groundcover","maintenance_level":"low","soil_compatibility":["loam"],"moisture":"dry"},
      {"id":"plant-c","common_name":"Silver birch","latin_name":"Betula pendula","native":true,
       "plant_type":"tree","maintenance_level":"low","soil_compatibility":["loam"],"moisture":"normal"}
    ]
  }'
```

Expect `{"status":"ok","intro":"…","selection":[…]}` with 2–3 picks, all ids from the menu.
`{"status":"no_curation","message":"…"}` means the model answered but the answer was
rejected — the `message` says why, and the n8n execution shows the raw reply.

**Auth check** — repeat either call with a wrong secret:

```bash
curl -s -o /dev/null -w '%{http_code}\n' -X POST \
  https://n8n.sproutly-green.de/webhook/plan-curation \
  -H 'Content-Type: application/json' -H 'x-sproutly-secret: wrong' -d '{}'
```

Expect **403**. A 200 here means the Webhook node lost its Header Auth credential.

**Check before moving on:** both workflows answered, and the **Executions** list shows two
successful runs. If curation answers `no_curation` with "Model answer was not valid JSON",
the reply shape is unexpected — see the parser note in the curation doc.

---

## Stage 7 — Cut over

1. **Vercel → Settings → Environment Variables.** Update both URLs for **Production**
   (and Preview, if set there):
   - `N8N_CLASSIFY_WEBHOOK_URL` = `https://n8n.sproutly-green.de/webhook/scan-vision`
   - `N8N_CURATE_WEBHOOK_URL` = `https://n8n.sproutly-green.de/webhook/plan-curation`
2. **Redeploy.** ⚠ Env vars bind at deploy time — the running deployment keeps the old
   values until you redeploy. Dashboard → latest deployment → **Redeploy**, or `vercel --prod`.
3. **Smoke-test the live app** (not the curls — the real journey):
   - New scan **with a photo** → "Reading your space…" → the review screen comes back
     prefilled. A blank form means the vision path isn't reaching n8n.
   - Generate a plan → the **"Why this plan"** intro card and per-plant "why" lines appear.
     Missing card = curation isn't reaching n8n.
4. **Confirm in n8n Executions:** two fresh successful runs, timestamped just now, on the
   *new* instance. This is the only positive proof — the app looks identical either way.
5. **Update `.env.local`** with the same two URLs for local dev.

---

## Stage 8 — Decommission the old instance

Only after Stage 7's checks pass:

1. **Deactivate** (don't delete) the workflows on the old instance. If something was still
   pointing there, it fails now — loudly, while you're watching.
2. Leave it deactivated for ~a week.
3. Then cancel the subscription and delete.

---

## Rollback

Point the two Vercel env vars back at the old origin and redeploy. That's the whole
rollback — which is why Stage 8 waits a week. If the old instance is already gone, the
features degrade gracefully (manual form, rule-engine plan) until the new one is fixed; no
data is lost and nothing breaks for users.

---

## Keeping it alive

**Back up two things.** The entire state is the `n8n_data` volume (SQLite DB + encrypted
credentials) and the `N8N_ENCRYPTION_KEY`. They're useless apart — store the key in your
password manager, not only in `.env` on the same box.

```bash
docker compose stop n8n
docker run --rm -v n8n_n8n_data:/data -v /opt/backups:/backup alpine \
  tar czf /backup/n8n-$(date +%F).tar.gz -C /data .
docker compose start n8n
```

Weekly cron is plenty at this scale. (Volume name is `<compose-project>_n8n_data` — check
with `docker volume ls`.)

**Monitoring — don't skip this.** Nothing alerts you when n8n dies, because the app
absorbs the failure silently: no error, no Vercel log, just plans without rationale and
scans without prefill. Point a free uptime monitor at:

```
https://n8n.sproutly-green.de/healthz
```

**Updates.** Bump the pinned tag deliberately, then re-run Stage 6's two curls — they're
your regression test. `scripts/n8n-workflows.test.ts` covers the Code nodes in CI, but only
a live call proves the credentials, TLS and webhook routing.

**Disk.** `EXECUTIONS_DATA_PRUNE` handles execution history. Watch `docker system df`
occasionally; `docker image prune` after version bumps.

---

## Cost, once this is done

| Item | Cost |
|---|---|
| VPS (e.g. Hetzner CX22) | ~€4–5/mo *(check current pricing)* |
| Subdomain of `sproutly-green.de` | €0 |
| TLS (Let's Encrypt via Caddy) | €0 |
| OpenRouter tokens | unchanged — same model, same prompts |
| n8n community edition | €0 (self-hosting for your own use is permitted under its sustainable-use licence) |

---

## A note on what's verified here

The commands and env vars above are written from n8n's documented self-host behaviour and
this repo's actual wiring — the file paths, route constants, webhook paths, header names
and response contracts were all read from the code. **The Compose stack itself has not been
run against a live VPS from this repo.** Stage 6's curls are what prove your instance is
right; treat any mismatch there as the config being wrong, not the check.
