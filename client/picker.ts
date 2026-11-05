// Pick-a-card: a held hand of category cards fanned along the bottom. Swipe / drag /
// wheel / arrows scroll it with momentum; the centred card lifts and straightens.
// Tap it (or flick it up) to pick: it flies to the centre and becomes the round's card.
import type { HandCard } from '../shared/protocol'
import type { Audio } from './audio'
import { E, ICON, anim, h, reduced } from './dom'
import { accentFor, shade } from './palette'

interface PCard {
  c: HandCard
  el: HTMLDivElement
  born: number
}

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
  private drag: { pid: number; x: number; y: number; t: number; pos: number; idx: number; moved: boolean; hist: [number, number][] } | null = null
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
    this.el.addEventListener('pointercancel', () => (this.drag = null))
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
    if (this.open) this.kick()
  }

  /** Open: instant feedback (face-down hand) while the server deals. */
  show() {
    if (this.open) return
    this.open = true
    this.picking = false
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
      el.style.opacity = '0'
      return { c, el, born: now + i * 45 }
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
    this.drag = { pid: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now(), pos: this.pos, idx: this.idxOf(e.target), moved: false, hist: [[performance.now(), e.clientX]] }
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
    if (!d.moved && Math.hypot(dx, dy) > 6) d.moved = true
    if (!d.moved) return
    if (Math.abs(dx) >= Math.abs(dy) * 0.8 || Math.abs(this.pos - d.pos) > 0.05) {
      this.pos = this.target = this.clampSoft(d.pos - dx / this.spacing)
      this.kick()
    }
    d.hist.push([performance.now(), e.clientX])
    if (d.hist.length > 6) d.hist.shift()
  }

  private up(e: PointerEvent) {
    const d = this.drag
    if (!d || e.pointerId !== d.pid) return
    this.drag = null
    const dx = e.clientX - d.x
    const dy = e.clientY - d.y
    const dt = performance.now() - d.t
    const n = this.cards.length
    if (!d.moved && dt < 500) {
      // Tap: focused card picks, others scroll to the centre, background closes.
      if (d.idx < 0) return this.hide()
      if (d.idx === Math.round(this.pos) && Math.abs(this.pos - d.idx) < 0.3) this.pick()
      else this.go(d.idx)
      return
    }
    if (Math.abs(dy) > Math.abs(dx) * 1.3) {
      if (dy < -70 && d.idx === Math.round(this.pos)) return this.pick() // flick it up
      if (dy > 90) return this.hide() // swipe down to put the hand away
    }
    // Momentum: project with the release velocity, then spring to the nearest card.
    const [t0, x0] = d.hist[0]!
    const v = (e.clientX - x0) / Math.max(16, performance.now() - t0) // px per ms
    const proj = this.pos - (v * 260) / this.spacing
    this.go(Math.max(0, Math.min(n - 1, Math.round(proj))))
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
    if (!this.drag) {
      const k = 1 - Math.exp(-dt / (reduced ? 40 : 85))
      this.pos += (this.target - this.pos) * k
      if (Math.abs(this.target - this.pos) < 0.001) this.pos = this.target
      else busy = true
    } else busy = true
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
    const y = t.y + (1 - e) * H * 0.55
    const r = t.r + (1 - e) * (o * 6 - 18)
    c.el.style.transform = `translate(${(t.x - this.w / 2).toFixed(1)}px,${(y - this.hgt / 2).toFixed(1)}px) rotate(${r.toFixed(2)}deg) scale(${t.s.toFixed(3)})`
    c.el.style.zIndex = String(100 - Math.round(t.a * 10))
    c.el.style.opacity = raw <= 0 || t.a > 5.5 ? '0' : '1'
    c.el.classList.toggle('focus', t.a < 0.5)
  }
}
