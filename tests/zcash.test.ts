import { describe, expect, it } from 'vitest'
import { bech32, bech32m } from 'bech32'
import { buildPaymentRequest, createCorrelationMemo, parseShieldedAddress, parseZecToZatoshis, formatZatoshis } from '../lib/zcash'
import vectors from './fixtures/zcash-vectors.json'

describe('shielded recipient validation', () => {
  it('recognizes the Orchard receiver in a published Unified Address', () => {
    expect(parseShieldedAddress(vectors.orchardOnly, 'mainnet')).toEqual({
      address: vectors.orchardOnly,
      network: 'mainnet',
      pools: ['orchard'],
      preferredPool: 'orchard',
    })
  })

  it.each([
    [vectors.saplingMainnet, 'mainnet', 'sapling'],
    [vectors.saplingTestnet, 'testnet', 'sapling'],
    [vectors.unifiedTestnet, 'testnet', 'sapling'],
    [vectors.saplingOnlyUnified, 'mainnet', 'sapling'],
  ] as const)('decodes published %s encoding', (address, network, pool) => {
    expect(parseShieldedAddress(address, network).preferredPool).toBe(pool)
  })

  it('lists Orchard before Sapling when both receivers are present', () => {
    expect(parseShieldedAddress(vectors.bothShielded, 'mainnet').pools).toEqual(['orchard', 'sapling'])
  })

  it('rejects Unified Addresses that permit a transparent fallback', () => {
    expect(() => parseShieldedAddress(vectors.transparentAndShielded, 'mainnet')).toThrow(/transparent fallback/)
  })

  it.each(['invalidPaddingBytes', 'truncatedSaplingBytes', 'transparentOnlyBytes'] as const)(
    'rejects the published %s negative vector', (key) => {
      const address = bech32m.encode('u', bech32m.toWords(new Uint8Array(vectors[key])), 1023)
      expect(() => parseShieldedAddress(address, 'mainnet')).toThrow()
    },
  )

  it.each([vectors.saplingMainnet, vectors.orchardOnly])('rejects a corrupt checksum on %s', (address) => {
    const corrupt = address.slice(0, -1) + (address.endsWith('q') ? 'p' : 'q')
    expect(() => parseShieldedAddress(corrupt, 'mainnet')).toThrow(/checksum/)
  })

  it('rejects Bech32 instead of the required Unified Address Bech32m checksum', () => {
    const decoded = bech32m.decode(vectors.orchardOnly, 1023)
    expect(() => parseShieldedAddress(bech32.encode('u', decoded.words, 1023), 'mainnet')).toThrow(/checksum/)
  })

  it('rejects a mainnet recipient in the default testnet flow', () => {
    expect(() => parseShieldedAddress(vectors.orchardOnly, 'testnet')).toThrow(/mainnet/)
  })

  it('rejects a testnet recipient in a mainnet flow', () => {
    expect(() => parseShieldedAddress(vectors.unifiedTestnet, 'mainnet')).toThrow(/testnet/)
  })

  it('rejects an altered network prefix even with a valid checksum', () => {
    const decoded = bech32m.decode(vectors.orchardOnly, 1023)
    expect(() => parseShieldedAddress(bech32m.encode('utest', decoded.words, 1023), 'testnet')).toThrow(/padding/)
  })

  it('rejects a truncated Sapling payload with a recomputed checksum', () => {
    const decoded = bech32.decode(vectors.saplingTestnet, 1023)
    const words = bech32.toWords(new Uint8Array(bech32.fromWords(decoded.words).slice(1)))
    expect(() => parseShieldedAddress(bech32.encode('ztestsapling', words, 1023), 'testnet')).toThrow(/length/)
  })

  it('accepts uppercase encodings and canonicalizes them', () => {
    expect(parseShieldedAddress(vectors.orchardOnly.toUpperCase(), 'mainnet').address).toBe(vectors.orchardOnly)
  })

  it('rejects mixed-case encodings', () => {
    expect(() => parseShieldedAddress('U' + vectors.orchardOnly.slice(1), 'mainnet')).toThrow(/checksum/)
  })

  it('rejects a payout address that is only an apparent prefix', () => {
    expect(() => parseShieldedAddress('utest1notanaddress', 'testnet')).toThrow()
  })
})

describe('ZIP 321 payment requests', () => {
  it('keeps a one-zatoshi amount exact in the URI', () => {
    expect(buildPaymentRequest({ address: vectors.unifiedTestnet, network: 'testnet', amountZatoshis: 1, memo: 'work' }).uri)
      .toBe(`zcash:${vectors.unifiedTestnet}?amount=0.00000001&memo=d29yaw`)
  })

  it('uses an opaque random correlation reference without a public job identifier', () => {
    const first = JSON.parse(createCorrelationMemo())
    const second = JSON.parse(createCorrelationMemo())
    expect(first).toMatchObject({ v: 1, k: 'work' })
    expect(Object.keys(first)).toEqual(['v', 'k', 'r'])
    expect(first.r).toMatch(/^[0-9a-f-]{36}$/)
    expect(first.r).not.toBe(second.r)
  })

  it('encodes a UTF-8 memo using unpadded URL-safe base64', () => {
    const request = buildPaymentRequest({ address: vectors.orchardOnly, network: 'mainnet', amountZatoshis: 10000, memo: 'Hello ☃ 😀' })
    const memo = new URL(request.uri).searchParams.get('memo')!
    expect(memo).toBe('SGVsbG8g4piDIPCfmIA')
    expect(memo).not.toMatch(/[+/=]/)
    expect(Buffer.from(memo, 'base64url').toString('utf8')).toBe('Hello ☃ 😀')
  })

  it('accepts exactly 512 UTF-8 bytes of memo text', () => {
    const request = buildPaymentRequest({ address: vectors.orchardOnly, network: 'mainnet', amountZatoshis: 10000, memo: '😀'.repeat(128) })
    expect(Buffer.from(new URL(request.uri).searchParams.get('memo')!, 'base64url').length).toBe(512)
  })

  it('rejects a memo over 512 bytes even when its character count is smaller', () => {
    expect(() => buildPaymentRequest({ address: vectors.orchardOnly, network: 'mainnet', amountZatoshis: 10000, memo: '😀'.repeat(129) })).toThrow(/512 UTF-8 bytes/)
  })

  it.each([0, -1, 0.1, NaN, Infinity, Number.MAX_SAFE_INTEGER, 2100000000000001])('rejects an invalid zatoshi amount %s', (amountZatoshis) => {
    expect(() => buildPaymentRequest({ address: vectors.orchardOnly, network: 'mainnet', amountZatoshis, memo: 'work' })).toThrow(/amount/)
  })

  it('rejects mismatched network before handing off to a wallet', () => {
    expect(() => buildPaymentRequest({ address: vectors.orchardOnly, network: 'testnet', amountZatoshis: 10000, memo: 'work' })).toThrow(/mainnet/)
  })
})

describe('integer ZEC amounts', () => {
  it.each([
    ['0.00000001', 1], ['0.0001', 10000], ['1.23456789', 123456789], ['21000000', 2100000000000000],
  ] as const)('parses exact decimal %s without floating-point rounding', (zec, zatoshis) => {
    expect(parseZecToZatoshis(zec)).toBe(zatoshis)
    expect(formatZatoshis(zatoshis)).toBe(zec)
  })

  it('formats zero for display', () => {
    expect(formatZatoshis(0)).toBe('0')
  })

  it.each(['0', '-1', '1e-8', '0.000000001', '1.23garbage', 'Infinity', '21000000.00000001', ''])('rejects malformed or unpayable decimal %s', (zec) => {
    expect(() => parseZecToZatoshis(zec)).toThrow()
  })

  it.each([-1, 0.5, Infinity, 2100000000000001])('rejects invalid display amount %s', (amount) => {
    expect(() => formatZatoshis(amount)).toThrow()
  })
})
