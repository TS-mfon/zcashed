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
              {['AI-Judged Escrow', 'Shielded Payments', 'No Arbitrators', 'Trustless', 'GenLayer Powered', 'Private by Default', 'Instant Settlement'].map((t) => (
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
                Freelancing, <span className="gradient-text">reimagined</span>
              </h2>
              <p style={{ color: 'var(--muted-2)', fontSize: 17, maxWidth: 520, margin: '0 auto' }}>
                Three problems with Web3 work, solved in one platform.
              </p>
            </div>
          </Reveal>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {[
              { icon: Brain, title: 'AI is the judge', desc: 'GenLayer Intelligent Contracts use LLM validator consensus to decide if work meets the brief. Objective, instant, no disputes.' },
              { icon: Shield, title: 'Payments stay private', desc: 'Every settlement runs through Zcash shielded transactions. Nobody sees who paid whom, how much, or for what.' },
              { icon: Lock, title: 'Escrow from day one', desc: 'ZEC is locked before work begins. Funds release automatically the moment AI approves — no running off with deposits.' },
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
              <p style={{ color: 'var(--muted-2)', fontSize: 16 }}>From brief to private payout in four steps.</p>
            </div>
          </Reveal>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
            {[
              { n: '01', t: 'Post & fund escrow', d: 'Describe the task and deposit ZEC into the job’s shielded escrow address.' },
              { n: '02', t: 'Assign or get applications', d: 'Choose direct assignment or review applicants and pick your freelancer.' },
              { n: '03', t: 'Submit to the AI', d: 'The freelancer submits work. GenLayer validators evaluate it against your brief in seconds.' },
              { n: '04', t: 'Instant private payout', d: 'If approved, ZEC releases to the freelancer’s shielded address. If not, they get feedback and resubmit.' },
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
              Start in under a minute
            </h2>
            <p style={{ color: 'var(--muted-2)', fontSize: 16, marginBottom: 32, maxWidth: 440, margin: '0 auto 32px' }}>
              Generate a Zcash testnet wallet, claim free ZEC, and post or find work.
            </p>
            <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
              <Link href="/onboarding" className="btn btn-primary" style={{ fontSize: 15, padding: '13px 30px' }}>
                Create Wallet <ArrowRight size={16} />
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
