# ZCashed — Agent Handoff / Resume Doc

> Living handoff for the next agent. Read this top-to-bottom before touching the GenLayer
> integration. The web app is **done and deployed**; the **real on-chain GenLayer contract is NOT
> working yet** and is the main remaining task. Be honest about this in any status you give the user.

Last updated: 2026-11-13

---

## 1. What this project is

**ZCashed** — an AI-judged, privacy-preserving freelance marketplace.
- **GenLayer** Intelligent Contract acts as the AI arbitrator that decides if submitted work meets the brief.
- **Zcash** (testnet, shielded t-addresses) is the private payment/escrow layer.
- Two hiring modes: **direct assignment** and **application-based** (freelancers apply, client picks).
- Roles: **freelancer / client / admin**. Notifications across the job lifecycle.

Stack: Next.js 16 (App Router), Supabase (Postgres) with a local file-DB fallback, `genlayer-js` + GenLayer CLI, Zcash key/address generation via `@noble/*` + `bs58check`.

---

## 2. Current status

### ✅ DONE and working
- Full Next.js app: landing (yellow/white theme, animated canvas globe, scroll reveals), onboarding, job explorer, job detail, dashboard, profile, admin, notifications.
- Backend API routes: jobs CRUD, apply, assign, accept, submit, notifications, profile, admin.
- **Supabase** provisioned via Vercel Marketplace; tables created from `supabase/schema.sql`. Data layer auto-switches Supabase ⇄ file-DB (`lib/store.ts` → `hasSupabase()`).
- End-to-end lifecycle verified on Supabase (post → apply → assign → submit → notifications).
- **Pushed** to GitHub `TS-mfon/zcashed` (private). **Deployed** to Vercel production.
- Production build passes (`npm run build`).

### ❌ NOT done / broken (MAIN REMAINING WORK)
1. **Real GenLayer contract deployment does not work yet.** The contract currently FINALIZES with
   `result: { status: 'contract_error', payload: 'invalid_contract' }`. See §4.
2. Because of (1), **work judging currently uses a FALLBACK heuristic, not real AI.**
   - `app/api/submit/route.ts` has `localEvaluate()` which approves if the submission has a URL + some text. This is NOT the GenLayer AI. It must be removed once the contract works (task 11).
   - `app/api/jobs/route.ts` deploys the contract in the background and stored `genlayerContractAddress` as **`undefined`** (the old `receipt.contractAddress` bug). The correct field is `receipt.data.contract_address` (see §3).
3. Deploy is best-effort/async; should be made **synchronous + required** so every real job has a real contract (no fake jobs). (task 11)
4. **Demo/test rows** exist in Supabase from testing (e.g. “Supa Client”, “Acme Co”). Must be cleared so all data is real. (task 12)
5. Vercel **Deployment Protection** is ON (login wall). GitHub repo is **private**. User may want these flipped to public — ASK, don't assume (auto-mode blocked public repo creation once already).

---

## 3. GenLayer facts learned (don't re-derive these)

- **Networks:** `localnet` (local sim via `genlayer up`), `studionet` (hosted Studio at `https://studio.genlayer.com/api`, **gasless**), `testnet-asimov`, `testnet-bradbury`.
- **RPC endpoints (verified):**
  - Bradbury `https://rpc-bradbury.genlayer.com` → **works** (`eth_chainId` = `0x107d` / 4221).
  - `https://rpc.testnet-chain.genlayer.com` → also works (Bradbury).
  - Asimov `https://rpc-asimov.genlayer.com` → **returns HTML, dead** from the SDK right now.
- **Studionet is gasless** (0 GEN is fine). **Testnet needs GEN** from the faucet:
  `https://testnet-faucet.genlayer.foundation/` (100 GEN / 7 days). Fund the deployer address
  `0x7BF2b9901f1e525112CE9A4ba47a9e917FE7f4FB` if you go the testnet route.
- **Contract address after deploy:** read from `receipt.data.contract_address` (NOT `receipt.contractAddress`). Confirmed by genlayerlabs issue #104 / PR #110.
- **Transaction status enum** (number → name): 0 UNINITIALIZED,1 PENDING,2 PROPOSING,3 COMMITTING,4 REVEALING,**5 ACCEPTED**,6 UNDETERMINED,**7 FINALIZED**,8 CANCELED,… ACCEPTED and FINALIZED are decided states.
- **On studionet, reads (`get_state` / gen_call) only work after FINALIZED**, and only if the contract is valid. Before finalization you get “Contract not found”.
- **Runner header is mandatory and version-sensitive.** The official `write-contract` skill says all
  networks **reject** `py-genlayer:test` / `py-genlayer:latest` / unversioned, and require a pinned
  hash. The official boilerplate uses:
  `# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }`
  **BUT** the user believes the header/runner is the cause of our `invalid_contract` error, and the
  hosted Studio historically accepted the `test` alias. **This contradiction is unresolved — see §4.**
- Contract API (verified against official skill + boilerplate):
  `from genlayer import *`; `class X(gl.Contract):`; storage = class-level annotations
  (`str`, `u256`, `TreeMap[K,V]`, `DynArray[T]`, `Address`); `@gl.public.view` / `@gl.public.write`;
  LLM via `gl.nondet.exec_prompt(prompt, response_format="json")`; consensus via
  `gl.eq_principle.strict_eq(fn)` / `gl.eq_principle.prompt_comparative(fn, principle=...)` /
  custom `gl.vm.run_nondet_unsafe(leader_fn, validator_fn)`; errors via `gl.vm.UserError`.

### Tooling installed
- **GenLayer CLI** `genlayer` v0.39.2 (`npm i -g genlayer`). Bundles its own SDK.
- App uses `genlayer-js` **1.1.8** (newer exist: 1.2.0, 2.0.0-rc.x). `genlayer-js` 1.1.8 could deploy
  to studio (got an address) but subsequent calls hit `contract_not_found`; the CLI deploy reached
  ACCEPTED but FINALIZED to `invalid_contract`. A version mismatch is plausible — **try upgrading
  `genlayer-js` to 1.2.0** in the app.
- CLI account imported as **`zcashed`** (keystore `~/.genlayer/keystores/zcashed.json`), password
  `zcashed-dev-pass`, already unlocked into the OS keychain. Address = the GenLayer deployer above.
- `genvm-lint` is referenced by the skill but **not installed**. Find it (likely via the GenLayer
  toolchain / `genlayer` extras) and run `genvm-lint check contracts/escrow.py`.

---

## 4. THE BLOCKER: `invalid_contract`

Deploying `contracts/escrow.py` to studionet via the CLI returns ACCEPTED (“deployed successfully”),
but the **FINALIZED** receipt shows:

```
status: 7 (FINALIZED)
result: { status: 'contract_error', payload: 'invalid_contract' }
```

So the GenVM **rejects the contract itself**. Reads then fail with “Contract not found” because no
valid contract was instantiated. This is NOT a networking/sequencing issue — it is the contract
module failing to load/validate.

### Prime suspects (investigate in this order)
1. **Runner header mismatch (user's hypothesis, most likely).**
   - Current header: `# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }`.
   - Try the Studio alias `# { "Depends": "py-genlayer:test" }` **on studionet specifically** and
     re-deploy; check the FINALIZED receipt result, not just ACCEPTED.
   - Confirm the pinned hash is the one the **current** hosted Studio actually serves — it may be
     stale. Get the correct current hash from `genlayer new` scaffold output or Studio docs.
2. **Scaffold the canonical template and diff.** Run `genlayer new zcashed-contract` to get a known-good
   contract + `gltest` config for THIS CLI version, deploy its default contract to studionet, confirm
   it finalizes cleanly, then port our escrow logic into that exact template (same header, same imports).
3. **Contract API details** that can cause `invalid_contract`:
   - `get_state` returns a plain `dict` — may need an explicit return type or a `TreeMap`/typed return.
   - `u256(0)` init / `self.submission_count += u256(1)` usage.
   - `gl.vm.UserError` vs `gl.UserError` (skill shows both in different places — verify which the
     pinned runner exports).
   - `gl.eq_principle.prompt_comparative` signature on this runner.
4. **Verify locally first.** `genlayer init && genlayer up` starts localnet with validators+LLM. Deploy
   there (the official boilerplate deploys to localnet) and get the full GenVM stderr via
   `genlayer trace <txId>` — that will show the exact Python/validation error behind `invalid_contract`.
   `genlayer trace` / `genlayer receipt <txId>` are your best debugging tools.

### Repro commands
```bash
genlayer network set studionet
genlayer account unlock --account zcashed --password zcashed-dev-pass
genlayer deploy --contract contracts/escrow.py \
  --args "Title" "Requirements text" "zec_0_1" "tmClientAddr" "tmEscrowAddr"
# note the returned Contract Address + Transaction Hash, then:
genlayer receipt <txHash>       # look at result.status / payload
genlayer trace <txHash>         # full GenVM stdout/stderr — shows WHY invalid_contract
genlayer call <addr> get_state  # only works once FINALIZED & valid
```
Note: the CLI `--args` auto-casts numeric-looking values to BigInt and **crashes on decimals** (e.g.
`0.1`). Pass budgets as non-numeric strings in CLI tests (the app passes them as strings via the SDK).

Helper scripts already written (SDK path, studionet): `scripts/deploy-test.mjs`, `scripts/probe-receipt.mjs`
(reads `GENLAYER_PRIVATE_KEY` from `.env.local`). `LEADER_ONLY=1` env toggles leaderOnly.

---

## 5. Remaining task list (in order)

1. **Fix `invalid_contract`** so `contracts/escrow.py` deploys + finalizes cleanly on studionet (§4).
   Verify `get_state` reads back and `submit_work` returns a real AI verdict (`approved` / `needs_revision` + reason).
2. **Wire real GenLayer into the app** (`lib/genlayer.ts`):
   - Read contract address from `receipt.data.contract_address`.
   - Wait for FINALIZED before reads; reads via `get_state`.
   - Make deploy in `POST /api/jobs` **synchronous + required** (fail job creation if deploy fails).
   - In `app/api/submit/route.ts` **remove `localEvaluate` fallback** — real AI only.
   - Decide how the app gets the verdict: either read `get_state` after the `submit_work` tx finalizes,
     or parse the write receipt return. (Reads need FINALIZED → add polling with a “judging…” UI state,
     which the job detail page already has as `subState === 'evaluating'`.)
3. **Clear demo/test data** from Supabase (truncate `profiles/jobs/applications/submissions/notifications`,
   or delete the obvious test rows). Connection: `POSTGRES_URL_NON_POOLING` in `.env.local` (psql available).
4. **Rebuild, redeploy, check logs** (`vercel logs <deployment>` / Vercel dashboard). Confirm a real
   job posted in prod deploys a real contract and gets a real AI verdict.
5. Ask the user whether to make the **Vercel deployment** and/or **GitHub repo** public.

---

## 6. Keys, URLs, accounts (testnet only — safe to lose)

- **Zcash testnet treasury / faucet address:** `tmJR8w1xsHcqTWCwm6C5VDrYsJkpVPYES9H`
  - Claim test ZEC: `https://zcash-faucet.vercel.app/` (user-provided), or `https://faucet.zecpages.com/`, `https://faucet.zcashfoundation.dev/`.
- **GenLayer deployer:** `0x7BF2b9901f1e525112CE9A4ba47a9e917FE7f4FB` (private key in `.env.local` + CLI keystore pass `zcashed-dev-pass`).
  - GenLayer testnet faucet (if using Bradbury): `https://testnet-faucet.genlayer.foundation/`.
- Secrets live in **`.env.local`** (gitignored). `vercel env pull` OVERWRITES it and drops non-Vercel
  vars — re-append the Zcash/GenLayer wallet vars after any pull.
- **GitHub:** `github.com/TS-mfon/zcashed` (private). `gh auth switch --user TS-mfon` before pushing.
- **Vercel:** project `chucks1093s-projects/zcashed`; prod `https://zcashed-rcunpnvjx-chucks1093s-projects.vercel.app` (Deployment Protection ON).
- **Supabase:** project `iealcshqrofsvrdotbll`; env vars already set in Vercel (Production/Preview/Development).

---

## 7. Key files

- `contracts/escrow.py` — the Intelligent Contract (currently `invalid_contract`; the thing to fix).
- `lib/genlayer.ts` — SDK deploy/write/read wrappers (needs the `receipt.data.contract_address` fix + FINALIZED reads).
- `lib/store.ts` / `lib/filedb.ts` / `lib/supabase.ts` — data layer (Supabase ⇄ file fallback).
- `app/api/submit/route.ts` — judging flow (remove `localEvaluate`).
- `app/api/jobs/route.ts` — job creation + (currently broken) contract deploy.
- `supabase/schema.sql` — DB schema.
- `scripts/deploy-test.mjs`, `scripts/probe-receipt.mjs` — GenLayer verification harnesses.
- Official reference downloaded to `.genlayer-skills/write-contract.md` (authoritative contract-writing rules).

---

## 8. Honesty note for whoever resumes

Do **not** claim the AI judging works until you have:
1. Deployed `escrow.py` and seen the FINALIZED receipt result be success (not `contract_error`).
2. Read `get_state` back from the live contract.
3. Called `submit_work` with a real submission and gotten a real `approved` / `needs_revision` verdict
   from the validators (check `genlayer trace`).
Until then, the app's judging is the placeholder `localEvaluate` heuristic.
