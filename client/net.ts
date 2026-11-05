// WebSocket transport: typed messages, auto-reconnect with backoff, rejoin on every (re)connect.
import { roomCode } from './room'
import type { ClientMsg, HandCard, ServerEvent, ServerMsg, Snapshot } from '../shared/protocol'

export interface NetHandlers {
  state(s: Snapshot): void
  event(e: ServerEvent): void
  err(msg: string): void
  hand(cards: HandCard[]): void
  status(online: boolean): void
}

export class Net {
  private ws: WebSocket | null = null
  private tries = 0
  private retry: ReturnType<typeof setTimeout> | null = null
  private watchdog: ReturnType<typeof setTimeout> | null = null
  private joinMsg: { id: string } | null = null
  online = false

  constructor(private h: NetHandlers) {
    // Phones sleep: when we come back, poke the socket (a zombie socket gets replaced).
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible') return
      this.wake()
    })
    addEventListener('online', () => this.wake())
    addEventListener('pageshow', () => this.wake())
  }

  join(id: string) {
    this.joinMsg = { id }
    if (this.ws?.readyState === WebSocket.OPEN) this.sendJoin()
    else this.connect()
  }

  send(m: ClientMsg) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m))
  }

  private sendJoin() {
    if (this.joinMsg) this.send({ t: 'join', id: this.joinMsg.id })
  }

  private wake() {
    if (!this.joinMsg) return
    if (this.ws?.readyState === WebSocket.OPEN) {
      // Re-join is idempotent; if no reply arrives the socket is dead, so replace it.
      this.sendJoin()
      if (this.watchdog) clearTimeout(this.watchdog)
      this.watchdog = setTimeout(() => this.ws?.close(), 3000)
    } else {
      this.tries = 0
      this.connect()
    }
  }

  private connect() {
    if (this.retry) clearTimeout(this.retry)
    this.retry = null
    const st = this.ws?.readyState
    if (st === WebSocket.OPEN || st === WebSocket.CONNECTING) return
    const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws?r=${roomCode}`
    let ws: WebSocket
    try {
      ws = new WebSocket(url)
    } catch {
      return this.schedule()
    }
    this.ws = ws
    ws.onopen = () => {
      this.tries = 0
      this.sendJoin()
    }
    ws.onmessage = (ev) => {
      if (this.watchdog) clearTimeout(this.watchdog)
      this.watchdog = null
      let msg: ServerMsg
      try {
        msg = JSON.parse(String(ev.data))
      } catch {
        return
      }
      if (msg.t === 'state') {
        if (!this.online) {
          this.online = true
          this.h.status(true)
        }
        this.h.state(msg.s)
      } else if (msg.t === 'ev') this.h.event(msg.e)
      else if (msg.t === 'err') this.h.err(msg.msg)
      else if (msg.t === 'hand') this.h.hand(msg.cards)
    }
    ws.onclose = () => {
      if (this.ws !== ws) return
      this.ws = null
      if (this.online) {
        this.online = false
        this.h.status(false)
      }
      this.schedule()
    }
    ws.onerror = () => ws.close()
  }

  private schedule() {
    if (this.retry) return
    const base = Math.min(8000, 350 * 2 ** this.tries)
    this.tries++
    this.retry = setTimeout(() => {
      this.retry = null
      this.connect()
    }, base * (0.75 + Math.random() * 0.5))
  }
}
