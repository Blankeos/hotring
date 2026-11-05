// Dev helper: fake phones at the table.
//   bun scripts/bots.ts [count=3] [--fast] [--url=ws://host:port/ws?r=CODE]
// Room defaults to $ROOM or BOTS (open http://localhost:5757/?r=BOTS to sit with them).
// While the ring is live each bot taps a random free letter every 0.6-3 s; when the table
// is idle or just blew up, a bot draws the next card after a short beat.
import type { ClientMsg, ServerMsg, Snapshot } from '../shared/protocol'

const args = process.argv.slice(2)
const count = Number(args.find((a) => /^\d+$/.test(a)) ?? 3)
const fast = args.includes('--fast') // 0.1-0.4 s taps: handy for seeing a refill
const url = args.find((a) => a.startsWith('--url='))?.slice(6) ?? `ws://localhost:${process.env.PORT ?? 5757}/ws?r=${process.env.ROOM ?? 'BOTS'}`
const rand = (a: number, b: number) => a + Math.random() * (b - a)

function bot(i: number) {
  const id = `bot-${i}-${Math.random().toString(36).slice(2, 8)}`
  let s: Snapshot | null = null
  let tapTimer: ReturnType<typeof setTimeout> | null = null
  let drawTimer: ReturnType<typeof setTimeout> | null = null
  const ws = new WebSocket(url)
  const send = (m: ClientMsg) => ws.readyState === WebSocket.OPEN && ws.send(JSON.stringify(m))

  ws.onopen = () => send({ t: 'join', id })
  ws.onclose = () => {
    console.log(`bot ${i}: disconnected, retrying`)
    if (tapTimer) clearTimeout(tapTimer)
    if (drawTimer) clearTimeout(drawTimer)
    setTimeout(() => bot(i), 1500)
  }
  ws.onmessage = (ev) => {
    const msg = JSON.parse(String(ev.data)) as ServerMsg
    if (msg.t === 'ev') {
      if (msg.e.type === 'boom' && i === 1) console.log(`💥 after ${s?.taps ?? 0} taps`)
      return
    }
    if (msg.t !== 'state') return
    s = msg.s
    act()
  }

  function act() {
    if (!s) return
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
        fast ? rand(100, 400) : rand(600, 3000),
      )
    }
    // Only the first bot deals, so they don't fight over the deck.
    if (i === 1 && (s.phase === 'idle' || s.phase === 'boom') && !drawTimer) {
      drawTimer = setTimeout(
        () => {
          drawTimer = null
          if (s?.phase === 'idle' || s?.phase === 'boom') send({ t: 'draw' })
        },
        s.phase === 'idle' ? 1500 : 3500,
      )
    }
  }
}

for (let i = 1; i <= count; i++) setTimeout(() => bot(i), i * 250)
console.log(`${count} bots -> ${url}`)
