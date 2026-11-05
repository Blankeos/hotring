// The ring of letters: 20 round tiles laid out clockwise from 12 o'clock on a
// flat donut band. Owns tile state/animation; the server snapshot is the truth.
import { E, anim, h, reduced } from './dom'
import type { Fx } from './fx'
import { CREAM } from './palette'

export type RingMode = 'idle' | 'calm' | 'recede' | 'play' | 'dim'

export interface Slot {
  ch: string
  i: number
  el: HTMLDivElement
  tile: HTMLButtonElement
  face: HTMLSpanElement
  used: boolean
  hold: number // ignore server state for this slot until (optimistic tap)
  x: number
  y: number
}

export class Ring {
  el: HTMLDivElement
  center: HTMLDivElement
  private band: HTMLDivElement
  private lit: HTMLDivElement
  private slots: Slot[] = []
  private by = new Map<string, Slot>()
  cx = 0
  cy = 0
  size = 0
  d = 0
  R = 0
  onTap: (s: Slot) => void = () => {}

  constructor(parent: HTMLElement, private fx: Fx) {
    this.el = h('div', '', parent)
    this.el.id = 'ring'
    this.band = h('div', 'band', this.el)
    this.lit = h('div', 'band lit', this.el)
    this.center = h('div', '', this.el)
    this.center.id = 'center'
  }

  private build(chs: string[]) {
    for (const s of this.slots) s.el.remove()
    this.slots = []
    this.by.clear()
    chs.forEach((ch, i) => {
      const el = h('div', 'slot', this.el)
      el.style.setProperty('--i', String(i))
      h('div', 'hollow', el)
      const tile = h('button', 'tile', el)
      tile.type = 'button'
      tile.setAttribute('aria-label', ch)
      const face = h('span', 'face', tile)
      face.textContent = ch
      const s: Slot = { ch, i, el, tile, face, used: false, hold: 0, x: 0, y: 0 }
      tile.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return
        e.preventDefault()
        this.onTap(s)
      })
      tile.addEventListener('click', (e) => {
        if (e.detail === 0) this.onTap(s) // keyboard activation
      })
      this.slots.push(s)
      this.by.set(ch, s)
    })
    this.el.insertBefore(this.center, null)
    if (this.size) this.layout(this.cx, this.cy, this.size, this.d)
  }

  layout(cx: number, cy: number, size: number, d: number) {
    Object.assign(this, { cx, cy, size, d })
    const st = this.el.style
    st.left = cx - size / 2 + 'px'
    st.top = cy - size / 2 + 'px'
    st.width = st.height = size + 'px'
    st.setProperty('--d', d + 'px')
    const R = (this.R = size / 2 - d / 2 - 2)
    const n = this.slots.length
    for (const s of this.slots) {
      const a = -Math.PI / 2 + (s.i * Math.PI * 2) / n
      s.x = size / 2 + R * Math.cos(a)
      s.y = size / 2 + R * Math.sin(a)
      s.el.style.left = s.x - d / 2 + 'px'
      s.el.style.top = s.y - d / 2 + 'px'
      s.el.style.width = s.el.style.height = d + 'px'
    }
    const bw = d + 12
    for (const b of [this.band, this.lit]) {
      b.style.width = b.style.height = 2 * R + bw + 'px'
      b.style.left = b.style.top = size / 2 - R - bw / 2 + 'px'
      b.style.borderWidth = bw + 'px'
    }
    const inner = 2 * R - d - 16
    const c = this.center.style
    c.width = c.height = inner + 'px'
    c.left = c.top = size / 2 - inner / 2 + 'px'
    st.setProperty('--inner', inner + 'px')
  }

  /** Page coordinates of a letter's centre (ignores the recede transform on purpose). */
  pos(ch: string) {
    const s = this.by.get(ch)
    if (!s) return { x: this.cx, y: this.cy }
    return { x: this.cx - this.size / 2 + s.x, y: this.cy - this.size / 2 + s.y }
  }

  setMode(m: RingMode) {
    if (this.el.dataset.mode !== m) this.el.dataset.mode = m
  }

  setLive(on: boolean, color: string) {
    this.el.classList.toggle('live', on)
    if (on) this.el.style.setProperty('--me', color)
    for (const s of this.slots) s.tile.setAttribute('aria-disabled', on && !s.used ? 'false' : 'true')
  }

  isUsed(ch: string) {
    return this.by.get(ch)?.used ?? true
  }

  /** Bring tile state in line with the server's letters. */
  sync(letters: { ch: string; used: boolean }[]) {
    if (letters.length !== this.slots.length || letters.some((l, i) => this.slots[i]?.ch !== l.ch)) {
      this.build(letters.map((l) => l.ch))
      letters.forEach((l) => {
        const s = this.by.get(l.ch)!
        s.used = l.used
        s.el.classList.toggle('used', l.used)
        if (l.used) anim(s.tile, [{ transform: 'scale(0)', opacity: 0 }], 1)
      })
      return
    }
    const now = performance.now()
    let k = 0
    for (const l of letters) {
      const s = this.by.get(l.ch)!
      if (s.hold > now) continue
      if (l.used && !s.used) this.pop(l.ch, null, true)
      else if (!l.used && s.used) this.restore(s, k++ * 38)
    }
  }

  /** Letter leaves the ring: squash, pop, burst. */
  pop(ch: string, color: string | null, quiet = false): boolean {
    const s = this.by.get(ch)
    if (!s || s.used) return false
    s.used = true
    s.el.classList.add('used')
    s.tile.setAttribute('aria-disabled', 'true')
    anim(
      s.tile,
      [
        { transform: 'scale(1)', opacity: 1 },
        { transform: 'scale(.82)', opacity: 1, offset: 0.18, easing: E.out },
        { transform: 'scale(1.32)', opacity: 1, offset: 0.45, easing: E.in },
        { transform: 'scale(0)', opacity: 0 },
      ],
      { duration: 340, easing: 'linear' },
    )
    const p = this.pos(ch)
    const c = color ?? CREAM
    if (!quiet) {
      setTimeout(() => {
        this.fx.burst(p.x, p.y, { colors: [c, c, CREAM], n: 22, speed: [90, 330], size: [2, 4], life: [0.35, 0.7], g: 200, radius: this.d * 0.3, streak: 0.3 })
        this.fx.shock(p.x, p.y, c, this.d * 0.95, 0.4, 4)
        this.fx.stars(p.x, p.y, { colors: [c, CREAM], n: 3, radius: this.d * 0.6, size: [4, 8], life: [0.4, 0.7] })
      }, 120)
    } else {
      setTimeout(() => this.fx.burst(p.x, p.y, { colors: [c], n: 6, speed: [40, 140], life: [0.3, 0.5], g: 0 }), 120)
    }
    return true
  }

  /** Letter springs back into its slot. */
  restore(s: Slot, delay = 0, sparkle = true) {
    s.used = false
    s.el.classList.remove('used')
    s.tile.setAttribute('aria-disabled', this.el.classList.contains('live') ? 'false' : 'true')
    anim(
      s.tile,
      [
        { transform: 'scale(0) rotate(-40deg)', opacity: 0 },
        { transform: 'scale(1.22) rotate(8deg)', opacity: 1, offset: 0.5, easing: E.out },
        { transform: 'scale(.92) rotate(-3deg)', offset: 0.75, easing: E.inOut },
        { transform: 'scale(1) rotate(0)', opacity: 1 },
      ],
      { duration: 560, delay, easing: E.out },
    )
    if (sparkle) {
      const p = this.pos(s.ch)
      setTimeout(() => this.fx.stars(p.x, p.y, { colors: [CREAM, '#FFC94D'], n: 2, radius: this.d * 0.5, size: [4, 8] }), delay + 140)
    }
  }

  /** Optimistic local pop: ignore stale server state for this letter for a moment. */
  hold(ch: string, ms: number) {
    const s = this.by.get(ch)
    if (s) s.hold = performance.now() + ms
  }

  /** Server rejected / never confirmed a tap: put it back. */
  unhold(ch: string, used: boolean) {
    const s = this.by.get(ch)
    if (!s) return
    s.hold = 0
    if (!used && s.used) this.restore(s, 0, false)
  }

  refill() {
    // Clockwise wave from the top.
    this.slots.forEach((s, i) => {
      s.hold = 0
      if (s.used) this.restore(s, 180 + i * 42)
    })
  }

  /** Tick: band edges flash with the heat colour. */
  pulse(heat: number) {
    anim(this.lit, [{ opacity: 0.55 + heat * 0.45 }, { opacity: 0.18 }], { duration: 120 + 260 * (1 - heat), easing: E.out })
    if (reduced) return
    anim(this.band, [{ transform: `scale(${1 + 0.006 + heat * 0.012})` }, { transform: 'scale(1)' }], { duration: 220, easing: E.out })
  }

  calm() {
    anim(this.lit, [{ opacity: 0.18 }], { duration: 300 })
  }

  /** Boom: tiles get blown outward and spring back. */
  knock() {
    if (reduced) return
    for (const s of this.slots) {
      const dx = s.x - this.size / 2
      const dy = s.y - this.size / 2
      const m = Math.hypot(dx, dy) || 1
      const k = 14 + Math.random() * 14
      const rot = (Math.random() - 0.5) * 50
      anim(
        s.el,
        [
          { transform: 'none' },
          { transform: `translate(${(dx / m) * k}px,${(dy / m) * k}px) rotate(${rot}deg)`, offset: 0.18, easing: E.out },
          { transform: `translate(${(-dx / m) * k * 0.2}px,${(-dy / m) * k * 0.2}px) rotate(${-rot * 0.3}deg)`, offset: 0.6, easing: E.inOut },
          { transform: 'none' },
        ],
        { duration: 900, easing: 'linear', fill: 'none' },
      )
    }
  }

  /** Not your turn: a tiny refusal shake. */
  nudge(ch: string) {
    const s = this.by.get(ch)
    if (!s) return
    anim(
      s.tile,
      [{ transform: 'translateX(0)' }, { transform: 'translateX(-4px)' }, { transform: 'translateX(4px)' }, { transform: 'translateX(-2px)' }, { transform: 'translateX(0)' }],
      { duration: 260, easing: 'linear', fill: 'none' },
    )
  }

  /** Lobby attract: a sparkle travels around the ring now and then. */
  shimmer() {
    this.slots.forEach((s, i) => {
      if (s.used) return
      anim(s.face, [{ transform: 'scale(1)' }, { transform: 'scale(1.12)', offset: 0.4 }, { transform: 'scale(1)' }], {
        duration: 420,
        delay: i * 45,
        easing: E.out,
        fill: 'none',
      })
    })
  }
}
