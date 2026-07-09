# PROJ-11 — Curator Runbook: First Plant Catalogue Import

A plain-language guide to running the plant catalogue import for the first time.
No coding needed — you run two commands and review a file in between.

**The whole idea:** the import *suggests* plants with AI-guessed traits into a review
file. Nothing reaches a real user's plan until **you** read it and approve it. The two
commands are deliberately separate so a human always sits in the middle.

There are three stages: **Stage** (machine suggests) → **Review** (you approve) →
**Commit** (approved plants go live).

---

## Before you start (one-time setup)

- [x] **Database migration applied** — done (the new columns exist on the `plants` table).
- [ ] **Anthropic API key** — you need an `ANTHROPIC_API_KEY` in your local `.env.local`
      file. This is the key that lets the AI infer plant traits. It stays on your
      machine only; it never ships to the website. The file already needs
      `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` (same ones the plant
      seed uses) — check those are present too.
- [ ] **You're on your own machine, not production** — these commands write directly to
      the live catalogue with admin rights. That's expected and safe (the commit only
      ever *adds* new plants, never overwrites existing ones), but run them deliberately.

> If a key is missing, the command stops immediately and tells you exactly which one.
> It won't half-run.

---

## Stage 0 — Smoke-test first (do this once, ~5 minutes)

The AI step has never run against a live key before, so prove it works on a tiny batch
before committing to the full run.

1. Run the stage command (see Stage 1 below) but **watch the first 3–5 species scroll by**.
2. You're checking one thing: does each species reach `— staged` (or a clear
   `excluded` / `no GBIF match` reason), rather than a wall of
   `AI inference failed` messages?
   - **All staging fine** → the AI call works. Let it finish, move on.
   - **Everything says "AI inference failed"** → stop. The most likely cause is the
     Anthropic request being rejected. Note the error message shown in brackets and
     flag it (this is the known "BUG-2" open item — the request shape needs a small
     tweak). Don't proceed to commit.

You don't need a separate command for this — just run the real stage command and read
the first several lines. If it looks healthy, let it complete.

---

## Stage 1 — Import & stage (the machine suggests plants)

**Command:**
```bash
npm run import:plants
```

**What it does, in order:**
1. Reads which plants are already in the catalogue (so it won't suggest duplicates).
2. Goes through a curated list of ~100 German garden species.
3. For each: looks it up in the open plant databases (GBIF for identity + whether it's
   native, Wikidata for the German common name), then asks the AI to fill in the
   gardening traits no database carries — sun, soil, water needs, mature size,
   maintenance, hardiness zone, care notes.
4. Checks every value against the app's allowed vocabulary and throws out anything
   nonsensical.
5. Writes everything to a review file.

**How long:** a few minutes — it makes one AI call per species, one at a time.

**What you'll see at the end** — a summary like:
```
─── Import summary ───
Candidates:            ~100
Staged:                NN  (natives first)
  needing review:      NN
  already in catalogue:NN  (marked existing/conflict)
Excluded by filter:    NN
...
Staging file written: plant-import.staging.yaml
```

**The output file:** `plant-import.staging.yaml` in the project root. This is your
working document for the next stage.

**If it fails:** it stops loudly and writes **no** file (or leaves the previous one
untouched). A network hiccup reaching GBIF will abort the whole run — just run it again.
It's safe to re-run any number of times.

---

## Stage 2 — Review (you decide what's trustworthy)

Open `plant-import.staging.yaml` in any text editor. The top of the file has the same
instructions repeated inline. Here's what to do:

**For each plant, check the four survival-critical traits** — these decide whether a
recommended plant actually lives:
- `sun_tolerance` — full / partial / shade
- `soil_compatibility`
- `moisture` — dry / moist / wet
- `min_hardiness_zone`

Each row has a `confidence` block telling you how sure the AI was about each of these.
**Low confidence is your cue to double-check that value** (a garden reference, or the
FloraWeb / POWO websites, are good cross-checks — you consult them, you don't copy data
in bulk).

**Four things to know as you go:**

1. **Correcting a value:** just edit it in the file. When you fix a survival-critical
   field, also remove that field's name from the row's `ai_origin_fields` list — that's
   how the catalogue records "a human verified this, it's no longer an AI guess."

2. **Rows marked `review_required: true`** had a low-confidence critical field. They are
   **blocked from committing** until you fix the value *and* change the line to
   `review_required: false`. This is the safety gate — don't switch it off without
   actually checking.

3. **Rows marked `status: existing`** are already in the live catalogue. The commit will
   skip them no matter what (it never overwrites), so you can leave them or delete them
   from the file.

4. **`native` status needs your attention too** — not just the AI traits. The native
   flag comes from GBIF data that mixes many sources of varying quality, so treat it as
   something to verify, not a settled fact. Budget review time for it.

**To approve a plant, set `approved: true` on its row.** Only approved rows get
committed. Leave everything you're unsure about as-is (unapproved) — you can approve it
in a later run.

> **Target for this first run: ~50–80 approved plants.** That roughly doubles the
> catalogue and proves the whole loop without an exhausting review session. You don't
> have to approve everything — approve what you're confident in, commit, and come back
> for the rest another day.

---

## Stage 3 — Commit (approved plants go live)

**Command:**
```bash
npm run import:plants:commit
```

**What it does:**
1. Reads your review file and takes **only** the rows you marked `approved: true`.
2. Re-checks every field one more time (so a typo you introduced while editing gets
   caught, not committed).
3. Adds the new plants to the live catalogue. If a plant somehow already exists, it's
   skipped — never overwritten.
4. Records where each plant came from and which traits are still AI-guessed.
5. Prints a report.

**What you'll see:**
```
─── Commit report ───
Staged rows read:        NN
Inserted (new):          NN
Skipped — unapproved:    NN
Skipped — needs review:  NN     ← these still have review_required: true
Skipped — already exists:NN
Rejected — bad shape:    NN     ← a hand-edit broke the format; the row is listed
Rejected — validation:   NN     ← a value isn't in the allowed vocabulary; listed

Done. NN new verified plant(s) committed to the catalogue.
```

**Read the report.** If a plant you meant to add shows up under "needs review",
"rejected", or "bad shape", it did **not** go in — fix it in the file and run commit
again. Committing is safe to repeat: already-added plants are simply skipped, so you
never get duplicates.

---

## After the commit

1. **Check `/admin/plants`** in the app — your new plants should be listed. Later
   corrections happen here, in the normal admin screen.
2. **Generate a plan or two** (the normal Scan → Plan flow) — with a bigger catalogue,
   plans should show more variety across the four planting layers. That confirms the
   whole point of the expansion worked.
3. **You're not locked in.** Anything you got wrong can be fixed in `/admin/plants`, and
   re-running the import will never clobber those fixes.

---

## Quick reference

| Step | Command | You produce / check |
|------|---------|---------------------|
| Stage | `npm run import:plants` | writes `plant-import.staging.yaml` |
| Review | *(edit the file)* | set `approved: true`, fix critical traits, clear `review_required` |
| Commit | `npm run import:plants:commit` | new plants land in the live catalogue |

**Safety guarantees baked in:** re-run anything freely (no duplicates, no overwrites);
nothing reaches users until you approve it; a bad edit skips its own row, never the
whole batch; a missing key or unreachable source stops cleanly without writing garbage.

**Optional overrides (env vars):** `STAGING_FILE` to use a different file path,
`ANTHROPIC_MODEL` to change the AI model (defaults to the configured one).
