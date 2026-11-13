'use client'

import { useEffect, useRef, useState } from 'react'

type Variant = 'up' | 'scale' | 'left' | 'right'

const classMap: Record<Variant, string> = {
  up: 'reveal',
  scale: 'reveal-scale',
  left: 'reveal-left',
  right: 'reveal-right',
}

export function Reveal({
  children,
  variant = 'up',
  delay = 0,
  className = '',
  style,
}: {
  children: React.ReactNode
  variant?: Variant
  delay?: number
  className?: string
  style?: React.CSSProperties
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [inView, setInView] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const obs = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setInView(true)
          obs.disconnect()
        }
      },
      { threshold: 0.15 },
    )
    obs.observe(el)
    return () => obs.disconnect()
  }, [])

  return (
    <div
      ref={ref}
      className={`${classMap[variant]} ${inView ? 'in' : ''} ${className}`}
      style={{ transitionDelay: `${delay}ms`, ...style }}
    >
      {children}
    </div>
  )
}
