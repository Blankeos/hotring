import { networkInterfaces } from 'node:os'
import { join } from 'node:path'
import type { ClientMsg, ServerMsg } from '../shared/protocol'
import index from '../client/index.html'
import { Game } from './game'

const PORT = Number(process.env.PORT ?? 5757)
const PUBLIC = join(import.meta.dir, '..', 'public')

/** Private-network IPv4 addresses, best guess first (Wi-Fi/ethernet before virtual NICs). */
function lanAddresses(): string[] {
  const found: { ip: string; score: number }[] = []
  for (const [name, list] of Object.entries(networkInterfaces())) {
    for (const i of list ?? []) {
      if (i.family !== 'IPv4' || i.internal) continue
      const private_ = /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(i.address)
      const virtual = /^(utun|bridge|docker|vmnet|veth|vboxnet|awdl|llw|lo)/.test(name)
      found.push({ ip: i.address, score: (private_ ? 2 : 0) + (virtual ? -3 : 0) + (/^en\d/.test(name) ? 1 : 0) })
    }
  }
  return found.sort((a, b) => b.score - a.score).map((f) => f.ip)
}

interface WsData {
  id: string | null
}

const sockets = new Map<string, Bun.ServerWebSocket<WsData>>()

const game = new Game((playerId, msg: ServerMsg) => {
  sockets.get(playerId)?.send(JSON.stringify(msg))
})

const server = Bun.serve<WsData>({
  port: PORT,
  hostname: '0.0.0.0',
  routes: {
    '/': index,
    '/api/lan': () => Response.json({ ips: lanAddresses(), port: PORT }),
  },
  fetch(req, server) {
    const url = new URL(req.url)
    if (url.pathname === '/ws') {
      return server.upgrade(req, { data: { id: null } }) ? undefined : new Response('upgrade failed', { status: 400 })
    }
    if (url.pathname.startsWith('/sfx/') && !url.pathname.includes('..')) {
      const f = Bun.file(join(PUBLIC, url.pathname))
      return new Response(f, { headers: { 'cache-control': 'public, max-age=3600' } })
    }
    return new Response('not found', { status: 404 })
  },
  websocket: {
    idleTimeout: 60,
    message(ws, raw) {
      let msg: ClientMsg
      try {
        msg = JSON.parse(String(raw))
      } catch {
        return
      }
      if (msg.t === 'join') {
        const id = game.join(msg.id, String(msg.name ?? ''))
        // A new tab for the same player replaces the old socket.
        const old = sockets.get(id)
        if (old && old !== ws) {
          old.data.id = null
          old.close()
        }
        ws.data.id = id
        sockets.set(id, ws)
        game.broadcast()
        return
      }
      if (ws.data.id) game.handle(ws.data.id, msg)
    },
    close(ws) {
      const id = ws.data.id
      if (!id || sockets.get(id) !== ws) return
      sockets.delete(id)
      game.disconnect(id)
    },
  },
  development: process.env.NODE_ENV !== 'production',
})

const ips = lanAddresses()
console.log(`\n  hotring\n  local  http://localhost:${server.port}`)
for (const ip of ips) console.log(`  lan    http://${ip}:${server.port}`)
console.log()
