// Dev helper: fake players so you can play against bots.
//   bun scripts/bots.ts [count=3] [--auto] [--fast] [--min=N] [--url=ws://host:port/ws]
// Bots tap a random free letter 0.6-2.5 s into their turn. A bot that is host
// starts the game once N (default 2) players are online, and with --auto also
// draws the next round after a boom and restarts after game over.
import type { ClientMsg, ServerMsg, Snapshot } from '../shared/protocol'

const args = process.argv.slice(2)
const count = Number(args.find((a) => /^\d+$/.test(a)) ?? 3)
const auto = args.includes('--auto')
const fast = args.includes('--fast') // 0.1-0.3 s turns: handy for seeing a ring refill
const min = Number(args.find((a) => a.startsWith('--min='))?.slice(6) ?? 2)
const url = args.find((a) => a.startsWith('--url='))?.slice(6) ?? `ws://localhost:${process.env.PORT ?? 5757}/ws?r=${process.env.ROOM ?? 'BOTS'}`
const rand = (a: number, b: number) => a + Math.random() * (b - a)

function bot(i: number) {
  const id = `bot-${i}-${Math.random().toString(36).slice(2, 8)}`
  const name = `Bot ${i}`
  let s: Snapshot | null = null
  let thinking = false
  let starting = false
  let drawing = false
  let againing = false
  const ws = new WebSocket(url)
  const send = (m: ClientMsg) => ws.readyState === WebSocket.OPEN && ws.send(JSON.stringify(m))

  ws.onopen = () => send({ t: 'join', id, name })
  ws.onclose = () => {
    console.log(`${name}: disconnected`)
    setTimeout(() => bot(i), 1500)
  }
  ws.onmessage = (ev) => {
    const msg = JSON.parse(String(ev.data)) as ServerMsg
    if (msg.t === 'err') console.log(`${name}: err ${msg.msg}`)
    if (msg.t === 'ev') {
      const e = msg.e
      if (e.type === 'boom' && s?.players) console.log(`💥 ${s.players.find((p) => p.id === e.loser)?.name}${e.out ? ' is out' : ''}`)
      if (e.type === 'win' && s?.players) console.log(`👑 ${s.players.find((p) => p.id === e.winner)?.name}`)
      return
    }
    if (msg.t !== 'state') return
    s = msg.s
    act()
  }

  function act() {
    if (!s) return
    const host = s.host === s.you
    if (s.phase === 'lobby' && host && !starting && s.players.filter((p) => p.online).length >= min) {
      starting = true
      setTimeout(() => {
        starting = false
        if (s?.phase === 'lobby' && s.players.filter((p) => p.online).length >= min) send({ t: 'start' })
      }, 1500)
    }
    if (s.phase === 'play' && s.turn === s.you && !thinking) {
      thinking = true
      const round = s.round
      setTimeout(() => {
        thinking = false
        if (!s || s.phase !== 'play' || s.turn !== s.you || s.round !== round) return
        const free = s.letters.filter((l) => !l.used)
        const pick = free[Math.floor(Math.random() * free.length)]
        if (pick) send({ t: 'tap', letter: pick.ch })
      }, fast ? rand(100, 300) : rand(600, 2500))
    }
    if (auto && host && s.phase === 'boom' && !drawing && s.players.filter((p) => !p.out).length > 1) {
      drawing = true
      setTimeout(() => {
        drawing = false
        if (s?.phase === 'boom') send({ t: 'draw' })
      }, 2200)
    }
    if (auto && host && s.phase === 'over' && !againing) {
      againing = true
      setTimeout(() => {
        againing = false
        if (s?.phase === 'over') send({ t: 'again' })
      }, 5000)
    }
  }
}

for (let i = 1; i <= count; i++) setTimeout(() => bot(i), i * 250)
console.log(`${count} bots -> ${url}${auto ? ' (auto)' : ''}`)
