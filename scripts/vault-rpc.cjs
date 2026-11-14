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
let writeQueue = Promise.resolve();
const ledgerPath = base + '/vault-bridge-ledger.private.json';
let ledger = fs.existsSync(ledgerPath) ? JSON.parse(fs.readFileSync(ledgerPath, 'utf8')) : { allocations: {}, sends: {} };
class BridgeError extends Error {}
class PrebroadcastError extends BridgeError {
  constructor(message) { super(message); this.data = { stage: 'prebroadcast', retryable: true }; }
}
function persistLedger(next) {
  const temporary = ledgerPath + '.tmp';
  const fd = fs.openSync(temporary, 'w', 0o600);
  try { fs.writeFileSync(fd, JSON.stringify(next)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.renameSync(temporary, ledgerPath);
  const directory = fs.openSync(base, 'r');
  try { fs.fsyncSync(directory); } finally { fs.closeSync(directory); }
  ledger = next;
}
const parsed = value => { try { return JSON.parse(value); } catch { return value; } };
const serializeWrite = fn => { const task = writeQueue.then(fn); writeQueue = task.catch(() => {}); return task; };
function publicStatus() {
  return { runtime: publicWallet.runtime, network: 'testnet', account: 0, fundingAddress: publicWallet.fundingAddress,
    running, lightwalletd: server, walletHeight, chainHeight, syncProgress, balance, lastCycle, lastError,
    capabilities: { nativeApi: true, zalletCompatible: false, exactNoteOutputReceipts: false,
      fundingReceipt: 'whole-shielded-account-transaction', vaultApiVersion: 1, spending: true }, };
}
function saveStatus() { fs.writeFileSync(base + '/bridge-status.json', JSON.stringify(publicStatus(), null, 2), { mode: 0o600 }); }
async function cycle() {
  if (loopBusy) return;
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
    await native.save_wallet_file();
    fs.chmodSync(publicWallet.walletPath, 0o600);
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
  assertAmount(input.amountZatoshis);
  await syncedHeight();
  const shieldedAddress = await orchardRecipient(input.address);
  const current = parsed(await native.get_balance());
  if (balanceValue(current.total_transparent_balance) !== 0 || balanceValue(current.total_sapling_balance) !== 0) throw new BridgeError('This demo operator wallet requires only Orchard or Ironwood funds before payout.');
  const spendable = balanceValue(current.confirmed_ironwood_balance) + balanceValue(current.confirmed_orchard_balance);
  if (!Number.isSafeInteger(spendable) || spendable <= input.amountZatoshis) throw new BridgeError('Fund the operator shielded testnet wallet for the payout plus wallet-calculated fees.');
  return { address: input.address, shieldedAddress, spendableZatoshis: spendable };
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
function sendKey(memo) {
  if (typeof memo !== 'string' || !/^zcashed:v1:payout:[0-9a-f-]{36}$/.test(memo)) throw new PrebroadcastError('Invalid opaque payout memo.');
  return crypto.createHash('sha256').update(memo).digest('hex');
}
function releaseSendReservation(key) {
  const sends = Object.fromEntries(Object.entries(ledger.sends).filter(([entryKey]) => entryKey !== key));
  persistLedger({ ...ledger, sends });
}
async function cancelBeforeBroadcast(key, message, proposalDispatched, confirmDispatched) {
  if (confirmDispatched) throw new BridgeError('Payout broadcast is uncertain. Reconcile the wallet; do not resend.');
  if (proposalDispatched && await native.clear_proposal() !== 'OK') throw new BridgeError('The wallet could not confirm cancellation of its stored proposal. Reconcile it; do not resend.');
  releaseSendReservation(key);
  throw new PrebroadcastError(message);
}
const vaultMethods = {
  vault_create_address: params => serializeWrite(async () => {
    const input = inputObject(params);
    if (!Number.isSafeInteger(input.allocationKey) || input.allocationKey < 1) throw new BridgeError('Invalid vault allocation key.');
    const startHeight = await syncedHeight();
    const key = String(input.allocationKey);
    if (Object.hasOwn(ledger.allocations, key)) return ledger.allocations[key];
    const created = parsed(await native.create_new_unified_address('o'));
    if (created.account !== 0 || created.has_orchard !== true || created.has_sapling !== false || created.has_transparent !== false || !Number.isSafeInteger(created.address_index)) throw new BridgeError('Unsupported native address derivation.');
    const address = await orchardRecipient(created.encoded_address);
    await native.save_wallet_file();
    fs.chmodSync(publicWallet.walletPath, 0o600);
    const allocation = { address, accountId: '0', allocationKey: input.allocationKey, addressIndex: created.address_index, startHeight };
    persistLedger({ ...ledger, allocations: { ...ledger.allocations, [key]: allocation } });
    return allocation;
  }),
  vault_verify_deposit: async params => {
    const input = inputObject(params);
    assertAmount(input.amountZatoshis);
    const height = await syncedHeight();
    await orchardRecipient(input.address);
    if (typeof input.reference !== 'string' || !/^zcashed:v1:deposit:[0-9a-f-]{36}$/.test(input.reference) || !Number.isSafeInteger(input.startHeight) || input.startHeight < 1 || input.startHeight > height) throw new BridgeError('Invalid vault receipt reference or start height.');
    if (!Object.values(ledger.allocations).some(allocation => allocation.address === input.address && allocation.startHeight === input.startHeight)) throw new BridgeError('The funding address is not a persisted vault allocation.');
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
  },
  vault_prepare_payout: params => prepare(inputObject(params)),
  vault_send_payout: params => serializeWrite(async () => {
    const input = inputObject(params);
    const key = sendKey(input.memo);
    if (Object.hasOwn(ledger.sends, key)) throw new BridgeError('This payout already has a permanent reservation. Reconcile it; do not resend.');
    let prepared;
    try { prepared = await prepare(input); }
    catch (error) { throw new PrebroadcastError(error instanceof BridgeError ? error.message : 'The wallet preflight failed before any payout proposal or broadcast was dispatched.'); }
    const reservation = { address: prepared.address, shieldedAddress: prepared.shieldedAddress, amountZatoshis: input.amountZatoshis, memo: input.memo, state: 'reserved', createdAt: new Date().toISOString() };
    try { persistLedger({ ...ledger, sends: { ...ledger.sends, [key]: reservation } }); }
    catch { return cancelBeforeBroadcast(key, 'The payout could not be reserved before wallet dispatch.', false, false); }
    let proposalDispatched = false;
    let confirmDispatched = false;
    try {
      // native.send creates a stored proposal only. native.confirm is the only
      // signing/broadcast dispatch here; cancellation before it proves no send.
      proposalDispatched = true;
      const proposal = parsed(await native.send(JSON.stringify([{ address: prepared.shieldedAddress, amount: input.amountZatoshis, memo: input.memo }])));
      if (proposal?.error || !Number.isSafeInteger(proposal?.fee) || proposal.fee < 0 || prepared.spendableZatoshis < input.amountZatoshis + proposal.fee) {
        return await cancelBeforeBroadcast(key, 'The wallet rejected the payout proposal before broadcast; no payout was sent.', proposalDispatched, confirmDispatched);
      }
      try { persistLedger({ ...ledger, sends: { ...ledger.sends, [key]: { ...reservation, state: 'broadcasting', feeZatoshis: proposal.fee } } }); }
      catch { return await cancelBeforeBroadcast(key, 'The payout reservation could not be made durable before broadcast; no payout was sent.', proposalDispatched, confirmDispatched); }
      confirmDispatched = true;
      const sent = parsed(await native.confirm());
      await native.save_wallet_file();
      if (sent?.error || !Array.isArray(sent?.txids) || sent.txids.length !== 1 || !/^[0-9a-f]{64}$/.test(sent.txids[0])) throw new BridgeError('Payout broadcast is uncertain. The bridge will not resend; reconcile the native wallet.');
      persistLedger({ ...ledger, sends: { ...ledger.sends, [key]: { ...ledger.sends[key], state: 'broadcast', txid: sent.txids[0] } } });
      return { txid: sent.txids[0], broadcast: true };
    } catch (error) {
      if (error instanceof PrebroadcastError) throw error;
      persistLedger({ ...ledger, sends: { ...ledger.sends, [key]: { ...ledger.sends[key], state: 'unknown' } } });
      throw error instanceof BridgeError ? error : new BridgeError('Payout broadcast is uncertain. The bridge will not resend; reconcile the native wallet.');
    }
  }),
  vault_release_prebroadcast: params => serializeWrite(async () => {
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
  httpServer.close();
  try { await native.stop_sync(); await native.save_wallet_file(); } catch {}
  running = false; saveStatus(); process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
