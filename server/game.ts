import {
  LETTERS,
  MAX_MARKS,
  MAX_NAME,
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
  cardMs: number // how long the shuffle + reveal takes before the fuse is lit
  revealMs: number // when within the card phase the card flips
  fuseMin: number
  fuseMax: number
  boomMs: number // how long the boom screen holds before game over is decided
  idleResetMs: number // nobody online for this long -> back to lobby
  lobbyGraceMs: number // a lobby player who drops (reload, sleep) keeps their seat this long
  random: () => number
}

export const DEFAULTS: GameOptions = {
  cardMs: 3400,
  revealMs: 1700,
  fuseMin: 14_000,
  fuseMax: 34_000,
  boomMs: 2600,
  idleResetMs: 30_000,
  lobbyGraceMs: 20_000,
  random: Math.random,
}

const COLORS = 12

interface Player {
  id: string
  name: string
  color: number
  marks: number
  out: boolean
  online: boolean
}

type Send = (playerId: string, msg: ServerMsg) => void

export class Game {
  readonly opts: GameOptions
  private send: Send
  private players: Player[] = []
  private phase: Phase = 'lobby'
  private host = ''
  private card: CategoryCard | null = null
  private cardN = 0
  private deck: number[] = []
  private used = new Set<string>()
  private turn: string | null = null
  private loser: string | null = null
  private winner: string | null = null
  private round = 0
  private cardUntil: number | null = null
  private fuseStart = 0
  private fuseLen = 0
  private timers = new Set<ReturnType<typeof setTimeout>>()
  private idleTimer: ReturnType<typeof setTimeout> | null = null
  private boomAt = 0

  constructor(send: Send, opts: Partial<GameOptions> = {}) {
    this.send = send
    this.opts = { ...DEFAULTS, ...opts }
  }

  // ---- connection lifecycle (called by the transport) ----

  /** Returns the player id for this connection (existing on reconnect, new otherwise). */
  join(id: string | undefined, rawName: string): string {
    this.clearIdle()
    const name = rawName.trim().slice(0, MAX_NAME)
    let p = id ? this.players.find((x) => x.id === id) : undefined
    if (p) {
      p.online = true
      if (name) p.name = name
    } else {
      const newId = id && /^[\w-]{6,40}$/.test(id) ? id : crypto.randomUUID()
      p = {
        id: newId,
        name: name || `Player ${this.players.length + 1}`,
        color: this.freeColor(),
        marks: 0,
        // Late joiners watch until the next game.
        out: this.phase !== 'lobby',
        online: true,
      }
      if (p.out) p.marks = MAX_MARKS
      this.players.push(p)
      this.emit({ type: 'joined', id: p.id })
    }
    this.fixHost()
    this.broadcast()
    return p.id
  }

  disconnect(id: string) {
    const p = this.players.find((x) => x.id === id)
    if (!p) return
    p.online = false
    if (this.phase === 'lobby') {
      // Phones sleep and tabs reload: hold the seat briefly, then tidy the roster.
      this.later(this.opts.lobbyGraceMs, () => {
        if (p.online || this.phase !== 'lobby') return
        this.players = this.players.filter((x) => x !== p)
        this.emit({ type: 'left', id })
        this.fixHost()
        this.broadcast()
      })
    } else if (this.phase === 'play' && this.turn === id) {
      const next = this.nextActive(id, true)
      if (next && next !== id) {
        this.turn = next
        this.emit({ type: 'skip', next })
      }
    }
    this.fixHost()
    if (!this.players.some((x) => x.online)) this.scheduleIdleReset()
    this.broadcast()
  }

  // ---- messages ----

  handle(id: string, msg: ClientMsg) {
    const p = this.players.find((x) => x.id === id)
    if (!p) return
    switch (msg.t) {
      case 'start':
        if (id !== this.host || this.phase !== 'lobby') return
        if (this.activePlayers().filter((x) => x.online).length < 2) return this.err(id, 'Need 2 players')
        this.round = 0
        this.draw(null)
        break
      case 'draw':
        if (id !== this.host) return
        if (this.phase === 'card') this.draw(this.turn)
        else if (this.phase === 'boom' && Date.now() - this.boomAt > 1200 && this.activePlayers().length > 1)
          this.draw(this.loser)
        break
      case 'tap':
        this.tap(id, msg.letter)
        break
      case 'again':
        if (id !== this.host || this.phase !== 'over') return
        this.reset()
        break
      case 'kick': {
        if (id !== this.host || msg.id === id) return
        const t = this.players.find((x) => x.id === msg.id)
        if (!t) return
        if (this.phase === 'lobby') {
          this.players = this.players.filter((x) => x !== t)
          this.send(t.id, { t: 'err', msg: 'removed' })
          this.emit({ type: 'left', id: t.id })
        } else {
          t.out = true
          t.marks = MAX_MARKS
          if (this.turn === t.id && this.phase === 'play') this.turn = this.nextActive(t.id, true)
          this.checkLastStanding()
        }
        this.broadcast()
        break
      }
    }
  }

  // ---- game flow ----

  private draw(starter: string | null) {
    this.clearTimers()
    this.phase = 'card'
    this.round++
    this.loser = null
    this.card = this.nextCard()
    this.used.clear()
    const act = this.activePlayers()
    // The loser of the last round starts; if they just went out, the next player does.
    // First round: random.
    this.turn = starter
      ? act.some((x) => x.id === starter)
        ? starter
        : this.nextActive(starter, false)
      : act[Math.floor(this.opts.random() * act.length)]!.id
    this.cardUntil = Date.now() + this.opts.cardMs
    this.emit({ type: 'deal' })
    this.later(this.opts.revealMs, () => {
      this.emit({ type: 'reveal' })
    })
    this.later(this.opts.cardMs, () => this.go())
    this.broadcast()
  }

  private go() {
    this.phase = 'play'
    this.cardUntil = null
    this.fuseStart = Date.now()
    const { fuseMin, fuseMax, random } = this.opts
    this.fuseLen = fuseMin + random() * (fuseMax - fuseMin)
    this.emit({ type: 'go', turn: this.turn! })
    this.broadcast()
    this.tickLoop()
  }

  private tickLoop() {
    if (this.phase !== 'play') return
    const elapsed = Date.now() - this.fuseStart
    if (elapsed >= this.fuseLen) return this.boom()
    const heat = Math.min(1, elapsed / this.fuseLen)
    this.emit({ type: 'tick', heat })
    // 650ms between ticks when cold, ~170ms when about to blow.
    const gap = Math.max(170, 650 - 480 * heat ** 1.4)
    this.later(Math.min(gap, this.fuseLen - elapsed), () => this.tickLoop())
  }

  private tap(id: string, letter: string) {
    if (this.phase !== 'play' || this.turn !== id) return
    if (!LETTERS.includes(letter) || this.used.has(letter)) return
    this.used.add(letter)
    const next = this.nextActive(id, true) ?? id
    this.turn = next
    this.emit({ type: 'tap', letter, by: id, next })
    if (this.used.size >= LETTERS.length) {
      this.used.clear()
      this.emit({ type: 'refill' })
    }
    this.broadcast()
  }

  private boom() {
    const loser = this.players.find((x) => x.id === this.turn)
    this.clearTimers()
    this.phase = 'boom'
    this.boomAt = Date.now()
    if (loser) {
      loser.marks++
      if (loser.marks >= MAX_MARKS) loser.out = true
      this.loser = loser.id
      this.emit({ type: 'boom', loser: loser.id, out: loser.out })
    }
    this.broadcast()
    this.later(this.opts.boomMs, () => this.checkLastStanding())
  }

  private checkLastStanding() {
    if (this.phase !== 'boom' && this.phase !== 'play') return
    const act = this.activePlayers()
    if (act.length > 1) return
    this.clearTimers()
    this.phase = 'over'
    this.winner = act[0]?.id ?? this.loser
    this.turn = null
    if (this.winner) this.emit({ type: 'win', winner: this.winner })
    this.broadcast()
  }

  private reset() {
    this.clearTimers()
    this.phase = 'lobby'
    this.card = null
    this.turn = null
    this.loser = null
    this.winner = null
    this.round = 0
    this.cardUntil = null
    this.used.clear()
    this.players = this.players.filter((p) => p.online)
    for (const p of this.players) {
      p.marks = 0
      p.out = false
    }
    this.fixHost()
    this.broadcast()
  }

  // ---- helpers ----

  private activePlayers() {
    return this.players.filter((p) => !p.out)
  }

  /** Next player after `from` in turn order who is still in (and online, if asked). */
  private nextActive(from: string, onlineOnly: boolean): string | null {
    const n = this.players.length
    const start = this.players.findIndex((p) => p.id === from)
    for (let i = 1; i <= n; i++) {
      const p = this.players[(start + i + n) % n]
      if (p && !p.out && (!onlineOnly || p.online)) return p.id
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

  private fixHost() {
    const cur = this.players.find((p) => p.id === this.host)
    if (cur?.online) return
    this.host = (this.players.find((p) => p.online) ?? this.players[0])?.id ?? ''
  }

  private later(ms: number, fn: () => void) {
    const t = setTimeout(() => {
      this.timers.delete(t)
      fn()
    }, ms)
    this.timers.add(t)
  }

  private clearTimers() {
    for (const t of this.timers) clearTimeout(t)
    this.timers.clear()
  }

  private scheduleIdleReset() {
    this.clearIdle()
    this.idleTimer = setTimeout(() => {
      if (this.players.some((p) => p.online)) return
      this.players = []
      this.deck = []
      this.reset()
    }, this.opts.idleResetMs)
  }

  private clearIdle() {
    if (this.idleTimer) clearTimeout(this.idleTimer)
    this.idleTimer = null
  }

  private err(id: string, msg: string) {
    this.send(id, { t: 'err', msg })
  }

  private emit(e: ServerEvent) {
    for (const p of this.players) if (p.online) this.send(p.id, { t: 'ev', e })
  }

  snapshot(forId: string): Snapshot {
    return {
      phase: this.phase,
      now: Date.now(),
      you: forId,
      host: this.host,
      players: this.players.map<PlayerView>(({ id, name, color, marks, out, online }) => ({
        id,
        name,
        color,
        marks,
        out,
        online,
      })),
      card: this.card,
      letters: LETTERS.map((ch) => ({ ch, used: this.used.has(ch) })),
      turn: this.turn,
      loser: this.loser,
      winner: this.winner,
      round: this.round,
      cardUntil: this.cardUntil,
    }
  }

  broadcast() {
    for (const p of this.players) if (p.online) this.send(p.id, { t: 'state', s: this.snapshot(p.id) })
  }

  /** Stop all timers (tests, shutdown). */
  dispose() {
    this.clearTimers()
    this.clearIdle()
  }
}
