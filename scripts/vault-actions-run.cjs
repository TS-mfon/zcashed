// Temporary hosted testnet operator. Wallet material never enters logs/artifacts.
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const { fork, spawn } = require('node:child_process');
const state = require('./vault-actions-state.cjs');
process.umask(0o077);
const minutes = Number(process.env.VAULT_DEMO_MINUTES || '180');
if (!Number.isSafeInteger(minutes) || minutes < 15 || minutes > 300) throw new Error('Choose a demo duration between 15 and 300 minutes.');
const owner = `github:${process.env.GITHUB_RUN_ID}:${process.env.GITHUB_RUN_ATTEMPT}`;
const base = path.join(process.env.RUNNER_TEMP, 'zcashed-operator');
const runtime = path.join(process.env.RUNNER_TEMP, 'zcashed-runtime');
let lease, bridge, tunnel, heartbeat, checkpointTimer, deadline, stopping = false;
let sequence = 0;
const pending = new Map();
const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

function privateFile(name, value) {
  fs.writeFileSync(path.join(base, name), typeof value === 'string' ? value : JSON.stringify(value), { mode: 0o600 });
}
function restore(snapshot, ledger) {
  if (snapshot.network !== 'testnet' || snapshot.walletName !== 'operator-demo' || !snapshot.walletBase64 || !snapshot.publicWallet?.fundingAddress?.startsWith('utest1')) throw new Error('The saved testnet operator snapshot is invalid.');
  fs.mkdirSync(path.join(base, 'zingo-wallet', 'testnet3'), { recursive: true, mode: 0o700 });
  const walletPath = path.join(base, 'zingo-wallet', 'testnet3', snapshot.walletName);
  fs.writeFileSync(walletPath, Buffer.from(snapshot.walletBase64, 'base64'), { mode: 0o600 });
  privateFile('wallet-public.json', { ...snapshot.publicWallet, walletPath });
  privateFile('actions-snapshot.private.json', snapshot);
  privateFile('vault-bridge-ledger.private.json', ledger);
  const credentials = JSON.parse(process.env.VAULT_RPC_CREDENTIALS || '{}');
  if (typeof credentials.user !== 'string' || typeof credentials.password !== 'string' || credentials.password.length < 32) throw new Error('Vault RPC credentials are unavailable.');
  privateFile('bridge-credentials.private.json', credentials);
}

function checkpoint() {
  if (!bridge?.connected || bridge.exitCode !== null) return Promise.reject(new Error('The wallet process cannot checkpoint.'));
  const id = ++sequence;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error('Wallet checkpoint timed out.')); }, 45000);
    pending.set(id, { resolve, reject, timer });
    bridge.send({ type: 'checkpoint', id }, error => {
      if (error) { clearTimeout(timer); pending.delete(id); reject(new Error('Wallet checkpoint failed.')); }
    });
  });
}
async function waitForBridge() {
  for (let attempt = 0; attempt < 180 && !stopping; attempt++) {
    const available = await new Promise(resolve => {
      const socket = net.connect({ host: '127.0.0.1', port: 18737 });
      socket.setTimeout(1000);
      socket.once('connect', () => { socket.destroy(); resolve(true); });
      socket.once('error', () => resolve(false));
      socket.once('timeout', () => { socket.destroy(); resolve(false); });
    });
    if (available) return;
    if (bridge.exitCode !== null) throw new Error('The native wallet could not start.');
    await delay(1000);
  }
  throw new Error('The wallet startup deadline expired.');
}
function startTunnel() {
  return new Promise((resolve, reject) => {
    tunnel = spawn(path.join(runtime, 'cloudflared'), ['tunnel', '--no-autoupdate', '--url', 'http://127.0.0.1:18737'], { stdio: ['ignore', 'ignore', 'pipe'] });
    let buffer = '';
    const timer = setTimeout(() => reject(new Error('The HTTPS tunnel did not start.')), 90000);
    tunnel.stderr.on('data', chunk => {
      buffer = (buffer + chunk.toString()).slice(-16000);
      const match = buffer.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
      if (match) { clearTimeout(timer); resolve(match[0]); }
    });
    tunnel.once('error', () => { clearTimeout(timer); reject(new Error('The HTTPS tunnel could not start.')); });
    tunnel.once('exit', () => { clearTimeout(timer); if (!stopping) void stop(1, 'The HTTPS tunnel stopped.'); });
  });
}

async function vercel(method, route, body) {
  const url = new URL(route, 'https://api.vercel.com');
  url.searchParams.set('teamId', process.env.VERCEL_TEAM_ID);
  const response = await fetch(url, { method, headers: { Authorization: `Bearer ${process.env.VERCEL_TOKEN}`, 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`Vercel ${method} request failed (${response.status}).`);
  return response.json();
}
async function updateProduction(endpoint) {
  const project = process.env.VERCEL_PROJECT_ID;
  const environments = await vercel('GET', `/v9/projects/${project}/env`);
  const existing = environments.envs.find(item => item.key === 'ZINGO_RPC_URL' && item.target?.includes('production'));
  if (!existing) throw new Error('Production vault environment configuration is missing.');
  await vercel('PATCH', `/v9/projects/${project}/env/${existing.id}`, { value: endpoint });
  const deployments = await vercel('GET', `/v6/deployments?projectId=${project}&target=production&state=READY&limit=1`);
  const current = deployments.deployments?.[0];
  if (!current) throw new Error('A ready production deployment is required.');
  const deployment = await vercel('POST', '/v13/deployments', { name: 'zcashed', project, deploymentId: current.uid, target: 'production' });
  console.log(`Production deployment: https://${deployment.url}`);
  for (let attempt = 0; attempt < 120 && !stopping; attempt++) {
    await delay(10000);
    const result = await vercel('GET', `/v13/deployments/${deployment.id}`);
    if (result.readyState === 'READY') return;
    if (['ERROR', 'CANCELED'].includes(result.readyState)) throw new Error('The production deployment did not complete.');
  }
  throw new Error('The production deployment deadline expired.');
}

async function stop(code, message) {
  if (stopping) return;
  stopping = true;
  clearInterval(heartbeat); clearInterval(checkpointTimer); clearTimeout(deadline);
  if (message) console.log(message);
  if (tunnel && tunnel.exitCode === null) tunnel.kill('SIGTERM');
  if (bridge && bridge.exitCode === null) {
    bridge.kill('SIGTERM');
    for (let attempt = 0; attempt < 50 && bridge.exitCode === null; attempt++) await delay(1000);
    if (bridge.exitCode === null) { bridge.kill('SIGKILL'); code = 1; }
    else if (bridge.exitCode !== 0) code = 1;
  }
  if (lease) await state.release(owner, lease.generation).catch(() => { code = 1; });
  await state.close().catch(() => { code = 1; });
  console.log('Vault runner stopped. The encrypted wallet and payout ledger remain in MongoDB.');
  process.exit(code);
}
process.on('SIGINT', () => void stop(0, 'Stopping the demo vault.'));
process.on('SIGTERM', () => void stop(0, 'Stopping the demo vault.'));
process.on('uncaughtException', () => void stop(1, 'The vault runner encountered an error.'));
process.on('unhandledRejection', () => void stop(1, 'The vault runner encountered an error.'));

(async () => {
  lease = await state.acquire(owner);
  const stored = await state.load(owner, lease.generation);
  restore(stored.snapshot, stored.ledger);
  let renewing = false;
  heartbeat = setInterval(async () => {
    if (renewing || stopping) return;
    renewing = true;
    try { await state.renew(owner, lease.generation); }
    catch { if (bridge?.exitCode === null) bridge.kill('SIGKILL'); void stop(1, 'Wallet lease lost; spending stopped.'); }
    finally { renewing = false; }
  }, 30000);
  bridge = fork(path.join(__dirname, 'vault-rpc.cjs'), [], { env: { ...process.env,
    ZCASHED_OPERATOR_DIR: base, ZCASHED_ZINGO_ADDON: path.join(runtime, 'zingo-pc', 'opt', 'Zingo PC', 'resources', 'app.asar.unpacked', 'build', 'native.node'),
    ZCASHED_ACTIONS_OWNER: owner, ZCASHED_ACTIONS_GENERATION: String(lease.generation) }, stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
  bridge.on('message', message => {
    if (message?.type !== 'checkpoint') return;
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id); clearTimeout(request.timer);
    if (message.ok) request.resolve(); else request.reject(new Error('The wallet checkpoint was not durably saved.'));
  });
  bridge.once('exit', () => { if (!stopping) void stop(1, 'The wallet process stopped.'); });
  await waitForBridge();
  await checkpoint();
  checkpointTimer = setInterval(() => { if (!stopping) checkpoint().catch(() => void stop(1, 'Wallet checkpoint failed; stopping the vault.')); }, 60000);
  deadline = setTimeout(() => void stop(0, 'The requested demo runtime has ended.'), minutes * 60000);
  const endpoint = await startTunnel();
  console.log(`Vault HTTPS endpoint: ${endpoint}`);
  await updateProduction(endpoint);
  console.log(`Vault is hosted on GitHub Actions for ${minutes} minutes. Production: https://zcashed-bice.vercel.app`);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,
    `## Testnet vault running\n\nProduction: https://zcashed-bice.vercel.app\n\nRuntime: ${minutes} minutes from wallet startup. Restart this workflow after expiry. The same funded wallet and encrypted payout ledger are restored.\n`);
})().catch(error => void stop(1, error.message.startsWith('Vercel ') ? error.message : 'The hosted vault could not start or update production.'));
