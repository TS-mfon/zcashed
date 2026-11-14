# ZCashed setup

## Requirements

- Node.js 20.9+ and npm.
- A server-side GenLayer deployer key for hosted Studio/Studionet.
- MongoDB for production and all durable vault operations.
- An operator-controlled **Zingo-PC 2.0.28-204 testnet** wallet with Orchard funds and fee capacity. The current temporary runtime is hosted by GitHub Actions.
- For connection: a browser with the Zucchini wallet extension and a testnet unified account. For funding/receipt: a wallet supporting the testnet Orchard address and memo flow.

## Configure and run

```bash
npm ci
cp .env.example .env.local
npm run dev
```

Fill `.env.local` before real job creation:

```env
GENLAYER_PRIVATE_KEY=<private GenLayer deployer key>
SESSION_SECRET=<cryptographically random session signing secret>
MONGODB_URI=<private MongoDB connection URI>
MONGODB_DB=zcashed
ZINGO_RPC_URL=<authenticated HTTPS native vault endpoint>
ZINGO_RPC_USER=<private RPC user>
ZINGO_RPC_PASSWORD=<private RPC password>
ZINGO_ACCOUNT_ID=0
```

The GenLayer key is `0x` plus 64 hexadecimal characters. `SESSION_SECRET` needs at least 32 random bytes from your secret manager. Keep keys, RPC credentials, and database credentials out of the browser, source control, terminal output, and screenshots. The RPC must use HTTPS or loopback HTTP. Production requires both a session secret and MongoDB.

The operator wallet must be on testnet, be synchronized, and have Orchard spending capacity for the offered amount plus wallet-calculated fees. The server RPC credentials grant spending authority over account `0`. The app must not request users' recovery phrases. `ZINGO_*` config selects the current native bridge; Zallet is a compatibility fallback only when no Zingo endpoint is configured.

Open <http://localhost:3000> and restart the server after environment changes.

## Zucchini wallet connection

Enable Zucchini in the browser, select a testnet unified account, and use the app's Connect wallet action. The browser requests that account through `window.zucchini.request`. Authenticated application requests require the server-issued session capability; an address alone is not authentication. The app uses an opaque `user_…` identity. A display name or selected role cannot grant administrator authority.

The connection flow does not ask for a seed phrase or a pasted P2PKH signature. A shielded payout address is provided separately through the private claim route.

## Temporary GitHub Actions vault

The workflow **Testnet vault demo** runs manually on branch `master`. Choose a runtime of 15–300 minutes; the default is 180 minutes. Configure these GitHub Actions secrets once:

- `MONGODB_URI`: the private database connection URI.
- `VAULT_STATE_KEY`: the private AES-GCM wallet-state encryption key.
- `VAULT_RPC_CREDENTIALS`: a JSON object with `user` and `password` fields matching the app's RPC credentials.
- `VERCEL_TOKEN`: the token used to update the production vault endpoint and redeploy the app.

The workflow restores the encrypted MongoDB wallet snapshot and private payout ledger, obtains an exclusive fenced 120-second lease, and starts the native Zingo-PC 2.0.28-204 bridge. Restart this same workflow to resume the same wallet and funded addresses. Keep the wallet-state key unchanged so the stored snapshot remains readable. Never run a local copy and an Actions copy of the same wallet together.

The bridge is reached through an authenticated transient trycloudflare HTTPS tunnel. The workflow updates production `ZINGO_RPC_URL` and redeploys Vercel automatically; the remaining app environment stays configured. There is no Cloudflare Worker. This is a temporary demo runtime, not continuous hosting.

The pinned Linux x64 package is [zingo-pc_2.0.28-204_amd64.deb](https://github.com/zingolabs/zingo-pc/releases/download/zingo-pc-2.0.28-204/zingo-pc_2.0.28-204_amd64.deb), with published SHA-256 `e53ab75361bc6b400b22cd967a993f116b9ccb062121f7e79c983336453955dc`.

## Storage

`MONGODB_URI` selects MongoDB; optional `MONGODB_DB` defaults to `zcashed`. Production uses TLS and a bounded driver pool. Public jobs embed applications/submissions and use their IDs as unique `_id` values. Atomic assignment/review helpers preserve concurrent nested changes and bound successful reviews to three.

The private `vault_operations` collection records address allocations, funding receipts, and durable claim intents. The native runtime also persists its AES-GCM encrypted wallet snapshot and payout ledger in MongoDB, with the exclusive lease fencing stale runners. Payout address, amount, memo, account identifier, and transaction state are visible to the authorized operator and excluded from public jobs and GenLayer.

Without MongoDB, development/test metadata can use a local file backend. Optional `ZCASHED_DATA_DIR` selects its directory; default is project `data/`. It is for one process and cannot provide durable vault operations. Corrupt files raise errors rather than becoming empty data.

Legacy rows remain read-only under deterministic `legacy_…` pseudonyms. Unsafe key/address fields and arbitrary properties are excluded from returned data. New wallet sessions cannot inherit ownership. Existing Supabase data is not automatically imported, changed, or deleted; any migration needs separate authorization.

## Using the hosted demo

1. Start **Testnet vault demo** on `master` and connect client and worker testnet accounts through Zucchini.
2. Post a small fictional public task with separate rubric lines. Require a fresh successful finalized GenLayer deployment and readable contract state.
3. Copy the reserved testnet Orchard deposit request into a native wallet. Check network, exact amount, and opaque deposit memo. A QR is a request, not evidence that the vault is funded.
4. Send only if the operator/user intends to fund the testnet job. The server must verify its matching wallet output and at least one confirmation before opening the job.
5. Submit the actual public deliverable text to GenLayer. Successful finalized receipts and criterion decisions govern acceptance; provider failures do not count as successful reviews. Only pasted text is evaluated.
6. For approved work, the worker submits an Orchard-only testnet payout address through the private authenticated claim route. The server records the durable reservation, exact payout amount, and opaque payout memo before the native Zingo vault signs.
7. Observe broadcast and the matching confirmed wallet receipt separately. Completion requires that receipt, not a verdict, URI, or user-entered hash. Recipient-wallet receipt is useful additional evidence.

Hosted Studionet is a development environment, not independent production network consensus. See the [network guide](https://docs.genlayer.com/developers/networks) and [Studio limitations](https://docs.genlayer.com/developers/intelligent-contracts/tools/genlayer-studio/limitations).

Uncertain or unbroadcast claims are never automatically resent. Known transaction outcomes can be reconciled through the private claim check; unresolved outcomes require operator attention. A verified funded job that is rejected or cancelled permits an explicit client refund request to an Orchard-only testnet address. Refund and worker payout share one permanent per-job reservation, and a matching confirmed wallet receipt is required. The app has no mainnet support or trustless custody guarantee. Do not fund a real-money deployment based on mocked tests.

Keep the workflow running while the demo needs the vault. Restarting it restores wallet state, but deposits and payouts still require their matching confirmed wallet receipts.
