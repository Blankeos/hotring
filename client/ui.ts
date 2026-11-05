// Tiny presence row (one dot per phone at the table) and the share/QR overlay.
import QRCode from 'qrcode'
import type { Device } from '../shared/protocol'
import { E, anim, h } from './dom'
import type { Fx } from './fx'
import { CREAM, INK, pc } from './palette'
import { roomCode } from './room'

export class Presence {
  el: HTMLDivElement
  private dots = new Map<string, HTMLDivElement>()
  private first = true

  constructor(parent: HTMLElement, private fx: Fx) {
    this.el = h('div', '', parent)
    this.el.id = 'presence'
  }

  sync(devices: Device[], you: string) {
    const seen = new Set<string>()
    devices.forEach((d, i) => {
      seen.add(d.id)
      let dot = this.dots.get(d.id)
      if (!dot) {
        dot = h('div', 'dot')
        this.dots.set(d.id, dot)
        const fresh = !this.first
        const el = dot
        anim(el, [{ transform: 'scale(0)' }, { transform: 'scale(1.6)', offset: 0.5, easing: E.out }, { transform: 'scale(1)' }], {
          duration: 520,
          delay: this.first ? i * 60 : 0,
          easing: E.out,
        })
        if (fresh)
          requestAnimationFrame(() => {
            const r = el.getBoundingClientRect()
            const c = pc(d.color)
            this.fx.burst(r.left + r.width / 2, r.top + r.height / 2, { colors: [c, c, CREAM], n: 18, speed: [60, 220], size: [1.5, 3.5], g: 60, life: [0.3, 0.7] })
            this.fx.shock(r.left + r.width / 2, r.top + r.height / 2, c, 22, 0.45, 3)
          })
      }
      if (this.el.children[i] !== dot) this.el.insertBefore(dot, this.el.children[i] ?? null)
      dot.style.setProperty('--c', pc(d.color))
      dot.classList.toggle('me', d.id === you)
    })
    for (const [id, dot] of this.dots) {
      if (seen.has(id)) continue
      this.dots.delete(id)
      anim(dot, [{ transform: 'scale(1)', opacity: 1 }, { transform: 'scale(0)', opacity: 0 }], { duration: 260, easing: E.in })
        .finished.then(() => dot.remove())
        .catch(() => dot.remove())
    }
    this.first = devices.length === 0
  }

  /** Little hop of the tapper's dot, so the table sees who pressed. */
  hop(id: string) {
    const dot = this.dots.get(id)
    if (dot) anim(dot, [{ transform: 'translateY(0)' }, { transform: 'translateY(-5px) scale(1.25)', offset: 0.35 }, { transform: 'translateY(0)' }], { duration: 320, easing: E.out, fill: 'none' })
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
