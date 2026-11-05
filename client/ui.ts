// People on screen: the big hero avatar in the ring centre, the tiny players
// strip on top, and the lobby orbit. Plus the name prompt and share overlay.
import QRCode from 'qrcode'
import type { PlayerView } from '../shared/protocol'
import { MAX_MARKS, MAX_NAME } from '../shared/protocol'
import { E, ICON, anim, h, initial, reduced } from './dom'
import type { Fx } from './fx'
import { CREAM, GOLD, INK, pc } from './palette'

function pips(parent: HTMLElement) {
  const row = h('div', 'pips', parent)
  return Array.from({ length: MAX_MARKS }, () => h('span', 'pip', row))
}

function popPip(p: HTMLElement, delay: number) {
  anim(
    p,
    [
      { transform: 'scale(1)', background: 'transparent' },
      { transform: 'scale(2.2)', offset: 0.45, easing: E.out },
      { transform: 'scale(1)' },
    ],
    { duration: 520, delay, easing: E.out, fill: 'none' },
  )
}

// ---------------------------------------------------------------------------

export class Hero {
  el: HTMLDivElement
  private body: HTMLDivElement
  private disc: HTMLDivElement
  private ini: HTMLSpanElement
  private halo: HTMLDivElement
  private cross: HTMLDivElement
  private crown: HTMLDivElement
  private name: HTMLDivElement
  private pips: HTMLSpanElement[]
  id: string | null = null
  private marks = 0
  private out = false
  private crowned = false
  private shown = false
  pipDelay = 0
  private swapTok = 0

  constructor(parent: HTMLElement, private fx: Fx) {
    this.el = h('div', '', parent)
    this.el.id = 'hero'
    this.body = h('div', 'body', this.el)
    this.halo = h('div', 'halo', this.body)
    this.disc = h('div', 'disc', this.body)
    this.ini = h('span', 'ini', this.disc)
    this.cross = h('div', 'cross', this.disc, ICON.cross)
    this.crown = h('div', 'crown', this.body, ICON.crown)
    const meta = h('div', 'meta', this.el)
    this.name = h('div', 'name', meta)
    this.pips = pips(meta)
  }

  private fill(p: PlayerView, mine: boolean) {
    this.el.style.setProperty('--c', p.out ? '#3A3354' : pc(p.color))
    this.ini.textContent = initial(p.name)
    this.name.textContent = p.name
    this.el.classList.toggle('mine', mine)
    this.el.classList.toggle('off', !p.online)
    this.el.classList.toggle('isout', p.out)
    this.pips.forEach((e, i) => e.classList.toggle('on', i < p.marks))
    this.cross.classList.toggle('on', p.out)
  }

  show(p: PlayerView, o: { mine: boolean; crown: boolean }) {
    const same = this.id === p.id
    if (!this.shown) {
      this.shown = true
      this.el.classList.add('on')
      this.fill(p, o.mine)
      anim(this.body, [{ transform: 'scale(0)' }, { transform: 'scale(1.12)', offset: 0.6 }, { transform: 'scale(1)' }], { duration: 480, easing: E.out })
      anim(this.el.querySelector('.meta')!, [{ opacity: 0, transform: 'translate(-50%,8px)' }, { opacity: 1, transform: 'translate(-50%,0)' }], { duration: 400, delay: 120 })
    } else if (!same) {
      // Turn passes: squash out, swap, spring in.
      anim(
        this.body,
        [
          { transform: 'scale(1) rotate(0)' },
          { transform: 'scale(.55) rotate(-12deg)', offset: 0.35, easing: E.in },
          { transform: 'scale(1.14) rotate(4deg)', offset: 0.7, easing: E.out },
          { transform: 'scale(1) rotate(0)' },
        ],
        { duration: 420, easing: 'linear' },
      )
      const tok = ++this.swapTok
      setTimeout(() => tok === this.swapTok && this.fill(p, o.mine), 150)
    } else {
      // Same player: animate what changed.
      const tok = ++this.swapTok
      const live = () => tok === this.swapTok && this.id === p.id
      const newMarks = p.marks > this.marks
      const before = this.marks
      this.fill(p, o.mine)
      if (newMarks) {
        for (let i = before; i < p.marks && i < MAX_MARKS; i++) {
          const pip = this.pips[i]!
          pip.classList.remove('on')
          setTimeout(() => live() && pip.classList.add('on'), this.pipDelay)
          popPip(pip, this.pipDelay)
        }
      }
      if (p.out && !this.out) {
        this.cross.classList.remove('on')
        setTimeout(() => {
          if (!live()) return
          this.cross.classList.add('on')
          anim(this.cross, [{ transform: 'scale(2.4) rotate(-30deg)', opacity: 0 }, { transform: 'scale(1) rotate(0)', opacity: 1 }], {
            duration: 380,
            easing: E.springHard,
            fill: 'none',
          })
        }, this.pipDelay + 380)
      }
    }
    if (o.crown && !this.crowned) {
      this.crowned = true
      this.crown.classList.add('on')
      anim(
        this.crown,
        [
          { transform: 'translate(-50%,-160%) rotate(-25deg)', opacity: 0 },
          { transform: 'translate(-50%,8%) rotate(6deg)', opacity: 1, offset: 0.6, easing: E.in },
          { transform: 'translate(-50%,-12%) rotate(-3deg)', offset: 0.8, easing: E.out },
          { transform: 'translate(-50%,0) rotate(0)', opacity: 1 },
        ],
        { duration: 760, delay: 250, easing: 'linear', fill: 'backwards' },
      )
      setTimeout(() => {
        const r = this.crown.getBoundingClientRect()
        this.fx.stars(r.left + r.width / 2, r.top + r.height / 2, { colors: [GOLD, CREAM], n: 10, radius: r.width * 0.7, size: [5, 11] })
      }, 700)
    } else if (!o.crown && this.crowned) {
      this.crowned = false
      this.crown.classList.remove('on')
    }
    this.id = p.id
    this.marks = p.marks
    this.out = p.out
    this.pipDelay = 0
  }

  hide() {
    if (!this.shown) return
    this.shown = false
    this.id = null
    this.crowned = false
    this.crown.classList.remove('on')
    const a = anim(this.body, [{ transform: 'scale(1)' }, { transform: 'scale(0)' }], { duration: 220, easing: E.in })
    a.finished.then(() => !this.shown && this.el.classList.remove('on')).catch(() => {})
  }

  thump(heat: number) {
    if (!this.shown) return
    const k = reduced ? 1.02 : 1.04 + heat * 0.06
    anim(this.disc, [{ transform: 'scale(1)' }, { transform: `scale(${k})`, offset: 0.25 }, { transform: 'scale(1)' }], {
      duration: 200,
      easing: E.out,
      fill: 'none',
    })
  }

  discCenter() {
    const r = this.disc.getBoundingClientRect()
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, r: r.width / 2 }
  }
}

// ---------------------------------------------------------------------------

interface StripItem {
  el: HTMLDivElement
  disc: HTMLDivElement
  pips: HTMLSpanElement[]
  marks: number
}

export class Strip {
  el: HTMLDivElement
  private items = new Map<string, StripItem>()

  constructor(parent: HTMLElement) {
    this.el = h('div', '', parent)
    this.el.id = 'strip'
  }

  sync(players: PlayerView[], turn: string | null, you: string, size: number) {
    this.el.style.setProperty('--a', size + 'px')
    const seen = new Set<string>()
    players.forEach((p, idx) => {
      seen.add(p.id)
      let it = this.items.get(p.id)
      if (!it) {
        const el = h('div', 'pl')
        const disc = h('div', 'disc', el)
        h('span', 'ini', disc)
        h('div', 'cross', disc, ICON.cross)
        it = { el, disc, pips: pips(el), marks: p.marks }
        this.items.set(p.id, it)
        anim(el, [{ transform: 'scale(0)' }, { transform: 'scale(1)' }], { duration: 360, easing: E.spring, fill: 'none' })
      }
      if (this.el.children[idx] !== it.el) this.el.insertBefore(it.el, this.el.children[idx] ?? null)
      it.el.style.setProperty('--c', pc(p.color))
      it.disc.querySelector('.ini')!.textContent = initial(p.name)
      it.el.title = p.name
      it.el.classList.toggle('turn', p.id === turn)
      it.el.classList.toggle('out', p.out)
      it.el.classList.toggle('off', !p.online)
      it.el.classList.toggle('me', p.id === you)
      it.pips.forEach((e, i) => e.classList.toggle('on', i < p.marks))
      if (p.marks > it.marks) for (let i = it.marks; i < p.marks && i < MAX_MARKS; i++) popPip(it.pips[i]!, 500)
      it.marks = p.marks
    })
    for (const [id, it] of this.items)
      if (!seen.has(id)) {
        this.items.delete(id)
        it.el.remove()
      }
  }

  center(id: string) {
    const it = this.items.get(id)
    if (!it) return null
    const r = it.disc.getBoundingClientRect()
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
  }
}

// ---------------------------------------------------------------------------

interface OrbitItem {
  el: HTMLDivElement
  pop: HTMLDivElement
  disc: HTMLDivElement
  name: HTMLDivElement
  leaving: boolean
  ang: number // current angle (eases toward target)
  target: number
  rad: number
}

export class Orbit {
  el: HTMLDivElement
  private items = new Map<string, OrbitItem>()
  private first = true
  onKick: (id: string) => void = () => {}
  onJoinFx: (x: number, y: number, color: string) => void = () => {}

  constructor(parent: HTMLElement) {
    this.el = h('div', '', parent)
    this.el.id = 'orbit'
    document.addEventListener(
      'pointerdown',
      (e) => {
        if ((e.target as Element).closest?.('.kx')) return
        for (const it of this.items.values()) it.el.classList.remove('kick')
      },
      true,
    )
  }

  sync(players: PlayerView[], o: { you: string; isHost: boolean; radius: number; a: number }) {
    const n = players.length
    this.el.style.setProperty('--a', o.a + 'px')
    this.el.classList.toggle('nonames', n > 8)
    const seen = new Set<string>()
    players.forEach((p, i) => {
      seen.add(p.id)
      let it = this.items.get(p.id)
      const ang = -Math.PI / 2 + (i * Math.PI * 2) / Math.max(1, n)
      const rad = n === 1 ? 0 : o.radius
      if (!it) {
        const el = h('div', 'oi', this.el)
        const pop = h('div', 'pop', el)
        const disc = h('div', 'disc', pop)
        h('span', 'ini', disc)
        const name = h('div', 'name', pop)
        const kx = h('button', 'kx', pop, ICON.x)
        kx.type = 'button'
        kx.setAttribute('aria-label', 'remove')
        it = { el, pop, disc, name, leaving: false, ang, target: ang, rad }
        const item = it
        const id = p.id
        kx.addEventListener('click', (e) => {
          e.stopPropagation()
          this.onKick(id)
          item.el.classList.remove('kick')
        })
        let timer: ReturnType<typeof setTimeout> | null = null
        const cancel = () => {
          if (timer) clearTimeout(timer)
          timer = null
        }
        disc.addEventListener('pointerdown', (e) => {
          if (!el.classList.contains('kickable')) return
          e.preventDefault()
          cancel()
          timer = setTimeout(() => {
            el.classList.add('kick')
            navigator.vibrate?.(12)
            anim(kx, [{ transform: 'scale(0)' }, { transform: 'scale(1)' }], { duration: 300, easing: E.spring, fill: 'none' })
          }, 520)
        })
        disc.addEventListener('pointerup', cancel)
        disc.addEventListener('pointerleave', cancel)
        disc.addEventListener('pointercancel', cancel)
        disc.addEventListener('contextmenu', (e) => e.preventDefault())
        this.place(it)
        this.items.set(p.id, it)
        const delay = this.first ? i * 70 : 0
        anim(
          pop,
          [{ transform: 'scale(0)' }, { transform: 'scale(1.25)', offset: 0.55, easing: E.out }, { transform: 'scale(.94)', offset: 0.8 }, { transform: 'scale(1)' }],
          { duration: 560, delay, easing: E.out },
        )
        if (!this.first) {
          const col = pc(p.color)
          requestAnimationFrame(() => {
            const r = disc.getBoundingClientRect()
            this.onJoinFx(r.left + r.width / 2, r.top + r.height / 2, col)
          })
        }
      }
      // Shortest way round to the new slot.
      let t = ang
      while (t - it.ang > Math.PI) t -= Math.PI * 2
      while (t - it.ang < -Math.PI) t += Math.PI * 2
      it.target = t
      it.rad = rad
      it.el.style.setProperty('--c', pc(p.color))
      it.disc.querySelector('.ini')!.textContent = initial(p.name)
      it.name.textContent = p.name
      it.el.classList.toggle('me', p.id === o.you)
      it.el.classList.toggle('off', !p.online)
      it.el.classList.toggle('kickable', o.isHost && p.id !== o.you)
    })
    for (const [id, it] of this.items) {
      if (seen.has(id) || it.leaving) continue
      it.leaving = true
      this.items.delete(id)
      this.cur.delete(it)
      anim(it.pop, [{ transform: 'scale(1)', opacity: 1 }, { transform: 'scale(0)', opacity: 0 }], { duration: 260, easing: E.in })
        .finished.then(() => it.el.remove())
        .catch(() => it.el.remove())
    }
    this.first = players.length === 0
    if (!this.raf) {
      this.last = performance.now()
      this.raf = requestAnimationFrame(this.frame)
    }
  }

  private raf = 0
  private last = 0
  private rot = 0
  private cur = new Map<OrbitItem, number>()

  private place(it: OrbitItem) {
    const r = this.cur.get(it) ?? it.rad
    const a = it.ang + this.rot
    it.el.style.transform = `translate(${(Math.cos(a) * r).toFixed(2)}px,${(Math.sin(a) * r).toFixed(2)}px)`
  }

  /** Slow drift of the whole orbit; members glide to new slots when people come and go. */
  private frame = (now: number) => {
    const dt = Math.min(0.05, (now - this.last) / 1000)
    this.last = now
    if (!reduced) this.rot += dt * 0.07
    const k = 1 - Math.exp(-dt * 5)
    for (const it of this.items.values()) {
      it.ang += (it.target - it.ang) * k
      const r = this.cur.get(it) ?? it.rad
      this.cur.set(it, r + (it.rad - r) * k)
      this.place(it)
    }
    this.raf = this.items.size ? requestAnimationFrame(this.frame) : 0
  }

  reset() {
    for (const it of this.items.values()) it.el.remove()
    this.items.clear()
    this.cur.clear()
    this.first = true
  }
}

// ---------------------------------------------------------------------------

export class NameBox {
  el: HTMLFormElement
  input: HTMLInputElement
  onSubmit: (name: string) => void = () => {}

  constructor(parent: HTMLElement) {
    this.el = h('form', '', parent)
    this.el.id = 'namebox'
    this.el.autocomplete = 'off'
    this.input = h('input', '', this.el)
    this.input.maxLength = MAX_NAME
    this.input.placeholder = 'name'
    this.input.setAttribute('aria-label', 'name')
    this.input.enterKeyHint = 'go'
    this.input.autocapitalize = 'words'
    this.input.spellcheck = false
    const go = h('button', 'go', this.el, ICON.arrow)
    go.type = 'submit'
    go.setAttribute('aria-label', 'continue')
    this.el.addEventListener('submit', (e) => {
      e.preventDefault()
      const v = this.input.value.trim().slice(0, MAX_NAME)
      if (!v) {
        anim(this.el, [{ transform: 'translateX(0)' }, { transform: 'translateX(-8px)' }, { transform: 'translateX(8px)' }, { transform: 'translateX(0)' }], {
          duration: 260,
          fill: 'none',
        })
        this.input.focus()
        return
      }
      this.input.blur()
      this.onSubmit(v)
    })
  }

  show(name: string) {
    this.input.value = name
    this.el.classList.add('on')
    if (matchMedia('(pointer: fine)').matches) setTimeout(() => this.input.focus(), 50)
    anim(this.el, [{ transform: 'scale(.8)', opacity: 0 }, { transform: 'scale(1)', opacity: 1 }], { duration: 420, easing: E.spring, fill: 'none' })
  }

  hide() {
    this.el.classList.remove('on')
  }
}

// ---------------------------------------------------------------------------

export class Share {
  el: HTMLDivElement
  private box: HTMLDivElement
  private canvas: HTMLCanvasElement
  private url: HTMLDivElement
  open = false

  constructor(parent: HTMLElement) {
    this.el = h('div', '', parent)
    this.el.id = 'share'
    this.el.setAttribute('role', 'dialog')
    this.box = h('div', 'qrbox', this.el)
    this.canvas = h('canvas', '', this.box)
    this.url = h('div', 'url', this.el)
    this.el.addEventListener('pointerdown', (e) => {
      if (e.target === this.el || e.target === this.url) this.close()
    })
    document.addEventListener('keydown', (e) => e.key === 'Escape' && this.close())
  }

  static async joinUrl(): Promise<string> {
    const local = /^(localhost|127\.0\.0\.1|\[?::1\]?|0\.0\.0\.0)$/.test(location.hostname)
    if (!local) return location.origin + '/'
    try {
      const r = await fetch('/api/lan')
      const j = (await r.json()) as { ips: string[]; port: number }
      if (j.ips[0]) return `http://${j.ips[0]}:${j.port}/`
    } catch {
      /* fall through */
    }
    return location.origin + '/'
  }

  async show() {
    if (this.open) return
    this.open = true
    this.el.classList.add('on')
    const url = await Share.joinUrl()
    this.url.textContent = url.replace(/^https?:\/\//, '').replace(/\/$/, '')
    this.el.dataset.url = url
    const size = Math.min(innerWidth, innerHeight) * 0.62
    const px = Math.round(Math.min(320, Math.max(200, size)))
    await QRCode.toCanvas(this.canvas, url, { width: px, margin: 2, errorCorrectionLevel: 'M', color: { dark: INK, light: CREAM } }).catch(() => {})
    anim(this.el, [{ opacity: 0 }, { opacity: 1 }], { duration: 220, fill: 'none' })
    anim(this.box, [{ transform: 'scale(.7) rotate(-6deg)' }, { transform: 'scale(1.04) rotate(1deg)', offset: 0.6 }, { transform: 'scale(1) rotate(0)' }], {
      duration: 460,
      easing: E.out,
      fill: 'none',
    })
  }

  close() {
    if (!this.open) return
    this.open = false
    const a = anim(this.el, [{ opacity: 1 }, { opacity: 0 }], { duration: 180, easing: E.in })
    a.finished
      .then(() => {
        if (!this.open) this.el.classList.remove('on')
        a.cancel()
      })
      .catch(() => {})
  }
}
