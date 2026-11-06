import { networkInterfaces } from 'node:os'
import { join } from 'node:path'
import index from '../client/index.html'

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

const server = Bun.serve({
  port: PORT,
  hostname: '0.0.0.0',
  routes: {
    '/': index,
    '/api/lan': () => Response.json({ ips: lanAddresses(), port: PORT }),
  },
  async fetch(req) {
    const url = new URL(req.url)
    if (url.pathname.startsWith('/sfx/') && !url.pathname.includes('..')) {
      const f = Bun.file(join(PUBLIC, url.pathname))
      if (!(await f.exists())) return new Response('not found', { status: 404 })
      return new Response(f, { headers: { 'cache-control': 'public, max-age=3600' } })
    }
    return new Response('not found', { status: 404 })
  },
  development: process.env.NODE_ENV !== 'production',
})

const ips = lanAddresses()
console.log(`\n  hotring\n  local  http://localhost:${server.port}`)
for (const ip of ips) console.log(`  lan    http://${ip}:${server.port}`)
console.log()
