// The instrument: a chunky round base with a raised rim, a recessed channel holding
// 20 domed keys (each with an extruded skirt), and a raised hub with a glowing lens.
// Depth comes from stacked flat shapes and hard offsets, not gradients.
import { E, ICON, anim, clamp, h, reduced } from './dom'
import type { Fx } from './fx'
import { CREAM, heatColor } from './palette'

export type RingMode = 'idle' | 'calm' | 'recede' | 'play' | 'dim'

export interface Key {
  ch: string
  i: number
  el: HTMLDivElement // positioned slot: tick bounce / boom jump live here
  cap: HTMLButtonElement // sinks into its skirt when pressed
  used: boolean
  hold: number // optimistic press: ignore stale server state until then
  x: number
  y: number
}

export class Ring {
  el: HTMLDivElement
  private shadow: HTMLDivElement
  private side: HTMLDivElement
  private base: HTMLDivElement
  private rimLight: HTMLDivElement
  private channel: HTMLDivElement
  private keysEl: HTMLDivElement
  private island: HTMLDivElement
  private well: HTMLDivElement
  private glow: HTMLDivElement
  private lens: HTMLDivElement
  private emoji: HTMLDivElement
  private label: HTMLDivElement
  private nameEl: HTMLDivElement
  private crownEl: HTMLDivElement
  private who: string | null = null
  private keys: Key[] = []
  private by = new Map<string, Key>()
  cx = 0
  cy = 0
  size = 0
  d = 0
  R = 0
  ext = 0
  lensR = 0
  private lit = false
  private blownT: ReturnType<typeof setTimeout> | undefined
  onPress: (k: Key) => void = () => {}

  constructor(parent: HTMLElement, private fx: Fx) {
    this.el = h('div', '', parent)
    this.el.id = 'ring'
    this.shadow = h('div', 'r-shadow', this.el)
    this.side = h('div', 'r-side', this.el)
    this.base = h('div', 'r-base', this.el)
    this.rimLight = h('div', 'r-rimlight', this.el)
    this.channel = h('div', 'r-channel', this.el)
    this.island = h('div', 'r-island', this.el)
    this.well = h('div', 'r-well', this.el)
    this.glow = h('div', 'r-glow', this.el)
    this.lens = h('div', 'r-lens', this.el)
    h('div', 'r-sheen', this.lens)
    this.emoji = h('div', 'r-emoji', this.lens)
    this.label = h('div', 'r-label', this.lens)
    this.crownEl = h('div', 'r-crown', this.label, ICON.crown)
    this.nameEl = h('div', 'r-name', this.label)
    h('div', 'r-glint', this.lens)
    this.keysEl = h('div', 'r-keys', this.el)
  }

  private build(chs: string[]) {
    for (const k of this.keys) k.el.remove()
    this.keys = []
    this.by.clear()
    chs.forEach((ch, i) => {
      const el = h('div', 'key', this.keysEl)
      el.style.setProperty('--i', String(i))
      el.style.setProperty('--h', String((352 + i * 18) % 360))
      h('div', 'hole', el)
      h('div', 'skirt', el)
      const cap = h('button', 'cap', el)
      cap.type = 'button'
      cap.setAttribute('aria-label', ch)
      h('span', 'face', cap, ch)
      const k: Key = { ch, i, el, cap, used: false, hold: 0, x: 0, y: 0 }
      cap.addEventListener('pointerdown', (e) => {
        if (e.button > 0) return
        e.preventDefault()
        this.onPress(k)
      })
      cap.addEventListener('click', (e) => {
        if (e.detail === 0) this.onPress(k) // keyboard
      })
      this.keys.push(k)
      this.by.set(ch, k)
    })
    if (this.size) this.layout(this.cx, this.cy, this.size)
  }

  layout(cx: number, cy: number, size: number) {
    Object.assign(this, { cx, cy, size })
    const st = this.el.style
    st.left = cx - size / 2 + 'px'
    st.top = cy - size / 2 + 'px'
    st.width = st.height = size + 'px'
    const S = size
    const rim = clamp(S * 0.03, 7, 20)
    const pad = clamp(S * 0.012, 4, 10)
    // Keys as big as fit around the circle with a hair of air between them.
    const c = (0.93 * 2 * Math.PI) / 20
    const A = S / 2 - rim - pad
    const d = (this.d = Math.min(104, (c * A) / (1 + c / 2)))
    const R = (this.R = A - d / 2)
    const ext = (this.ext = Math.max(3, Math.round(d * 0.13)))
    st.setProperty('--d', d + 'px')
    st.setProperty('--ext', ext + 'px')
    st.setProperty('--S', S + 'px')
    const baseExt = Math.max(4, Math.round(S * 0.022))
    const put = (e: HTMLElement, dia: number, dy = 0) => {
      e.style.width = e.style.height = dia + 'px'
      e.style.left = S / 2 - dia / 2 + 'px'
      e.style.top = S / 2 - dia / 2 + dy + 'px'
    }
    const baseD = S - 2
    put(this.shadow, baseD * 0.96, baseExt * 2.2)
    put(this.side, baseD, baseExt)
    put(this.base, baseD)
    put(this.rimLight, baseD - rim * 0.9)
    const chanD = 2 * (R + d / 2 + pad)
    put(this.channel, chanD)
    const islD = 2 * (R - d / 2 - pad)
    put(this.island, islD)
    const wellD = islD * 0.8
    put(this.well, wellD, Math.max(2, ext * 0.4))
    const lensD = wellD * 0.84
    this.lensR = lensD / 2
    put(this.lens, lensD, Math.max(2, ext * 0.4))
    put(this.glow, lensD, Math.max(2, ext * 0.4))
    st.setProperty('--lens', lensD + 'px')
    st.setProperty('--isl', islD + 'px')
    for (const k of this.keys) {
      const a = -Math.PI / 2 + (k.i * Math.PI * 2) / this.keys.length
      k.x = S / 2 + R * Math.cos(a)
      k.y = S / 2 + R * Math.sin(a)
      k.el.style.left = k.x - d / 2 + 'px'
      k.el.style.top = k.y - d / 2 - ext / 2 + 'px'
      k.el.style.width = k.el.style.height = d + 'px'
    }
  }

  /** Page coordinates of a key's top face. */
  pos(ch: string) {
    const k = this.by.get(ch)
    if (!k) return { x: this.cx, y: this.cy }
    return { x: this.cx - this.size / 2 + k.x, y: this.cy - this.size / 2 + k.y - this.ext / 2 }
  }

  lensCenter() {
    return { x: this.cx, y: this.cy + Math.max(2, this.ext * 0.4) }
  }

  setMode(m: RingMode) {
    if (this.el.dataset.mode !== m) this.el.dataset.mode = m
    const locked = m !== 'play'
    for (const k of this.keys) k.cap.setAttribute('aria-disabled', locked || k.used ? 'true' : 'false')
  }

  setEmoji(e: string | null) {
    if (this.emoji.textContent !== (e ?? '')) {
      this.emoji.textContent = e ?? ''
      if (e) anim(this.emoji, [{ transform: 'scale(.3)', opacity: 0 }, { transform: 'scale(1.15)', opacity: 1, offset: 0.6 }, { transform: 'scale(1)', opacity: 1 }], { duration: 520, easing: E.out })
    }
  }

  /**
   * Who holds the fuse: their name big on the lens, their colour on the bezel around it.
   * null: no roster, the lens shows the category emoji instead.
   */
  setTurn(p: { id: string; name: string; color: string } | null, crown = false) {
    this.el.classList.toggle('named', !!p)
    this.el.classList.toggle('crowned', !!p && crown)
    this.el.style.setProperty('--turn', p ? p.color : '#0c0818')
    const key = p ? p.id + '|' + p.name : null
    if (key === this.who) return
    const first = this.who === null
    this.who = key
    if (!p) return
    const apply = () => {
      this.nameEl.textContent = p.name
      const len = Math.max(3, [...p.name].length)
      const D = this.lensR * 2
      this.nameEl.style.fontSize = Math.min(D * 0.25, (D * 0.86) / (len * 0.6)) + 'px'
    }
    if (first) {
      apply()
      anim(this.label, [{ transform: 'scale(.3)', opacity: 0 }, { transform: 'scale(1.1)', opacity: 1, offset: 0.6 }, { transform: 'scale(1)', opacity: 1 }], { duration: 420, easing: E.out })
      return
    }
    // Turn passes: squash out, swap, spring in.
    anim(
      this.label,
      [
        { transform: 'scale(1)', opacity: 1 },
        { transform: 'scale(.4,.6)', opacity: 0, offset: 0.35, easing: E.in },
        { transform: 'scale(1.12)', opacity: 1, offset: 0.7, easing: E.out },
        { transform: 'scale(1)', opacity: 1 },
      ],
      { duration: 380, easing: 'linear' },
    )
    setTimeout(() => this.who === key && apply(), 130)
  }

  /** Big flash of the name on the lens (boom). */
  flashName() {
    anim(
      this.label,
      [
        { transform: 'scale(2.2) rotate(-6deg)', opacity: 0 },
        { transform: 'scale(.9) rotate(2deg)', opacity: 1, offset: 0.45, easing: E.out },
        { transform: 'scale(1.06)', offset: 0.7 },
        { transform: 'scale(1)', opacity: 1 },
      ],
      { duration: 700, delay: 120, easing: 'linear', fill: 'backwards' },
    )
  }

  /** Fuse burning or not: the lens wakes up or goes dark. */
  setLit(on: boolean) {
    if (on === this.lit) return
    this.lit = on
    this.el.classList.toggle('lit', on)
    if (!on) this.el.classList.remove('hot')
  }

  isUsed(ch: string) {
    return this.by.get(ch)?.used ?? true
  }

  /** Bring keys in line with the server's letters. */
  sync(letters: { ch: string; used: boolean }[]) {
    if (letters.length !== this.keys.length || letters.some((l, i) => this.keys[i]?.ch !== l.ch)) {
      this.build(letters.map((l) => l.ch))
      for (const l of letters) if (l.used) this.press(l.ch, null, true)
      return
    }
    const now = performance.now()
    let k = 0
    for (const l of letters) {
      const key = this.by.get(l.ch)!
      if (key.hold > now) continue
      if (l.used && !key.used) this.press(l.ch, null, true)
      else if (!l.used && key.used) this.release(key, 60 + k++ * 40)
    }
  }

  /** A key goes down and stays down (used). */
  press(ch: string, color: string | null, quiet = false): boolean {
    const k = this.by.get(ch)
    if (!k || k.used) return false
    k.used = true
    k.el.classList.add('used')
    k.cap.setAttribute('aria-disabled', 'true')
    const e = this.ext
    anim(
      k.cap,
      quiet
        ? [{ transform: `translateY(${e}px)` }]
        : [
            { transform: 'translateY(0) scale(1)' },
            { transform: `translateY(${e * 1.15}px) scale(1.07,.88)`, offset: 0.35, easing: E.out },
            { transform: `translateY(${e * 0.9}px) scale(.98,1.02)`, offset: 0.7, easing: E.inOut },
            { transform: `translateY(${e}px) scale(1)` },
          ],
      { duration: quiet ? 1 : 200, easing: 'linear' },
    )
    if (!quiet && color) this.ripple(ch, color)
    return true
  }

  ripple(ch: string, color: string) {
    const p = this.pos(ch)
    const d = this.d
    this.fx.shock(p.x, p.y + this.ext, color, d * 1.05, 0.45, 5)
    this.fx.burst(p.x, p.y, { colors: [color, color, CREAM], n: 20, speed: [80, 300], size: [2, 4], life: [0.3, 0.65], g: 160, radius: d * 0.3, streak: 0.3 })
    this.fx.stars(p.x, p.y, { colors: [color, CREAM], n: 3, radius: d * 0.6, size: [4, 8], life: [0.35, 0.6] })
  }

  /** A key springs back up. */
  release(k: Key, delay = 0, sparkle = true) {
    k.used = false
    const e = this.ext
    setTimeout(() => {
      if (!k.used) k.el.classList.remove('used')
    }, delay + 60)
    anim(
      k.cap,
      [
        { transform: `translateY(${e}px) scale(1)` },
        { transform: `translateY(${-e * 0.55}px) scale(.94,1.08)`, offset: 0.35, easing: E.out },
        { transform: `translateY(${e * 0.15}px) scale(1.03,.97)`, offset: 0.65, easing: E.inOut },
        { transform: 'translateY(0) scale(1)' },
      ],
      { duration: 480, delay, easing: 'linear' },
    )
    k.cap.setAttribute('aria-disabled', this.el.dataset.mode === 'play' ? 'false' : 'true')
    if (sparkle) {
      const p = this.pos(k.ch)
      setTimeout(() => this.fx.stars(p.x, p.y - this.d * 0.2, { colors: [CREAM], n: 1, radius: this.d * 0.3, size: [4, 7], life: [0.3, 0.5] }), delay + 100)
    }
  }

  hold(ch: string, ms: number) {
    const k = this.by.get(ch)
    if (k) k.hold = ms ? performance.now() + ms : 0
  }

  /** Optimistic press never confirmed: trust the server. */
  unhold(ch: string, used: boolean) {
    const k = this.by.get(ch)
    if (!k) return
    k.hold = 0
    if (!used && k.used) this.release(k, 0, false)
  }

  /** All twenty pop back up, clockwise from the top, with a light sweep. */
  refill() {
    this.keys.forEach((k, i) => {
      k.hold = 0
      if (k.used) this.release(k, 120 + i * 38)
      else
        anim(k.cap, [{ transform: 'translateY(0)' }, { transform: `translateY(${-this.ext * 0.4}px)`, offset: 0.4 }, { transform: 'translateY(0)' }], {
          duration: 300,
          delay: 120 + i * 38,
          easing: E.out,
          fill: 'none',
        })
    })
  }

  /** Fuse tick: a physical "tk". Lens pulses, rim flares, keys hop a hair. */
  tick(heat: number) {
    const col = heatColor(heat)
    this.el.style.setProperty('--heat', col)
    this.el.classList.toggle('hot', heat > 0.72)
    const k = 1.03 + heat * 0.05
    anim(this.lens, [{ transform: `scale(${k})` }, { transform: 'scale(1)' }], { duration: 180, easing: E.out, fill: 'none' })
    anim(this.glow, [{ opacity: 0.55 + heat * 0.45, transform: `scale(${1.04 + heat * 0.12})` }, { opacity: 0.25 + heat * 0.35, transform: 'scale(1)' }], {
      duration: 140 + 280 * (1 - heat),
      easing: E.out,
    })
    anim(this.rimLight, [{ opacity: 0.35 + heat * 0.65 }, { opacity: 0.12 + heat * 0.45 }], { duration: 120 + 280 * (1 - heat), easing: E.out })
    if (reduced) return
    const hop = Math.max(0.6, this.ext * (0.08 + heat * 0.14))
    for (const key of this.keys) {
      if (key.used) continue
      anim(key.el, [{ transform: 'translateY(0)' }, { transform: `translateY(${-hop}px)`, offset: 0.3 }, { transform: 'translateY(0)' }], {
        duration: 140,
        easing: E.out,
        fill: 'none',
      })
    }
  }

  /** A tap relit the fuse: the lens flashes the tapper's colour, then back to calm. */
  relight(color: string) {
    this.el.style.setProperty('--heat', heatColor(0))
    this.el.classList.remove('hot')
    anim(this.lens, [{ backgroundColor: color, transform: 'scale(1.1)' }, { backgroundColor: heatColor(0), transform: 'scale(1)' }], { duration: 420, easing: E.out, fill: 'none' })
    anim(this.glow, [{ opacity: 0.9, transform: 'scale(1.2)', backgroundColor: color }, { opacity: 0.3, transform: 'scale(1)' }], { duration: 420, easing: E.out })
    anim(this.rimLight, [{ opacity: 0.6 }, { opacity: 0.15 }], { duration: 400, easing: E.out })
  }

  calm() {
    this.el.style.setProperty('--heat', heatColor(0))
    this.el.classList.remove('hot')
    anim(this.glow, [{ opacity: 0.25 }], { duration: 300 })
    anim(this.rimLight, [{ opacity: 0.12 }], { duration: 300 })
  }

  /** Boom: the whole instrument convulses, then settles. */
  boom() {
    this.el.classList.remove('hot')
    this.el.style.setProperty('--heat', heatColor(1))
    this.el.classList.add('blown')
    clearTimeout(this.blownT)
    this.blownT = setTimeout(() => this.el.classList.remove('blown'), 1500)
    anim(this.lens, [{ transform: 'scale(1.35)', backgroundColor: '#FFFFFF' }, { transform: 'scale(.92)', offset: 0.35 }, { transform: 'scale(1)' }], {
      duration: 700,
      easing: E.out,
      fill: 'none',
    })
    anim(this.glow, [{ opacity: 1, transform: 'scale(2.2)' }, { opacity: 0, transform: 'scale(1)' }], { duration: 1200, easing: E.out })
    anim(this.rimLight, [{ opacity: 1 }, { opacity: 0.1 }], { duration: 1400, easing: E.out })
    if (reduced) return
    for (const k of this.keys) {
      const dx = k.x - this.size / 2
      const dy = k.y - this.size / 2
      const m = Math.hypot(dx, dy) || 1
      const f = this.d * (0.25 + Math.random() * 0.3)
      const lift = this.d * (0.25 + Math.random() * 0.35)
      const rot = (Math.random() - 0.5) * 70
      anim(
        k.el,
        [
          { transform: 'none' },
          { transform: `translate(${(dx / m) * f}px,${(dy / m) * f - lift}px) rotate(${rot}deg) scale(1.12)`, offset: 0.16, easing: E.out },
          { transform: `translate(${(-dx / m) * f * 0.15}px,${(-dy / m) * f * 0.15 + 2}px) rotate(${-rot * 0.35}deg) scale(.96)`, offset: 0.42, easing: E.inOut },
          { transform: `translate(0,-2px) rotate(${rot * 0.12}deg)`, offset: 0.62 },
          { transform: `translate(0,1px) rotate(${-rot * 0.05}deg)`, offset: 0.8 },
          { transform: 'none' },
        ],
        { duration: 1100, delay: Math.random() * 60, easing: 'linear', fill: 'none' },
      )
    }
    anim(this.base, [{ transform: 'scale(1)' }, { transform: 'scale(1.02)', offset: 0.15 }, { transform: 'scale(.995)', offset: 0.45 }, { transform: 'scale(1)' }], {
      duration: 700,
      fill: 'none',
    })
  }

  /** Locked key: a tiny refusal rattle. */
  nudge(ch: string) {
    const k = this.by.get(ch)
    if (!k) return
    anim(k.el, [{ transform: 'rotate(0)' }, { transform: 'rotate(-6deg)' }, { transform: 'rotate(5deg)' }, { transform: 'rotate(-2deg)' }, { transform: 'rotate(0)' }], {
      duration: 260,
      easing: 'linear',
      fill: 'none',
    })
  }

  /** Idle attract: a soft wave of hops around the ring. */
  shimmer() {
    if (reduced) return
    this.keys.forEach((k, i) => {
      anim(k.el, [{ transform: 'translateY(0)' }, { transform: `translateY(${-this.ext * 0.5}px)`, offset: 0.4 }, { transform: 'translateY(0)' }], {
        duration: 420,
        delay: i * 45,
        easing: E.out,
        fill: 'none',
      })
    })
  }
}
