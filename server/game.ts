import {
  LETTERS,
  MAX_MARKS,
  MAX_NAME,
  MAX_PLAYERS,
  type CategoryCard,
  type ClientMsg,
  type Phase,
  type PlayerView,
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
  overMs: number // after the last boom, how long before 'over' shows
  random: () => number
}

export const DEFAULTS: GameOptions = {
  cardMs: 3400,
  revealMs: 1700,
  fuseMin: 5000,
  fuseMax: 10_000,
  drawGapMs: 700,
  overMs: 2600,
  random: Math.random,
}

const COLORS = 12

type Send = (remoteId: string, msg: ServerMsg) => void

/** One shared table. Everyone connected sees the same ring and can tap, draw or edit the roster. */
export class Game {
  readonly opts: GameOptions
  private send: Send
  private remotes = new Map<string, true>() // connected phone ids
  private players: PlayerView[] = []
  private turn: string | null = null
  private loser: string | null = null
  private winner: string | null = null
  /** called after roster changes so the host can persist them */
  onPersist: (() => void) | null = null
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
  private overPending = false
  private cardTimers = new Set<ReturnType<typeof setTimeout>>()
  private fuseTimer: ReturnType<typeof setTimeout> | null = null

  constructor(send: Send, opts: Partial<GameOptions> = {}) {
    this.send = send
    this.opts = { ...DEFAULTS, ...opts }
  }

  /** A phone connected. Returns its id. */
  join(id: string | undefined): string {
    const rid = id && /^[\w-]{6,40}$/.test(id) ? id : crypto.randomUUID()
    this.remotes.set(rid, true)
    this.emit({ type: 'joined' })
    this.broadcast()
    return rid
  }

  disconnect(id: string) {
    if (!this.remotes.delete(id)) return
    // Nobody watching: stop the clock, keep the roster and marks.
    if (this.remotes.size === 0) {
      this.clearAll()
      this.phase = 'idle'
      this.used.clear()
      this.taps = 0
      this.lit = false
      this.loser = this.winner = null
      this.cardUntil = this.revealAt = null
      return
    }
    this.emit({ type: 'left' })
    this.broadcast()
  }

  handle(id: string, msg: ClientMsg) {
    if (!this.remotes.has(id)) return
    switch (msg.t) {
      case 'draw':
        this.draw()
        break
      case 'tap':
        this.tap(msg.letter)
        break
      case 'add':
        this.add(String(msg.name ?? ''))
        break
      case 'remove':
        this.remove(msg.id)
        break
      case 'reset': {
        for (const p of this.players) {
          p.marks = 0
          p.out = false
        }
        if (this.phase === 'over' || this.phase === 'boom') {
          this.clearAll()
          this.overPending = false
          this.phase = 'idle'
          this.loser = this.winner = null
          this.card = null
          this.used.clear()
          this.taps = 0
          this.lit = false
        }
        if (!this.turn) this.turn = this.players[0]?.id ?? null
        this.emit({ type: 'reset' })
        this.changed()
        break
      }
      case 'order': {
        // Accept only a permutation of the current roster; unknown ids are ignored, missing ones keep their relative order at the end.
        const byId = new Map(this.players.map((p) => [p.id, p]))
        const next = (Array.isArray(msg.ids) ? msg.ids : []).flatMap((i) => {
          const p = byId.get(i)
          byId.delete(i)
          return p ? [p] : []
        })
        this.players = [...next, ...byId.values()]
        this.changed()
        break
      }
      case 'rename': {
        const p = this.players.find((x) => x.id === msg.id)
        const name = String(msg.name ?? '').trim().slice(0, MAX_NAME)
        if (p && name) {
          p.name = name
          this.changed()
        }
        break
      }
    }
  }

  // ---- roster ----

  private add(raw: string) {
    const name = raw.trim().slice(0, MAX_NAME)
    if (!name || this.players.length >= MAX_PLAYERS) return
    const p: PlayerView = { id: crypto.randomUUID(), name, color: this.freeColor(), marks: 0, out: false }
    this.players.push(p)
    if (!this.turn) this.turn = p.id
    // A new player joins a finished game as part of the next one.
    this.emit({ type: 'added', id: p.id })
    this.changed()
  }

  private remove(id: string) {
    const i = this.players.findIndex((x) => x.id === id)
    if (i < 0) return
    const wasTurn = this.turn === id
    const next = wasTurn ? this.nextActive(id) : null
    this.players.splice(i, 1)
    if (wasTurn) this.turn = next && next !== id ? next : (this.players.find((x) => !x.out)?.id ?? null)
    if (this.loser === id) this.loser = null
    if (this.winner === id) this.winner = null
    this.emit({ type: 'removed', id })
    this.changed()
  }

  private changed() {
    this.broadcast()
    this.onPersist?.()
  }

  serialize() {
    return { players: this.players, deckSeen: this.cardN }
  }

  restore(data: { players?: PlayerView[] } | undefined) {
    if (!data?.players) return
    this.players = data.players.map((p) => ({ ...p }))
    this.turn = this.players.find((p) => !p.out)?.id ?? null
  }

  // ---- flow ----

  private draw() {
    const now = Date.now()
    if (now - this.lastDraw < this.opts.drawGapMs || this.overPending) return
    this.lastDraw = now
    this.clearAll()
    // Who starts: after a boom the loser does (or the next player if they went out);
    // a fresh game picks at random; switching the card mid-round keeps the turn.
    if (this.phase === 'over') {
      for (const p of this.players) {
        p.marks = 0
        p.out = false
      }
      this.turn = null
    }
    const act = this.players.filter((p) => !p.out)
    if (this.phase === 'boom' && this.loser) {
      const l = this.players.find((p) => p.id === this.loser)
      this.turn = l && !l.out ? l.id : this.nextActive(this.loser)
    } else if (!this.turn || !act.some((p) => p.id === this.turn)) {
      this.turn = act.length ? act[Math.floor(this.opts.random() * act.length)]!.id : null
    }
    this.loser = this.winner = null
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
      this.emit({ type: 'go', turn: this.turn })
      this.broadcast()
    })
    this.broadcast()
  }

  private tap(letter: string) {
    if (this.phase !== 'play' || !LETTERS.includes(letter) || this.used.has(letter)) return
    this.used.add(letter)
    this.taps++
    const by = this.turn
    const next = by ? (this.nextActive(by) ?? by) : null
    this.turn = next
    this.emit({ type: 'tap', letter, by, next })
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

  /** The fuse ran out on whoever's turn it is. */
  private boom() {
    this.fuseTimer = null
    this.phase = 'boom'
    this.lit = false
    const loser = this.players.find((p) => p.id === this.turn)
    let out = false
    if (loser) {
      loser.marks++
      if (loser.marks >= MAX_MARKS) loser.out = out = true
      this.loser = loser.id
    }
    this.emit({ type: 'boom', loser: loser?.id ?? null, out })
    this.changed()
    if (this.players.length >= 2 && this.players.filter((p) => !p.out).length <= 1) {
      this.overPending = true
      this.cardLater(this.opts.overMs, () => {
        this.overPending = false
        const w = this.players.find((p) => !p.out)
        this.phase = 'over'
        this.winner = w?.id ?? null
        if (w) this.emit({ type: 'win', winner: w.id })
        this.broadcast()
      })
    }
  }

  // ---- helpers ----

  /** Next player after `from` in turn order who is still in. */
  private nextActive(from: string): string | null {
    const n = this.players.length
    const start = this.players.findIndex((p) => p.id === from)
    for (let i = 1; i <= n; i++) {
      const p = this.players[(start + i + n) % n]
      if (p && !p.out) return p.id
    }
    return null
  }

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
    const taken = new Set(this.players.map((p) => p.color))
    for (let c = 0; c < COLORS; c++) if (!taken.has(c)) return c
    return this.players.length % COLORS
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
    for (const id of this.remotes.keys()) this.send(id, { t: 'ev', e })
  }

  snapshot(): Snapshot {
    return {
      phase: this.phase,
      now: Date.now(),
      remotes: this.remotes.size,
      players: this.players,
      turn: this.turn,
      loser: this.loser,
      winner: this.winner,
      card: this.card,
      letters: LETTERS.map((ch) => ({ ch, used: this.used.has(ch) })),
      taps: this.taps,
      lit: this.lit,
      fuseLeft: this.lit ? Math.max(0, this.fuseStart + this.fuseLen - Date.now()) : null,
      fuseLen: this.lit ? this.fuseLen : null,
      cardUntil: this.cardUntil,
      revealAt: this.revealAt,
    }
  }

  broadcast() {
    const s = this.snapshot()
    for (const id of this.remotes.keys()) this.send(id, { t: 'state', s })
  }

  dispose() {
    this.clearAll()
  }
}
