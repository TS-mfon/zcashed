// Encrypted, fenced state for the temporary GitHub Actions testnet operator.
// Bootstrap one document before starting a worker; never give it a TTL index.
// Public API: acquire(owner) -> { owner, generation, expiresAt }; renew(owner,
// generation) -> the same shape; assertLease(owner, generation); load(owner,
// generation) -> { snapshot, ledger }; saveSnapshot(owner, generation, value);
// saveLedger(owner, generation, value); release(owner, generation); close().
// Lease fields are leaseOwner, leaseExpiresAt (BSON Date), leaseGeneration.
// Encrypted blobs are { iv, tag, ciphertext }, with base64 values and AAD
// `operator-testnet-v1:snapshot` or `operator-testnet-v1:ledger`.
const crypto = require('node:crypto');
const { MongoClient } = require('mongodb');

const WALLET_ID = 'operator-testnet-v1';
const LEASE_SECONDS = 120;
const WRITE_CONCERN = { w: 'majority', j: true };
const EPOCH = new Date(0);
let connection;
let encryptionKey;

class LeaseError extends Error {
  constructor() { super('The hosted operator lease is unavailable or expired. Wallet spending is disabled.'); this.name = 'LeaseError'; }
}

function key() {
  if (encryptionKey) return encryptionKey;
  const encoded = process.env.VAULT_STATE_KEY;
  if (typeof encoded !== 'string' || !/^[A-Za-z0-9+/]{43}=$/.test(encoded)) throw new Error('VAULT_STATE_KEY must be a base64-encoded 32-byte key.');
  const decoded = Buffer.from(encoded, 'base64');
  if (decoded.length !== 32 || decoded.toString('base64') !== encoded) throw new Error('VAULT_STATE_KEY must be a base64-encoded 32-byte key.');
  encryptionKey = decoded;
  return decoded;
}

async function collection() {
  key();
  if (!connection) {
    const uri = process.env.MONGODB_URI;
    if (typeof uri !== 'string' || !/^mongodb(?:\+srv)?:\/\//.test(uri)) throw new Error('MONGODB_URI is required for the hosted operator.');
    const client = new MongoClient(uri, {
      readConcern: { level: 'majority' }, writeConcern: WRITE_CONCERN,
      readPreference: 'primary', retryWrites: true, serverSelectionTimeoutMS: 10000,
      connectTimeoutMS: 10000, socketTimeoutMS: 20000,
    });
    connection = client.connect().then(() => ({ client, state: client.db('zcashed').collection('vault_actions_runtime') })).catch(async error => {
      connection = undefined;
      await client.close().catch(() => {});
      throw new Error('The hosted operator state store is unavailable.', { cause: error });
    });
  }
  return (await connection).state;
}

function ownerValue(owner) {
  if (typeof owner !== 'string' || !/^[A-Za-z0-9_.:-]{1,160}$/.test(owner)) throw new Error('Invalid hosted operator lease owner.');
  return owner;
}

function leaseFilter(owner, generation) {
  ownerValue(owner);
  if (!Number.isSafeInteger(generation) || generation < 1) throw new Error('Invalid hosted operator lease generation.');
  return { _id: WALLET_ID, leaseOwner: owner, leaseGeneration: generation,
    $expr: { $gt: ['$leaseExpiresAt', '$$NOW'] } };
}

function leaseInfo(document) {
  if (!document || !Number.isSafeInteger(document.leaseGeneration) || document.leaseGeneration < 1) throw new LeaseError();
  return { owner: document.leaseOwner, generation: document.leaseGeneration, expiresAt: document.leaseExpiresAt };
}

function encrypt(kind, value) {
  const json = JSON.stringify(value);
  if (typeof json !== 'string') throw new Error('Hosted operator state must be JSON serializable.');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);
  cipher.setAAD(Buffer.from(`${WALLET_ID}:${kind}`, 'utf8'));
  const ciphertext = Buffer.concat([cipher.update(json, 'utf8'), cipher.final()]);
  return { iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), ciphertext: ciphertext.toString('base64') };
}

function decode(encoded, length) {
  if (typeof encoded !== 'string' || !encoded.length || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) throw new Error('Encrypted hosted operator state is invalid.');
  const decoded = Buffer.from(encoded, 'base64');
  if (decoded.toString('base64') !== encoded || (length && decoded.length !== length)) throw new Error('Encrypted hosted operator state is invalid.');
  return decoded;
}

function decrypt(kind, blob) {
  if (!blob || typeof blob !== 'object' || Array.isArray(blob)) throw new Error('Encrypted hosted operator state is missing.');
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', key(), decode(blob.iv, 12));
    decipher.setAAD(Buffer.from(`${WALLET_ID}:${kind}`, 'utf8'));
    decipher.setAuthTag(decode(blob.tag, 16));
    const cleartext = Buffer.concat([decipher.update(decode(blob.ciphertext)), decipher.final()]);
    return JSON.parse(cleartext.toString('utf8'));
  } catch { throw new Error('Encrypted hosted operator state could not be authenticated.'); }
}

async function acquire(owner) {
  ownerValue(owner);
  const state = await collection();
  const document = await state.findOneAndUpdate({ _id: WALLET_ID, $or: [
    { leaseOwner: owner }, { $expr: { $lte: [{ $ifNull: ['$leaseExpiresAt', EPOCH] }, '$$NOW'] } },
  ] }, [{ $set: {
    leaseOwner: owner, leaseGeneration: { $add: [{ $ifNull: ['$leaseGeneration', 0] }, 1] },
    leaseExpiresAt: { $dateAdd: { startDate: '$$NOW', unit: 'second', amount: LEASE_SECONDS } }, updatedAt: '$$NOW',
  } }], { returnDocument: 'after', includeResultMetadata: false, writeConcern: WRITE_CONCERN });
  return leaseInfo(document);
}

async function renew(owner, generation) {
  const state = await collection();
  const document = await state.findOneAndUpdate(leaseFilter(owner, generation), [{ $set: {
    leaseExpiresAt: { $dateAdd: { startDate: '$$NOW', unit: 'second', amount: LEASE_SECONDS } }, updatedAt: '$$NOW',
  } }], { returnDocument: 'after', includeResultMetadata: false, writeConcern: WRITE_CONCERN });
  return leaseInfo(document);
}

async function assertLease(owner, generation) {
  const state = await collection();
  const document = await state.findOne(leaseFilter(owner, generation), { projection: { leaseOwner: 1, leaseGeneration: 1, leaseExpiresAt: 1 } });
  return leaseInfo(document);
}

async function load(owner, generation) {
  const state = await collection();
  const document = await state.findOne(leaseFilter(owner, generation), { projection: { encryptedSnapshot: 1, encryptedLedger: 1, version: 1 } });
  if (!document) throw new LeaseError();
  if (document.version !== 1) throw new Error('Unsupported hosted operator state version.');
  return { snapshot: decrypt('snapshot', document.encryptedSnapshot), ledger: decrypt('ledger', document.encryptedLedger) };
}

async function save(owner, generation, field, kind, value) {
  const filter = leaseFilter(owner, generation);
  const encrypted = encrypt(kind, value);
  const state = await collection();
  const result = await state.updateOne(filter, [{ $set: { [field]: { $literal: encrypted }, updatedAt: '$$NOW' } }], { writeConcern: WRITE_CONCERN });
  if (!result.acknowledged || result.matchedCount !== 1) throw new LeaseError();
}

async function release(owner, generation) {
  const state = await collection();
  const result = await state.updateOne(leaseFilter(owner, generation), [{ $set: { leaseOwner: null, leaseExpiresAt: '$$NOW', updatedAt: '$$NOW' } }], { writeConcern: WRITE_CONCERN });
  if (!result.acknowledged || result.matchedCount !== 1) throw new LeaseError();
}

async function close() {
  const current = connection;
  connection = undefined;
  if (current) await (await current).client.close();
}

module.exports = { acquire, renew, assertLease, load,
  saveSnapshot: (owner, generation, snapshot) => save(owner, generation, 'encryptedSnapshot', 'snapshot', snapshot),
  saveLedger: (owner, generation, ledger) => save(owner, generation, 'encryptedLedger', 'ledger', ledger),
  release, close };
