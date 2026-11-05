import {
  LETTERS,
  type CategoryCard,
  type ClientMsg,
  type Device,
  type Phase,
  type ServerEvent,
  type ServerMsg,
  type Snapshot,
} from '../shared/protocol'
import { CATEGORIES } from './categories'

export interface GameOptions {
  cardMs: number // shuffle + reveal before the ring goes live
  revealMs: number // when within the card phase the card flips
  fuseMin: number // each letter tap lights a fresh hidden fuse in this range
  fuseMax: number
  drawGapMs: number // ignore draws closer together than this (two phones tapping at once)
  random: () => number
}

export const DEFAULTS: GameOptions = {
  cardMs: 3400,
  revealMs: 1700,
  fuseMin: 5000,
  fuseMax: 10_000,
  drawGapMs: 700,
  random: Math.random,
}

const COLORS = 12

type Send = (deviceId: string, msg: ServerMsg) => void

/** One shared table. Everyone connected sees the same ring and can tap or draw. */
export class Game {
  readonly opts: GameOptions
  private send: Send
  private devices: (Device & { online: boolean })[] = []
  private phase: Phase = 'idle'
  private card: CategoryCard | null = null
  private cardN = 0
  private deck: number[] = []
  private used = new Set<string>()
  private taps = 0
  private lit = false
  private cardUntil: number | null = null
  private revealAt: number | null = null
  private fuseStart = 0
  private fuseLen = 0
  private lastDraw = 0
  private cardTimers = new Set<ReturnType<typeof setTimeout>>()
  private fuseTimer: ReturnType<typeof setTimeout> | null = null

  constructor(send: Send, opts: Partial<GameOptions> = {}) {
    this.send = send
    this.opts = { ...DEFAULTS, ...opts }
  }

  join(id: string | undefined): string {
    let d = id ? this.devices.find((x) => x.id === id) : undefined
    if (d) d.online = true
    else {
      d = { id: id && /^[\w-]{6,40}$/.test(id) ? id : crypto.randomUUID(), color: this.freeColor(), online: true }
      this.devices.push(d)
    }
    this.emit({ type: 'joined', id: d.id })
    this.broadcast()
    return d.id
  }

  disconnect(id: string) {
    const d = this.devices.find((x) => x.id === id)
    if (!d) return
    d.online = false
    // Nobody left: the table resets so the next party starts clean.
    if (!this.devices.some((x) => x.online)) {
      this.devices = []
      this.clearAll()
      this.phase = 'idle'
      this.card = null
      this.used.clear()
      this.taps = 0
      this.lit = false
      this.cardUntil = this.revealAt = null
      return
    }
    this.devices = this.devices.filter((x) => x.online)
    this.emit({ type: 'left', id })
    this.broadcast()
  }

  handle(id: string, msg: ClientMsg) {
    if (!this.devices.some((x) => x.id === id)) return
    switch (msg.t) {
      case 'draw':
        this.draw()
        break
      case 'tap':
        this.tap(id, msg.letter)
        break
    }
  }

  // ---- flow ----

  private draw() {
    const now = Date.now()
    if (now - this.lastDraw < this.opts.drawGapMs) return
    this.lastDraw = now
    this.clearAll()
    this.phase = 'card'
    this.card = this.nextCard()
    this.used.clear()
    this.taps = 0
    this.lit = false
    this.cardUntil = now + this.opts.cardMs
    this.revealAt = now + this.opts.revealMs
    this.emit({ type: 'deal' })
    this.cardLater(this.opts.revealMs, () => this.emit({ type: 'reveal' }))
    this.cardLater(this.opts.cardMs, () => {
      this.phase = 'play'
      this.cardUntil = this.revealAt = null
      this.emit({ type: 'go' })
      this.broadcast()
    })
    this.broadcast()
  }

  private tap(id: string, letter: string) {
    if (this.phase !== 'play' || !LETTERS.includes(letter) || this.used.has(letter)) return
    this.used.add(letter)
    this.taps++
    this.emit({ type: 'tap', letter, by: id })
    if (this.used.size >= LETTERS.length) {
      this.used.clear()
      this.emit({ type: 'refill' })
    }
    this.lightFuse()
    this.broadcast()
  }

  /** Every tap restarts the hidden fuse. */
  private lightFuse() {
    if (this.fuseTimer) clearTimeout(this.fuseTimer)
    const { fuseMin, fuseMax, random } = this.opts
    this.fuseStart = Date.now()
    this.fuseLen = fuseMin + random() * (fuseMax - fuseMin)
    this.lit = true
    this.tickLoop()
  }

  private tickLoop() {
    if (this.phase !== 'play') return
    const elapsed = Date.now() - this.fuseStart
    if (elapsed >= this.fuseLen) return this.boom()
    const heat = Math.min(1, elapsed / this.fuseLen)
    this.emit({ type: 'tick', heat })
    // 600ms between ticks when cold, ~160ms when about to blow.
    const gap = Math.max(160, 600 - 440 * heat ** 1.3)
    this.fuseTimer = setTimeout(() => this.tickLoop(), Math.min(gap, this.fuseLen - elapsed))
  }

  private boom() {
    this.fuseTimer = null
    this.phase = 'boom'
    this.lit = false
    this.emit({ type: 'boom' })
    this.broadcast()
  }

  // ---- helpers ----

  private nextCard(): CategoryCard {
    if (this.deck.length === 0) {
      this.deck = CATEGORIES.map((_, i) => i)
      for (let i = this.deck.length - 1; i > 0; i--) {
        const j = Math.floor(this.opts.random() * (i + 1))
        ;[this.deck[i], this.deck[j]] = [this.deck[j]!, this.deck[i]!]
      }
    }
    const [emoji, text] = CATEGORIES[this.deck.pop()!]!
    return { emoji, text, n: ++this.cardN }
  }

  private freeColor(): number {
    const taken = new Set(this.devices.map((d) => d.color))
    for (let c = 0; c < COLORS; c++) if (!taken.has(c)) return c
    return this.devices.length % COLORS
  }

  private cardLater(ms: number, fn: () => void) {
    const t = setTimeout(() => {
      this.cardTimers.delete(t)
      fn()
    }, ms)
    this.cardTimers.add(t)
  }

  private clearAll() {
    for (const t of this.cardTimers) clearTimeout(t)
    this.cardTimers.clear()
    if (this.fuseTimer) clearTimeout(this.fuseTimer)
    this.fuseTimer = null
  }

  private emit(e: ServerEvent) {
    for (const d of this.devices) if (d.online) this.send(d.id, { t: 'ev', e })
  }

  snapshot(forId: string): Snapshot {
    return {
      phase: this.phase,
      now: Date.now(),
      you: forId,
      devices: this.devices.filter((d) => d.online).map(({ id, color }) => ({ id, color })),
      card: this.card,
      letters: LETTERS.map((ch) => ({ ch, used: this.used.has(ch) })),
      taps: this.taps,
      lit: this.lit,
      cardUntil: this.cardUntil,
      revealAt: this.revealAt,
    }
  }

  broadcast() {
    for (const d of this.devices) if (d.online) this.send(d.id, { t: 'state', s: this.snapshot(d.id) })
  }

  dispose() {
    this.clearAll()
  }
}
