// Dev helper: extra phones (remotes) at one table.
//   ROOM=X bun scripts/bots.ts [phones=2] [--lazy] [--fast] [--no-draw] [--url=ws://host:port/ws?r=CODE]
// Room defaults to $ROOM or BOTS (open http://localhost:5757/?r=BOTS to sit at the same table).
// The first phone seats Ana, Ben, Cy and Dee if the roster is empty. While the ring is live
// every phone taps a random free letter every few seconds (so turns visibly pass); when the
// table is idle / just blew up / a game is over, the first phone draws the next card.
// --lazy: slow taps so the fuse actually blows. --fast: quick taps to see a refill.
import type { ClientMsg, ServerMsg, Snapshot } from '../shared/protocol'

const args = process.argv.slice(2)
const count = Number(args.find((a) => /^\d+$/.test(a)) ?? 2)
const fast = args.includes('--fast')
const lazy = args.includes('--lazy')
const noDraw = args.includes('--no-draw')
const url = args.find((a) => a.startsWith('--url='))?.slice(6) ?? `ws://localhost:${process.env.PORT ?? 5757}/ws?r=${process.env.ROOM ?? 'BOTS'}`
const rand = (a: number, b: number) => a + Math.random() * (b - a)
const NAMES = ['Ana', 'Ben', 'Cy', 'Dee']

function phone(i: number) {
  const id = `bot-${i}-${Math.random().toString(36).slice(2, 8)}`
  let s: Snapshot | null = null
  let tapTimer: ReturnType<typeof setTimeout> | null = null
  let drawTimer: ReturnType<typeof setTimeout> | null = null
  let seated = false
  const ws = new WebSocket(url)
  const send = (m: ClientMsg) => ws.readyState === WebSocket.OPEN && ws.send(JSON.stringify(m))

  ws.onopen = () => send({ t: 'join', id })
  ws.onclose = () => {
    console.log(`phone ${i}: disconnected, retrying`)
    if (tapTimer) clearTimeout(tapTimer)
    if (drawTimer) clearTimeout(drawTimer)
    setTimeout(() => phone(i), 1500)
  }
  ws.onmessage = (ev) => {
    const msg = JSON.parse(String(ev.data)) as ServerMsg
    if (msg.t === 'ev') {
      if (i !== 1) return
      const e = msg.e
      const name = (pid: string | null) => s?.players.find((p) => p.id === pid)?.name ?? '-'
      if (e.type === 'boom') console.log(`💥 ${name(e.loser)}${e.out ? ' is out' : ''}`)
      if (e.type === 'win') console.log(`👑 ${name(e.winner)}`)
      return
    }
    if (msg.t !== 'state') return
    s = msg.s
    act()
  }

  function act() {
    if (!s) return
    if (i === 1 && !seated && s.players.length === 0) {
      seated = true
      NAMES.forEach((n, k) => setTimeout(() => send({ t: 'add', name: n }), 300 + k * 250))
    }
    if (s.phase === 'play' && !tapTimer) {
      tapTimer = setTimeout(
        () => {
          tapTimer = null
          if (s?.phase !== 'play') return
          const free = s.letters.filter((l) => !l.used)
          const pick = free[Math.floor(Math.random() * free.length)]
          if (pick) send({ t: 'tap', letter: pick.ch })
          act()
        },
        fast ? rand(100, 400) : lazy ? rand(3000, 14_000) : rand(1500, 4500),
      )
    }
    if (!noDraw && i === 1 && (s.phase === 'idle' || s.phase === 'boom' || s.phase === 'over') && !drawTimer) {
      drawTimer = setTimeout(
        () => {
          drawTimer = null
          if (s?.phase === 'idle' || s?.phase === 'boom' || s?.phase === 'over') send({ t: 'draw' })
        },
        s.phase === 'idle' ? 2500 : s.phase === 'over' ? 6000 : 3500,
      )
    }
  }
}

for (let i = 1; i <= count; i++) setTimeout(() => phone(i), i * 250)
console.log(`${count} phones -> ${url}`)
