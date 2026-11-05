// The roster row (players live on the table, not on phones), the add/edit popover,
// and the share/QR overlay.
import QRCode from 'qrcode'
import type { Phase, PlayerView } from '../shared/protocol'
import { MAX_MARKS, MAX_NAME, MAX_PLAYERS } from '../shared/protocol'
import { E, ICON, anim, h, initial } from './dom'
import type { Fx } from './fx'
import { CREAM, INK, pc, shade } from './palette'
import { roomCode } from './room'

interface Item {
  el: HTMLDivElement
  disc: HTMLButtonElement
  ini: HTMLSpanElement
  pips: HTMLSpanElement[]
  cross: HTMLDivElement
  crown: HTMLDivElement
  marks: number
  out: boolean
}

export class Roster {
  el: HTMLDivElement
  private items = new Map<string, Item>()
  private add: HTMLButtonElement
  private addWrap: HTMLDivElement
  private halo: HTMLDivElement
  private first = true
  private turn: string | null = null
  /** mark pops wait for the boom to land */
  pipDelay = 0
  onOpen: (id: string, anchor: DOMRect) => void = () => {}
  onAdd: (anchor: DOMRect) => void = () => {}

  constructor(parent: HTMLElement, private fx: Fx) {
    this.el = h('div', '', parent)
    this.el.id = 'roster'
    this.halo = h('div', 'halo', this.el)
    this.addWrap = h('div', 'pl addwrap', this.el)
    this.add = h('button', 'disc add', this.addWrap, ICON.plus)
    this.add.type = 'button'
    this.add.setAttribute('aria-label', 'add player')
    this.add.addEventListener('click', () => this.onAdd(this.add.getBoundingClientRect()))
  }

  sync(players: PlayerView[], o: { turn: string | null; winner: string | null; phase: Phase; size: number }) {
    this.el.style.setProperty('--a', o.size + 'px')
    this.el.classList.toggle('empty', players.length === 0)
    this.addWrap.classList.toggle('full', players.length >= MAX_PLAYERS)
    const seen = new Set<string>()
    players.forEach((p, i) => {
      seen.add(p.id)
      let it = this.items.get(p.id)
      if (!it) {
        const el = h('div', 'pl')
        const disc = h('button', 'disc', el)
        disc.type = 'button'
        const ini = h('span', 'ini', disc)
        const cross = h('div', 'cross', disc, ICON.cross)
        const crown = h('div', 'crown', el, ICON.crown)
        const row = h('div', 'pips', el)
        const pips = Array.from({ length: MAX_MARKS }, () => h('span', 'pip', row))
        it = { el, disc, ini, pips, cross, crown, marks: p.marks, out: p.out }
        const id = p.id
        disc.addEventListener('click', () => this.onOpen(id, disc.getBoundingClientRect()))
        this.items.set(p.id, it)
        const item = it
        anim(el, [{ transform: 'scale(0)' }, { transform: 'scale(1.3)', offset: 0.55, easing: E.out }, { transform: 'scale(.94)', offset: 0.8 }, { transform: 'scale(1)' }], {
          duration: 520,
          delay: this.first ? i * 50 : 0,
          easing: E.out,
          fill: 'backwards',
        })
        if (!this.first) {
          const col = pc(p.color)
          requestAnimationFrame(() => {
            const r = item.disc.getBoundingClientRect()
            const x = r.left + r.width / 2
            const y = r.top + r.height / 2
            this.fx.burst(x, y, { colors: [col, col, CREAM], n: 30, speed: [90, 320], size: [2, 4], g: 120, life: [0.4, 0.8], streak: 0.3 })
            this.fx.shock(x, y, col, r.width * 1.2, 0.5, 4)
            this.fx.stars(x, y, { colors: [col, CREAM], n: 4, radius: r.width })
          })
        }
      }
      if (this.el.children[i + 1] !== it.el) this.el.insertBefore(it.el, this.el.children[i + 1] ?? this.addWrap)
      const col = p.out ? '#3a3354' : pc(p.color)
      it.el.style.setProperty('--c', col)
      it.el.style.setProperty('--cd', shade(col, 0.42))
      it.ini.textContent = initial(p.name)
      it.disc.setAttribute('aria-label', p.name)
      it.el.classList.toggle('turn', p.id === o.turn && o.phase !== 'over')
      it.el.classList.toggle('win', p.id === o.winner)
      // marks: pop the new pip once the boom lands
      it.pips.forEach((e, k) => {
        const was = k < it!.marks
        const now = k < p.marks
        if (now && !was) {
          setTimeout(() => {
            e.classList.add('on')
            anim(e, [{ transform: 'scale(1)' }, { transform: 'scale(2.6)', offset: 0.4, easing: E.out }, { transform: 'scale(1)' }], { duration: 520, easing: E.out, fill: 'none' })
          }, this.pipDelay)
        } else e.classList.toggle('on', now)
      })
      if (p.out && !it.out) {
        const item = it
        setTimeout(() => {
          item.el.classList.add('out')
          anim(item.cross, [{ transform: 'scale(2.4) rotate(-30deg)', opacity: 0 }, { transform: 'scale(1) rotate(0)', opacity: 1 }], { duration: 380, easing: E.springHard, fill: 'none' })
        }, this.pipDelay + 420)
      } else if (!p.out) it.el.classList.remove('out')
      if (p.id === o.winner && !it.crown.dataset.shown) {
        it.crown.dataset.shown = '1'
        anim(it.crown, [{ transform: 'translate(-50%,-200%) rotate(-25deg)', opacity: 0 }, { transform: 'translate(-50%,10%) rotate(6deg)', opacity: 1, offset: 0.65 }, { transform: 'translate(-50%,0) rotate(0)', opacity: 1 }], {
          duration: 700,
          delay: 300,
          easing: E.out,
          fill: 'backwards',
        })
      } else if (p.id !== o.winner) delete it.crown.dataset.shown
      it.marks = p.marks
      it.out = p.out
    })
    for (const [id, it] of this.items) {
      if (seen.has(id)) continue
      this.items.delete(id)
      anim(it.el, [{ transform: 'scale(1)', opacity: 1 }, { transform: 'scale(0)', opacity: 0 }], { duration: 240, easing: E.in })
        .finished.then(() => it.el.remove())
        .catch(() => it.el.remove())
    }
    this.pipDelay = 0
    this.first = false
    const turnP = players.find((p) => p.id === o.turn)
    this.turn = o.phase !== 'over' && turnP && !turnP.out ? turnP.id : null
    this.el.style.setProperty('--hc', turnP ? pc(turnP.color) : CREAM)
    requestAnimationFrame(() => this.placeHalo())
  }

  /** The turn highlight slides from disc to disc. */
  placeHalo() {
    const it = this.turn ? this.items.get(this.turn) : undefined
    if (!it || !it.el.isConnected) {
      this.halo.classList.remove('on')
      return
    }
    const x = it.el.offsetLeft + it.disc.offsetLeft + it.disc.offsetWidth / 2
    const y = it.el.offsetTop + it.disc.offsetTop + it.disc.offsetHeight / 2
    const was = this.halo.classList.contains('on')
    if (!was) this.halo.style.transition = 'none'
    this.halo.style.transform = `translate(${x}px,${y}px)`
    if (!was) {
      void this.halo.offsetWidth
      this.halo.style.transition = ''
      this.halo.classList.add('on')
    }
  }

  center(id: string | null) {
    const it = id ? this.items.get(id) : undefined
    if (!it) return null
    const r = it.disc.getBoundingClientRect()
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
  }

  rect(id: string) {
    return this.items.get(id)?.disc.getBoundingClientRect() ?? null
  }

  addRect() {
    return this.add.getBoundingClientRect()
  }
}

// ---------------------------------------------------------------------------

/** One small floating plate: add players (keeps open for a whole party), or edit/remove one. */
export class Pop {
  el: HTMLDivElement
  private input: HTMLInputElement
  private nameBtn: HTMLButtonElement
  private go: HTMLButtonElement
  private del: HTMLButtonElement
  mode: 'none' | 'add' | 'player' | 'rename' = 'none'
  target: string | null = null
  private anchor: () => DOMRect | null = () => null
  onAdd: (name: string) => void = () => {}
  onRemove: (id: string) => void = () => {}
  onRename: (id: string, name: string) => void = () => {}

  constructor(parent: HTMLElement) {
    this.el = h('div', '', parent)
    this.el.id = 'pop'
    h('div', 'nub', this.el)
    const form = h('form', 'row', this.el)
    form.autocomplete = 'off'
    this.input = h('input', '', form)
    this.input.maxLength = MAX_NAME
    this.input.enterKeyHint = 'done'
    this.input.autocapitalize = 'words'
    this.input.spellcheck = false
    this.input.setAttribute('aria-label', 'name')
    this.nameBtn = h('button', 'name', form)
    this.nameBtn.type = 'button'
    this.go = h('button', 'go', form, ICON.plus)
    this.go.type = 'submit'
    this.del = h('button', 'del', form, ICON.x)
    this.del.type = 'button'
    this.del.setAttribute('aria-label', 'remove')
    form.addEventListener('submit', (e) => {
      e.preventDefault()
      this.submit()
    })
    this.nameBtn.addEventListener('click', () => {
      if (this.mode !== 'player') return
      this.mode = 'rename'
      this.paint()
      this.input.value = this.nameBtn.textContent ?? ''
      this.input.focus()
      this.input.select()
    })
    this.del.addEventListener('click', () => {
      if (this.target) this.onRemove(this.target)
      this.close()
    })
    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.close()
    })
    document.addEventListener(
      'pointerdown',
      (e) => {
        if (this.mode === 'none') return
        const t = e.target as Element
        if (this.el.contains(t) || t.closest?.('#roster .disc')) return
        this.close()
      },
      true,
    )
  }

  private submit() {
    const v = this.input.value.trim().slice(0, MAX_NAME)
    if (this.mode === 'add') {
      if (!v) return this.close()
      this.onAdd(v)
      this.input.value = ''
      this.input.focus()
    } else if (this.mode === 'rename' && this.target) {
      if (v) this.onRename(this.target, v)
      this.close()
    }
  }

  private paint() {
    this.el.dataset.mode = this.mode
    this.go.innerHTML = this.mode === 'add' ? ICON.plus : '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5.5 12.5l4.2 4.2 8.8-9.4"/></svg>'
    this.go.setAttribute('aria-label', this.mode === 'add' ? 'add' : 'save')
  }

  openAdd(anchor: () => DOMRect | null) {
    this.mode = 'add'
    this.target = null
    this.anchor = anchor
    this.input.value = ''
    this.input.placeholder = '+'
    this.el.style.setProperty('--c', CREAM)
    this.show()
    this.input.focus()
  }

  openPlayer(p: PlayerView, anchor: () => DOMRect | null) {
    this.mode = 'player'
    this.target = p.id
    this.anchor = anchor
    this.nameBtn.textContent = p.name
    this.input.placeholder = ''
    this.el.style.setProperty('--c', pc(p.color))
    this.show()
  }

  private show() {
    this.paint()
    this.el.classList.add('on')
    this.place()
    anim(this.el, [{ transform: 'translateY(-6px) scale(.9)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 260, easing: E.spring, fill: 'none' })
  }

  /** Sit under the anchor disc, clamped to the screen. */
  place() {
    if (this.mode === 'none') return
    const a = this.anchor()
    if (!a || !a.width) return this.close()
    const w = this.el.offsetWidth
    const x = Math.max(8, Math.min(innerWidth - w - 8, a.left + a.width / 2 - w / 2))
    this.el.style.left = x + 'px'
    this.el.style.top = a.bottom + 14 + 'px'
    this.el.style.setProperty('--nub', a.left + a.width / 2 - x + 'px')
  }

  close() {
    if (this.mode === 'none') return
    this.mode = 'none'
    this.target = null
    this.input.blur()
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
    if (!local) return `${location.origin}/?r=${roomCode}`
    try {
      const r = await fetch('/api/lan')
      const j = (await r.json()) as { ips: string[]; port: number }
      if (j.ips[0]) return `http://${j.ips[0]}:${j.port}/?r=${roomCode}`
    } catch {
      /* fall through */
    }
    return `${location.origin}/?r=${roomCode}`
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
