# ZCashed repair handoff

Updated: 2026-11-14

## Current product contract

The current scope is a funded **testnet custodial vault**, backed by an existing operator Zallet wallet. A public task freezes separate rubric criteria, a client funds the reserved Orchard address/reference, and the job opens only after verified full funding. GenLayer judges the pasted public deliverable. The assigned worker can request a shielded claim after successful finalized acceptance.

This replaces the earlier unfunded native-wallet handoff design. Do not restore claims that all payout signing happens in the client's wallet, that payout addresses stay only in the browser, or that the app has no custody authority. The app generates no seeds or accounts, but server RPC credentials can spend from the operator's existing wallet. GenLayer never transfers ZEC and does not cryptographically constrain the operator's Zcash spending.

## Implementation boundaries

- Existing-wallet login verifies a native compact Zcash signed message from a transparent P2PKH key, producing an opaque `user_…` app identity. It does not prove ownership of a shielded payout address.
- Public jobs include offers, deposit address/reference, text, and verdicts. Private claim requests send payout details to the server; `vault_operations` keeps recipient, amount, opaque memo, wallet account, transaction ID, and operation state. These details must not enter public jobs, GenLayer, or public logs.
- MongoDB is required in production and for durable vault operations. Applications/submissions are embedded per job. `assignJob` atomically chooses an applicant; `recordJobReview` records at most three unique successful judgments and supports same-ID recovery without increasing the attempt count.
- The first two nonpassing judgments permit revision; the third nonpassing judgment is terminal. Provider failure records no successful review and never approves work.
- A private permanent claim intent is stored before signing. A confirmed matching wallet payout marks completion. Unknown or unbroadcast outcomes never automatically resend.
- Legacy rows remain read-only under deterministic `legacy_…` pseudonyms. No new wallet session inherits them. Unsafe legacy keys/address properties are excluded from returned records; old Supabase data has not been changed remotely.
- Local file metadata is only for one development/test process; corruption raises errors. It cannot substitute for the private durable vault ledger.

The historical `contracts/escrow.py` name remains a work-acceptance contract. Explicit client refunds for verified funded rejected/cancelled jobs are implemented using the same permanent per-job reservation as worker payouts. States move through refunding to refunded only after matching wallet confirmation. Operator recovery, mainnet deployment, and production custody assurance remain unverified.

## Verification still required

Local tests cover public storage, exact amounts, address decoding, signed-message verification, receipt validation, bounded reviews, failed providers, and durable claim behavior using fixtures/mocks. They do not establish live funds or wallet compatibility.

- Authenticate the intended MongoDB project and authorize a scoped real persistence/index check.
- Configure an existing synchronized, funded beta.4-compatible Zallet testnet account. Observe network, RPC access, Orchard source, backups/unlock responsibility, and fee capacity without exposing credentials.
- Verify native client/worker signed-message login, rather than treating an independent fixture signer as every wallet's compatibility proof.
- Obtain fresh successful finalized Studionet deployment, acceptance, and good/deficient submission receipts. Confirm the validator path re-evaluates criteria independently, rather than checking only leader JSON format.
- Verify a native deposit request and its matching confirmed wallet funding output. A URI or supplied txid is insufficient.
- Request a worker payout, observe durable reservation and broadcast, then verify matching confirmed output and recipient receipt. Report prepared, funded, broadcast, unknown, and confirmed states separately.
- Exercise failed providers and uncertain broadcasts without heuristic approval or duplicate payout. An unresolved transfer requires operator intervention; it cannot be automatically resent as either a payout or a refund. Verify the explicit client refund path separately.

Studionet is real LLM execution in a development consensus environment. It does not establish independently operated production-network consensus or a trustless cross-chain payment guarantee.

## Resume safely

Read [AGENTS.md](AGENTS.md) and the installed Next.js guides before code edits. Configure server-only secrets using [SETUP.md](SETUP.md) and [.env.example](.env.example). Run the repository checks and inspect the complete diff; keep live evidence separate from mocks.

The previous handoff disclosed a development credential. Its value has been removed. An authorized operator must replace the exposed credential and review previous copies/history; do not reproduce it in commands or reports.

See [README.md](README.md) for the current funded flow. Deployment, publishing, credential changes, real wallet funding/payout, and legacy migration require scoped authorization. No remote provisioning, completed transfer, or public release is asserted here.
