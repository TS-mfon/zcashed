'use client'

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react'
import { Profile } from '@/lib/types'

interface WalletContextType {
  address: string | null
  profile: Profile | null
  role: string | null
  setAddress: (addr: string) => void
  clearWallet: () => void
  isConnected: boolean
  isLoading: boolean
  generateWallet: () => Promise<{ address: string; privateKeyHex: string } | null>
  refreshProfile: () => Promise<void>
  saveProfile: (data: Partial<Profile>) => Promise<Profile | null>
}

const WalletContext = createContext<WalletContextType | null>(null)
const STORAGE_KEY = 'zcashed_wallet_address'

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const [address, setAddressState] = useState<string | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  const fetchProfile = useCallback(async (addr: string) => {
    try {
      const res = await fetch(`/api/profile?address=${encodeURIComponent(addr)}`)
      const data = await res.json()
      setProfile(data.profile ?? null)
    } catch {
      setProfile(null)
    }
  }, [])

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored) {
      setAddressState(stored)
      fetchProfile(stored).finally(() => setIsLoading(false))
    } else {
      setIsLoading(false)
    }
  }, [fetchProfile])

  const setAddress = useCallback(
    (addr: string) => {
      setAddressState(addr)
      localStorage.setItem(STORAGE_KEY, addr)
      fetchProfile(addr)
    },
    [fetchProfile],
  )

  const clearWallet = useCallback(() => {
    setAddressState(null)
    setProfile(null)
    localStorage.removeItem(STORAGE_KEY)
  }, [])

  const generateWallet = useCallback(async () => {
    try {
      const res = await fetch('/api/wallet', { method: 'POST' })
      const data = await res.json()
      if (data.address) {
        setAddress(data.address)
        return data
      }
      return null
    } catch {
      return null
    }
  }, [setAddress])

  const refreshProfile = useCallback(async () => {
    if (address) await fetchProfile(address)
  }, [address, fetchProfile])

  const saveProfile = useCallback(
    async (data: Partial<Profile>) => {
      if (!address) return null
      try {
        const res = await fetch('/api/profile', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ address, ...data }),
        })
        const json = await res.json()
        if (json.profile) {
          setProfile(json.profile)
          return json.profile as Profile
        }
        return null
      } catch {
        return null
      }
    },
    [address],
  )

  return (
    <WalletContext.Provider
      value={{
        address,
        profile,
        role: profile?.role ?? null,
        setAddress,
        clearWallet,
        isConnected: !!address,
        isLoading,
        generateWallet,
        refreshProfile,
        saveProfile,
      }}
    >
      {children}
    </WalletContext.Provider>
  )
}

export function useWallet() {
  const ctx = useContext(WalletContext)
  if (!ctx) throw new Error('useWallet must be used within WalletProvider')
  return ctx
}
