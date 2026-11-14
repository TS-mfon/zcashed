# ZCashed setup

## Requirements

- Node.js 20.9+ and npm.
- A server-side GenLayer deployer key for hosted Studio/Studionet.
- MongoDB for production and all durable vault operations.
- An existing synchronized beta.4-compatible **Zallet testnet** wallet account with Orchard funds and fee capacity. The app does not create a wallet, seed, or account.
- For login: an existing Zcash wallet supporting a standard signed message from a transparent P2PKH address. For funding/receipt: a native wallet supporting the testnet Orchard address and memo flow.

## Configure and run

```bash
npm ci
cp .env.example .env.local
npm run dev
```

Fill `.env.local` before testing real job creation:

```env
GENLAYER_PRIVATE_KEY=<private GenLayer deployer key>
SESSION_SECRET=<cryptographically random session signing secret>
MONGODB_URI=<private MongoDB connection URI>
MONGODB_DB=zcashed
ZALLET_RPC_URL=<existing operator wallet RPC endpoint>
ZALLET_RPC_USER=<private RPC user>
ZALLET_RPC_PASSWORD=<private RPC password>
ZALLET_ACCOUNT_ID=<existing wallet account UUID>
```

The GenLayer key is `0x` plus 64 hexadecimal characters. `SESSION_SECRET` needs at least 32 random bytes from your secret manager. Keep keys, RPC credentials, and database credentials out of the browser, source control, terminal output, and screenshots. The RPC must use HTTPS or loopback HTTP. Production requires both a session secret and MongoDB.

The operator wallet must already exist, be on testnet, be synchronized, and have Orchard spending capacity for the offered amount plus wallet-calculated fees. The server RPC credentials grant spending authority over that account. The operator controls backups and unlocking; the app must not request recovery phrases or create accounts.

Open <http://localhost:3000> and restart the server after environment changes. Authenticate the intended MongoDB and wallet services and authorize a scoped live check before claiming the deployment is connected.

## Existing-wallet login

Sign the exact server-issued challenge in an existing wallet using its transparent P2PKH key, then paste the compact Zcash signed-message signature. The server verifies the signature and issues an opaque `user_…` session identity. This proves the transparent signing key only; it does not prove ownership of an Orchard payout address. A display name or selected role cannot grant administrator authority.

Independent fixture signatures test protocol verification. A real native-wallet signing roundtrip remains necessary to establish that wallet's compatibility.

## Storage

`MONGODB_URI` selects MongoDB; optional `MONGODB_DB` defaults to `zcashed`. Production uses TLS and a bounded driver pool. Public jobs embed applications/submissions and use their IDs as unique `_id` values. Atomic assignment/review helpers preserve concurrent nested changes and bound successful reviews to three.

The private `vault_operations` collection records address allocations, funding receipts, and durable claim intents. Vault initialization creates unique allocation and deposit-receipt indexes when an authorized job is reserved. Payout address, amount, memo, account identifier, and transaction state are visible to the operator's database and wallet, and excluded from public jobs and GenLayer.

Without MongoDB, development/test metadata can use a local file backend. Optional `ZCASHED_DATA_DIR` selects its directory; default is project `data/`. It is for one process and cannot provide durable vault operations. Corrupt files raise errors rather than becoming empty data.

Legacy rows remain read-only under deterministic `legacy_…` pseudonyms. Unsafe key/address fields and arbitrary properties are excluded from returned data. New wallet sessions cannot inherit ownership. Existing Supabase data is not automatically imported, changed, or deleted; any migration needs separate authorization.

## Live verification

1. Connect the existing client and worker wallets using real signed-message challenges.
2. Post a small fictional public task with separate rubric lines. Require a fresh successful finalized GenLayer deployment and readable contract state.
3. Copy the reserved testnet Orchard deposit request into a native wallet. Check network, exact amount, and opaque deposit memo. A QR is a request, not evidence that the vault is funded.
4. Send only if the operator/user intends to fund the testnet job. The server must verify its matching wallet output and at least one confirmation before opening the job.
5. Submit good text and deficient text to real GenLayer. Capture successful finalized receipts and criterion decisions; test provider failure without recording a successful review. Only pasted text is evaluated.
6. For accepted work, the worker submits an Orchard-only testnet payout address through the private authenticated claim route. Check durable reservation, shielded source, exact payout amount, and opaque payout memo. Zallet signs through the server's existing account.
7. Observe broadcast and the matching confirmed wallet receipt separately. Completion requires that receipt, not a verdict, URI, or user-entered hash. Recipient-wallet receipt is useful additional evidence.

Hosted Studionet is a development environment, not independent production network consensus. See the [network guide](https://docs.genlayer.com/developers/networks) and [Studio limitations](https://docs.genlayer.com/developers/intelligent-contracts/tools/genlayer-studio/limitations).

Uncertain or unbroadcast claims are never automatically resent. Known transaction outcomes can be reconciled through the private claim check; unresolved outcomes require operator attention. A verified funded job that is rejected or cancelled permits an explicit client refund request to an Orchard-only testnet address. Refund and worker payout share one permanent per-job reservation, and a matching confirmed wallet receipt is required. The app has no mainnet support or trustless custody guarantee. Do not fund a real-money deployment based on mocked tests.

Run the test, typecheck, lint, and build scripts in `package.json`. [HANDOFF.md](HANDOFF.md) records live checks still needed; no remote cluster or wallet has been claimed as verified by this setup document.
