// hotring client: one shared table, players live on the table (any phone is a remote).
// Wires the network, the ring instrument, the deck, the roster and the effects.
// Snapshots are the truth; `ev` events fire one-shot juice.
import { MAX_PLAYERS, type PlayerView, type ServerEvent, type Snapshot } from '../shared/protocol'
import { Audio } from './audio'
import { Deck } from './deck'
import { E, ICON, anim, clamp, h, reduced } from './dom'
import { Fx } from './fx'
import { Net } from './net'
import { CREAM, GOLD, HOT, pc } from './palette'
import { Ring, type RingMode } from './ring'
import { Takeover } from './takeover'
import { Pop, Roster, Share } from './ui'

const ID_KEY = 'hotring.id'

function deviceId() {
  let id = localStorage.getItem(ID_KEY)
  if (!id || !/^[\w-]{6,40}$/.test(id)) {
    // getRandomValues works on plain-http LAN origins (randomUUID does not).
    const b = crypto.getRandomValues(new Uint8Array(14))
    id = 'd-' + Array.from(b, (x) => (x % 36).toString(36)).join('')
    localStorage.setItem(ID_KEY, id)
  }
  return id
}

// ---- the one and only view ----

const stage = h('div', '', document.body)
stage.id = 'stage'
const canvas = h('canvas', '', document.body)
canvas.id = 'fx'
const flash = h('div', '', document.body)
flash.id = 'flash'

const fx = new Fx(canvas)
const audio = new Audio()
const ring = new Ring(stage, fx)
const deck = new Deck(stage, fx, audio)

const top = h('div', '', stage)
top.id = 'top'
const muteBtn = h('button', 'icon', top)
muteBtn.type = 'button'
const roster = new Roster(top, fx)
const shareBtn = h('button', 'icon share', top, ICON.qr)
shareBtn.type = 'button'
shareBtn.setAttribute('aria-label', 'share')
const remotesEl = h('div', '', shareBtn)
remotesEl.id = 'remotes'
const pop = new Pop(document.body)
const takeover = new Takeover(stage, fx)
const conn = h('div', '', stage)
conn.id = 'conn'
const share = new Share(document.body)

let connTimer: ReturnType<typeof setTimeout> | undefined
const net = new Net({
  state: onState,
  event: onEvent,
  err: () => {},
  status: (online) => {
    clearTimeout(connTimer)
    if (online) conn.classList.remove('on')
    else connTimer = setTimeout(() => conn.classList.add('on'), 700)
  },
})

// ---- state ----

let snap: Snapshot | null = null
let dealAt = 0
let boomAt = 0
const pending = new Map<string, number>() // optimistic presses: letter -> time
let readyTimer: ReturnType<typeof setTimeout> | undefined

const player = (id: string | null | undefined): PlayerView | undefined => (id ? snap?.players.find((p) => p.id === id) : undefined)
const colorOf = (id: string | null | undefined) => {
  const p = player(id)
  return p ? pc(p.color) : CREAM
}

// ---- layout ----

const probe = h('div', '', document.body)
probe.id = 'probe'

function layout() {
  const cs = getComputedStyle(probe)
  const ins = { t: parseFloat(cs.paddingTop) || 0, r: parseFloat(cs.paddingRight) || 0, b: parseFloat(cs.paddingBottom) || 0, l: parseFloat(cs.paddingLeft) || 0 }
  const W = innerWidth
  // While a name is being typed, keep the table still under the on-screen keyboard.
  const typing = document.activeElement?.tagName === 'INPUT'
  const H = typing && lastH ? lastH : innerHeight
  lastH = H
  fx.resize()
  const left = ins.l + 8
  const right = W - ins.r - 8
  const topY = ins.t + 8
  const bottom = H - Math.max(ins.b, 12) - 8
  // Roster between the two corner icons: one row, or two rows of bigger discs when crowded.
  const n = snap?.players.length ?? 0
  const items = Math.min(n + 1, MAX_PLAYERS)
  const avail = W - ins.l - ins.r - 2 * (8 + 44 + 8)
  const gap = 8
  let perRow = items
  let a = Math.min(44, (avail - (perRow - 1) * gap) / perRow)
  if (a < 30) {
    perRow = Math.ceil(items / 2)
    a = Math.min(44, (avail - (perRow - 1) * gap) / perRow)
  }
  a = Math.floor(a)
  discSize = a
  const rows = Math.ceil(items / perRow)
  const rosterH = 12 + rows * (a + 13) + (rows - 1) * 10
  const rs = roster.el.style
  rs.width = perRow * a + (perRow - 1) * gap + 'px'
  rs.left = (W - ins.l - ins.r - 16) / 2 - (perRow * a + (perRow - 1) * gap) / 2 + 'px'
  const topH = Math.max(44, rosterH)
  const chipH = 52
  top.style.left = ins.l + 8 + 'px'
  top.style.right = ins.r + 8 + 'px'
  top.style.top = topY + 'px'
  top.style.height = topH + 'px'
  conn.style.top = topY + topH + 4 + 'px'
  const head = topY + topH + 8 + chipH + 12
  const landscape = W > H * 1.12
  const cx = (left + right) / 2
  let size: number, cy: number, dx: number, dy: number, dh: number
  if (!landscape) {
    dh = clamp(H * 0.15, 84, 150)
    const block = dh + 40
    const avail = bottom - head - block
    size = Math.min(right - left, avail, 780)
    const free = avail - size
    cy = head + free * 0.42 + size / 2
    dx = cx
    dy = cy + size / 2 + free * 0.3 + block / 2
  } else {
    dh = clamp(H * 0.2, 96, 168)
    const gutter = dh * 0.72 + 112
    size = Math.min(bottom - head - 8, right - left - 2 * gutter, 780)
    cy = head + (bottom - head - 8) / 2
    dx = (cx + size / 2 + right) / 2
    dy = cy
  }
  ring.layout(cx, cy, size)
  const cw = Math.min(size * 0.6, 300)
  const chipY = Math.max(topY + topH + 8 + chipH / 2, (topY + topH + (cy - size / 2)) / 2)
  deck.layout({ deck: { x: dx, y: dy, w: dh * 0.72, h: dh }, card: { x: cx, y: cy, w: cw, h: cw * 1.4 }, chip: { x: cx, y: chipY } })
  laidN = n
  if (snap) render(snap, snap)
  requestAnimationFrame(() => {
    roster.placeHalo()
    pop.place()
  })
}
let lastH = 0
let fuseDeadline = 0
let laidN = -1
let discSize = 44

// ---- render: snapshot -> view ----

function ringMode(s: Snapshot | null): RingMode {
  if (!s) return 'idle'
  switch (s.phase) {
    case 'idle':
      return 'idle'
    case 'card':
      return deck.stage === 'fly' || deck.stage === 'center' || deck.stage === 'revealed' ? 'recede' : 'calm'
    case 'play':
      return 'play'
    default:
      return 'dim'
  }
}
deck.onStage = () => ring.setMode(ringMode(snap))

function render(s: Snapshot, p: Snapshot | null) {
  const phase = s.phase
  stage.dataset.phase = phase
  if (s.players.length !== laidN) return layout()
  roster.sync(s.players, { turn: s.turn, winner: s.winner, phase, size: discSize })
  if (pop.target && !player(pop.target)) pop.close()
  remotesEl.innerHTML = s.remotes > 1 ? '<i></i>'.repeat(Math.min(6, s.remotes)) : ''

  // who holds the fuse: big on the lens
  const holder = phase === 'over' ? player(s.winner) : phase === 'boom' ? (player(s.loser) ?? player(s.turn)) : player(s.turn)
  ring.setTurn(holder ? { id: holder.id, name: holder.name, color: pc(holder.color) } : null, phase === 'over')
  if (phase === 'over' && takeover.kind !== 'win' && holder) takeover.show('win', { name: holder.name, color: pc(holder.color), quiet: true })
  else if (phase !== 'over' && takeover.kind === 'win') takeover.hide()

  ring.sync(s.letters)
  ring.setMode(ringMode(s))
  ring.setLit(phase === 'play' && s.lit)
  ring.setFuse(fuseDeadline && phase === 'play' ? Math.max(0, fuseDeadline - performance.now()) : null, s.fuseLen)
  ring.setEmoji(phase === 'play' || phase === 'boom' ? (s.card?.emoji ?? null) : null)
  if (!s.lit && phase !== 'boom') ring.calm()

  // card / chip
  if (s.card && phase === 'card') {
    if (deck.n !== s.card.n) {
      if (dealAt && performance.now() - dealAt < 1500) deck.setCard(s.card)
      else deck.midJoin(s.card, s.revealAt !== null && s.now >= s.revealAt)
    }
  } else if (s.card && (phase === 'play' || phase === 'boom')) {
    if (deck.n === s.card.n && (deck.stage === 'center' || deck.stage === 'revealed')) void deck.go()
    else if (deck.stage !== 'chip' || deck.n !== s.card.n) deck.showChip(s.card)
  } else if (deck.stage !== 'none') deck.clear()

  // The deck is always live: anyone can shuffle a fresh category.
  deck.setInteractive(true)
  const sinceBoom = boomAt ? performance.now() - boomAt : 1e9
  const invite = phase === 'idle' || phase === 'over' || (phase === 'boom' && sinceBoom > 900)
  deck.setReady(invite)
  clearTimeout(readyTimer)
  if (phase === 'boom' && !invite) readyTimer = setTimeout(() => snap && render(snap, snap), 920 - sinceBoom)

  fx.setAmbient(phase === 'idle')
  void wake(phase !== 'idle')
  void p
}

function onState(s: Snapshot) {
  const p = snap
  snap = s
  // Fuse deadline on the local clock, fixed at receive time (clocks are never compared).
  fuseDeadline = s.phase === 'play' && s.lit && s.fuseLeft !== null ? performance.now() + s.fuseLeft : 0
  // Optimistic presses the server never confirmed: the snapshot wins.
  const now = performance.now()
  for (const [ch, at] of pending) {
    if (now - at < 1200) continue
    pending.delete(ch)
    ring.unhold(ch, s.letters.find((l) => l.ch === ch)?.used ?? false)
  }
  render(s, p)
}

// ---- events ----

function onEvent(e: ServerEvent) {
  const s = snap
  if (!s) return
  switch (e.type) {
    case 'joined':
    case 'left':
      break
    case 'added':
      audio.play('join')
      break
    case 'removed':
      audio.play('ui', { gain: 0.6 })
      break
    case 'deal':
      dealAt = performance.now()
      pending.clear()
      ring.calm()
      ring.setLit(false)
      takeover.hide()
      if (s.phase === 'idle' || s.phase === 'over') audio.play('start')
      void deck.deal()
      break
    case 'reveal':
      deck.reveal()
      break
    case 'go':
      void deck.go()
      audio.play('whoosh', { gain: 0.6 })
      break
    case 'tap': {
      const col = colorOf(e.by)
      if (pending.has(e.letter)) {
        // We pressed it here already; just confirm.
        pending.delete(e.letter)
        ring.hold(e.letter, 0)
      } else if (ring.press(e.letter, col)) audio.tap(0.75)
      else ring.ripple(e.letter, col)
      ring.relight(col)
      // The fuse travels to whoever is next.
      if (e.next && e.next !== e.by) {
        const from = ring.pos(e.letter)
        const to = ring.lensCenter()
        fx.comet(from.x, from.y, to.x, to.y, colorOf(e.next), 260)
        audio.play('whoosh', { gain: 0.4, rate: 0.95 + Math.random() * 0.15 })
      }
      break
    }
    case 'tick':
      onTick(e.heat)
      break
    case 'refill':
      setTimeout(() => {
        ring.refill()
        audio.play('refill')
        const c = ring.lensCenter()
        fx.shock(c.x, c.y, CREAM, ring.size * 0.55, 0.7, 4)
      }, 260)
      break
    case 'boom':
      onBoom(e.loser, e.out)
      break
    case 'win':
      onWin(e.winner)
      break
  }
}

function onTick(heat: number) {
  audio.play('tick', { rate: 0.9 + 0.9 * heat, gain: 0.45 + 0.45 * heat })
  ring.tick(heat)
}

function shake(power: number) {
  if (reduced) return
  const kf: Keyframe[] = []
  for (let i = 0; i <= 12; i++) {
    const k = power * (1 - i / 12) ** 1.5
    kf.push({ transform: `translate(${(Math.random() - 0.5) * 2 * k}px,${(Math.random() - 0.5) * 2 * k}px) rotate(${(Math.random() - 0.5) * k * 0.15}deg)` })
  }
  kf.push({ transform: 'none' })
  anim(stage, kf, { duration: 700, easing: 'linear', fill: 'none' })
}

function onWin(id: string) {
  const col = colorOf(id)
  audio.play('win')
  takeover.show('win', { name: player(id)?.name ?? '', color: col })
  fx.confetti([col, col, CREAM, GOLD], 4200)
  setTimeout(() => {
    const c = ring.lensCenter()
    fx.burst(c.x, c.y, { colors: [col, GOLD, CREAM], n: 90, speed: [150, 640], g: 120, streak: 0.3, radius: ring.lensR * 0.6 })
    fx.shock(c.x, c.y, GOLD, ring.lensR * 3, 0.8, 6)
    const d = roster.center(id)
    if (d) fx.stars(d.x, d.y - discSize * 0.6, { colors: [GOLD, CREAM], n: 10, radius: discSize })
  }, 250)
}

function onBoom(loser: string | null, out: boolean) {
  boomAt = performance.now()
  pending.clear()
  audio.play('boom')
  if (out) audio.play('out', { delay: 1100 })
  roster.pipDelay = 650
  const lp = player(loser)
  setTimeout(() => {
    if (snap?.phase !== 'boom' && snap?.phase !== 'over') return
    if (lp) takeover.show(out ? 'out' : 'lost', { name: lp.name, color: pc(lp.color) })
    else takeover.show('boom', { color: HOT })
  }, 380)
  if (loser) {
    ring.flashName()
    const col = colorOf(loser)
    setTimeout(() => {
      const d = roster.center(loser)
      if (d) {
        fx.burst(d.x, d.y, { colors: [col, HOT, CREAM], n: 34, speed: [80, 300], size: [2, 4], g: 80, life: [0.4, 0.8] })
        fx.shock(d.x, d.y, HOT, discSize * 1.3, 0.5, 4)
      }
    }, 650)
  }
  navigator.vibrate?.([70, 40, 220])
  anim(flash, [{ opacity: reduced ? 0.4 : 0.95 }, { opacity: 0 }], { duration: 500, easing: E.out })
  shake(18)
  ring.boom()
  const { x, y } = ring.lensCenter()
  const size = ring.size
  fx.burst(x, y, { colors: [HOT, '#FFB020', CREAM, GOLD], n: 180, speed: [260, 1000], size: [2.5, 6], life: [0.6, 1.4], g: 320, drag: 2, streak: 0.5, radius: ring.lensR * 0.6 })
  fx.shock(x, y, CREAM, size * 0.6, 0.6, 12)
  fx.shock(x, y, HOT, size * 0.95, 0.95, 7)
  setTimeout(() => fx.burst(x, y, { colors: [HOT, GOLD], n: 50, speed: [60, 260], size: [2, 4], g: -40, life: [0.8, 1.6], radius: ring.lensR }), 200)
  setTimeout(() => snap && render(snap, snap), 940)
}

// ---- input ----

ring.onPress = (k) => {
  audio.unlock()
  const s = snap
  if (!s || s.phase !== 'play') return ring.nudge(k.ch)
  if (k.used || pending.has(k.ch)) return
  pending.set(k.ch, performance.now())
  net.send({ t: 'tap', letter: k.ch })
  ring.hold(k.ch, 1500)
  // A tap counts for whoever holds the fuse: tint it their colour.
  ring.press(k.ch, colorOf(s.turn))
  audio.tap()
  navigator.vibrate?.(10)
  const ch = k.ch
  setTimeout(() => {
    if (!pending.has(ch) || !snap) return
    pending.delete(ch)
    ring.unhold(ch, snap.letters.find((l) => l.ch === ch)?.used ?? false)
  }, 1600)
}

roster.onAdd = () => {
  audio.unlock()
  if (pop.mode === 'add') return pop.close()
  pop.openAdd(() => roster.addRect())
}
roster.onOpen = (id) => {
  audio.unlock()
  const p = player(id)
  if (!p) return
  if (pop.target === id) return pop.close()
  audio.play('ui', { gain: 0.6 })
  pop.openPlayer(p, () => roster.rect(id))
}
pop.onAdd = (name) => net.send({ t: 'add', name })
pop.onRemove = (id) => net.send({ t: 'remove', id })
pop.onRename = (id, name) => net.send({ t: 'rename', id, name })

deck.onDraw = () => {
  audio.unlock()
  audio.play('ui')
  net.send({ t: 'draw' })
}

function paintMute() {
  muteBtn.innerHTML = audio.muted ? ICON.mute : ICON.sound
  muteBtn.setAttribute('aria-label', audio.muted ? 'unmute' : 'mute')
  muteBtn.classList.toggle('muted', audio.muted)
}
paintMute()
muteBtn.addEventListener('click', () => {
  audio.unlock()
  audio.setMuted(!audio.muted)
  paintMute()
  audio.play('ui')
})

shareBtn.addEventListener('click', () => {
  audio.unlock()
  audio.play('ui')
  void share.show()
})

// Unlock audio on the very first gesture, wherever it lands.
for (const t of ['pointerdown', 'touchstart', 'touchend', 'click', 'keydown'] as const)
  addEventListener(t, () => audio.unlock(), { capture: true, passive: true })
// Debug handle for checking the audio state from devtools.
;(window as unknown as { __hotringAudio: Audio }).__hotringAudio = audio
// No pinch / double-tap zoom, no context menus: it's a game.
document.addEventListener('gesturestart', (e) => e.preventDefault())
document.addEventListener('dblclick', (e) => e.preventDefault())
document.addEventListener('contextmenu', (e) => e.preventDefault())

// ---- screen wake lock while a round is on ----

let lock: WakeLockSentinel | null = null
let locking = false
let wantLock = false
async function wake(on: boolean) {
  wantLock = on
  try {
    if (on && !lock && !locking && 'wakeLock' in navigator && document.visibilityState === 'visible') {
      locking = true
      const l = await navigator.wakeLock.request('screen').finally(() => (locking = false))
      l.addEventListener('release', () => lock === l && (lock = null))
      if (wantLock) lock = l
      else void l.release()
    } else if (!on && lock) {
      const l = lock
      lock = null
      await l.release()
    }
  } catch {
    /* not supported / not allowed */
  }
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && wantLock) void wake(true)
})

// ---- boot ----

addEventListener('resize', layout)
visualViewport?.addEventListener('resize', layout)
ring.sync([...'ABCDEFGHIJKLMNOPRSTW'].map((ch) => ({ ch, used: false })))
layout()
ring.setMode('idle')
ring.calm()
fx.setAmbient(true)
deck.setReady(true)
net.join(deviceId())

// Idle attract: a wave of hops around the ring now and then.
setInterval(() => {
  if (!snap || snap.phase === 'idle') ring.shimmer()
}, 5200)
