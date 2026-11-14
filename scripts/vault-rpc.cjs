// Native Zingo testnet vault RPC bridge. Run with: node scripts/vault-rpc.cjs
// ZCASHED_OPERATOR_DIR holds an existing operator wallet and private runtime
// configuration; it must be outside the repository. ZCASHED_ZINGO_ADDON can
// override the installed native addon path. This bridge never exports keys.
// Incoming receipts reserve the entire shielded account transaction: the native
// addon does not expose an incoming note's recipient address or output index.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const crypto = require('node:crypto');
const { MongoClient } = require('mongodb');
const actionsOwner = process.env.ZCASHED_ACTIONS_OWNER;
const actionsGenerationValue = process.env.ZCASHED_ACTIONS_GENERATION;
const actionsEnabled = actionsOwner !== undefined || actionsGenerationValue !== undefined;
const actionsGeneration = Number(actionsGenerationValue);
if (actionsEnabled && (typeof actionsOwner !== 'string' || !/^[A-Za-z0-9_.:-]{1,160}$/.test(actionsOwner) ||
    !/^[1-9][0-9]*$/.test(actionsGenerationValue || '') || !Number.isSafeInteger(actionsGeneration))) throw new Error('A hosted operator requires a valid lease owner and generation.');
const actionsState = actionsEnabled ? require('./vault-actions-state.cjs') : null;
process.umask(0o077);
const base = path.resolve(process.env.ZCASHED_OPERATOR_DIR || path.join(os.homedir(), '.local', 'share', 'zcashed-operator'));
const addonPath = process.env.ZCASHED_ZINGO_ADDON || path.join(base, 'runtime', 'zingo-pc', 'opt', 'Zingo PC', 'resources', 'app.asar.unpacked', 'build', 'native.node');
const native = require(addonPath);
const server = process.env.ZCASHED_LIGHTWALLETD_URL || 'https://testnet.zec.rocks:443';
const walletName = process.env.ZCASHED_OPERATOR_WALLET_NAME || 'operator-demo';
const port = Number(process.env.ZCASHED_OPERATOR_RPC_PORT || '18737');
if (!Number.isSafeInteger(port) || port < 1 || port > 65535) throw new Error('ZCASHED_OPERATOR_RPC_PORT must be a valid TCP port.');
const credentialsPath = base + '/bridge-credentials.private.json';
if (!fs.existsSync(credentialsPath)) fs.writeFileSync(credentialsPath, JSON.stringify({ user: 'zcashed-operator', password: crypto.randomBytes(48).toString('base64url') }), { mode: 0o600, flag: 'wx' });
const credentials = JSON.parse(fs.readFileSync(credentialsPath, 'utf8'));
const authDigest = crypto.createHash('sha256').update('Basic ' + Buffer.from(credentials.user + ':' + credentials.password).toString('base64')).digest();
const publicWallet = JSON.parse(fs.readFileSync(base + '/wallet-public.json', 'utf8'));
let running = false;
let lastCycle = null;
let lastError = null;
let syncProgress = null;
let walletHeight = null;
let chainHeight = null;
let balance = null;
let loopBusy = false;
let shuttingDown = false;
let writeQueue = Promise.resolve();
let principalStore;
const feeReservePerJob = Number(process.env.ZCASHED_FEE_RESERVE_PER_JOB || '10000');
if (!Number.isSafeInteger(feeReservePerJob) || feeReservePerJob < 10000 || feeReservePerJob > 100000000) throw new Error('The per-job fee reserve must be an integer from 10000 to 100000000 zatoshis.');
const ledgerPath = base + '/vault-bridge-ledger.private.json';
let ledger = fs.existsSync(ledgerPath) ? JSON.parse(fs.readFileSync(ledgerPath, 'utf8')) : { allocations: {}, sends: {}, principalReceipts: {} };
class BridgeError extends Error {}
class PrebroadcastError extends BridgeError {
  constructor(message) { super(message); this.data = { stage: 'prebroadcast', retryable: true }; }
}
function persistLocalLedger(next) {
  const temporary = ledgerPath + '.tmp';
  const fd = fs.openSync(temporary, 'w', 0o600);
  try { fs.writeFileSync(fd, JSON.stringify(next)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.renameSync(temporary, ledgerPath);
  const directory = fs.openSync(base, 'r');
  try { fs.fsyncSync(directory); } finally { fs.closeSync(directory); }
  ledger = next;
}
async function persistLedger(next) {
  persistLocalLedger(next);
  if (actionsState) await actionsState.saveLedger(actionsOwner, actionsGeneration, next);
}
async function assertSpendLease() {
  if (!actionsState) return;
  try { await actionsState.assertLease(actionsOwner, actionsGeneration); }
  catch { throw new BridgeError('The hosted operator lease is unavailable or expired. Wallet spending is disabled.'); }
}
function loadedLedger(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !value.allocations || !value.sends ||
      typeof value.allocations !== 'object' || Array.isArray(value.allocations) || typeof value.sends !== 'object' || Array.isArray(value.sends)) throw new Error('The hosted operator requires its durable shared allocation and payout ledger.');
  return { ...value, principalReceipts: value.principalReceipts ?? {} };
}
const parsed = value => { try { return JSON.parse(value); } catch { return value; } };
const serializeWrite = fn => { const task = writeQueue.then(fn); writeQueue = task.catch(() => {}); return task; };
async function saveActionsCheckpoint() {
  if (!actionsState) throw new BridgeError('Hosted wallet checkpoints are unavailable.');
  await assertSpendLease();
  const manifest = JSON.parse(fs.readFileSync(base + '/actions-snapshot.private.json', 'utf8'));
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) throw new BridgeError('The hosted wallet snapshot manifest is invalid.');
  await native.save_wallet_file();
  const walletBase64 = fs.readFileSync(publicWallet.walletPath).toString('base64');
  fs.chmodSync(publicWallet.walletPath, 0o600);
  await actionsState.saveSnapshot(actionsOwner, actionsGeneration, { ...manifest, walletBase64 });
}
function checkpointReply(id, ok) {
  if (typeof process.send === 'function' && process.connected) process.send({ type: 'checkpoint', id, ok }, () => {});
}
process.on('message', async message => {
  if (!message || message.type !== 'checkpoint') return;
  const id = message.id;
  if ((typeof id !== 'string' || id.length < 1 || id.length > 160) && !Number.isSafeInteger(id)) return;
  if (!actionsState || !running || shuttingDown) { checkpointReply(id, false); return; }
  try { await serializeWrite(saveActionsCheckpoint); checkpointReply(id, true); }
  catch { checkpointReply(id, false); }
});
function publicStatus() {
  return { runtime: publicWallet.runtime, network: 'testnet', account: 0, fundingAddress: publicWallet.fundingAddress,
    running, lightwalletd: server, walletHeight, chainHeight, syncProgress, balance, lastCycle, lastError,
    capabilities: { nativeApi: true, zalletCompatible: false, exactNoteOutputReceipts: false,
      fundingReceipt: 'whole-shielded-account-transaction', vaultApiVersion: 2, principalProtection: true, spending: true }, };
}
function saveStatus() { fs.writeFileSync(base + '/bridge-status.json', JSON.stringify(publicStatus(), null, 2), { mode: 0o600 }); }
async function cycle() {
  if (loopBusy || shuttingDown) return;
  loopBusy = true;
  try {
    const report = parsed(await native.poll_sync());
    if (report?.sync_failed) { lastError = report.sync_failed.reason; await native.run_sync(); }
    else if (typeof report === 'string' && report.includes('has not been launched')) await native.run_sync();
    syncProgress = parsed(await native.status_sync());
    const height = parsed(await native.get_latest_block_wallet());
    walletHeight = Number(height?.height);
    chainHeight = Number(await native.get_latest_block_server(server));
    balance = parsed(await native.get_balance());
    lastCycle = new Date().toISOString();
    if (!report?.sync_failed) lastError = null;
    await serializeWrite(async () => {
      await native.save_wallet_file();
      fs.chmodSync(publicWallet.walletPath, 0o600);
    });
    saveStatus();
  } catch (error) { lastError = String(error.message || error); saveStatus(); }
  finally { loopBusy = false; }
}
const readonlyMethods = {
  wallet_status: async () => publicStatus(),
  wallet_balance: async () => parsed(await native.get_balance()),
  wallet_transfers: async () => ({ value_transfers: await valueTransfers() }),
  wallet_addresses: async () => parsed(await native.get_unified_addresses()),
  wallet_parse_address: async params => {
    if (!Array.isArray(params) || params.length !== 1 || typeof params[0] !== 'string' || params[0].length > 512) throw new Error('Invalid address parameters.');
    return parsed(await native.parse_address(params[0]));
  },
};
function inputObject(params) {
  if (!Array.isArray(params) || params.length !== 1 || !params[0] || typeof params[0] !== 'object' || Array.isArray(params[0])) throw new BridgeError('Expected one parameter object.');
  return params[0];
}
function assertAmount(value) {
  if (!Number.isSafeInteger(value) || value < 1 || value > 2100000000000000) throw new BridgeError('Invalid integer zatoshi amount.');
}
async function orchardRecipient(address) {
  if (typeof address !== 'string' || address.length > 512 || !address.startsWith('utest1')) throw new BridgeError('Use a testnet Unified Address with an Orchard receiver.');
  const receiver = parsed(await native.parse_address(address));
  if (receiver.status !== 'success' || receiver.chain_name !== 'test' || receiver.address_kind !== 'unified' ||
      typeof receiver.only_orchard_ua !== 'string' || !receiver.only_orchard_ua.startsWith('utest1') ||
      !Array.isArray(receiver.receivers_available) || !receiver.receivers_available.includes('orchard')) throw new BridgeError('The native wallet did not verify a testnet Orchard receiver.');
  // Decode the user's UA, then send to its Orchard receiver alone. Sapling and
  // transparent receivers in an ordinary UA cannot become fallback recipients.
  return receiver.only_orchard_ua;
}
async function syncedHeight() {
  const progress = parsed(await native.status_sync());
  const local = Number(parsed(await native.get_latest_block_wallet())?.height);
  const remote = Number(await native.get_latest_block_server(server));
  if (!Number.isSafeInteger(local) || local < 1 || remote !== local || !progress ||
      progress.total_blocks_scanned !== progress.total_blocks || progress.total_outputs_scanned !== progress.total_outputs ||
      progress.percentage_total_outputs_scanned !== 100 || !Array.isArray(progress.scan_ranges) || !progress.scan_ranges.length ||
      progress.scan_ranges.some(range => range.priority !== 'Scanned') ||
      Math.max(...progress.scan_ranges.map(range => Number(range.end_block))) !== local) throw new BridgeError('The testnet wallet must finish scanning the current chain before a vault operation.');
  return local;
}
function balanceValue(value) {
  if (!Number.isSafeInteger(value) || value < 0 || value > 2100000000000000) throw new BridgeError('The native wallet returned an unsupported balance.');
  return value;
}
async function prepare(input) {
  await assertSpendLease();
  assertAmount(input.amountZatoshis);
  await syncedHeight();
  const shieldedAddress = await orchardRecipient(input.address);
  const fees = await feeSummary();
  if (fees.pendingPayouts) throw new BridgeError('An earlier payout is awaiting wallet confirmation or reconciliation. Other job deposits stay protected.');
  if (fees.feeShortfallZatoshis > 0 || fees.spendableZatoshis <= input.amountZatoshis) throw new BridgeError('The operator must top up its separate fee balance. Job deposits cannot pay transaction fees.');
  return { address: input.address, shieldedAddress, ...fees, principalProtection: true };
}
const shieldedPools = pools => Array.isArray(pools) && pools.length > 0 && pools.every(pool => pool === 'orchard' || pool === 'ironwood');
function normalizePools(pools) {
  return Array.isArray(pools) ? pools.map(pool => typeof pool === 'string' ? pool.toLowerCase() : pool) : pools;
}
async function valueTransfers() {
  const result = parsed(await native.get_value_transfers());
  const transfers = Array.isArray(result) ? result : result?.value_transfers;
  if (!Array.isArray(transfers)) throw new BridgeError('Unsupported native wallet transaction response.');
  return transfers.map(transfer => ({ ...transfer,
    pools_sent_from: normalizePools(transfer.pools_sent_from), pools_received: normalizePools(transfer.pools_received) }));
}
function memoMatches(transfer, memo) { return Array.isArray(transfer.memos) && transfer.memos.length === 1 && transfer.memos[0] === memo; }
function confirmedSend(transfer, reservation, height) {
  return transfer.kind === 'sent' && transfer.status === 'confirmed' && Number.isSafeInteger(transfer.blockheight) &&
    transfer.blockheight > 0 && transfer.blockheight <= height && /^[0-9a-f]{64}$/.test(transfer.txid) &&
    transfer.recipient_address === reservation.shieldedAddress && transfer.value === reservation.amountZatoshis &&
    (!reservation.txid || transfer.txid === reservation.txid) && memoMatches(transfer, reservation.memo) &&
    shieldedPools(transfer.pools_received) && shieldedPools(transfer.pools_sent_from);
}
async function legacyPrincipal(reservation) {
  if (reservation.principalReceiptId) return reservation;
  if (!process.env.MONGODB_URI) throw new BridgeError('An older payout requires operator reconciliation before principal reserves can be upgraded.');
  if (!principalStore) {
    const client = new MongoClient(process.env.MONGODB_URI, { readConcern: { level: 'majority' }, readPreference: 'primary',
      serverSelectionTimeoutMS: 10000, connectTimeoutMS: 10000, socketTimeoutMS: 20000 });
    principalStore = client.connect().then(() => ({ client, operations: client.db('zcashed').collection('vault_operations') }));
  }
  const { operations } = await principalStore;
  const claim = await operations.findOne({ kind: 'claim', memo: reservation.memo });
  const deposit = claim && await operations.findOne({ _id: 'deposit:' + claim.jobId, kind: 'deposit' });
  if (!deposit || deposit.accountId !== '0' || deposit.receipt?.amountZatoshis !== reservation.amountZatoshis ||
      !/^[0-9a-f]{64}$/.test(deposit.receiptId)) throw new BridgeError('An older payout needs its original verified principal receipt before the vault can send again.');
  return { ...reservation, principalReceiptId: deposit.receiptId, fundingReference: deposit.reference };
}
async function synchronizePrincipal() {
  const transfers = await valueTransfers();
  const height = Number(parsed(await native.get_latest_block_wallet())?.height);
  let receipts = { ...(ledger.principalReceipts || {}) };
  // Discover deposits from native evidence even before an application verifies
  // funding. A job-memo deposit can never become the operator's fee balance.
  const incoming = transfers.filter(transfer => transfer.kind === 'received' && transfer.status === 'confirmed' &&
    /^[0-9a-f]{64}$/.test(transfer.txid) && Number.isSafeInteger(transfer.value) && transfer.value > 0 &&
    Array.isArray(transfer.memos) && shieldedPools(transfer.pools_received) &&
    Array.isArray(transfer.pools_sent_from) && transfer.pools_sent_from.length === 0);
  const jobTransactionIds = new Set(incoming.filter(transfer => transfer.memos.some(memo =>
    typeof memo === 'string' && memo.startsWith('zcashed:v1:deposit:'))).map(transfer => transfer.txid));
  for (const txid of jobTransactionIds) {
    const parts = incoming.filter(transfer => transfer.txid === txid);
    const references = parts.flatMap(transfer => transfer.memos);
    const reference = references.length === 1 && /^zcashed:v1:deposit:[0-9a-f-]{36}$/.test(references[0]) ? references[0] : '';
    const amountZatoshis = parts.reduce((sum, transfer) => sum + transfer.value, 0);
    if (!Number.isSafeInteger(amountZatoshis)) throw new BridgeError('Unsupported protected principal amount.');
    const observed = { txid, reference, amountZatoshis };
    if (receipts[txid] && JSON.stringify(receipts[txid]) !== JSON.stringify(observed)) throw new BridgeError('A protected principal receipt changed; operator reconciliation is required.');
    receipts = { ...receipts, [txid]: observed };
  }
  let sends = {};
  for (const [key, existing] of Object.entries(ledger.sends)) {
    const reservation = await legacyPrincipal(existing);
    const matches = transfers.filter(transfer => confirmedSend(transfer, reservation, height));
    const reconciled = matches.length === 1 ? { ...reservation, state: 'confirmed', txid: matches[0].txid } :
      reservation.state === 'confirmed' ? { ...reservation, state: 'unknown' } : reservation;
    sends = { ...sends, [key]: reconciled };
  }
  const next = { ...ledger, principalReceipts: receipts, sends };
  if (JSON.stringify(next) !== JSON.stringify(ledger)) await persistLedger(next);
  return transfers;
}
async function feeSummary(ignoreSendKey) {
  const transfers = await synchronizePrincipal();
  const current = parsed(await native.get_balance());
  if (balanceValue(current.total_transparent_balance) !== 0 || balanceValue(current.total_sapling_balance) !== 0) throw new BridgeError('This demo operator wallet requires only Orchard or Ironwood funds before payout.');
  const spendableZatoshis = balanceValue(current.confirmed_ironwood_balance) + balanceValue(current.confirmed_orchard_balance);
  const completed = new Set(Object.values(ledger.sends).filter(send => send.state === 'confirmed').map(send => send.principalReceiptId));
  const protectedReceipts = Object.values(ledger.principalReceipts || {}).filter(receipt => !completed.has(receipt.txid));
  const protectedPrincipalZatoshis = protectedReceipts.reduce((sum, receipt) => sum + balanceValue(receipt.amountZatoshis), 0);
  const requiredFeeReserveZatoshis = protectedReceipts.length * feeReservePerJob;
  // A background scan may discover a new deposit between reads. Independently
  // bound fees by confirmed operator credits, so that race cannot spend a job's
  // principal. Unknown outgoing transfers require accounting reconciliation.
  const operatorCredits = transfers.filter(transfer => transfer.kind === 'received' && transfer.status === 'confirmed' &&
    shieldedPools(transfer.pools_received) && Array.isArray(transfer.pools_sent_from) && transfer.pools_sent_from.length === 0 &&
    Array.isArray(transfer.memos) && !Object.hasOwn(ledger.principalReceipts || {}, transfer.txid))
    .reduce((sum, transfer) => sum + balanceValue(transfer.value), 0);
  const confirmed = Object.values(ledger.sends).filter(send => send.state === 'confirmed');
  if (transfers.some(transfer => transfer.kind === 'sent' && !Object.values(ledger.sends).some(send =>
      memoMatches(transfer, send.memo) && transfer.value === send.amountZatoshis && transfer.recipient_address === send.shieldedAddress))) {
    throw new BridgeError('The wallet contains an unaccounted outgoing transfer. The operator must reconcile its fee balance before releasing another job.');
  }
  const feesSpent = confirmed.reduce((sum, send) => sum + balanceValue(send.feeZatoshis), 0);
  const operatorFeeBalanceZatoshis = Math.max(0, operatorCredits - feesSpent);
  const feeAvailableZatoshis = Math.max(0, Math.min(spendableZatoshis - protectedPrincipalZatoshis, operatorFeeBalanceZatoshis));
  if (![spendableZatoshis, protectedPrincipalZatoshis, requiredFeeReserveZatoshis, operatorCredits, feesSpent].every(Number.isSafeInteger)) throw new BridgeError('Unsupported aggregate vault balance.');
  return { spendableZatoshis, protectedPrincipalZatoshis, feeAvailableZatoshis, requiredFeeReserveZatoshis,
    feeShortfallZatoshis: Math.max(0, protectedPrincipalZatoshis - spendableZatoshis, requiredFeeReserveZatoshis - feeAvailableZatoshis),
    activeFundedJobs: protectedReceipts.length,
    pendingPayouts: Object.entries(ledger.sends).filter(([key, send]) => key !== ignoreSendKey && send.state !== 'confirmed').length,
    principalProtection: true, feeReservePerJobZatoshis: feeReservePerJob };
}
function principalForSend(input) {
  if (typeof input.fundingTxid !== 'string' || !/^[0-9a-f]{64}$/.test(input.fundingTxid) || typeof input.fundingReference !== 'string') throw new PrebroadcastError('A payout requires the original verified job funding receipt.');
  const receipt = ledger.principalReceipts?.[input.fundingTxid];
  if (!receipt || receipt.reference !== input.fundingReference || receipt.amountZatoshis !== input.amountZatoshis) throw new PrebroadcastError('The payout does not match a protected job deposit.');
  if (Object.values(ledger.sends).some(send => send.principalReceiptId === input.fundingTxid)) throw new PrebroadcastError('This job deposit already has a payout or refund reservation.');
  return receipt;
}
function sendKey(memo) {
  if (typeof memo !== 'string' || !/^zcashed:v1:payout:[0-9a-f-]{36}$/.test(memo)) throw new PrebroadcastError('Invalid opaque payout memo.');
  return crypto.createHash('sha256').update(memo).digest('hex');
}
async function releaseSendReservation(key) {
  const sends = Object.fromEntries(Object.entries(ledger.sends).filter(([entryKey]) => entryKey !== key));
  await persistLedger({ ...ledger, sends });
}
async function cancelBeforeBroadcast(key, message, proposalDispatched, confirmDispatched) {
  if (confirmDispatched) throw new BridgeError('Payout broadcast is uncertain. Reconcile the wallet; do not resend.');
  if (proposalDispatched && await native.clear_proposal() !== 'OK') throw new BridgeError('The wallet could not confirm cancellation of its stored proposal. Reconcile it; do not resend.');
  await releaseSendReservation(key);
  throw new PrebroadcastError(message);
}
const vaultMethods = {
  vault_create_address: params => serializeWrite(async () => {
    await assertSpendLease();
    const input = inputObject(params);
    if (!Number.isSafeInteger(input.allocationKey) || input.allocationKey < 1) throw new BridgeError('Invalid vault allocation key.');
    const startHeight = await syncedHeight();
    const key = String(input.allocationKey);
    if (Object.hasOwn(ledger.allocations, key)) return ledger.allocations[key];
    await assertSpendLease();
    const created = parsed(await native.create_new_unified_address('o'));
    if (created.account !== 0 || created.has_orchard !== true || created.has_sapling !== false || created.has_transparent !== false || !Number.isSafeInteger(created.address_index)) throw new BridgeError('Unsupported native address derivation.');
    const address = await orchardRecipient(created.encoded_address);
    if (actionsState) await saveActionsCheckpoint();
    else await native.save_wallet_file();
    fs.chmodSync(publicWallet.walletPath, 0o600);
    const allocation = { address, accountId: '0', allocationKey: input.allocationKey, addressIndex: created.address_index, startHeight };
    await persistLedger({ ...ledger, allocations: { ...ledger.allocations, [key]: allocation } });
    return allocation;
  }),
  vault_verify_deposit: params => serializeWrite(async () => {
    const input = inputObject(params);
    assertAmount(input.amountZatoshis);
    const height = await syncedHeight();
    await orchardRecipient(input.address);
    if (typeof input.reference !== 'string' || !/^zcashed:v1:deposit:[0-9a-f-]{36}$/.test(input.reference) || !Number.isSafeInteger(input.startHeight) || input.startHeight < 1 || input.startHeight > height) throw new BridgeError('Invalid vault receipt reference or start height.');
    if (!Object.values(ledger.allocations).some(allocation => allocation.address === input.address && allocation.startHeight === input.startHeight)) throw new BridgeError('The funding address is not a persisted vault allocation.');
    await synchronizePrincipal();
    const transfers = await valueTransfers();
    for (const transfer of transfers) {
      if (transfer.kind !== 'received' || transfer.status !== 'confirmed' || !Number.isSafeInteger(transfer.blockheight) || transfer.blockheight < input.startHeight || transfer.blockheight > height ||
          transfer.value !== input.amountZatoshis || !memoMatches(transfer, input.reference) || !shieldedPools(transfer.pools_received) || !Array.isArray(transfer.pools_sent_from) || transfer.pools_sent_from.length !== 0 ||
          !/^[0-9a-f]{64}$/.test(transfer.txid)) continue;
      if (transfers.filter(item => item.txid === transfer.txid).length !== 1) continue;
      return { txid: transfer.txid, receiptId: transfer.txid, receiptType: 'whole-shielded-account-transaction',
        amountZatoshis: transfer.value, confirmations: height - transfer.blockheight + 1,
        accountId: '0', memo: input.reference, poolsReceived: transfer.pools_received };
    }
    return null;
  }),
  vault_fee_status: () => serializeWrite(async () => { await assertSpendLease(); await syncedHeight(); return feeSummary(); }),
  vault_prepare_payout: params => serializeWrite(() => prepare(inputObject(params))),
  vault_send_payout: params => serializeWrite(async () => {
    const input = inputObject(params);
    const key = sendKey(input.memo);
    if (Object.hasOwn(ledger.sends, key)) throw new BridgeError('This payout already has a permanent reservation. Reconcile it; do not resend.');
    let prepared;
    try { prepared = await prepare(input); }
    catch (error) { throw new PrebroadcastError(error instanceof BridgeError ? error.message : 'The wallet preflight failed before any payout proposal or broadcast was dispatched.'); }
    const principal = principalForSend(input);
    const reservation = { address: prepared.address, shieldedAddress: prepared.shieldedAddress, amountZatoshis: input.amountZatoshis, memo: input.memo,
      principalReceiptId: principal.txid, fundingReference: principal.reference, state: 'reserved', createdAt: new Date().toISOString() };
    try { await persistLedger({ ...ledger, sends: { ...ledger.sends, [key]: reservation } }); }
    catch { return cancelBeforeBroadcast(key, 'The payout could not be reserved before wallet dispatch.', false, false); }
    let proposalDispatched = false;
    let confirmDispatched = false;
    try {
      // native.send creates a stored proposal only. native.confirm is the only
      // signing/broadcast dispatch here; cancellation before it proves no send.
      await assertSpendLease();
      proposalDispatched = true;
      const proposal = parsed(await native.send(JSON.stringify([{ address: prepared.shieldedAddress, amount: input.amountZatoshis, memo: input.memo }])));
      if (proposal?.error || !Number.isSafeInteger(proposal?.fee) || proposal.fee < 0 || prepared.spendableZatoshis < input.amountZatoshis + proposal.fee) {
        return await cancelBeforeBroadcast(key, 'The wallet rejected the payout proposal before broadcast; no payout was sent.', proposalDispatched, confirmDispatched);
      }
      const freshFees = await feeSummary(key);
      const remainingReserve = Math.max(0, freshFees.activeFundedJobs - 1) * feeReservePerJob;
      if (freshFees.pendingPayouts || freshFees.feeAvailableZatoshis < proposal.fee + remainingReserve ||
          freshFees.spendableZatoshis < input.amountZatoshis + proposal.fee) {
        return await cancelBeforeBroadcast(key, 'The operator fee balance is too low. Other job deposits and their fee reserves remain protected; no payout was sent.', proposalDispatched, confirmDispatched);
      }
      try { await persistLedger({ ...ledger, sends: { ...ledger.sends, [key]: { ...reservation, state: 'broadcasting', feeZatoshis: proposal.fee } } }); }
      catch { return await cancelBeforeBroadcast(key, 'The payout reservation could not be made durable before broadcast; no payout was sent.', proposalDispatched, confirmDispatched); }
      await assertSpendLease();
      confirmDispatched = true;
      const sent = parsed(await native.confirm());
      if (actionsState) await saveActionsCheckpoint();
      else await native.save_wallet_file();
      if (sent?.error || !Array.isArray(sent?.txids) || sent.txids.length !== 1 || !/^[0-9a-f]{64}$/.test(sent.txids[0])) throw new BridgeError('Payout broadcast is uncertain. The bridge will not resend; reconcile the native wallet.');
      await persistLedger({ ...ledger, sends: { ...ledger.sends, [key]: { ...ledger.sends[key], state: 'broadcast', txid: sent.txids[0] } } });
      return { txid: sent.txids[0], broadcast: true };
    } catch (error) {
      if (error instanceof PrebroadcastError) throw error;
      await persistLedger({ ...ledger, sends: { ...ledger.sends, [key]: { ...reservation, ...ledger.sends[key], state: 'unknown' } } });
      throw error instanceof BridgeError ? error : new BridgeError('Payout broadcast is uncertain. The bridge will not resend; reconcile the native wallet.');
    }
  }),
  vault_release_prebroadcast: params => serializeWrite(async () => {
    await assertSpendLease();
    const input = inputObject(params);
    const key = sendKey(input.memo);
    // A dispatched send always has a durable memo reservation first. Absence
    // proves this memo never reached dispatch, or was cancelled with proof.
    // Existing reserved/broadcasting/unknown records are never auto-released.
    if (Object.hasOwn(ledger.sends, key)) throw new BridgeError('This payout has a wallet reservation; automatic release is unsafe.');
    await syncedHeight();
    const transfers = await valueTransfers();
    if (transfers.some(transfer => Array.isArray(transfer.memos) && transfer.memos.includes(input.memo))) throw new BridgeError('The wallet already has a transaction carrying this payout memo; automatic release is unsafe.');
    return { released: true, stage: 'prebroadcast', retryable: true };
  }),
  vault_inspect_payout: async params => {
    const input = inputObject(params);
    assertAmount(input.amountZatoshis);
    const height = await syncedHeight();
    const shieldedAddress = await orchardRecipient(input.address);
    if (typeof input.txid !== 'string' || !/^[0-9a-f]{64}$/.test(input.txid) || typeof input.memo !== 'string') throw new BridgeError('Invalid payout receipt request.');
    const transfer = (await valueTransfers()).find(item => item.txid === input.txid && item.kind === 'sent' && item.recipient_address === shieldedAddress && item.value === input.amountZatoshis && memoMatches(item, input.memo) && shieldedPools(item.pools_received) && shieldedPools(item.pools_sent_from));
    if (!transfer) throw new BridgeError('The native wallet has not verified the reserved payout recipient, amount, memo and shielded pools.');
    const confirmed = transfer.status === 'confirmed' && Number.isSafeInteger(transfer.blockheight) && transfer.blockheight > 0 && transfer.blockheight <= height;
    return { confirmed, confirmations: confirmed ? height - transfer.blockheight + 1 : 0 };
  },
};
const methods = { ...readonlyMethods, ...vaultMethods };
const requests = new Map();
function reply(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(JSON.stringify(body));
}
const httpServer = http.createServer(async (req, res) => {
  const candidate = crypto.createHash('sha256').update(req.headers.authorization || '').digest();
  if (!crypto.timingSafeEqual(candidate, authDigest)) return reply(res, 401, { error: 'Authentication required.' });
  const now = Date.now();
  const slot = Math.floor(now / 60000);
  const count = (requests.get(slot) || 0) + 1;
  requests.clear(); requests.set(slot, count);
  if (count > 240) return reply(res, 429, { error: 'Request limit reached.' });
  if (req.method !== 'POST' || req.url !== '/') return reply(res, 405, { error: 'Use authenticated JSON-RPC POST /.' });
  let request;
  try {
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > 16384) { reply(res, 413, { error: 'Request too large.' }); req.destroy(); return; }
      chunks.push(chunk);
    }
    request = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (request.jsonrpc !== '2.0' || (typeof request.id !== 'string' && typeof request.id !== 'number') || !Array.isArray(request.params)) throw new Error('Invalid JSON-RPC request.');
    const handler = methods[request.method];
    if (!Object.hasOwn(methods, request.method) || !handler) return reply(res, 200, { jsonrpc: '2.0', id: request.id, error: { code: -32601, message: 'Unsupported bridge method; this bridge is not Zallet.' } });
    const result = await handler(request.params);
    return reply(res, 200, { jsonrpc: '2.0', id: request.id, result });
  } catch (error) { return reply(res, 200, { jsonrpc: '2.0', id: request?.id ?? null, error: { code: -32000, message: error instanceof BridgeError ? error.message : 'Wallet request failed; inspect private operator status.', ...(error instanceof PrebroadcastError ? { data: error.data } : {}) } }); }
});
httpServer.requestTimeout = 10000;
httpServer.headersTimeout = 5000;
httpServer.keepAliveTimeout = 5000;
(async () => {
  if (actionsState) {
    const stored = await actionsState.load(actionsOwner, actionsGeneration);
    persistLocalLedger(loadedLedger(stored.ledger));
  }
  native.set_wallet_base_dir(base + '/zingo-wallet');
  native.init_from_b64(server, 'test', 'Low', 1, walletName);
  await native.run_sync();
  running = true;
  saveStatus();
  httpServer.listen(port, '127.0.0.1');
  setInterval(cycle, 15000);
  await cycle();
})().catch(error => { lastError = String(error.message || error); saveStatus(); process.exit(1); });
async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  httpServer.close();
  let exitCode = 0;
  try {
    await serializeWrite(async () => {
      await native.stop_sync();
      if (actionsState) await saveActionsCheckpoint();
      else await native.save_wallet_file();
    });
  } catch {
    if (actionsState) { exitCode = 1; lastError = 'The hosted wallet shutdown checkpoint could not be saved durably.'; }
  }
  if (actionsState) await actionsState.close().catch(() => {});
  if (principalStore) await (await principalStore).client.close().catch(() => {});
  running = false; saveStatus(); process.exit(exitCode);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
