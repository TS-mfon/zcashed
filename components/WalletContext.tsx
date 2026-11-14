'use client'

import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react'
import { Profile } from '@/lib/types'
import { ZcashNetwork } from '@/lib/zcash'

interface WalletConnection {
  address: string
  walletAddress: string
  network: ZcashNetwork
}

export interface WalletChallenge {
  message: string
  challengeToken: string
  expiresAt?: string
}

interface WalletState {
  address: string | null
  walletAddress: string | null
  network: ZcashNetwork | null
  profile: Profile | null
  isLoading: boolean
  error: string
}

interface WalletContextType extends WalletState {
  role: string | null
  clearWallet: () => Promise<void>
  isConnected: boolean
  beginConnection: (walletAddress: string) => Promise<WalletChallenge | null>
  verifyConnection: (challengeToken: string, signature: string) => Promise<WalletConnection | null>
  refreshProfile: () => Promise<void>
  saveProfile: (data: Partial<Profile>) => Promise<Profile | null>
}

const WalletContext = createContext<WalletContextType | null>(null)
const emptyState: WalletState = { address: null, walletAddress: null, network: null, profile: null, isLoading: false, error: '' }
const message = (cause: unknown) => cause instanceof Error ? cause.message : 'The wallet session could not be updated.'

function readConnection(data: Record<string, unknown>): WalletConnection | null {
  if (data.address === null) return null
  if (typeof data.address !== 'string' || !data.address || typeof data.walletAddress !== 'string' || !data.walletAddress
    || (data.network !== 'mainnet' && data.network !== 'testnet')) throw new Error('The server returned an invalid wallet session.')
  return { address: data.address, walletAddress: data.walletAddress, network: data.network }
}

async function fetchProfile(address: string): Promise<Profile | null> {
  const response = await fetch('/api/profile', { cache: 'no-store', credentials: 'same-origin' })
  const data = await response.json()
  if (!response.ok) throw new Error(data.error ?? 'Could not load your profile.')
  if (data.profile && data.profile.address !== address) throw new Error('The profile does not match the verified wallet session.')
  return data.profile ?? null
}

async function resolveProfile(address: string): Promise<{ profile: Profile | null; error: string }> {
  try { return { profile: await fetchProfile(address), error: '' } }
  catch (cause) { return { profile: null, error: message(cause) } }
}

export function WalletProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<WalletState>({ ...emptyState, isLoading: true })

  useEffect(() => {
    let cancelled = false
    async function restore() {
      try {
        const response = await fetch('/api/session', { cache: 'no-store', credentials: 'same-origin' })
        const data = await response.json()
        if (!response.ok) throw new Error(data.error ?? 'Could not restore your wallet session.')
        const connection = readConnection(data)
        const profileState = connection ? await resolveProfile(connection.address) : null
        if (!cancelled) setState(connection && profileState ? { ...connection, ...profileState, isLoading: false } : { ...emptyState })
      } catch (cause) {
        if (!cancelled) setState({ ...emptyState, error: message(cause) })
      }
    }
    void restore()
    return () => { cancelled = true }
  }, [])

  const beginConnection = useCallback(async (walletAddress: string) => {
    setState((current) => ({ ...current, isLoading: true, error: '' }))
    try {
      const response = await fetch('/api/auth/challenge', {
        method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ walletAddress }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error ?? 'Could not request a wallet ownership challenge.')
      if (typeof data.message !== 'string' || !data.message || typeof data.challengeToken !== 'string' || !data.challengeToken) throw new Error('The server returned an invalid ownership challenge.')
      setState((current) => ({ ...current, isLoading: false }))
      return { message: data.message, challengeToken: data.challengeToken, expiresAt: typeof data.expiresAt === 'string' ? data.expiresAt : undefined }
    } catch (cause) {
      setState((current) => ({ ...current, isLoading: false, error: message(cause) }))
      return null
    }
  }, [])

  const verifyConnection = useCallback(async (challengeToken: string, signature: string) => {
    setState((current) => ({ ...current, isLoading: true, error: '' }))
    try {
      const response = await fetch('/api/session', {
        method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ challengeToken, signature }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error ?? 'The wallet signature could not be verified.')
      const connection = readConnection(data)
      if (!connection) throw new Error('The wallet signature did not establish a session.')
      const profileState = await resolveProfile(connection.address)
      setState({ ...connection, ...profileState, isLoading: false })
      return connection
    } catch (cause) {
      setState((current) => ({ ...current, isLoading: false, error: message(cause) }))
      return null
    }
  }, [])

  const clearWallet = useCallback(async () => {
    setState((current) => ({ ...current, isLoading: true, error: '' }))
    try {
      const response = await fetch('/api/session', { method: 'DELETE', credentials: 'same-origin' })
      if (!response.ok) throw new Error('Could not disconnect the wallet session. Please try again.')
      setState({ ...emptyState })
    } catch (cause) {
      setState((current) => ({ ...current, isLoading: false, error: message(cause) }))
    }
  }, [])

  const refreshProfile = useCallback(async () => {
    if (!state.address) return
    try {
      const profile = await fetchProfile(state.address)
      setState((current) => current.address === state.address ? { ...current, profile, error: '' } : current)
    } catch (cause) {
      setState((current) => ({ ...current, error: message(cause) }))
    }
  }, [state.address])

  const saveProfile = useCallback(async (data: Partial<Profile>) => {
    try {
      const response = await fetch('/api/profile', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ displayName: data.displayName, role: data.role, bio: data.bio, skills: data.skills }),
      })
      const json = await response.json()
      if (!response.ok || !json.profile) throw new Error(json.error ?? 'Could not save your profile.')
      const profile = json.profile as Profile
      setState((current) => current.address === profile.address ? { ...current, profile, error: '' } : current)
      return profile
    } catch (cause) {
      setState((current) => ({ ...current, error: message(cause) }))
      return null
    }
  }, [])

  return <WalletContext.Provider value={{
    ...state,
    role: state.profile?.role ?? null,
    clearWallet,
    isConnected: !!state.address && !!state.walletAddress,
    beginConnection,
    verifyConnection,
    refreshProfile,
    saveProfile,
  }}>{children}</WalletContext.Provider>
}

export function useWallet() {
  const context = useContext(WalletContext)
  if (!context) throw new Error('useWallet must be used within WalletProvider')
  return context
}
