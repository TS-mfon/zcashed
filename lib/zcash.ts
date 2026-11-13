import { sha256 } from '@noble/hashes/sha2.js'
import { ripemd160 } from '@noble/hashes/legacy.js'

function hash160(data: Uint8Array): Uint8Array {
  return ripemd160(sha256(data))
}

export async function generateZcashTestnetAddress(): Promise<{
  address: string
  privateKeyHex: string
}> {
  // Dynamically import ESM-only packages
  const secp = await import('@noble/secp256k1')
  const bs58checkMod = await import('bs58check')
  const { encode } = (bs58checkMod as any).default ?? bs58checkMod

  const privKey = secp.utils.randomSecretKey()
  const pubKey = secp.getPublicKey(privKey, true)

  const pubKeyHash = hash160(pubKey)

  // Zcash testnet t-addr (P2PKH): version bytes [0x1D, 0x25] → starts with "tm"
  const payload = new Uint8Array(22)
  payload[0] = 0x1d
  payload[1] = 0x25
  payload.set(pubKeyHash, 2)

  const address = encode(Buffer.from(payload))

  return {
    address,
    privateKeyHex: Buffer.from(privKey).toString('hex'),
  }
}

export async function validateZcashAddress(address: string): Promise<boolean> {
  try {
    const bs58checkMod = await import('bs58check')
    const { decode } = (bs58checkMod as any).default ?? bs58checkMod
    const decoded = decode(address)
    if (decoded.length !== 22) return false
    // Testnet t-addr: [0x1D, 0x25], Mainnet t-addr: [0x1C, 0xB8]
    const isTestnet = decoded[0] === 0x1d && decoded[1] === 0x25
    const isMainnet = decoded[0] === 0x1c && decoded[1] === 0xb8
    return isTestnet || isMainnet
  } catch {
    return false
  }
}

export function isTestnetAddress(address: string): boolean {
  return address.startsWith('tm') || address.startsWith('t2')
}

export const TESTNET_FAUCETS = [
  {
    name: 'ZecPages Testnet Faucet',
    url: 'https://faucet.zecpages.com/',
    description: 'Get free testnet ZEC to test the platform',
  },
  {
    name: 'Zcash Foundation Faucet',
    url: 'https://faucet.zcashfoundation.dev/',
    description: 'Official Zcash Foundation testnet faucet',
  },
]

export const TESTNET_EXPLORER_URL = 'https://testnet.zcashblockexplorer.com'

export function getExplorerTxUrl(txHash: string): string {
  return `${TESTNET_EXPLORER_URL}/tx/${txHash}`
}

export function getExplorerAddressUrl(address: string): string {
  return `${TESTNET_EXPLORER_URL}/address/${address}`
}
