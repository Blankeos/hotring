// One full-screen canvas particle system: sparks, streaks, stars, shockwaves,
// confetti and ambient motes. Pooled, capped, DPR-aware, sleeps when idle.
import { reduced } from './dom'
import { rgbOf } from './palette'

const MAX = 600
const SPARK = 0
const STREAK = 1
const CONFETTI = 2
const RING = 3
const STAR = 4
const MOTE = 5

interface P {
  k: number
  x: number
  y: number
  vx: number
  vy: number
  g: number
  drag: number
  t: number
  life: number
  s: number
  s2: number
  c: string
  rot: number
  vr: number
  a: number
  ph: number
}

const blank = (): P => ({ k: 0, x: 0, y: 0, vx: 0, vy: 0, g: 0, drag: 0, t: 0, life: 1, s: 1, s2: 0, c: '#fff', rot: 0, vr: 0, a: 1, ph: 0 })

type Range = [number, number]
const r = (v: Range | number) => (typeof v === 'number' ? v : v[0] + Math.random() * (v[1] - v[0]))

export interface BurstOpts {
  colors: string[]
  n?: number
  speed?: Range
  size?: Range
  life?: Range
  g?: number
  drag?: number
  angle?: number // direction (rad), default: all around
  spread?: number // rad around angle
  radius?: number // spawn offset from origin
  streak?: number // 0..1 share of streaks
}

export type Hook = (dt: number) => boolean | void

export class Fx {
  private ctx: CanvasRenderingContext2D
  private ps: P[] = []
  private free: P[] = []
  private hooks = new Set<Hook>()
  private raf = 0
  private last = 0
  private dpr = 1
  private sprites = new Map<string, HTMLCanvasElement>()
  private ambient = false
  private ambAcc = 0
  w = 0
  h = 0

  constructor(private cv: HTMLCanvasElement) {
    this.ctx = cv.getContext('2d')!
    for (let i = 0; i < MAX; i++) this.free.push(blank())
    this.resize()
  }

  resize() {
    this.dpr = Math.min(2, window.devicePixelRatio || 1)
    this.w = innerWidth
    this.h = innerHeight
    this.cv.width = Math.round(this.w * this.dpr)
    this.cv.height = Math.round(this.h * this.dpr)
    this.cv.style.width = this.w + 'px'
    this.cv.style.height = this.h + 'px'
  }

  private n(n: number) {
    return reduced ? Math.max(1, Math.ceil(n * 0.3)) : n
  }

  private get(): P | null {
    const p = this.free.pop()
    if (!p) return null
    p.t = 0
    p.rot = 0
    p.vr = 0
    p.a = 1
    p.ph = 0
    p.s2 = 0
    this.ps.push(p)
    this.wake()
    return p
  }

  private wake() {
    if (this.raf) return
    this.last = performance.now()
    this.raf = requestAnimationFrame(this.frame)
  }

  /** One glowing spark. Velocities in px/s. */
  spark(x: number, y: number, vx: number, vy: number, c: string, s: number, life: number, g = 0, drag = 2) {
    const p = this.get()
    if (!p) return
    Object.assign(p, { k: SPARK, x, y, vx, vy, c, s, life, g, drag })
  }

  burst(x: number, y: number, o: BurstOpts) {
    const n = this.n(o.n ?? 24)
    for (let i = 0; i < n; i++) {
      const p = this.get()
      if (!p) return
      const ang = o.angle === undefined ? Math.random() * Math.PI * 2 : o.angle + (Math.random() - 0.5) * (o.spread ?? 1)
      const sp = r(o.speed ?? [120, 420])
      const off = o.radius ? Math.random() * o.radius : 0
      p.k = Math.random() < (o.streak ?? 0) ? STREAK : SPARK
      p.x = x + Math.cos(ang) * off
      p.y = y + Math.sin(ang) * off
      p.vx = Math.cos(ang) * sp
      p.vy = Math.sin(ang) * sp
      p.g = o.g ?? 260
      p.drag = o.drag ?? 2.6
      p.life = r(o.life ?? [0.45, 0.9])
      p.s = r(o.size ?? [2, 4.5])
      p.c = o.colors[i % o.colors.length]!
    }
  }

  /** Twinkling four-point stars scattered around a point or along a rect. */
  stars(x: number, y: number, o: { colors: string[]; n?: number; radius?: number; size?: Range; life?: Range; w?: number; h?: number }) {
    const n = this.n(o.n ?? 8)
    for (let i = 0; i < n; i++) {
      const p = this.get()
      if (!p) return
      p.k = STAR
      if (o.w && o.h) {
        // Along the perimeter of a w*h rect centred on x,y.
        const per = 2 * (o.w + o.h)
        let d = Math.random() * per
        let px: number, py: number
        if (d < o.w) [px, py] = [d - o.w / 2, -o.h / 2]
        else if ((d -= o.w) < o.h) [px, py] = [o.w / 2, d - o.h / 2]
        else if ((d -= o.h) < o.w) [px, py] = [o.w / 2 - d, o.h / 2]
        else [px, py] = [-o.w / 2, o.h / 2 - (d - o.w)]
        p.x = x + px * 1.08
        p.y = y + py * 1.08
      } else {
        const a = Math.random() * Math.PI * 2
        const d = Math.sqrt(Math.random()) * (o.radius ?? 30)
        p.x = x + Math.cos(a) * d
        p.y = y + Math.sin(a) * d
      }
      p.vx = (Math.random() - 0.5) * 30
      p.vy = -10 - Math.random() * 30
      p.g = 0
      p.drag = 1
      p.life = r(o.life ?? [0.5, 1.1])
      p.s = r(o.size ?? [5, 11])
      p.rot = Math.random() * 0.6
      p.vr = (Math.random() - 0.5) * 3
      p.c = o.colors[i % o.colors.length]!
    }
  }

  shock(x: number, y: number, c: string, radius: number, life = 0.6, width = 6) {
    const p = this.get()
    if (!p) return
    Object.assign(p, { k: RING, x, y, vx: 0, vy: 0, g: 0, drag: 0, c, s: radius, s2: width, life })
  }

  /** Confetti rain from the top edge for `ms`. */
  confetti(colors: string[], ms: number) {
    let left = ms / 1000
    const rate = reduced ? 22 : 95
    let acc = 0
    this.hook((dt) => {
      left -= dt
      acc += dt * rate
      while (acc >= 1) {
        acc--
        const p = this.get()
        if (!p) break
        p.k = CONFETTI
        p.x = Math.random() * this.w
        p.y = -16
        p.vx = (Math.random() - 0.5) * 80
        p.vy = 60 + Math.random() * 140
        p.g = 140
        p.drag = 1.1
        p.life = 3.2 + Math.random() * 1.8
        p.s = 6 + Math.random() * 5
        p.s2 = 9 + Math.random() * 7
        p.rot = Math.random() * Math.PI
        p.vr = (Math.random() - 0.5) * 10
        p.ph = Math.random() * 6.28
        p.c = colors[Math.floor(Math.random() * colors.length)]!
      }
      return left > 0
    })
  }

  /** A glowing comet that flies from a to b along a soft arc. */
  comet(ax: number, ay: number, bx: number, by: number, c: string, ms = 300, done?: () => void) {
    let t = 0
    const dur = ms / 1000
    const mx = (ax + bx) / 2 + (ay - by) * 0.25
    const my = (ay + by) / 2 + (bx - ax) * 0.25
    this.hook((dt) => {
      t = Math.min(1, t + dt / dur)
      const e = 1 - (1 - t) ** 2
      const u = 1 - e
      const x = u * u * ax + 2 * u * e * mx + e * e * bx
      const y = u * u * ay + 2 * u * e * my + e * e * by
      for (let i = 0; i < (reduced ? 1 : 3); i++)
        this.spark(x, y, (Math.random() - 0.5) * 60, (Math.random() - 0.5) * 60, i ? c : '#fff', 2 + Math.random() * 2.5, 0.25 + Math.random() * 0.2, 0, 3)
      if (t >= 1) {
        done?.()
        return false
      }
      return true
    })
  }

  setAmbient(on: boolean) {
    this.ambient = on
    if (on) this.wake()
  }

  /** Run fn every frame until it returns false. Returns an unsubscribe. */
  hook(fn: Hook) {
    this.hooks.add(fn)
    this.wake()
    return () => this.hooks.delete(fn)
  }

  private sprite(c: string) {
    let s = this.sprites.get(c)
    if (s) return s
    s = document.createElement('canvas')
    s.width = s.height = 64
    const g = s.getContext('2d')!
    const [R, G, B] = rgbOf(c)
    // A soft glow dot (particle glow only, never a surface).
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32)
    grad.addColorStop(0, `rgba(255,255,255,1)`)
    grad.addColorStop(0.12, `rgba(${R},${G},${B},1)`)
    grad.addColorStop(0.35, `rgba(${R},${G},${B},.45)`)
    grad.addColorStop(1, `rgba(${R},${G},${B},0)`)
    g.fillStyle = grad
    g.fillRect(0, 0, 64, 64)
    this.sprites.set(c, s)
    return s
  }

  private frame = (now: number) => {
    const dt = Math.min(0.05, (now - this.last) / 1000)
    this.last = now
    for (const h of this.hooks) if (h(dt) === false) this.hooks.delete(h)

    if (this.ambient) {
      this.ambAcc += dt * (reduced ? 2 : 7)
      while (this.ambAcc >= 1) {
        this.ambAcc--
        const p = this.get()
        if (!p) break
        p.k = MOTE
        p.x = Math.random() * this.w
        p.y = this.h * (0.15 + Math.random() * 0.85)
        p.vx = (Math.random() - 0.5) * 12
        p.vy = -8 - Math.random() * 18
        p.g = 0
        p.drag = 0
        p.life = 4 + Math.random() * 4
        p.s = 1.5 + Math.random() * 2.5
        p.ph = Math.random() * 6.28
        p.c = Math.random() < 0.7 ? '#F3ECDD' : Math.random() < 0.5 ? '#FFC94D' : '#5CC8FF'
      }
    }

    const ctx = this.ctx
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0)
    ctx.clearRect(0, 0, this.w, this.h)

    // update
    const ps = this.ps
    for (let i = ps.length - 1; i >= 0; i--) {
      const p = ps[i]!
      p.t += dt
      if (p.t >= p.life || p.y > this.h + 40) {
        ps[i] = ps[ps.length - 1]!
        ps.pop()
        this.free.push(p)
        continue
      }
      if (p.drag) {
        const d = Math.exp(-p.drag * dt)
        p.vx *= d
        p.vy *= d
      }
      p.vy += p.g * dt
      p.x += p.vx * dt
      p.y += p.vy * dt
      p.rot += p.vr * dt
      if (p.k === CONFETTI) p.x += Math.sin(p.ph + p.t * 5) * 40 * dt
    }

    // confetti: normal blending
    ctx.globalCompositeOperation = 'source-over'
    for (const p of ps) {
      if (p.k !== CONFETTI) continue
      const fade = Math.min(1, (p.life - p.t) * 2)
      ctx.globalAlpha = fade
      ctx.fillStyle = p.c
      const flip = Math.abs(Math.cos(p.ph + p.t * 7))
      ctx.save()
      ctx.translate(p.x, p.y)
      ctx.rotate(p.rot)
      ctx.fillRect(-p.s / 2, (-p.s2 * flip) / 2, p.s, p.s2 * flip + 0.5)
      ctx.restore()
    }

    // glowy stuff: additive
    ctx.globalCompositeOperation = 'lighter'
    for (const p of ps) {
      const q = p.t / p.life
      switch (p.k) {
        case SPARK: {
          const s = p.s * (1 - q * 0.7) * 3
          ctx.globalAlpha = 1 - q * q
          ctx.drawImage(this.sprite(p.c), p.x - s, p.y - s, s * 2, s * 2)
          break
        }
        case STREAK: {
          ctx.globalAlpha = 1 - q
          ctx.strokeStyle = p.c
          ctx.lineWidth = p.s * (1 - q * 0.6)
          ctx.lineCap = 'round'
          ctx.beginPath()
          ctx.moveTo(p.x, p.y)
          ctx.lineTo(p.x - p.vx * 0.045, p.y - p.vy * 0.045)
          ctx.stroke()
          break
        }
        case RING: {
          const e = 1 - (1 - q) ** 3
          ctx.globalAlpha = (1 - q) * 0.9
          ctx.strokeStyle = p.c
          ctx.lineWidth = Math.max(0.5, p.s2 * (1 - q))
          ctx.beginPath()
          ctx.arc(p.x, p.y, Math.max(1, p.s * e), 0, Math.PI * 2)
          ctx.stroke()
          break
        }
        case STAR: {
          const s = p.s * Math.sin(Math.PI * Math.min(1, q * 1.1))
          if (s <= 0.2) break
          ctx.globalAlpha = 1
          ctx.fillStyle = p.c
          ctx.save()
          ctx.translate(p.x, p.y)
          ctx.rotate(p.rot)
          ctx.beginPath()
          const k = s * 0.22
          ctx.moveTo(0, -s)
          ctx.quadraticCurveTo(k, -k, s, 0)
          ctx.quadraticCurveTo(k, k, 0, s)
          ctx.quadraticCurveTo(-k, k, -s, 0)
          ctx.quadraticCurveTo(-k, -k, 0, -s)
          ctx.fill()
          ctx.restore()
          break
        }
        case MOTE: {
          const s = p.s * 2.4
          ctx.globalAlpha = Math.sin(Math.PI * q) * (0.35 + 0.25 * Math.sin(p.ph + p.t * 3))
          ctx.drawImage(this.sprite(p.c), p.x - s, p.y - s, s * 2, s * 2)
          break
        }
      }
    }
    ctx.globalAlpha = 1
    ctx.globalCompositeOperation = 'source-over'

    if (ps.length || this.hooks.size || this.ambient) this.raf = requestAnimationFrame(this.frame)
    else {
      this.raf = 0
      ctx.clearRect(0, 0, this.w, this.h)
    }
  }
}
