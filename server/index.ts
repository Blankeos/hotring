import { networkInterfaces } from 'node:os'
import { join } from 'node:path'
import type { ClientMsg, ServerMsg } from '../shared/protocol'
import index from '../client/index.html'
import { Hub, ROOM_RE } from './hub'

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
  code: string
}

const rooms = new Map<string, Hub>()
function room(code: string) {
  let h = rooms.get(code)
  if (!h) rooms.set(code, (h = new Hub()))
  return h
}

const server = Bun.serve<WsData>({
  port: PORT,
  hostname: '0.0.0.0',
  routes: {
    '/': index,
    '/api/lan': () => Response.json({ ips: lanAddresses(), port: PORT }),
  },
  async fetch(req, server) {
    const url = new URL(req.url)
    if (url.pathname === '/ws') {
      const code = (url.searchParams.get('r') ?? '').toUpperCase()
      if (!ROOM_RE.test(code)) return new Response('bad room', { status: 400 })
      return server.upgrade(req, { data: { code } }) ? undefined : new Response('upgrade failed', { status: 400 })
    }
    if (url.pathname.startsWith('/sfx/') && !url.pathname.includes('..')) {
      const f = Bun.file(join(PUBLIC, url.pathname))
      if (!(await f.exists())) return new Response('not found', { status: 404 })
      return new Response(f, { headers: { 'cache-control': 'public, max-age=3600' } })
    }
    return new Response('not found', { status: 404 })
  },
  websocket: {
    idleTimeout: 60,
    message(ws, raw) {
      room(ws.data.code).message(ws, String(raw))
    },
    close(ws) {
      const h = rooms.get(ws.data.code)
      h?.close(ws)
    },
  },
  development: process.env.NODE_ENV !== 'production',
})

const ips = lanAddresses()
console.log(`\n  hotring\n  local  http://localhost:${server.port}`)
for (const ip of ips) console.log(`  lan    http://${ip}:${server.port}`)
console.log()
