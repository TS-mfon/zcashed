# ZCashed

ZCashed connects public freelance work acceptance to a funded **Zcash testnet custodial vault**. GenLayer evaluates pasted deliverable text against a frozen rubric. A chosen worker can claim the offered amount only after a successful finalized verdict and verified full funding.

The vault uses an **operator-controlled Zingo-PC 2.0.28-204 testnet wallet**, currently hosted by the temporary GitHub Actions workflow **Testnet vault demo**. Its authenticated server RPC has spending authority. This is operator custody, not a trustless cross-chain escrow or a decentralized payment guarantee. The app never asks users for wallet seeds.

## Flow

1. Connect an existing testnet wallet through the browser's Zucchini extension. The app requests a unified account with `window.zucchini.request` and uses a server-issued session capability for authenticated actions. An address alone cannot authenticate a user.
2. Post a public task with one acceptance criterion per line and an exact zatoshi budget. The server requires a successful finalized GenLayer deployment and reserves a testnet Orchard deposit address.
3. Fund the vault from a native wallet using the exact amount and opaque deposit-reference memo. The job opens only after the operator wallet verifies the matching shielded output with at least one confirmation. A URI or user-entered transaction hash is not funding evidence.
4. A freelancer accepts an open task, or the client chooses an applicant. The freelancer pastes the actual deliverable text.
5. GenLayer independently re-evaluates rubric decisions. Revisions are bounded to three successful reviews: the first two nonpassing reviews can be revised; the third nonpassing review is terminal. Provider failures never become approval.
6. After approval, the assigned worker enters an Orchard-only testnet payout address and requests a claim. The server durably reserves the claim before asking the native Zingo vault to sign and broadcast a fully shielded payout. Completion requires a matching confirmed wallet receipt.

An uncertain transfer is never automatically resent. The client can explicitly request a shielded refund for a verified funded job that is rejected or cancelled. A permanent per-job reservation prevents both a worker payout and a client refund. Operator recovery of unresolved transfers remains manual; live funding, payout, and refund verification are separate requirements.

## Architecture

- **Next.js on Vercel:** public jobs, Zucchini wallet connections, server session capabilities, and authenticated funding/claim routes. Application identities remain opaque `user_…` identifiers.
- **GenLayer Studionet:** real LLM execution and configurable development consensus testing. The contract judges public text; it never holds or transfers ZEC. Studio execution does not establish independent production-network consensus. See [Studio limitations](https://docs.genlayer.com/developers/intelligent-contracts/tools/genlayer-studio/limitations).
- **MongoDB:** public application metadata, durable GenLayer operations, a private payout ledger, and an AES-GCM encrypted wallet snapshot. An exclusive fenced 120-second lease coordinates the hosted wallet. Production and durable vault operations require MongoDB; local file metadata is available only for one development/test process.
- **Native Zingo vault on GitHub Actions:** the manually started **Testnet vault demo** workflow on `master` runs for 15–300 minutes, defaulting to 180. Restarting the same workflow restores the same encrypted wallet and funded addresses. An authenticated transient trycloudflare HTTPS tunnel exposes its RPC; the workflow updates Vercel's endpoint and redeploys the app. This uses no Cloudflare Worker. Never run local and Actions copies of the same wallet together.

The historical [contracts/escrow.py](contracts/escrow.py) filename is a work-acceptance contract, not the Zcash custody mechanism.

## Run locally

Requires Node.js 20.9+ and npm. Run `npm ci`, copy [.env.example](.env.example) to `.env.local`, and supply the server configuration described in [SETUP.md](SETUP.md). Then run `npm run dev` and open <http://localhost:3000>.

Real job creation and vault operations need `GENLAYER_PRIVATE_KEY`, `MONGODB_URI`, `SESSION_SECRET`, and the `ZINGO_RPC_URL`, `ZINGO_RPC_USER`, `ZINGO_RPC_PASSWORD`, and `ZINGO_ACCOUNT_ID` configuration. Keep all credentials server-side and out of source control. [SETUP.md](SETUP.md) describes the hosted workflow and its secrets.

## Privacy and trust boundaries

- Briefs, budgets, deposit addresses/references, deliverable text, and verdicts are public application data. Shielded transfers do not make these public offers private.
- A fully shielded transfer hides addresses, amount, and memo on the public chain. The operator wallet and private database still see payment details.
- A claim sends the payout address to the server. The private vault ledger stores recipient, amount, opaque memo, operation state, and transaction ID; these are excluded from public jobs and GenLayer inputs. Authorized client/worker receipt views are private.
- Wallet connection uses Zucchini's testnet unified-account request and a server session capability. Pasting an address does not grant a session or prove ownership of a shielded recipient.
- Only pasted text is judged. URLs are references; the MVP does not fetch websites, execute code, or inspect attachments.
- Legacy rows keep deterministic read-only pseudonyms. New wallet sessions cannot inherit their ownership; a scoped migration requires separate authorization.
- The operator can spend wallet funds. A GenLayer verdict is not a cryptographic authorization enforced by Zcash. Mainnet, automated lost-broadcast recovery, and production operational assurance remain outside the verified MVP. Refunds require a client request and a confirmed matching wallet receipt.

## Demo and differentiation

Start **Testnet vault demo** from GitHub Actions on `master` when the temporary vault runtime is needed. Its authenticated tunnel address changes between runs; the workflow updates the production app automatically. Wallet state persists in encrypted MongoDB storage beyond a runner's lifetime. A running workflow alone is not evidence of a confirmed deposit or payout.

Private bounties and AI payment tools already exist. The useful distinction is frozen, criterion-level work acceptance, independent re-evaluation, bounded revisions, and a funded worker-claim gate. See [the source-backed comparison](docs/winner-differentiation.md) and [the demo brief](docs/demo-script.md); payment demonstrations must use the current funded vault flow described here.
