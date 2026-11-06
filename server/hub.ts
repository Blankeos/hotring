import type { ClientMsg, ServerMsg } from '../shared/protocol'
import { Game, type GameOptions } from './game'

/** The minimum a transport must give us: a data channel to one phone, or the host's own loopback. */
export interface Sock {
  send(data: string): void
  close(): void
}

/** One table: a Game plus the channels that belong to its players. Transport-agnostic; runs in the host's browser. */
export class Hub {
  readonly game: Game
  private socks = new Map<string, Sock>()
  /** player id per socket, set after `join` */
  private ids = new WeakMap<Sock, string>()

  constructor(opts: Partial<GameOptions> = {}) {
    this.game = new Game((playerId, msg: ServerMsg) => this.socks.get(playerId)?.send(JSON.stringify(msg)), opts)
  }

  message(sock: Sock, raw: string) {
    let msg: ClientMsg
    try {
      msg = JSON.parse(raw)
    } catch {
      return
    }
    if (msg.t === 'join') {
      const id = this.game.join(msg.id)
      // A new tab for the same player replaces the old socket.
      const old = this.socks.get(id)
      if (old && old !== sock) {
        this.ids.delete(old)
        old.close()
      }
      this.ids.set(sock, id)
      this.socks.set(id, sock)
      this.game.broadcast()
      return
    }
    const id = this.ids.get(sock)
    if (id) this.game.handle(id, msg)
  }

  close(sock: Sock) {
    const id = this.ids.get(sock)
    if (!id || this.socks.get(id) !== sock) return
    this.socks.delete(id)
    this.game.disconnect(id)
  }
}
