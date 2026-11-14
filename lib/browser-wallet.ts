import { parseShieldedAddress } from './zcash'

export interface BrowserWalletAccount { address: string; network: 'testnet' }
export interface BrowserWallet {
  id: string
  name: string
  connect: () => Promise<BrowserWalletAccount[]>
}
interface ZucchiniProvider {
  request: (args: { method: string; params?: unknown }) => Promise<unknown>
  connect?: (permissions: readonly string[]) => Promise<unknown>
}
type ObjectValue = Record<string, unknown>
const object = (value: unknown): ObjectValue | null => value !== null && typeof value === 'object' ? value as ObjectValue : null
function provider(): ZucchiniProvider | null {
  if (typeof window === 'undefined') return null
  const value = object((window as unknown as ObjectValue).zucchini)
  return value && typeof value.request === 'function' ? value as unknown as ZucchiniProvider : null
}
// Exact ordinary Wallet 0.5.2 ABI from the official SDK's src/zcash.ts:
// https://github.com/zucchini-wallet/dapp-sdk/blob/main/src/zcash.ts
async function permissions(wallet: ZucchiniProvider, requested: string[]): Promise<void> {
  if (typeof wallet.connect !== 'function') throw new Error('Zucchini was detected, but this version does not expose its website connection interface. Enable website connections or update the wallet.')
  const grant = object(await wallet.connect(requested))
  const approved = grant?.approvedPermissions
  if (grant?.connected !== true || !Array.isArray(approved) || requested.some((permission) => !approved.includes(permission))) {
    throw new Error('Approve the requested permissions in Zucchini to continue.')
  }
}
async function testnet(wallet: ZucchiniProvider): Promise<void> {
  const network = object(await wallet.request({ method: 'getNetwork' }))
  if (network?.network !== 'test') throw new Error('Switch Zucchini to Zcash testnet. This app accepts testnet accounts only.')
}
async function connect(): Promise<BrowserWalletAccount[]> {
  const wallet = provider()
  if (!wallet) throw new Error('Enable Zucchini for this website, then refresh the page.')
  await permissions(wallet, ['view_addresses'])
  await testnet(wallet)
  const addresses = object(await wallet.request({ method: 'getAddresses' }))
  if (typeof addresses?.unified !== 'string') throw new Error('Zucchini did not return a Unified Account. Unlock your wallet and try again.')
  const recipient = parseShieldedAddress(addresses.unified, 'testnet')
  if (!recipient.address.startsWith('utest1')) throw new Error('Choose a testnet Unified Account in Zucchini.')
  return [{ address: recipient.address, network: 'testnet' }]
}
export function watchBrowserWallets(listener: (wallets: BrowserWallet[]) => void): () => void {
  listener(provider() ? [{ id: 'zucchini', name: 'Zucchini', connect }] : [])
  return () => undefined
}
export async function requestZucchiniPayment(uri: string): Promise<{ txid: string }> {
  const wallet = provider()
  if (!wallet) throw new Error('Enable Zucchini for this website and check wallet Activity before trying a payment.')
  if (typeof uri !== 'string' || !uri.startsWith('zcash:utest1') || uri.length > 16384) throw new Error('A valid testnet ZIP 321 payment request is required.')
  await permissions(wallet, ['view_addresses', 'send_transaction'])
  await testnet(wallet)
  // This call is made once. A returned txid is submission evidence, never confirmation.
  const result = await wallet.request({ method: 'zcash_requestPayment', params: { uri } })
  if (typeof result !== 'string' || !/^[a-f0-9]{64}$/i.test(result)) throw new Error('The payment response is uncertain. Check Zucchini Activity and the confirmed deposit before trying again.')
  return { txid: result }
}
