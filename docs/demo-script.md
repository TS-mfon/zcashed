# ZCashed demo script

This demonstrates a funded custodial testnet vault and independently re-evaluated public work. Label the environment **GenLayer Studionet/Studio development**, and distinguish live wallet evidence from local fixtures. Never show private keys, recovery phrases, RPC credentials, or database credentials.

## Prepare and fund

Configure the existing operator Zallet testnet account and MongoDB using [SETUP.md](../SETUP.md). Use two browser sessions and existing client/worker wallets. Login signs the exact server challenge with a transparent P2PKH key; it does not prove ownership of an Orchard payout address. Do not generate a wallet in the app.

Create a Writing task with a small public testnet budget and these separate rubric lines:

```text
Write a 70–120 word release note for the fictional project Nightjar 1.2.
State that CSV export is now available.
State that saved filters persist across sessions.
State that existing projects need no migration.
Include one clear next step: open Settings → Export to try CSV export.
Do not claim other features or promise guaranteed results.
```

Show the successful finalized GenLayer deployment receipt and readable contract state. A hash, address, or ACCEPTED status alone is insufficient.

The job starts as **Funding needed**. Open its exact amount, Orchard testnet address, and opaque deposit-reference memo in the client’s native wallet. A URI/QR prepares a request only. If the user/operator intends to fund the testnet demo, send it and wait for the server wallet to verify a matching shielded output with at least one confirmation. Only then does the job open for work.

Explain custody: the deposit belongs to an existing operator wallet. Authenticated server RPC has spending authority; GenLayer does not hold ZEC or enforce a trustless Zcash escrow. Public offers and deposit requests remain public.

## Good work

The worker accepts the funded task and pastes:

> Nightjar 1.2 is here with a practical update for everyday reporting. CSV export is now available, making it easier to move your project data into a spreadsheet for your own analysis. Saved filters now persist across sessions, so the view you set up is there when you return. Existing projects need no migration; you can continue using them with the update. To try the new export, open Settings → Export and choose CSV. Review the exported file before sharing it, and tell the team if something does not look right.

Show the actual successful finalized submission receipt and matching criterion decisions. Validators re-evaluate the deliverable independently; schema validation alone would be insufficient. Studio is a development consensus environment, not independent production-network consensus.

If the real provider returns an unexpected verdict, show the observed result. Do not substitute a fixture success for a failed live evaluation.

## Deficient work and bounded revisions

Use another funded task, or submit this before revising the same task:

> Nightjar 1.2 is here with a practical update for everyday reporting. CSV export is now available, making it easier to move your project data into a spreadsheet for your own analysis. Open Settings → Export and choose CSV to try it. Review the exported file before sharing it and tell the team if something does not look right. This release is focused on making a common reporting task easier to find and use in your normal project workflow.

It omits saved-filter persistence and the no-migration statement. Read the missed-criterion feedback and show **attempt 1 of 3**. The first two nonpassing reviews permit revision; the third nonpassing review closes the job as rejected. Replaying the same finalized transaction does not consume another attempt. URLs are references; only the pasted deliverable is evaluated.

## Provider failure

Use a controlled local provider-failure fixture and label it **local failure demonstration**. Do not change a shared provider. Show the error and unchanged successful-review count. There must be no heuristic approval, fabricated receipt, consumed review attempt, or unlocked worker claim.

## Claim and receipt

For accepted work with verified full funding, the assigned worker enters an Orchard-only testnet address and explicitly requests the claim. That address goes privately to the server and operator database; it is not sent to public jobs or GenLayer.

Show durable reservation before signing. The existing operator Zallet wallet signs a fully shielded transfer for the exact offered amount, with an opaque payout memo and wallet-calculated fees. The operator supplies fee capacity. Show reserved, broadcast, and confirmed states separately. A matching confirmed wallet output completes the job; recipient-wallet receipt provides additional evidence.

An unknown or unbroadcast outcome must not automatically resend. A private claim check can reconcile known outcomes; unresolved transfers require operator attention.

## Explicit client refund

For a verified funded job that is rejected or cancelled, the client can enter an Orchard-only testnet refund address and explicitly request a refund. The same permanent per-job reservation prevents both a worker payout and a client refund. Show **Refund pending** until the wallet confirms the matching transfer, then **Refund confirmed**. An unresolved previous transfer blocks resending as a refund.

## Evidence record

Record the environment, contract address, finalized deployment/submission hashes, execution results, criterion decisions, and review counts. For funding, claims, and refunds, label prepared request, verified deposit, reservation, broadcast, unknown outcome, and confirmed receipt separately. Do not disclose private recipient details without the operator’s choice.

The operator wallet and private database know payment details. Fully shielded transfers hide their addresses, amounts, and memos on the public chain; the public brief, offer, and deposit request remain public. Without live wallet/MongoDB credentials and separately observed transfers, this is an implementation/fixture demonstration, not evidence of a completed payment.
