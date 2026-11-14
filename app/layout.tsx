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
  title: 'ZCashed — Work Acceptance and Shielded Testnet Vaults',
  description:
    'Fund public freelance tasks, evaluate delivered text with GenLayer, and explicitly claim shielded Zcash testnet payouts through an operator vault.',
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
              ZCashed © 2026 — Built with{' '}
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
