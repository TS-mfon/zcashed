import type { Metadata } from 'next'
import { Geist, Geist_Mono } from 'next/font/google'
import './globals.css'
import { WalletProvider } from '@/components/WalletContext'
import { Navbar } from '@/components/Navbar'

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
})

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
})

export const metadata: Metadata = {
  title: 'ZCashed — AI-Judged Private Freelance Payments',
  description:
    'Hire talent and pay privately with Zcash. AI judges work completion — no middlemen, no exposed payments.',
  icons: {
    icon: '/favicon.ico',
  },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable}`}>
      <body className="min-h-screen flex flex-col antialiased" style={{ background: 'var(--bg)', color: 'var(--text)' }}>
        <WalletProvider>
          <Navbar />
          <main className="flex-1">{children}</main>
          <footer
            style={{ borderTop: '1px solid var(--border)' }}
            className="py-6 text-center text-sm"
          >
            <span style={{ color: 'var(--muted)' }}>
              ZCashed © 2024 — Powered by{' '}
              <a
                href="https://www.genlayer.com"
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: 'var(--primary)' }}
                className="hover:underline"
              >
                GenLayer
              </a>{' '}
              &{' '}
              <a
                href="https://z.cash"
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: 'var(--gold)' }}
                className="hover:underline"
              >
                Zcash
              </a>
            </span>
          </footer>
        </WalletProvider>
      </body>
    </html>
  )
}
