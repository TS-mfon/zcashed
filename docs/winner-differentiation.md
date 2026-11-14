# Positioning against ZecHub Hackathon 3.0 projects

Sources reviewed: 2026-11-14. The starting point is ZecHub's [winner announcement](https://zechub.substack.com/p/announcing-the-winners-of-zechub), published 2026-08-03, and the linked projects' READMEs. Their feature claims below are descriptions from those sources, not an independent runtime audit.

“Private freelance payments with AI” is a crowded category. Existing projects already cover shielded bounties, agent payments, human-approved wallet requests, and selective payment evidence. A payment QR or local-key boundary alone is not a distinct product claim.

| Project and source | Documented capability | Implication for ZCashed |
| --- | --- | --- |
| [ZBounty](https://github.com/Jay-cey/zechub/tree/hackathon-submission/Hackathon/2026/ZBounty) | Public bounty workflow, Zcash mainnet rewards through Zingo CLI/lightwalletd, and a Privacy Score. | “A Zcash bounty marketplace” already exists. Our demo must show more than job posting and payout. |
| [ZecAgent](https://github.com/aliiqbal24/ZecAgent) | Local wallet, CLI, dashboard, and MCP tools; payment proposals, user approval, spending limits, and confirmation receipts. Its README also describes optional autonomy and cross-chain routes. | AI-assisted payment and local spending authority already exist. Our acceptance decision must be demonstrably about the delivered work. |
| [ZBooks](https://github.com/AustinChris1/ZBooks-SIWZ) | Non-custodial accounting, multi-recipient ZIP 321 requests, approval thresholds, wallet signing, and viewing-key reconciliation. | A human-approved ZIP 321 handoff is established practice. We should not claim to invent it or equate it with verified payment. |
| [Glasspane Rooms](https://github.com/dolepee/glasspane) | Selective disclosure of chosen Orchard outputs using Out Cipher Keys; verification of recipient, amount, and memo without revealing the whole treasury. | Our acceptance memo is context, not equivalent cryptographic proof of a shielded payout. |

## The useful distinction

ZCashed's intended contribution is **criterion-level, independently re-evaluated work acceptance connected to a funded testnet worker claim**:

1. The client publishes a brief and explicit acceptance criteria.
2. Real LLM evaluation checks the actual pasted deliverable. The validator path re-evaluates criteria independently rather than approving the leader's JSON format alone.
3. The application requires successful finalized execution and matching contract state before treating the work as accepted. Missing evidence or provider failure never becomes a fallback approval.
4. The job opens only after verified funding. An accepted worker explicitly requests a shielded payout from an existing operator Zallet account; the server durably reserves the transfer before signing.

This is a custodial testnet vault with a work-acceptance gate. The server RPC has spending authority over the operator wallet; the GenLayer verdict does not cryptographically constrain Zcash spending. A worker payout or explicit client refund completes only after matching wallet confirmation. Hosted Studionet demonstrates development execution, not independent production network consensus. Independent criterion evaluation is an implementation property that must be verified, not assumed from the GenLayer name.

## What the demo must prove

Use [the fixed demo script](demo-script.md). Show one complete deliverable accepted with criterion evidence, one incomplete deliverable rejected with useful feedback, and one provider failure that fails closed. Keep fresh finalized receipts and contract-state reads as the evidence for live GenLayer execution.

Show the native deposit request, then the operator wallet’s verified funding output. For an accepted job, show the worker’s private claim request, durable reservation, broadcast, and confirmed matching wallet receipt. For rejected or cancelled funded jobs, show the explicit client refund request. Memos are opaque references, not public job identifiers. A QR is not settlement evidence; unresolved outcomes must never trigger a resend.

Public job budgets, deposit addresses/references, and text remain public. Payout/refund recipients, amounts, memos, and operation state are visible to the operator’s private database and wallet, and excluded from public jobs and GenLayer. A fully shielded payment protects its on-chain addresses, amount, and memo; it does not conceal the marketplace brief or offer. An entered address or session alone does not prove wallet ownership. The supported existing-wallet connection mechanism needs its own verification evidence.

The strongest pitch is: “Fund clear criteria, see the delivered work evaluated against them, then request a shielded claim backed by verified testnet funding.” Claim production consensus or completed payment only when separately observed and recorded.
