import { DurableObject } from 'cloudflare:workers'
import { Hub, ROOM_RE } from '../server/hub'

interface Env {
  ROOM: DurableObjectNamespace<Room>
}

/** One Durable Object per room code: holds the game and every player's websocket. */
export class Room extends DurableObject<Env> {
  private hub = new Hub()

  async fetch(req: Request): Promise<Response> {
    if (req.headers.get('upgrade') !== 'websocket') return new Response('expected websocket', { status: 426 })
    const { 0: client, 1: server } = new WebSocketPair()
    server.accept() // not hibernating: the fuse timers live in memory while people are playing
    server.addEventListener('message', (e) => this.hub.message(server, String(e.data)))
    const gone = () => this.hub.close(server)
    server.addEventListener('close', gone)
    server.addEventListener('error', gone)
    return new Response(null, { status: 101, webSocket: client })
  }
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url)
    if (url.pathname !== '/ws') return new Response('not found', { status: 404 })
    const code = (url.searchParams.get('r') ?? '').toUpperCase()
    if (!ROOM_RE.test(code)) return new Response('bad room', { status: 400 })
    return env.ROOM.getByName(code).fetch(req)
  },
} satisfies ExportedHandler<Env>
