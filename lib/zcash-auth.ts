import bs58check from 'bs58check'
import { sha256 } from '@noble/hashes/sha2.js'
import { ripemd160 } from '@noble/hashes/legacy.js'
import { Point, recoverPublicKey } from '@noble/secp256k1'

export function parseSigningAddress(address: string): { address: string; network: 'mainnet' | 'testnet' } {
  const decoded = bs58check.decode(address)
  if (decoded.length !== 22) throw new Error('Use an existing Zcash P2PKH address for message signing.')
  const mainnet = decoded[0] === 0x1c && decoded[1] === 0xb8
  const testnet = decoded[0] === 0x1d && decoded[1] === 0x25
  if (!mainnet && !testnet) throw new Error('This address does not support the Zcash message-signing connection.')
  return { address, network: testnet ? 'testnet' : 'mainnet' }
}

function compactLength(length: number): Uint8Array {
  if (length < 253) return Uint8Array.of(length)
  return Uint8Array.of(253, length & 255, (length >>> 8) & 255)
}

// Matches zcashd's CDataStream << strMessageMagic << message and RecoverCompact.
export function verifyZcashMessage(address: string, message: string, signature: string): boolean {
  try {
    parseSigningAddress(address)
    if (!/^[A-Za-z0-9+/]{87}=$/.test(signature)) return false
    const raw = Buffer.from(signature, 'base64')
    if (raw.length !== 65 || raw[0] < 27 || raw[0] > 34) return false
    const magic = new TextEncoder().encode('Zcash Signed Message:\n')
    const text = new TextEncoder().encode(message)
    if (text.length > 8192) return false
    const digest = sha256(sha256(Buffer.concat([compactLength(magic.length), magic, compactLength(text.length), text])))
    const recovery = (raw[0] - 27) & 3
    const publicKey = recoverPublicKey(Buffer.concat([Uint8Array.of(recovery), raw.subarray(1)]), digest, { prehash: false })
    const serialized = Point.fromBytes(publicKey).toBytes(raw[0] >= 31)
    const payload = bs58check.decode(address)
    const recoveredHash = ripemd160(sha256(serialized))
    return Buffer.from(recoveredHash).equals(Buffer.from(payload.subarray(2)))
  } catch {
    return false
  }
}
