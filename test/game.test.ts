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
    { cardMs: 60, revealMs: 30, fuseMin: 150, fuseMax: 150, drawGapMs: 0, random: () => 0, ...opts },
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

describe('shared table', () => {
  test('anyone draws; card then play; taps locked before play', async () => {
    const { game, snap, events } = setup({ fuseMin: 5000, fuseMax: 5000 })
    g = game
    const a = game.join(undefined)
    const b = game.join(undefined)
    expect(snap(a).phase).toBe('idle')
    game.handle(a, { t: 'tap', letter: 'A' })
    expect(snap(a).taps).toBe(0)
    game.handle(b, { t: 'draw' })
    expect(snap(a).phase).toBe('card')
    expect(snap(a).card?.text).toBeTruthy()
    expect(snap(a).revealAt).toBeGreaterThan(Date.now() - 5)
    game.handle(a, { t: 'tap', letter: 'A' }) // still locked
    expect(snap(a).taps).toBe(0)
    await sleep(90)
    expect(snap(a).phase).toBe('play')
    expect(snap(a).lit).toBe(false) // fuse not lit before the first tap
    expect(events(a).map((e) => e.type)).toEqual(expect.arrayContaining(['deal', 'reveal', 'go']))
  })

  test('either phone can tap; a letter only once; every tap lights a fresh fuse', async () => {
    const { game, snap, events } = setup({ fuseMin: 5000, fuseMax: 5000 })
    g = game
    const a = game.join(undefined)
    const b = game.join(undefined)
    game.handle(a, { t: 'draw' })
    await sleep(90)
    game.handle(b, { t: 'tap', letter: 'A' })
    game.handle(a, { t: 'tap', letter: 'A' }) // already used
    game.handle(a, { t: 'tap', letter: 'Z' }) // not in ring
    expect(snap(a).taps).toBe(1)
    expect(snap(a).lit).toBe(true)
    game.handle(a, { t: 'tap', letter: 'B' })
    expect(snap(a).taps).toBe(2)
    expect(events(a).filter((e) => e.type === 'tap').map((e) => (e as { by: string }).by)).toEqual([b, a])
  })

  test('fuse runs out -> boom; deck draws the next card', async () => {
    const { game, snap, events } = setup()
    g = game
    const a = game.join(undefined)
    game.handle(a, { t: 'draw' })
    await sleep(90)
    game.handle(a, { t: 'tap', letter: 'C' })
    await sleep(260)
    expect(snap(a).phase).toBe('boom')
    expect(snap(a).lit).toBe(false)
    expect(events(a).some((e) => e.type === 'boom')).toBe(true)
    game.handle(a, { t: 'draw' })
    expect(snap(a).phase).toBe('card')
    expect(snap(a).letters.every((l) => !l.used)).toBe(true)
  })

  test('a tap restarts the fuse so a steady tapper never blows', async () => {
    const { game, snap } = setup({ fuseMin: 200, fuseMax: 200 })
    g = game
    const a = game.join(undefined)
    game.handle(a, { t: 'draw' })
    await sleep(90)
    for (const ch of 'ABCDEF') {
      game.handle(a, { t: 'tap', letter: ch })
      await sleep(100)
    }
    expect(snap(a).phase).toBe('play')
  })

  test('switching the card mid-round resets the ring and the fuse', async () => {
    const { game, snap } = setup({ fuseMin: 300, fuseMax: 300 })
    g = game
    const a = game.join(undefined)
    game.handle(a, { t: 'draw' })
    await sleep(90)
    game.handle(a, { t: 'tap', letter: 'A' })
    game.handle(a, { t: 'draw' })
    expect(snap(a).phase).toBe('card')
    expect(snap(a).lit).toBe(false)
    expect(snap(a).letters[0]!.used).toBe(false)
    await sleep(500)
    expect(snap(a).phase).toBe('play') // never blew
  })

  test('refill when all letters used; draws are debounced', async () => {
    const { game, snap, events } = setup({ fuseMin: 5000, fuseMax: 5000, drawGapMs: 50 })
    g = game
    const a = game.join(undefined)
    game.handle(a, { t: 'draw' })
    const n = snap(a).card!.n
    game.handle(a, { t: 'draw' }) // too soon
    expect(snap(a).card!.n).toBe(n)
    await sleep(100)
    for (const l of snap(a).letters) game.handle(a, { t: 'tap', letter: l.ch })
    expect(events(a).some((e) => e.type === 'refill')).toBe(true)
    expect(snap(a).letters.every((l) => !l.used)).toBe(true)
  })

  test('devices come and go; reconnect keeps the id and color; empty table resets', () => {
    const { game, snap } = setup()
    g = game
    const a = game.join(undefined)
    const b = game.join(undefined)
    expect(snap(a).devices.map((d) => d.color)).toEqual([0, 1])
    game.disconnect(b)
    expect(snap(a).devices.length).toBe(1)
    expect(game.join(b)).toBe(b)
    expect(snap(b).devices.length).toBe(2)
    game.handle(a, { t: 'draw' })
    game.disconnect(a)
    game.disconnect(b)
    const c = game.join(undefined)
    expect(snap(c).phase).toBe('idle')
  })
})
