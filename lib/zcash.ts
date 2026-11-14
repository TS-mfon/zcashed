import { blake2b } from '@noble/hashes/blake2.js'
import { bech32, bech32m } from 'bech32'

export type ZcashNetwork = 'testnet' | 'mainnet'
export type ShieldedPool = 'orchard' | 'sapling'

export interface ShieldedRecipient {
  address: string
  network: ZcashNetwork
  pools: ShieldedPool[]
  preferredPool: ShieldedPool
}

const ADDRESS_LIMIT = 1023

function xor(left: Uint8Array, right: Uint8Array): Uint8Array {
  return left.map((byte, index) => byte ^ right[index])
}

// ZIP 316 F4Jumble inverse, matching librustzcash's f4jumble reference.
// Only newly allocated byte arrays are transformed; no key material is involved.
function unjumble(bytes: Uint8Array): Uint8Array {
  if (bytes.length < 48 || bytes.length > 4194368) throw new Error('Invalid Unified Address length.')
  const leftLength = Math.min(64, Math.floor(bytes.length / 2))
  const h = (left: Uint8Array, right: Uint8Array, round: number) => xor(left, blake2b(right, {
    dkLen: leftLength,
    personalization: new Uint8Array([...new TextEncoder().encode('UA_F4Jumble_H'), round, 0, 0]),
  }))
  const g = (left: Uint8Array, right: Uint8Array, round: number) => {
    const masks = Array.from({ length: Math.ceil(right.length / 64) }, (_, block) => blake2b(left, {
      dkLen: 64,
      personalization: new Uint8Array([...new TextEncoder().encode('UA_F4Jumble_G'), round, block & 255, block >> 8]),
    }))
    return right.map((byte, index) => byte ^ masks[Math.floor(index / 64)][index % 64])
  }
  const left1 = h(bytes.slice(0, leftLength), bytes.slice(leftLength), 1)
  const right1 = g(left1, bytes.slice(leftLength), 1)
  const left0 = h(left1, right1, 0)
  const right0 = g(left0, right1, 0)
  return new Uint8Array([...left0, ...right0])
}

function compactSize(bytes: Uint8Array, offset: number): { value: number; next: number } {
  if (offset >= bytes.length) throw new Error('Truncated Unified Address receiver.')
  const first = bytes[offset]
  const width = first < 253 ? 0 : first === 253 ? 2 : first === 254 ? 4 : 8
  if (offset + width >= bytes.length) throw new Error('Truncated Unified Address receiver.')
  if (!width) return { value: first, next: offset + 1 }
  const value = Array.from(bytes.slice(offset + 1, offset + 1 + width))
    .reduce((sum, byte, index) => sum + BigInt(byte) * (256n ** BigInt(index)), 0n)
  const minimum = width === 2 ? 253n : width === 4 ? 65536n : 4294967296n
  if (value < minimum || value > 536870911n) throw new Error('Invalid Unified Address receiver encoding.')
  return { value: Number(value), next: offset + width + 1 }
}

function unifiedPools(bytes: Uint8Array, prefix: string): ShieldedPool[] {
  const raw = unjumble(bytes)
  const padding = new Uint8Array([...new TextEncoder().encode(prefix), ...Array(16 - prefix.length).fill(0)])
  if (!raw.slice(-16).every((byte, index) => byte === padding[index])) {
    throw new Error('Invalid Unified Address network padding.')
  }
  const receivers = raw.slice(0, -16)
  let offset = 0
  let previous = -1
  let pools: ShieldedPool[] = []
  while (offset < receivers.length) {
    const type = compactSize(receivers, offset)
    const length = compactSize(receivers, type.next)
    if (type.value <= previous || length.next + length.value > receivers.length) {
      throw new Error('Invalid Unified Address receiver order or length.')
    }
    if (type.value === 0 || type.value === 1) {
      if (length.value !== 20 || previous === 0) throw new Error('Invalid transparent receiver in Unified Address.')
    } else if (type.value === 2 || type.value === 3) {
      if (length.value !== 43) throw new Error('Invalid shielded receiver length.')
      pools = [...pools, type.value === 3 ? 'orchard' : 'sapling']
    }
    // ZIP 316 permits opaque future receivers alongside known shielded ones.
    // Payments select a known Orchard receiver at the native wallet boundary.
    previous = type.value
    offset = length.next + length.value
  }
  if (!pools.length) throw new Error('A known shielded receiver is required.')
  return pools.includes('orchard') ? ['orchard', ...pools.filter((pool) => pool !== 'orchard')] : pools
}

export function parseShieldedAddress(address: string, network: ZcashNetwork): ShieldedRecipient {
  if (network !== 'testnet' && network !== 'mainnet') throw new Error('Choose testnet or mainnet.')
  if (typeof address !== 'string' || !address.trim() || address.trim().length > ADDRESS_LIMIT) {
    throw new Error('Enter a supported shielded Zcash address.')
  }
  const normalized = address.trim()
  const prefix = normalized.toLowerCase().slice(0, normalized.toLowerCase().lastIndexOf('1'))
  const addressNetwork = prefix === 'u' || prefix === 'zs' ? 'mainnet'
    : prefix === 'utest' || prefix === 'ztestsapling' ? 'testnet' : null
  if (!addressNetwork) throw new Error('Use a Sapling address or a Unified Address with a shielded receiver.')
  if (network !== addressNetwork) throw new Error(`This address is for ${addressNetwork}; select that network.`)
  let bytes: Uint8Array
  try {
    const codec = prefix === 'u' || prefix === 'utest' ? bech32m : bech32
    bytes = new Uint8Array(codec.fromWords(codec.decode(normalized, ADDRESS_LIMIT).words))
  } catch {
    throw new Error('Invalid address checksum or encoding. Copy the complete address from the recipient wallet.')
  }
  const pools = prefix === 'u' || prefix === 'utest' ? unifiedPools(bytes, prefix) : ['sapling'] as ShieldedPool[]
  if (prefix !== 'u' && prefix !== 'utest' && bytes.length !== 43) throw new Error('Invalid Sapling receiver length.')
  return { address: normalized.toLowerCase(), network, pools, preferredPool: pools[0] }
}

export const MAX_ZATOSHIS = 2100000000000000

function checkAmount(amount: number) {
  if (!Number.isSafeInteger(amount) || amount <= 0 || amount > MAX_ZATOSHIS) {
    throw new Error('Use a positive ZEC amount with at most eight decimal places.')
  }
}

export function parseZecToZatoshis(zec: string): number {
  const match = /^(\d+)(?:\.(\d{1,8}))?$/.exec(zec.trim())
  if (!match || zec.length > 30) throw new Error('Enter a decimal ZEC amount with at most eight decimal places.')
  const amount = BigInt(match[1]) * 100000000n + BigInt((match[2] ?? '').padEnd(8, '0'))
  if (amount > BigInt(MAX_ZATOSHIS)) throw new Error('ZEC amount exceeds the maximum money supply.')
  const result = Number(amount)
  checkAmount(result)
  return result
}

export function formatZatoshis(amount: number): string {
  if (!Number.isSafeInteger(amount) || amount < 0 || amount > MAX_ZATOSHIS) throw new Error('Invalid zatoshi amount.')
  const integer = BigInt(amount)
  const fraction = (integer % 100000000n).toString().padStart(8, '0').replace(/0+$/, '')
  return `${integer / 100000000n}${fraction ? `.${fraction}` : ''}`
}

export function createCorrelationMemo(): string {
  return JSON.stringify({ v: 1, k: 'work', r: crypto.randomUUID() })
}

export interface PaymentRequest extends ShieldedRecipient {
  amountZatoshis: number
  memo: string
  uri: string
}

export function buildPaymentRequest(input: {
  address: string
  network: ZcashNetwork
  amountZatoshis: number
  memo: string
}): PaymentRequest {
  const recipient = parseShieldedAddress(input.address, input.network)
  checkAmount(input.amountZatoshis)
  const memoBytes = new TextEncoder().encode(input.memo)
  if (memoBytes.length > 512) throw new Error('The encrypted memo must fit within 512 UTF-8 bytes.')
  const encodedMemo = btoa(String.fromCharCode(...memoBytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  return {
    ...recipient,
    amountZatoshis: input.amountZatoshis,
    memo: input.memo,
    uri: `zcash:${recipient.address}?amount=${formatZatoshis(input.amountZatoshis)}&memo=${encodedMemo}`,
  }
}
