// Pick-a-card: a held hand of category cards fanned along the bottom. Swipe / drag /
// wheel / arrows scroll it with momentum; the centred card lifts and straightens.
// Tap it to pick: it flies to the centre and becomes the round's card.
//
// Vertical drags are live and finger-tracked (axis-locked after a small deadzone):
//   down: the whole hand sinks and flattens with the finger; past a threshold it's "committed"
//         (haptic tick), and letting go there puts the hand away. Before it, it springs back.
//   up:   the focused card rises toward the middle while the rest fall away; past the threshold
//         it locks in (tick + accent ring) and letting go picks it. A quick flick counts too.
import type { HandCard } from '../shared/protocol'
import type { Audio } from './audio'
import { E, ICON, anim, h, reduced } from './dom'
import { accentFor, shade } from './palette'

interface PCard {
  c: HandCard
  el: HTMLDivElement
  ring: HTMLDivElement
  dim: HTMLDivElement
  born: number
}

/** A value that follows the finger while dragging and springs (slightly bouncy) when let go. */
class Spring {
  v = 0
  w = 0
  target = 0
  held = false
  step(dt: number) {
    if (this.held) return false
    const s = Math.min(dt, 32) / 1000
    this.w += (170 * (this.target - this.v) - 19 * this.w) * s
    this.v += this.w * s
    if (Math.abs(this.target - this.v) < 0.0005 && Math.abs(this.w) < 0.005) {
      this.v = this.target
      this.w = 0
      return false
    }
    return true
  }
  set(v: number) {
    this.v = v
    this.w = 0
  }
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v))
/** Past 1 the finger keeps pulling, but with resistance. */
const rubber = (p: number) => (p <= 1 ? p : 1 + (p - 1) * 0.35)

const ease = (t: number) => 1 - (1 - t) ** 3
const back = (t: number) => {
  const c1 = 1.5
  const c3 = c1 + 1
  return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2
}

export class Picker {
  el: HTMLDivElement
  private fan: HTMLDivElement
  private shuf: HTMLButtonElement
  private close: HTMLButtonElement
  private cards: PCard[] = []
  open = false
  private waiting = false
  private waitT: ReturnType<typeof setTimeout> | undefined
  private pos = 0
  private target = 0
  private raf = 0
  private last = 0
  private lastIdx = -1
  private lastScrub = 0
  private leaving = 0
  private leavingCards: PCard[] = []
  private picking = false
  private w = 200
  private hgt = 280
  private cy = 600
  private spacing = 90
  // drag
  private drag: {
    pid: number
    x: number
    y: number
    t: number
    pos: number
    idx: number
    moved: boolean
    axis: 'h' | 'v' | null
    focus: number // the focused card when the vertical lock happened
    hist: [number, number, number][] // t, x, y
  } | null = null
  // vertical gesture state (progress units: 1 = threshold)
  private sink = new Spring()
  private lift = new Spring()
  private upFocus = -1
  private downCommit = 0 // eased 0..1 "committed" look
  private upCommit = 0
  private downOn = false
  private upOn = false
  private thresh = 110
  private scrim!: HTMLDivElement
  private wheelAcc = 0
  private wheelT: ReturnType<typeof setTimeout> | undefined
  /** The card this phone just picked, until the server's deal arrives. */
  pending: HandCard | null = null
  pendingAt = 0
  onRequest: () => void = () => {}
  onPick: (c: HandCard) => void = () => {}
  onOpenChange: (open: boolean) => void = () => {}
  onFail: () => void = () => {}
  target3d: () => { x: number; y: number; w: number; h: number } | null = () => null

  constructor(
    parent: HTMLElement,
    private audio: Audio,
  ) {
    this.el = h('div', '', parent)
    this.el.id = 'picker'
    this.scrim = h('div', 'scrim', this.el)
    this.fan = h('div', 'fan', this.el)
    // Face-down placeholder while the server deals the hand.
    const w = h('div', 'waitcards', this.el)
    for (let i = 0; i < 3; i++) h('div', 'cardback', w)
    this.shuf = h('button', 'pbtn shuf', this.el, ICON.shuffle)
    this.shuf.type = 'button'
    this.shuf.setAttribute('aria-label', 'another hand')
    this.close = h('button', 'pbtn close', this.el, ICON.x)
    this.close.type = 'button'
    this.close.setAttribute('aria-label', 'close')
    this.shuf.addEventListener('click', () => this.reshuffle())
    this.close.addEventListener('click', () => this.hide())
    this.el.addEventListener('pointerdown', (e) => this.down(e))
    this.el.addEventListener('pointermove', (e) => this.move(e))
    this.el.addEventListener('pointerup', (e) => this.up(e))
    this.el.addEventListener('pointercancel', () => {
      // Interrupted: everything springs home.
      this.drag = null
      this.release(false, false)
    })
    this.el.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault()
        this.wheelAcc += Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY
        while (Math.abs(this.wheelAcc) >= 50) {
          this.go(this.target + Math.sign(this.wheelAcc))
          this.wheelAcc -= Math.sign(this.wheelAcc) * 50
        }
        clearTimeout(this.wheelT)
        this.wheelT = setTimeout(() => (this.wheelAcc = 0), 160)
      },
      { passive: false },
    )
    window.addEventListener('keydown', (e: KeyboardEvent) => {
      if (!this.open) return
      if (e.key === 'ArrowRight') this.go(this.target + 1)
      else if (e.key === 'ArrowLeft') this.go(this.target - 1)
      else if (e.key === 'Enter' || e.key === ' ') this.pick()
      else if (e.key === 'Escape') this.hide()
      else return
      e.preventDefault()
    })
  }

  layout() {
    const W = innerWidth
    const H = innerHeight
    this.w = Math.round(Math.min(W * 0.5, 230, H * 0.3))
    this.hgt = Math.round(this.w * 1.4)
    this.spacing = this.w * 0.5
    this.cy = H - Math.max(0, H * 0.02) - 96 - this.hgt * 0.5
    this.el.style.setProperty('--pw', this.w + 'px')
    this.el.style.setProperty('--ph', this.hgt + 'px')
    this.shuf.style.top = H - 64 + 'px'
    this.thresh = Math.round(Math.max(90, Math.min(150, H * 0.13)))
    if (this.open) this.kick()
  }

  /** Open: instant feedback (face-down hand) while the server deals. */
  show() {
    if (this.open) return
    this.open = true
    this.picking = false
    this.resetGesture()
    this.layout()
    this.el.classList.add('on')
    anim(this.el, [{ opacity: 0 }, { opacity: 1 }], { duration: 200, fill: 'none' })
    this.audio.play('ui')
    this.onOpenChange(true)
    this.request()
  }

  private request() {
    this.waiting = true
    this.el.classList.add('waiting')
    this.onRequest()
    clearTimeout(this.waitT)
    this.waitT = setTimeout(() => {
      if (!this.waiting) return
      this.waiting = false
      this.el.classList.remove('waiting')
      if (!this.cards.length) {
        this.onFail()
        this.hide()
      }
    }, 3500)
  }

  private reshuffle() {
    if (this.waiting || this.picking) return
    this.audio.play('shuffle')
    // Old hand sweeps down, the new one deals in.
    this.leavingCards = this.cards
    this.leaving = performance.now()
    this.cards = []
    this.kick()
    anim(this.shuf, [{ transform: 'rotate(0)' }, { transform: 'rotate(360deg)' }], { duration: 500, easing: E.out, fill: 'none' })
    this.request()
  }

  /** The server's hand arrived. */
  deal(cards: HandCard[]) {
    if (!this.open) return
    this.waiting = false
    this.el.classList.remove('waiting')
    for (const c of this.cards) c.el.remove()
    const now = performance.now()
    this.cards = cards.map((c, i) => {
      const el = h('div', 'pcard' + (c.hot ? ' hot' : ''), this.fan)
      const acc = accentFor(c)
      el.style.setProperty('--acc', acc)
      el.style.setProperty('--accd', shade(acc, 0.35))
      const face = h('div', 'pface', el)
      h('div', 'emo', face, c.emoji)
      const t = h('div', 'txt', face)
      t.textContent = c.text
      const n = c.text.length
      t.style.fontSize = `calc(var(--pw) * ${n > 40 ? 0.084 : n > 28 ? 0.092 : n > 18 ? 0.1 : 0.115})`
      if (c.hot) h('div', 'flame', face, '🔥')
      const ring = h('div', 'lockring', el)
      const dim = h('div', 'dim', el)
      el.style.opacity = '0'
      return { c, el, ring, dim, born: now + i * 45 }
    })
    this.pos = this.target = Math.floor((cards.length - 1) / 2)
    this.lastIdx = Math.round(this.pos)
    this.audio.play('whoosh', { gain: 0.5 })
    this.kick()
  }

  hide() {
    if (!this.open) return
    this.open = false
    this.waiting = false
    this.drag = null
    clearTimeout(this.waitT)
    this.el.classList.remove('waiting')
    this.audio.play('ui', { gain: 0.6 })
    const a = anim(this.el, [{ opacity: 1 }, { opacity: 0 }], { duration: 200, easing: E.in, fill: 'none' })
    a.finished
      .then(() => {
        if (this.open) return
        this.el.classList.remove('on')
        for (const c of [...this.cards, ...this.leavingCards]) c.el.remove()
        this.cards = []
        this.leavingCards = []
      })
      .catch(() => {})
    this.onOpenChange(false)
  }

  // ---- input ----

  private idxOf(t: EventTarget | null) {
    const el = (t as Element | null)?.closest?.('.pcard')
    return el ? this.cards.findIndex((c) => c.el === el) : -1
  }

  private down(e: PointerEvent) {
    if (this.picking || (e.target as Element).closest('.pbtn')) return
    const now = performance.now()
    this.drag = {
      pid: e.pointerId,
      x: e.clientX,
      y: e.clientY,
      t: now,
      pos: this.pos,
      idx: this.idxOf(e.target),
      moved: false,
      axis: null,
      focus: -1,
      hist: [[now, e.clientX, e.clientY]],
    }
    try {
      this.el.setPointerCapture(e.pointerId)
    } catch {
      /* fine */
    }
  }

  private move(e: PointerEvent) {
    const d = this.drag
    if (!d || e.pointerId !== d.pid) return
    const dx = e.clientX - d.x
    const dy = e.clientY - d.y
    d.hist.push([performance.now(), e.clientX, e.clientY])
    if (d.hist.length > 6) d.hist.shift()
    if (!d.moved && Math.hypot(dx, dy) > 8) {
      d.moved = true
      // Axis lock: decided once, kept until the finger lifts.
      d.axis = Math.abs(dx) > Math.abs(dy) ? 'h' : 'v'
      if (d.axis === 'v') {
        // Freeze the scrub on whatever card is focused right now.
        this.target = this.pos = Math.max(0, Math.min(this.cards.length - 1, Math.round(this.pos)))
        d.focus = Math.round(this.pos)
        this.upFocus = d.focus
        this.sink.held = this.lift.held = true
      }
    }
    if (!d.moved) return
    if (d.axis === 'h') {
      this.pos = this.target = this.clampSoft(d.pos - dx / this.spacing)
    } else {
      // Progress is live: 1 = threshold. Only one direction is active at a time.
      const pDown = Math.max(0, dy) / this.thresh
      const pUp = this.cards[d.focus] ? Math.max(0, -dy) / this.thresh : 0
      this.sink.set(rubber(pDown))
      this.lift.set(rubber(pUp))
      this.setCommit('down', pDown >= 1)
      this.setCommit('up', pUp >= 1)
    }
    this.kick()
  }

  private setCommit(which: 'down' | 'up', on: boolean) {
    const was = which === 'down' ? this.downOn : this.upOn
    if (was === on) return
    if (which === 'down') this.downOn = on
    else this.upOn = on
    // Crossing the line either way is felt and heard.
    navigator.vibrate?.(on ? 14 : 6)
    this.audio.play('tap', { gain: on ? 0.5 : 0.25, rate: on ? (which === 'up' ? 1.3 : 0.8) : 1 })
  }

  private up(e: PointerEvent) {
    const d = this.drag
    if (!d || e.pointerId !== d.pid) return
    this.drag = null
    const dt = performance.now() - d.t
    const n = this.cards.length
    if (!d.moved && dt < 500) {
      // Tap: focused card picks, others scroll to the centre, background closes.
      if (d.idx < 0) return this.hide()
      if (d.idx === Math.round(this.pos) && Math.abs(this.pos - d.idx) < 0.3) this.pick()
      else this.go(d.idx)
      return
    }
    const [t0, x0, y0] = d.hist[0]!
    const span = Math.max(16, performance.now() - t0)
    if (d.axis === 'v') {
      // A quick flick counts as crossing the line.
      const vy = (e.clientY - y0) / span // px per ms
      const flickUp = vy < -0.9 && this.lift.v > 0.25
      const flickDown = vy > 0.9 && this.sink.v > 0.25
      return this.release(this.downOn || flickDown, this.upOn || flickUp)
    }
    // Momentum: project with the release velocity, then spring to the nearest card.
    const v = (e.clientX - x0) / span
    const proj = this.pos - (v * 260) / this.spacing
    this.go(Math.max(0, Math.min(n - 1, Math.round(proj))))
  }

  /** Let go of a vertical drag: commit (hide / pick) or spring everything back into the fan. */
  private release(downGo: boolean, upGo: boolean) {
    this.sink.held = this.lift.held = false
    if (downGo) {
      // Sweep the hand away with the finger's momentum, then close.
      this.sink.target = 2.4
      this.sink.w = Math.max(this.sink.w, 6)
      setTimeout(() => this.hide(), reduced ? 60 : 170)
    } else if (upGo && this.cards[this.upFocus] && (this.pick(), this.picking)) {
      this.upOn = true
    } else {
      this.sink.target = 0
      this.lift.target = 0
      this.downOn = this.upOn = false
    }
    this.kick()
  }

  private resetGesture() {
    for (const sp of [this.sink, this.lift]) {
      sp.set(0)
      sp.target = 0
      sp.held = false
    }
    this.downOn = this.upOn = false
    this.downCommit = this.upCommit = 0
    this.upFocus = -1
    this.scrim.style.opacity = '1'
  }

  private clampSoft(p: number) {
    const max = this.cards.length - 1
    if (p < 0) return p * 0.3
    if (p > max) return max + (p - max) * 0.3
    return p
  }

  private go(i: number) {
    const n = this.cards.length
    if (!n) return
    this.target = Math.max(0, Math.min(n - 1, i))
    this.kick()
  }

  /** The focused card flies to the centre; the deal from the server takes it from there. */
  private pick() {
    const i = Math.round(this.pos)
    const pc = this.cards[i]
    if (!pc || this.picking || this.waiting) return
    this.picking = true
    const r = this.target3d()
    const cur = pc.el.style.transform
    this.audio.play('whoosh')
    this.el.classList.add('picking')
    const dur = reduced ? 200 : 380
    if (r)
      anim(
        pc.el,
        [
          { transform: cur },
          { transform: `translate(${r.x - this.w / 2}px,${r.y - this.hgt / 2}px) rotate(0) scale(${r.w / this.w})` },
        ],
        { duration: dur, easing: E.out },
      )
    setTimeout(() => {
      this.pending = pc.c
      this.pendingAt = performance.now()
      this.onPick(pc.c)
      // If the deal never comes back, don't leave the card hanging.
      setTimeout(() => {
        if (this.open && this.picking) {
          this.pending = null
          this.hide()
        }
      }, 1500)
    }, dur)
  }

  /** The deal for our pick arrived: hand over to the deck's centre card. */
  handoff() {
    this.pending = null
    this.picking = false
    this.el.classList.remove('picking')
    this.open = true
    this.hide()
  }

  // ---- render loop (12 transforms a frame, only while something moves) ----

  private kick() {
    if (this.raf) return
    this.last = performance.now()
    this.raf = requestAnimationFrame(this.frame)
  }

  private frame = (now: number) => {
    const dt = Math.min(50, now - this.last)
    this.last = now
    let busy = false
    if (this.sink.step(dt)) busy = true
    if (this.lift.step(dt)) busy = true
    const k = 1 - Math.exp(-dt / 70)
    this.downCommit += ((this.downOn ? 1 : 0) - this.downCommit) * k
    this.upCommit += ((this.upOn ? 1 : 0) - this.upCommit) * k
    if (Math.abs((this.downOn ? 1 : 0) - this.downCommit) > 0.003 || Math.abs((this.upOn ? 1 : 0) - this.upCommit) > 0.003) busy = true
    // The backdrop clears as the hand is pulled down.
    const D = Math.max(0, this.sink.v)
    this.scrim.style.opacity = String(Math.max(0, Math.min(1, 1 - 0.5 * clamp01(D) - 0.4 * this.downCommit - 0.6 * Math.max(0, D - 1))).toFixed(3))
    if (!this.drag || this.drag.axis === 'v') {
      const k = 1 - Math.exp(-dt / (reduced ? 40 : 85))
      this.pos += (this.target - this.pos) * k
      if (Math.abs(this.target - this.pos) < 0.001) this.pos = this.target
      else busy = true
    } else busy = true
    if (this.drag?.axis === 'v') busy = true
    const idx = Math.round(this.pos)
    if (idx !== this.lastIdx && this.cards.length) {
      this.lastIdx = idx
      if (now - this.lastScrub > 70) {
        this.lastScrub = now
        this.audio.play('flip', { gain: 0.28, rate: 1.25 + Math.random() * 0.1 })
      }
    }
    const cx = innerWidth / 2
    const H = innerHeight
    this.cards.forEach((c, i) => {
      const e = Math.max(0, Math.min(1, (now - c.born) / 460))
      if (e < 1) busy = true
      this.place(c, i - this.pos, cx, reduced ? ease(e) : back(e), e, H)
    })
    if (this.leavingCards.length) {
      const t = Math.min(1, (now - this.leaving) / 320)
      this.leavingCards.forEach((c, i) => {
        const o = i - this.pos
        const base = this.fanTransform(o, cx)
        c.el.style.transform = `translate(${base.x - this.w / 2}px,${base.y - this.hgt / 2 + ease(t) * H * 0.6}px) rotate(${base.r + t * (o * 12)}deg) scale(${base.s})`
      })
      if (t >= 1) {
        for (const c of this.leavingCards) c.el.remove()
        this.leavingCards = []
      } else busy = true
    }
    this.raf = busy ? requestAnimationFrame(this.frame) : 0
  }

  private fanTransform(o: number, cx: number) {
    const a = Math.abs(o)
    const near = Math.max(0, 1 - a)
    // Compress the outer cards so the hand reads as a held fan.
    const dist = a < 1 ? a : 1 + (a - 1) * 0.6
    const x = cx + Math.sign(o) * dist * this.spacing
    const y = this.cy + dist * dist * this.hgt * 0.045 - near * this.hgt * 0.16
    const r = Math.max(-34, Math.min(34, Math.sign(o) * dist * 8))
    const s = 0.86 + near * 0.3
    return { x, y, r, s, a }
  }

  private place(c: PCard, o: number, cx: number, e: number, raw: number, H: number) {
    const t = this.fanTransform(o, cx)
    let x = t.x
    let y = t.y + (1 - e) * H * 0.55
    let r = t.r + (1 - e) * (o * 6 - 18)
    let s = t.s
    let sy = 1
    let op = raw <= 0 || t.a > 5.5 ? 0 : 1
    let z = 100 - Math.round(t.a * 10)
    let dim = 0

    // Drag down: the whole hand sinks, the fan closes and flattens, cards shrink and dim.
    const D = Math.max(0, this.sink.v)
    if (D > 0.0005) {
      const d1 = clamp01(D)
      const cd = this.downCommit
      x = cx + (x - cx) * (1 - 0.32 * d1 - 0.12 * cd)
      y += D * this.hgt * 0.5 + cd * this.hgt * 0.08
      r *= 1 - 0.65 * d1
      s *= 1 - 0.22 * d1 - 0.06 * cd
      sy = 1 - 0.18 * cd // flattened, like tilting the hand away
      // Dim with an ink layer (cards stay opaque, no see-through mess); fade only when swept away.
      dim = 0.3 * d1 + 0.25 * cd
      op *= Math.max(0, 1 - 0.8 * Math.max(0, D - 1.1))
    }

    // Drag up: the focused card rises to the middle; the rest drop away and spread.
    const U = Math.max(0, this.lift.v)
    let ring = 0
    if (U > 0.0005 && this.upFocus >= 0) {
      const u1 = clamp01(U)
      const cu = this.upCommit
      const i = this.cards.indexOf(c)
      if (i === this.upFocus) {
        const toY = H * 0.42
        const ease1 = 1 - (1 - u1) ** 2
        x += (cx - x) * ease1
        y += (toY - y) * ease1 - Math.max(0, U - 1) * this.hgt * 0.25
        r *= 1 - u1
        s += (1.32 - s) * ease1 + 0.06 * cu
        z = 200
        ring = cu
      } else {
        const side = Math.sign(i - this.upFocus) || 1
        x += side * u1 * this.w * 0.55
        y += U * this.hgt * 0.75
        r += side * u1 * 10
        s *= 1 - 0.28 * u1
        dim = Math.max(dim, 0.35 * u1)
        op *= Math.max(0, 1 - 0.85 * Math.max(0, u1 - 0.25) / 0.75)
      }
    }

    c.el.style.transform = `translate(${(x - this.w / 2).toFixed(1)}px,${(y - this.hgt / 2).toFixed(1)}px) rotate(${r.toFixed(2)}deg) scale(${s.toFixed(3)},${(s * sy).toFixed(3)})`
    c.el.style.zIndex = String(z)
    c.el.style.opacity = op.toFixed(3)
    c.ring.style.opacity = ring.toFixed(3)
    c.dim.style.opacity = dim.toFixed(3)
    c.el.classList.toggle('focus', t.a < 0.5)
  }
}
