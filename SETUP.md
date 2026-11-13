# ZCashed — Setup Guide

## Stack
- **Frontend/Backend**: Next.js 16 (App Router)
- **AI Judge**: GenLayer Studionet (Intelligent Contracts)
- **Payments**: Zcash Testnet (shielded t-addresses)
- **Storage**: JSON file DB (`data/jobs.json`)

## Run Locally

```bash
npm run dev
# → http://localhost:3000
```

## Get Testnet ZEC (Faucets)

After generating a wallet on the Dashboard page, paste your address at:

1. **ZecPages Faucet**: https://faucet.zecpages.com/
2. **Zcash Foundation Faucet**: https://faucet.zcashfoundation.dev/

---

## GenLayer Setup

The app auto-generates a GenLayer private key on first run (saved to `data/.genlayer_key`).

To deploy contracts manually via the GenLayer Studio:
1. Visit https://studio.genlayer.com
2. Upload `contracts/escrow.py`
3. Set the generated key as `GENLAYER_PRIVATE_KEY` in `.env.local`

---

## Environment Variables (optional)

Create `.env.local`:
```env
# Optional: Override auto-generated GenLayer key
GENLAYER_PRIVATE_KEY=0x...
```

---

## User Flow

### As a Client (Job Poster):
1. Go to **Dashboard** → Generate or connect wallet
2. Get testnet ZEC from a faucet (paste your address)
3. Click **Post a Job** → Fill in title, description, budget
4. Send the exact ZEC amount to the generated escrow address
5. Click "I've Sent the ZEC" → job goes live

### As a Worker:
1. Go to **Dashboard** → Generate or connect wallet
2. Browse **Jobs** → Click a job → **Accept**
3. Do the work, then submit your URL/proof
4. **GenLayer AI evaluates immediately** (15–60 seconds)
5. If approved → ZEC released to your address
6. If rejected → See specific AI feedback → Fix and resubmit

---

## Architecture

```
Client Browser
    ↓
Next.js App Router (port 3000)
    ↓ POST /api/jobs          → Creates job + generates Zcash escrow address
    ↓ POST /api/jobs/[id]/accept → Updates status, calls GenLayer accept_job()
    ↓ POST /api/submit        → Calls GenLayer submit_work() → AI evaluates
    ↓ GET  /api/jobs          → Returns jobs from data/jobs.json
    ↓ POST /api/wallet        → Generates new Zcash testnet t-address

GenLayer Studionet
    → contracts/escrow.py (Intelligent Contract)
    → AI runs eq_principle_strict_eq() with LLM validator consensus
    → Returns: approved / needs_revision + reason

Zcash Testnet
    → Escrow t-address per job (generated server-side)
    → Client manually sends ZEC to escrow
    → On approval: payout to worker's address
```

---

## Production Checklist

- [ ] Replace JSON file DB with PostgreSQL/Prisma
- [ ] Add automatic Zcash deposit detection via lightwalletd gRPC
- [ ] Add automatic shielded payout using `librustzcash` or `zcashd RPC`
- [ ] Deploy GenLayer contract on mainnet when available
- [ ] Add wallet authentication (sign message to prove ownership)
- [ ] Add email/push notifications for job updates
