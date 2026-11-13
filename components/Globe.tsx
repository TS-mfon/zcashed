'use client'

import { useEffect, useRef } from 'react'

/**
 * Yellow dot-matrix rotating globe rendered on canvas.
 * Pure 2D projection of points on a sphere — no external deps.
 */
export function Globe({ className, style }: { className?: string; style?: React.CSSProperties }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const cnv = canvasRef.current
    if (!cnv) return
    const cx = cnv.getContext('2d')
    if (!cx) return

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    let raf = 0
    let w = 0
    let h = 0
    const dpr = Math.min(window.devicePixelRatio || 1, 2)

    const N = 1100
    const points: { x: number; y: number; z: number }[] = []
    const golden = Math.PI * (3 - Math.sqrt(5))
    for (let i = 0; i < N; i++) {
      const y = 1 - (i / (N - 1)) * 2
      const r = Math.sqrt(1 - y * y)
      const theta = golden * i
      points.push({ x: Math.cos(theta) * r, y, z: Math.sin(theta) * r })
    }

    function resize() {
      const parent = cnv!.parentElement
      if (!parent) return
      w = parent.clientWidth
      h = parent.clientHeight
      cnv!.width = w * dpr
      cnv!.height = h * dpr
      cnv!.style.width = w + 'px'
      cnv!.style.height = h + 'px'
      cx!.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    resize()
    window.addEventListener('resize', resize)

    let angle = 0
    const tilt = -0.42

    function frame() {
      cx!.clearRect(0, 0, w, h)
      const centerX = w / 2
      const centerY = h / 2
      const radius = Math.min(w, h) * 0.42

      angle += reduced ? 0 : 0.0016
      const cosT = Math.cos(tilt)
      const sinT = Math.sin(tilt)

      for (const p of points) {
        const cosA = Math.cos(angle)
        const sinA = Math.sin(angle)
        const x = p.x * cosA - p.z * sinA
        const z = p.x * sinA + p.z * cosA
        let y = p.y
        const y2 = y * cosT - z * sinT
        const z2 = y * sinT + z * cosT
        y = y2
        const depth = (z2 + 1) / 2
        const px = centerX + x * radius
        const py = centerY + y * radius
        const size = 0.6 + depth * 1.9
        const alpha = 0.12 + depth * 0.78
        const gC = Math.round(150 + depth * 70)
        const bC = Math.round(depth * 30)
        cx!.beginPath()
        cx!.fillStyle = `rgba(245,${gC},${bC},${alpha})`
        cx!.arc(px, py, size, 0, Math.PI * 2)
        cx!.fill()
      }

      const grad = cx!.createRadialGradient(centerX, centerY, radius * 0.6, centerX, centerY, radius * 1.25)
      grad.addColorStop(0, 'rgba(245,184,0,0)')
      grad.addColorStop(1, 'rgba(245,184,0,0.06)')
      cx!.fillStyle = grad
      cx!.beginPath()
      cx!.arc(centerX, centerY, radius * 1.25, 0, Math.PI * 2)
      cx!.fill()

      raf = requestAnimationFrame(frame)
    }
    frame()

    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', resize)
    }
  }, [])

  return <canvas ref={canvasRef} className={className} style={style} aria-hidden="true" />
}
