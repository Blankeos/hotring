import { afterEach, describe, expect, test } from 'bun:test'
import { Game } from '../server/game'
import type { ServerEvent, ServerMsg, Snapshot } from '../shared/protocol'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

function setup(opts = {}) {
  const inbox = new Map<string, ServerMsg[]>()
  const game = new Game(
    (id, m) => {
      const l = inbox.get(id) ?? []
      l.push(m)
      inbox.set(id, l)
    },
    { cardMs: 60, revealMs: 30, fuseMin: 150, fuseMax: 150, boomMs: 40, random: () => 0, ...opts },
  )
  const snap = (id: string): Snapshot => {
    const s = [...(inbox.get(id) ?? [])].reverse().find((m) => m.t === 'state')
    return (s as { s: Snapshot }).s
  }
  const events = (id: string): ServerEvent[] =>
    (inbox.get(id) ?? []).flatMap((m) => (m.t === 'ev' ? [m.e] : []))
  return { game, snap, events }
}

let g: Game | undefined
afterEach(() => g?.dispose())

describe('game', () => {
  test('lobby needs 2 players, host starts, card then play', async () => {
    const { game, snap } = setup()
    g = game
    const a = game.join(undefined, 'Ana')
    expect(snap(a).host).toBe(a)
    game.handle(a, { t: 'start' })
    expect(snap(a).phase).toBe('lobby')
    const b = game.join(undefined, 'Ben')
    game.handle(b, { t: 'start' }) // not host
    expect(snap(a).phase).toBe('lobby')
    game.handle(a, { t: 'start' })
    expect(snap(a).phase).toBe('card')
    expect(snap(a).card?.text).toBeTruthy()
    await sleep(90)
    expect(snap(a).phase).toBe('play')
    expect(snap(a).turn).toBe(a) // random() = 0 -> first player
  })

  test('only the turn holder can tap; turn passes; used letter rejected', async () => {
    const { game, snap, events } = setup({ fuseMin: 5000, fuseMax: 5000 })
    g = game
    const a = game.join(undefined, 'Ana')
    const b = game.join(undefined, 'Ben')
    game.handle(a, { t: 'start' })
    await sleep(90)
    game.handle(b, { t: 'tap', letter: 'A' })
    expect(snap(a).letters[0]!.used).toBe(false)
    game.handle(a, { t: 'tap', letter: 'A' })
    expect(snap(a).letters[0]!.used).toBe(true)
    expect(snap(a).turn).toBe(b)
    game.handle(b, { t: 'tap', letter: 'A' }) // already used
    expect(snap(a).turn).toBe(b)
    game.handle(b, { t: 'tap', letter: 'Z' }) // not in ring
    expect(snap(a).turn).toBe(b)
    expect(events(a).some((e) => e.type === 'tap' && e.letter === 'A' && e.next === b)).toBe(true)
  })

  test('ring refills when all letters are used', async () => {
    const { game, snap, events } = setup({ fuseMin: 5000, fuseMax: 5000 })
    g = game
    const a = game.join(undefined, 'Ana')
    const b = game.join(undefined, 'Ben')
    game.handle(a, { t: 'start' })
    await sleep(90)
    for (const [i, ch] of snap(a).letters.map((l) => l.ch).entries())
      game.handle(i % 2 === 0 ? a : b, { t: 'tap', letter: ch })
    expect(events(a).some((e) => e.type === 'refill')).toBe(true)
    expect(snap(a).letters.every((l) => !l.used)).toBe(true)
  })

  test('fuse blows on the turn holder, three marks and out, last player wins', async () => {
    const { game, snap, events } = setup()
    g = game
    const a = game.join(undefined, 'Ana')
    const b = game.join(undefined, 'Ben')
    game.handle(a, { t: 'start' })
    for (let round = 1; round <= 3; round++) {
      await sleep(round === 1 ? 300 : 360)
      expect(snap(a).phase === 'boom' || snap(a).phase === 'over').toBe(true)
      expect(snap(a).players.find((p) => p.id === a)!.marks).toBe(round)
      if (round < 3) {
        await sleep(1250)
        game.handle(a, { t: 'draw' })
        expect(snap(a).phase).toBe('card')
        expect(snap(a).turn).toBe(a) // loser starts
      }
    }
    await sleep(80)
    expect(snap(a).phase).toBe('over')
    expect(snap(a).winner).toBe(b)
    expect(events(b).some((e) => e.type === 'win')).toBe(true)
    game.handle(a, { t: 'again' })
    expect(snap(a).phase).toBe('lobby')
    expect(snap(a).players.every((p) => p.marks === 0 && !p.out)).toBe(true)
  })

  test('ticks speed up and heat rises', async () => {
    const { game, events } = setup({ fuseMin: 1500, fuseMax: 1500 })
    g = game
    const a = game.join(undefined, 'Ana')
    game.join(undefined, 'Ben')
    game.handle(a, { t: 'start' })
    await sleep(1700)
    const heats = events(a).flatMap((e) => (e.type === 'tick' ? [e.heat] : []))
    expect(heats.length).toBeGreaterThan(3)
    expect(heats[heats.length - 1]!).toBeGreaterThan(heats[0]!)
  })

  test('reconnect keeps identity; offline turn holder is skipped', async () => {
    const { game, snap } = setup({ fuseMin: 5000, fuseMax: 5000 })
    g = game
    const a = game.join(undefined, 'Ana')
    const b = game.join(undefined, 'Ben')
    game.handle(a, { t: 'start' })
    await sleep(90)
    game.disconnect(a)
    expect(snap(b).turn).toBe(b)
    expect(snap(b).players.find((p) => p.id === a)!.online).toBe(false)
    expect(game.join(a, 'Ana')).toBe(a)
    expect(snap(b).players.find((p) => p.id === a)!.online).toBe(true)
  })

  test('late joiners spectate; host moves when host leaves in lobby', async () => {
    const { game, snap } = setup({ lobbyGraceMs: 30 })
    g = game
    const a = game.join(undefined, 'Ana')
    const b = game.join(undefined, 'Ben')
    game.disconnect(a)
    expect(snap(b).host).toBe(b)
    expect(snap(b).players.length).toBe(2) // seat held during grace
    await sleep(60)
    expect(snap(b).players.length).toBe(1)
    const c = game.join(undefined, 'Cy')
    game.handle(b, { t: 'start' })
    expect(snap(c).players.length).toBe(2)
    const d = game.join(undefined, 'Di')
    expect(snap(d).players.find((p) => p.id === d)!.out).toBe(true)
  })
})
