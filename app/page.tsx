import Link from 'next/link'
import { Brain, Shield, Lock, Users, Send, CheckCircle2, ArrowRight } from 'lucide-react'
import { HeroClient } from '@/components/HeroClient'
import { Reveal } from '@/components/Reveal'

export default function HomePage() {
  return (
    <div>
      <HeroClient />

      {/* Trust marquee */}
      <section style={{ borderTop: '1px solid var(--border)', borderBottom: '1px solid var(--border)', padding: '18px 0', overflow: 'hidden', background: 'var(--surface-2)' }}>
        <div className="marquee-track">
          {[...Array(2)].map((_, dup) => (
            <div key={dup} style={{ display: 'flex', gap: 48, paddingRight: 48, whiteSpace: 'nowrap' }}>
              {['Frozen acceptance criteria', 'Verified testnet funding', 'Three review attempts', 'Explicit worker claims', 'Operator-custodied vault', 'Public work briefs', 'Shielded payouts'].map((t) => (
                <span key={t} style={{ fontSize: 14, fontWeight: 600, color: 'var(--muted-2)', display: 'flex', alignItems: 'center', gap: 48 }}>
                  {t} <span style={{ color: 'var(--primary)' }}>✦</span>
                </span>
              ))}
            </div>
          ))}
        </div>
      </section>

      {/* Features */}
      <section style={{ padding: '100px 16px' }}>
        <div className="max-w-6xl mx-auto">
          <Reveal>
            <div className="text-center" style={{ marginBottom: 60 }}>
              <h2 style={{ fontSize: 'clamp(30px,5vw,44px)', fontWeight: 800, marginBottom: 14, letterSpacing: '-0.02em' }}>
                Make work acceptance <span className="gradient-text">explicit</span>
              </h2>
              <p style={{ color: 'var(--muted-2)', fontSize: 17, maxWidth: 520, margin: '0 auto' }}>
                A funded offer, useful feedback, and a clear claim path.
              </p>
            </div>
          </Reveal>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {[
              { icon: Brain, title: 'Review each criterion', desc: 'GenLayer evaluates the actual text against a frozen public rubric. Read specific feedback and revise within a three-review limit. Studio is a development environment.' },
              { icon: Shield, title: 'Fund before work starts', desc: 'The job opens after the operator wallet verifies the exact testnet deposit and memo. Shielded transfers hide payment fields on chain; briefs, offers, and deposit requests remain public.' },
              { icon: Lock, title: 'Claim after acceptance', desc: 'The accepted worker explicitly requests a payout. An existing operator Zallet wallet signs it, and matching wallet confirmation completes the job. This vault uses operator custody.' },
            ].map((f, i) => (
              <Reveal key={f.title} variant="up" delay={i * 120}>
                <div className="card" style={{ padding: 32, height: '100%' }}>
                  <div
                    style={{
                      width: 52, height: 52, borderRadius: 13,
                      background: 'linear-gradient(135deg, var(--primary), #ffd94d)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 20,
                      boxShadow: '0 6px 18px var(--primary-glow)',
                    }}
                  >
                    <f.icon size={25} color="#1a1500" />
                  </div>
                  <h3 style={{ fontSize: 19, fontWeight: 700, marginBottom: 10 }}>{f.title}</h3>
                  <p style={{ color: 'var(--muted-2)', fontSize: 14.5, lineHeight: 1.7 }}>{f.desc}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* Two modes */}
      <section style={{ padding: '80px 16px', background: 'var(--surface-2)', borderTop: '1px solid var(--border)', borderBottom: '1px solid var(--border)' }}>
        <div className="max-w-6xl mx-auto">
          <Reveal>
            <div className="text-center" style={{ marginBottom: 56 }}>
              <h2 style={{ fontSize: 'clamp(28px,5vw,40px)', fontWeight: 800, marginBottom: 12 }}>Two ways to hire</h2>
              <p style={{ color: 'var(--muted-2)', fontSize: 16 }}>Pick the flow that fits your job.</p>
            </div>
          </Reveal>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <Reveal variant="left">
              <div className="card" style={{ padding: 36, height: '100%' }}>
                <Send size={28} color="var(--primary-dark)" style={{ marginBottom: 16 }} />
                <h3 style={{ fontSize: 22, fontWeight: 700, marginBottom: 10 }}>Direct Assignment</h3>
                <p style={{ color: 'var(--muted-2)', fontSize: 15, lineHeight: 1.7, marginBottom: 16 }}>
                  Post a job and let the first qualified freelancer accept it instantly. Best for simple, well-defined tasks you want done fast.
                </p>
                <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {['First-come, first-served', 'Zero back-and-forth', 'Instant start'].map((x) => (
                    <li key={x} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, color: 'var(--text)' }}>
                      <CheckCircle2 size={16} color="var(--primary)" /> {x}
                    </li>
                  ))}
                </ul>
              </div>
            </Reveal>
            <Reveal variant="right">
              <div className="card" style={{ padding: 36, height: '100%' }}>
                <Users size={28} color="var(--primary-dark)" style={{ marginBottom: 16 }} />
                <h3 style={{ fontSize: 22, fontWeight: 700, marginBottom: 10 }}>Application-Based</h3>
                <p style={{ color: 'var(--muted-2)', fontSize: 15, lineHeight: 1.7, marginBottom: 16 }}>
                  Freelancers apply with a pitch and their price. You review applicants and hand-pick the best fit. Best for high-value or creative work.
                </p>
                <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {['Review every applicant', 'Compare proposals & pricing', 'Choose who you trust'].map((x) => (
                    <li key={x} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, color: 'var(--text)' }}>
                      <CheckCircle2 size={16} color="var(--primary)" /> {x}
                    </li>
                  ))}
                </ul>
              </div>
            </Reveal>
          </div>
        </div>
      </section>

      {/* How it works */}
      <section style={{ padding: '100px 16px' }}>
        <div className="max-w-4xl mx-auto">
          <Reveal>
            <div className="text-center" style={{ marginBottom: 60 }}>
              <h2 style={{ fontSize: 'clamp(28px,5vw,40px)', fontWeight: 800, marginBottom: 12 }}>How it works</h2>
              <p style={{ color: 'var(--muted-2)', fontSize: 16 }}>From a funded brief to an accepted, confirmed payout.</p>
            </div>
          </Reveal>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
            {[
              { n: '01', t: 'Post and fund the brief', d: 'Define public criteria and an exact budget. Fund the reserved testnet vault request from your wallet; work starts after verified confirmation.' },
              { n: '02', t: 'Assign or get applications', d: 'Choose direct assignment or review applicants and pick your freelancer.' },
              { n: '03', t: 'Review, then revise if needed', d: 'Paste the actual deliverable. GenLayer reviews each criterion; linked pages are not fetched. There are three successful reviews, with a final nonpassing result closing the job.' },
              { n: '04', t: 'Request the shielded payout', d: 'Accepted workers claim through the operator wallet. Rejected or cancelled funded jobs allow a client refund request. Transfers complete only after matching wallet confirmation.' },
            ].map((s, i) => (
              <Reveal key={s.n} delay={i * 80}>
                <div className="card" style={{ padding: '24px 28px', display: 'flex', gap: 20, alignItems: 'center' }}>
                  <div
                    style={{
                      fontSize: 24, fontWeight: 800, color: 'var(--primary)', fontFamily: 'var(--font-geist-mono)',
                      minWidth: 48,
                    }}
                  >
                    {s.n}
                  </div>
                  <div>
                    <h3 style={{ fontSize: 18, fontWeight: 700, marginBottom: 4 }}>{s.t}</h3>
                    <p style={{ color: 'var(--muted-2)', fontSize: 14.5, lineHeight: 1.6 }}>{s.d}</p>
                  </div>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section style={{ padding: '40px 16px 110px' }}>
        <Reveal variant="scale">
          <div
            className="max-w-3xl mx-auto text-center"
            style={{
              padding: '64px 40px',
              borderRadius: 24,
              background: 'linear-gradient(135deg, #fff7d6 0%, #ffffff 100%)',
              border: '1px solid var(--border-2)',
              boxShadow: '0 20px 60px var(--primary-glow)',
            }}
          >
            <div style={{ fontSize: 52, marginBottom: 16 }}>⚡</div>
            <h2 style={{ fontSize: 'clamp(28px,5vw,40px)', fontWeight: 800, marginBottom: 12 }}>
              Start with a clear brief
            </h2>
            <p style={{ color: 'var(--muted-2)', fontSize: 16, marginBottom: 32, maxWidth: 440, margin: '0 auto 32px' }}>
              Connect your existing wallet by signing a challenge. Fund a public testnet task or find work with clear acceptance criteria.
            </p>
            <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
              <Link href="/onboarding" className="btn btn-primary" style={{ fontSize: 15, padding: '13px 30px' }}>
                Connect Wallet <ArrowRight size={16} />
              </Link>
              <Link href="/jobs" className="btn btn-dark" style={{ fontSize: 15, padding: '13px 30px' }}>
                Browse Jobs
              </Link>
            </div>
          </div>
        </Reveal>
      </section>
    </div>
  )
}
