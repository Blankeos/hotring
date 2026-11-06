// The peer-to-peer layer, on PeerJS (WebRTC data channels; its free broker only introduces the phones).
//
//   host phone:   runs the Game in this tab as `new Peer('hotring-CODE')` and accepts connections.
//   other phones: `new Peer()` + `peer.connect('hotring-CODE')`, send ClientMsgs and render what comes back.
//
// Once a channel is open every game message flows phone to phone. The host's own UI talks to the Game
// through a loopback socket, no network at all. Same pattern as juicy.
import Peer, { type DataConnection } from 'peerjs'
import { Hub, type Sock } from '../server/hub'
import { isHost, roomCode } from './room'
import type { ClientMsg, HandCard, ServerEvent, ServerMsg, Snapshot } from '../shared/protocol'

export interface NetHandlers {
  state(s: Snapshot): void
  event(e: ServerEvent): void
  err(msg: string): void
  hand(cards: HandCard[]): void
  status(online: boolean): void
}

const PREFIX = 'hotring-'
const SAVE_KEY = 'hotring:table:'

export class Net {
  private joinMsg: { id: string } | null = null
  private hub: Hub | null = null
  private loop: Sock | null = null
  private peer: Peer | null = null
  private conn: DataConnection | null = null
  private retry: ReturnType<typeof setTimeout> | null = null
  private tries = 0
  private lock: WakeLockSentinel | null = null
  online = false

  constructor(private h: NetHandlers) {
    if (isHost) this.startHost()
    else this.connect()

    // Phones sleep: when we come back, reconnect if the link died (and keep the host screen on).
    const wake = () => {
      if (document.visibilityState !== 'visible') return
      if (isHost) {
        this.keepAwake()
        if (this.peer?.disconnected && !this.peer.destroyed) this.peer.reconnect()
      } else if (!this.conn?.open) {
        this.tries = 0
        this.connect()
      }
    }
    document.addEventListener('visibilitychange', wake)
    addEventListener('online', wake)
    addEventListener('pageshow', wake)
  }

  join(id: string) {
    this.joinMsg = { id }
    if (isHost) this.hub!.message(this.loop!, JSON.stringify({ t: 'join', id }))
    else if (this.conn?.open) this.sendJoin()
  }

  send(m: ClientMsg) {
    const raw = JSON.stringify(m)
    if (isHost) this.hub!.message(this.loop!, raw)
    else if (this.conn?.open) this.conn.send(raw)
  }

  // ---- host ----

  private startHost() {
    const hub = new Hub()
    this.hub = hub
    try {
      hub.game.restore(JSON.parse(localStorage.getItem(SAVE_KEY + roomCode) ?? 'null') ?? undefined)
    } catch {}
    hub.game.onPersist = () => localStorage.setItem(SAVE_KEY + roomCode, JSON.stringify(hub.game.serialize()))

    // The host's own phone: a socket whose far end is this very tab.
    this.loop = { send: (d) => this.deliver(d), close() {} }
    this.setOnline(true)
    this.keepAwake()
    this.register(0)
  }

  /** Claim the room code at the broker. After a reload the old registration can linger a few seconds: retry. */
  private register(tries: number) {
    const peer = new Peer(PREFIX + roomCode)
    this.peer = peer
    peer.on('connection', (conn) => {
      const sock: Sock = { send: (d) => conn.open && conn.send(d), close: () => conn.close() }
      conn.on('data', (d) => this.hub!.message(sock, String(d)))
      const gone = () => this.hub!.close(sock)
      conn.on('close', gone)
      conn.on('error', gone)
    })
    // The broker link can drop while open data channels stay fine. Just re-register.
    peer.on('disconnected', () => !peer.destroyed && peer.reconnect())
    peer.on('error', (e: { type?: string }) => {
      if (e.type === 'unavailable-id' && tries < 8) {
        peer.destroy()
        setTimeout(() => this.register(tries + 1), 1500)
      }
    })
  }

  private async keepAwake() {
    // A phone that sleeps in your pocket stops the fuse for everyone: keep the host screen on.
    try {
      if (document.visibilityState === 'visible') this.lock = (await navigator.wakeLock?.request('screen')) ?? null
    } catch {}
  }

  // ---- guest ----

  private connect() {
    if (this.retry) clearTimeout(this.retry)
    this.retry = null
    if (this.conn?.open) return
    if (!this.peer || this.peer.destroyed) {
      const peer = new Peer()
      this.peer = peer
      peer.on('error', () => this.fail())
    }
    const p = this.peer
    const go = () => {
      const c = p.connect(PREFIX + roomCode, { reliable: true })
      this.conn = c
      // A host that just vanished can stay registered at the broker for a while: the offer then gets
      // neither an answer nor an error. Treat a channel that never opens like a missing host.
      const stuck = setTimeout(() => {
        if (this.conn !== c || c.open) return
        c.close()
        this.fail()
      }, 7000)
      c.on('open', () => {
        clearTimeout(stuck)
        this.tries = 0
        this.sendJoin()
      })
      c.on('data', (d) => this.deliver(String(d)))
      const lost = () => {
        if (this.conn !== c) return
        this.setOnline(false)
        this.fail()
      }
      c.on('close', lost)
      c.on('error', lost)
    }
    if (p.open) go()
    else p.once('open', go)
  }

  private fail() {
    if (this.retry) return
    this.conn = null
    this.setOnline(false)
    this.tries++
    this.retry = setTimeout(() => this.connect(), Math.min(4000, 400 * this.tries))
  }

  private sendJoin() {
    if (this.joinMsg && this.conn?.open) this.conn.send(JSON.stringify({ t: 'join', id: this.joinMsg.id }))
  }

  private setOnline(on: boolean) {
    if (this.online === on) return
    this.online = on
    this.h.status(on)
  }

  // ---- inbound from the game (host loopback or the host's reply) ----

  private deliver(raw: string) {
    let msg: ServerMsg
    try {
      msg = JSON.parse(raw)
    } catch {
      return
    }
    if (msg.t === 'state') {
      this.setOnline(true)
      this.h.state(msg.s)
    } else if (msg.t === 'ev') this.h.event(msg.e)
    else if (msg.t === 'err') this.h.err(msg.msg)
    else if (msg.t === 'hand') this.h.hand(msg.cards)
  }
}
