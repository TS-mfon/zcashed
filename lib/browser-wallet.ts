import { parseShieldedAddress } from './zcash'

export interface BrowserWalletAccount {
  address: string
  signingAddress: string
  network: 'testnet'
  source: Record<string, unknown>
}
export interface BrowserWallet {
  id: string
  name: string
  connect: () => Promise<BrowserWalletAccount[]>
  sign: (account: BrowserWalletAccount, message: string) => Promise<string>
}
type ObjectValue = Record<string, unknown>
const object = (value: unknown): ObjectValue | null => value !== null && typeof value === 'object' ? value as ObjectValue : null
const registry = new Map<string, BrowserWallet>()
let listeners = new Set<(wallets: BrowserWallet[]) => void>()
let listening = false

function account(value: unknown): BrowserWalletAccount | null {
  const data = object(value)
  if (!data || typeof data.address !== 'string' || typeof data.signingAddress !== 'string' || !data.signingAddress.startsWith('tm')) return null
  try {
    const recipient = parseShieldedAddress(data.address, 'testnet')
    if (!recipient.address.startsWith('utest1') || (data.network !== undefined && data.network !== 'testnet')) return null
    return { address: recipient.address, signingAddress: data.signingAddress, network: 'testnet', source: data }
  } catch { return null }
}
function accounts(result: unknown): BrowserWalletAccount[] {
  const values = Array.isArray(result) ? result : object(result)?.accounts
  return Array.isArray(values) ? values.map(account).filter((value): value is BrowserWalletAccount => !!value) : []
}
function signature(result: unknown): string {
  const value = Array.isArray(result) ? result[0] : result
  const data = object(value)
  const proof = typeof value === 'string' ? value : data?.signature
  if (typeof proof === 'string' && /^[A-Za-z0-9+/]{87}=$/.test(proof)) return proof
  if (proof instanceof Uint8Array && proof.length === 65) return btoa(String.fromCharCode(...proof))
  throw new Error('This wallet did not return a native Zcash message-signing proof. It has not been connected.')
}
function publish() { const wallets = [...registry.values()]; listeners.forEach((listener) => listener(wallets)) }

// Wallet Standard defines discovery and account permission. zcash:signMessage is
// an optional provider-advertised capability, not a universal Zcash wallet API.
function registerStandard(...values: unknown[]) {
  const ids: string[] = []
  values.forEach((value) => {
    const wallet = object(value), features = object(wallet?.features)
    const connect = object(features?.['standard:connect']), sign = object(features?.['zcash:signMessage'])
    if (!wallet || typeof wallet.name !== 'string' || typeof connect?.connect !== 'function' || typeof sign?.signMessage !== 'function') return
    const id = 'standard:' + wallet.name
    ids.push(id)
    registry.set(id, { id, name: wallet.name,
      connect: async () => accounts(await (connect.connect as (options: { silent: boolean }) => Promise<unknown>).call(connect, { silent: false })),
      sign: async (selected, message) => signature(await (sign.signMessage as (input: unknown) => Promise<unknown>).call(sign, {
        account: selected.source, message: new TextEncoder().encode(message), signingAddress: selected.signingAddress,
      })),
    })
  })
  publish()
  return () => { ids.forEach((id) => registry.delete(id)); publish() }
}
function scanInjected() {
  const injection = object((window as unknown as ObjectValue).zcash)
  const providers = Array.isArray(injection?.providers) ? injection.providers : injection ? [injection] : []
  providers.forEach((value, index) => {
    const provider = object(value)
    if (!provider || typeof provider.requestAccounts !== 'function' || typeof provider.signMessage !== 'function') return
    const name = typeof provider.name === 'string' ? provider.name : 'Injected Zcash wallet'
    const id = 'injected:' + name + ':' + index
    registry.set(id, { id, name,
      connect: async () => accounts(await (provider.requestAccounts as (input: unknown) => Promise<unknown>).call(provider, { network: 'testnet' })),
      sign: async (selected, message) => signature(await (provider.signMessage as (input: unknown) => Promise<unknown>).call(provider, {
        network: 'testnet', account: selected.source, address: selected.signingAddress, message,
      })),
    })
  })
}
export function watchBrowserWallets(listener: (wallets: BrowserWallet[]) => void): () => void {
  if (typeof window === 'undefined') return () => undefined
  listeners = new Set([...listeners, listener])
  if (!listening) {
    window.addEventListener('wallet-standard:register-wallet', ((event: CustomEvent) => {
      if (typeof event.detail === 'function') event.detail({ register: registerStandard })
    }) as EventListener)
    listening = true
  }
  scanInjected()
  window.dispatchEvent(new CustomEvent('wallet-standard:app-ready', { detail: { register: registerStandard } }))
  publish()
  return () => { listeners = new Set([...listeners].filter((value) => value !== listener)) }
}
