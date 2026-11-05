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
    { cardMs: 60, revealMs: 30, fuseMin: 150, fuseMax: 150, drawGapMs: 0, overMs: 30, random: () => 0, ...opts },
  )
  const snap = (id: string): Snapshot => {
    const s = [...(inbox.get(id) ?? [])].reverse().find((m) => m.t === 'state')
    return (s as { s: Snapshot }).s
  }
  const events = (id: string): ServerEvent[] => (inbox.get(id) ?? []).flatMap((m) => (m.t === 'ev' ? [m.e] : []))
  return { game, snap, events }
}

let g: Game | undefined
afterEach(() => g?.dispose())

function table(opts = {}, names = ['Ana', 'Ben', 'Cy']) {
  const s = setup(opts)
  g = s.game
  const r = s.game.join(undefined)
  for (const n of names) s.game.handle(r, { t: 'add', name: n })
  return { ...s, r, ids: () => s.snap(r).players.map((p) => p.id) }
}

describe('roster', () => {
  test('anyone adds, renames and removes players; names trimmed; first becomes the turn', () => {
    const { game, snap, r, ids } = table({}, [])
    expect(snap(r).players).toEqual([])
    const r2 = game.join(undefined) // a second phone, same powers
    game.handle(r2, { t: 'add', name: '  Ana  ' })
    game.handle(r, { t: 'add', name: '   ' })
    game.handle(r, { t: 'add', name: 'Ben' })
    expect(snap(r).players.map((p) => p.name)).toEqual(['Ana', 'Ben'])
    expect(snap(r).turn).toBe(ids()[0]!)
    game.handle(r, { t: 'rename', id: ids()[1]!, name: 'Benny' })
    expect(snap(r2).players[1]!.name).toBe('Benny')
    game.handle(r2, { t: 'remove', id: ids()[0]! })
    expect(snap(r).players.length).toBe(1)
    expect(snap(r).turn).toBe(ids()[0]!) // turn moved to the remaining player
    expect(snap(r).remotes).toBe(2)
  })

  test('roster and marks survive everybody disconnecting; a fresh phone sees them', () => {
    const { game, snap, r } = table()
    game.disconnect(r)
    const r2 = game.join(undefined)
    expect(snap(r2).players.length).toBe(3)
    expect(snap(r2).phase).toBe('idle')
  })

  test('serialize / restore keeps the roster', () => {
    const { game } = table()
    const data = JSON.parse(JSON.stringify(game.serialize()))
    const s2 = setup()
    s2.game.restore(data)
    const r = s2.game.join(undefined)
    expect(s2.snap(r).players.map((p) => p.name)).toEqual(['Ana', 'Ben', 'Cy'])
    s2.game.dispose()
  })
})

describe('rounds', () => {
  test('card then play; taps locked before play; no fuse until the first tap', async () => {
    const { game, snap, events, r } = table({ fuseMin: 5000, fuseMax: 5000 })
    game.handle(r, { t: 'tap', letter: 'A' })
    expect(snap(r).taps).toBe(0)
    game.handle(r, { t: 'draw' })
    expect(snap(r).phase).toBe('card')
    expect(snap(r).turn).toBeTruthy() // random()=0 -> first player
    game.handle(r, { t: 'tap', letter: 'A' })
    expect(snap(r).taps).toBe(0)
    await sleep(90)
    expect(snap(r).phase).toBe('play')
    expect(snap(r).lit).toBe(false)
    expect(events(r).map((e) => e.type)).toEqual(expect.arrayContaining(['deal', 'reveal', 'go']))
  })

  test('a tap counts for whoever holds the turn, passes it on, and relights the fuse', async () => {
    const { game, snap, events, r, ids } = table({ fuseMin: 5000, fuseMax: 5000 })
    const [a, b, c] = ids()
    game.handle(r, { t: 'draw' })
    await sleep(90)
    game.handle(r, { t: 'tap', letter: 'A' })
    game.handle(r, { t: 'tap', letter: 'A' }) // used
    game.handle(r, { t: 'tap', letter: 'Z' }) // not in ring
    expect(snap(r).turn).toBe(b!)
    game.handle(r, { t: 'tap', letter: 'B' })
    game.handle(r, { t: 'tap', letter: 'C' })
    expect(snap(r).turn).toBe(a!) // wrapped round
    expect(snap(r).lit).toBe(true)
    expect(snap(r).fuseLeft).toBeGreaterThan(4000)
    expect(snap(r).fuseLen).toBe(5000)
    const taps = events(r).filter((e) => e.type === 'tap') as Extract<ServerEvent, { type: 'tap' }>[]
    expect(taps.map((t) => t.by)).toEqual([a!, b!, c!])
  })

  test('with no players it is a plain shared table', async () => {
    const { game, snap, r } = table({}, [])
    game.handle(r, { t: 'draw' })
    await sleep(90)
    game.handle(r, { t: 'tap', letter: 'A' })
    expect(snap(r).taps).toBe(1)
    expect(snap(r).turn).toBeNull()
    await sleep(260)
    expect(snap(r).phase).toBe('boom')
    expect(snap(r).loser).toBeNull()
  })

  test('boom marks the holder; the loser starts the next round; three marks and out', async () => {
    const { game, snap, events, r, ids } = table({}, ['Ana', 'Ben', 'Cy'])
    const [a, b] = ids()
    game.handle(r, { t: 'draw' })
    await sleep(90)
    game.handle(r, { t: 'tap', letter: 'A' }) // Ana taps, Ben holds
    await sleep(260)
    expect(snap(r).phase).toBe('boom')
    expect(snap(r).loser).toBe(b!)
    expect(snap(r).players.find((p) => p.id === b)!.marks).toBe(1)
    expect(events(r).some((e) => e.type === 'boom')).toBe(true)
    game.handle(r, { t: 'draw' })
    expect(snap(r).turn).toBe(b!) // loser starts
    expect(snap(r).letters.every((l) => !l.used)).toBe(true)
    void a
  })

  test('last player standing wins; deck starts a fresh game', async () => {
    const { game, snap, events, r, ids } = table({}, ['Ana', 'Ben'])
    const [a, b] = ids()
    for (let round = 0; round < 3; round++) {
      game.handle(r, { t: 'draw' })
      await sleep(90)
      // Ana starts round 1: one tap leaves Ben holding. After that Ben starts: two taps bring it back to him.
      game.handle(r, { t: 'tap', letter: 'A' })
      if (round > 0) game.handle(r, { t: 'tap', letter: 'B' })
      await sleep(260)
    }
    await sleep(80)
    expect(snap(r).phase).toBe('over')
    expect(['Ana', 'Ben']).toContain(snap(r).players.find((p) => p.id === snap(r).winner)!.name)
    expect(events(r).some((e) => e.type === 'win')).toBe(true)
    expect(snap(r).players.some((p) => p.out)).toBe(true)
    game.handle(r, { t: 'draw' })
    expect(snap(r).phase).toBe('card')
    expect(snap(r).players.every((p) => p.marks === 0 && !p.out)).toBe(true)
    void a
    void b
  })

  test('a steady tapper never blows; switching the card resets ring and fuse', async () => {
    const { game, snap, r } = table({ fuseMin: 200, fuseMax: 200 })
    game.handle(r, { t: 'draw' })
    await sleep(90)
    for (const ch of 'ABCDEF') {
      game.handle(r, { t: 'tap', letter: ch })
      await sleep(100)
    }
    expect(snap(r).phase).toBe('play')
    const turn = snap(r).turn
    game.handle(r, { t: 'draw' })
    expect(snap(r).phase).toBe('card')
    expect(snap(r).lit).toBe(false)
    expect(snap(r).turn).toBe(turn!) // switching the card keeps the turn
    expect(snap(r).letters.every((l) => !l.used)).toBe(true)
  })

  test('removing the player on the clock passes the turn; refill; draw debounce', async () => {
    const { game, snap, events, r, ids } = table({ fuseMin: 5000, fuseMax: 5000, drawGapMs: 50 }, ['Ana', 'Ben'])
    const [a, b] = ids()
    game.handle(r, { t: 'draw' })
    const n = snap(r).card!.n
    game.handle(r, { t: 'draw' })
    expect(snap(r).card!.n).toBe(n)
    await sleep(100)
    game.handle(r, { t: 'remove', id: snap(r).turn! })
    expect(snap(r).turn).toBe(snap(r).players[0]!.id)
    game.handle(r, { t: 'add', name: 'Dee' })
    for (const l of snap(r).letters) game.handle(r, { t: 'tap', letter: l.ch })
    expect(events(r).some((e) => e.type === 'refill')).toBe(true)
    void a
    void b
  })

  test('a draw right after the final boom does not skip the winner screen', async () => {
    const { game, snap, r } = table({ overMs: 150 }, ['Ana', 'Ben'])
    for (let round = 0; round < 3; round++) {
      game.handle(r, { t: 'draw' })
      await sleep(90)
      game.handle(r, { t: 'tap', letter: 'A' })
      if (round > 0) game.handle(r, { t: 'tap', letter: 'B' })
      await sleep(round < 2 ? 260 : 190)
    }
    expect(snap(r).phase).toBe('boom')
    game.handle(r, { t: 'draw' })
    expect(snap(r).phase).toBe('boom') // ignored while 'over' is pending
    await sleep(200)
    expect(snap(r).phase).toBe('over')
  })

  test('players can be reordered; the turn holder stays; bad ids are ignored', async () => {
    const { game, snap, r, ids } = table({ fuseMin: 5000, fuseMax: 5000 })
    const [a, b, c] = ids()
    game.handle(r, { t: 'draw' })
    await sleep(90)
    const holder = snap(r).turn
    game.handle(r, { t: 'order', ids: [c!, 'nope', a!] }) // b missing -> goes last
    expect(snap(r).players.map((p) => p.id)).toEqual([c!, a!, b!])
    expect(snap(r).turn).toBe(holder!)
    game.handle(r, { t: 'tap', letter: 'A' })
    const order = snap(r).players.map((p) => p.id)
    expect(snap(r).turn).toBe(order[(order.indexOf(holder!) + 1) % 3]!) // next in the NEW order
  })

  test('reset restores all lives, un-outs players and clears a finished game', async () => {
    const { game, snap, r } = table({ overMs: 20 }, ['Ana', 'Ben'])
    for (let round = 0; round < 3; round++) {
      game.handle(r, { t: 'draw' })
      await sleep(90)
      game.handle(r, { t: 'tap', letter: 'A' })
      if (round > 0) game.handle(r, { t: 'tap', letter: 'B' })
      await sleep(260)
    }
    await sleep(40)
    expect(snap(r).phase).toBe('over')
    game.handle(r, { t: 'reset' })
    expect(snap(r).phase).toBe('idle')
    expect(snap(r).players.every((p) => p.marks === 0 && !p.out)).toBe(true)
    expect(snap(r).winner).toBeNull()
    expect(snap(r).players.length).toBe(2)
  })

  test('a hand of cards goes to the asker only; picking draws that exact card and removes it from the deck', async () => {
    const inbox = new Map<string, ServerMsg[]>()
    const game = new Game((id, m) => inbox.set(id, [...(inbox.get(id) ?? []), m]), { cardMs: 60, revealMs: 30, drawGapMs: 0 })
    g = game
    const a = game.join(undefined)
    const b = game.join(undefined)
    game.handle(a, { t: 'hand', size: 8 })
    const hands = (id: string) =>
      (inbox.get(id) ?? []).flatMap((m) => (m.t === 'hand' ? [m.cards] : []))
    expect(hands(b).length).toBe(0)
    const [cards] = hands(a)
    expect(cards!.length).toBe(8)
    expect(new Set(cards!.map((c) => c.cat)).size).toBe(8)
    const want = cards![3]!
    game.handle(b, { t: 'pick', cat: want.cat })
    const last = [...(inbox.get(a) ?? [])].reverse().find((m) => m.t === 'state') as { s: Snapshot }
    expect(last.s.phase).toBe('card')
    expect(last.s.card!.text).toBe(want.text)
    game.handle(a, { t: 'hand', size: 12 })
    expect(hands(a)[1]!.some((c) => c.cat === want.cat)).toBe(false) // already used
    game.handle(a, { t: 'pick', cat: 99999 }) // bogus index ignored
    expect(last.s.card!.text).toBe(want.text)
  })
})
