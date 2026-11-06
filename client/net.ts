// The peer-to-peer layer, on Trystero (signaling over public Nostr relays, then phone to phone).
//
//   host phone:   runs the Game in this tab. The code in the URL is its Trystero room.
//   other phones: join the same room, send ClientMsgs to the host and render what it sends back.
//
// Trystero only introduces peers; every game message flows over WebRTC data channels. The host's own
// UI talks to the Game through a loopback socket, no network at all.
import { joinRoom, type MessageAction, type Room } from 'trystero'
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

const APP_ID = 'hotring-9f3c'
const SAVE_KEY = 'hotring:table:'

export class Net {
  private room: Room
  private toHost: (data: string, o?: { target?: string }) => Promise<void>
  private toPeer: (data: string, o?: { target?: string }) => Promise<void>
  private joinMsg: { id: string } | null = null
  private hub: Hub | null = null
  private loop: Sock | null = null
  private hostPeer: string | null = null
  private watchdog: ReturnType<typeof setTimeout> | null = null
  private lock: WakeLockSentinel | null = null
  online = false

  constructor(private h: NetHandlers) {
    this.room = joinRoom({ appId: APP_ID }, roomCode)
    const c = this.room.makeAction<string>('c') // client -> host
    const s = this.room.makeAction<string>('s') // host -> client
    this.toHost = c.send
    this.toPeer = s.send

    if (isHost) this.startHost(c)
    else this.startGuest(s)

    // Phones sleep: when we come back, say hello again (idempotent) and see if the host answers.
    const wake = () => {
      if (document.visibilityState === 'visible') {
        this.wake()
        if (isHost) this.keepAwake()
      }
    }
    document.addEventListener('visibilitychange', wake)
    addEventListener('online', wake)
    addEventListener('pageshow', wake)
  }

  join(id: string) {
    this.joinMsg = { id }
    if (isHost) this.hub!.message(this.loop!, JSON.stringify({ t: 'join', id }))
    else this.sendJoin()
  }

  send(m: ClientMsg) {
    const raw = JSON.stringify(m)
    if (isHost) this.hub!.message(this.loop!, raw)
    else if (this.hostPeer) void this.toHost(raw, { target: this.hostPeer }).catch(() => {})
  }

  // ---- host ----

  private startHost(c: MessageAction<string>) {
    const hub = new Hub()
    this.hub = hub
    try {
      hub.game.restore(JSON.parse(localStorage.getItem(SAVE_KEY + roomCode) ?? 'null') ?? undefined)
    } catch {}
    hub.game.onPersist = () => localStorage.setItem(SAVE_KEY + roomCode, JSON.stringify(hub.game.serialize()))

    // The host's own phone: a socket whose far end is this very tab.
    this.loop = { send: (d) => this.deliver(d), close() {} }
    this.online = true
    queueMicrotask(() => this.h.status(true))

    const socks = new Map<string, Sock>()
    const sockFor = (peer: string) => {
      let sk = socks.get(peer)
      if (!sk) {
        sk = { send: (d) => void this.toPeer(d, { target: peer }).catch(() => {}), close() {} }
        socks.set(peer, sk)
      }
      return sk
    }
    c.onMessage = (data, ctx) => hub.message(sockFor(ctx.peerId), data)
    this.room.onPeerLeave = (peer) => {
      const sk = socks.get(peer)
      if (!sk) return
      socks.delete(peer)
      hub.close(sk)
    }
    this.keepAwake()
  }

  private async keepAwake() {
    // A phone that sleeps in your pocket stops the fuse for everyone: keep the host screen on.
    try {
      if (document.visibilityState === 'visible') this.lock = (await navigator.wakeLock?.request('screen')) ?? null
    } catch {}
  }

  // ---- guest ----

  private startGuest(s: MessageAction<string>) {
    s.onMessage = (data, ctx) => {
      if (this.watchdog) clearTimeout(this.watchdog)
      this.watchdog = null
      // The first peer that answers our join is the host.
      this.hostPeer = ctx.peerId
      this.deliver(data)
    }
    this.room.onPeerJoin = (peer) => {
      if (this.joinMsg) void this.toHost(JSON.stringify({ t: 'join', id: this.joinMsg.id }), { target: peer }).catch(() => {})
    }
    this.room.onPeerLeave = (peer) => {
      if (peer !== this.hostPeer) return
      this.hostPeer = null
      this.setOnline(false)
    }
    // No answer in a while: the host isn't here (yet).
    this.setOnline(false)
  }

  private sendJoin() {
    if (!this.joinMsg) return
    const raw = JSON.stringify({ t: 'join', id: this.joinMsg.id })
    const peers = Object.keys(this.room.getPeers())
    for (const p of peers) void this.toHost(raw, { target: p }).catch(() => {})
  }

  private wake() {
    if (!this.joinMsg || isHost) return
    this.sendJoin()
    if (this.watchdog) clearTimeout(this.watchdog)
    // A join that gets no reply means the host link is dead: show the offline hint until it answers.
    this.watchdog = setTimeout(() => this.setOnline(false), 3000)
  }

  private setOnline(on: boolean) {
    if (this.online === on) return
    this.online = on
    this.h.status(on)
  }

  // ---- inbound from the game (host loopback or a host's reply) ----

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
