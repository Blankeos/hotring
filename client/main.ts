// hotring client: wires the network, the ring, the deck, the people and the effects.
// Snapshots are the truth (diffed against the previous one); `ev` events fire one-shot juice.
import type { PlayerView, ServerEvent, Snapshot } from '../shared/protocol'
import { Audio } from './audio'
import { Deck } from './deck'
import { E, ICON, anim, clamp, h, reduced } from './dom'
import { Fx } from './fx'
import { Net } from './net'
import { CREAM, GOLD, HOT, heatColor, pc } from './palette'
import { Ring, type RingMode } from './ring'
import { Hero, NameBox, Orbit, Share, Strip } from './ui'

const ID_KEY = 'hotring.id'
const NAME_KEY = 'hotring.name'

function playerId() {
  let id = localStorage.getItem(ID_KEY)
  if (!id || !/^[\w-]{6,40}$/.test(id)) {
    // getRandomValues works on plain-http LAN origins (randomUUID does not).
    const b = crypto.getRandomValues(new Uint8Array(14))
    id = 'p-' + Array.from(b, (x) => (x % 36).toString(36)).join('')
    localStorage.setItem(ID_KEY, id)
  }
  return id
}

// ---- build the one and only view ----

const stage = h('div', '', document.body)
stage.id = 'stage'
const edge = h('div', '', stage)
edge.id = 'edge'
const canvas = h('canvas', '', document.body)
canvas.id = 'fx'
const flash = h('div', '', document.body)
flash.id = 'flash'

const fx = new Fx(canvas)
const audio = new Audio()
const ring = new Ring(stage, fx)
const hero = new Hero(ring.center, fx)
const orbit = new Orbit(ring.center)
const playBtn = h('button', 'big', ring.center, ICON.play)
playBtn.id = 'play'
playBtn.type = 'button'
playBtn.setAttribute('aria-label', 'start')
const waitEl = h('div', '', ring.center, '<span></span><span></span><span></span>')
waitEl.id = 'wait'
const namebox = new NameBox(ring.center)
const deck = new Deck(stage, fx, audio)
const againBtn = h('button', 'big', stage, ICON.replay)
againBtn.id = 'again'
againBtn.type = 'button'
againBtn.setAttribute('aria-label', 'play again')

const top = h('div', '', stage)
top.id = 'top'
const muteBtn = h('button', 'icon', top)
muteBtn.type = 'button'
const strip = new Strip(top)
const shareBtn = h('button', 'icon', top, ICON.qr)
shareBtn.type = 'button'
shareBtn.setAttribute('aria-label', 'share')
const conn = h('div', '', stage)
conn.id = 'conn'
const share = new Share(document.body)

const net = new Net({
  state: onState,
  event: onEvent,
  err: onErr,
  status: (online) => {
    clearTimeout(connTimer)
    if (online) conn.classList.remove('on')
    else connTimer = setTimeout(() => conn.classList.add('on'), 700)
  },
})
let connTimer: ReturnType<typeof setTimeout> | undefined

// ---- state ----

let snap: Snapshot | null = null
let heat = 0
let dealAt = 0
let boomAt = 0
let pending: { ch: string; at: number } | null = null
let fuseOff: (() => void) | null = null
let readyTimer: ReturnType<typeof setTimeout> | undefined

const player = (id: string | null | undefined): PlayerView | undefined => (id ? snap?.players.find((p) => p.id === id) : undefined)
const colorOf = (id: string | null | undefined) => {
  const p = player(id)
  return p ? pc(p.color) : CREAM
}

// ---- layout (all geometry in one place) ----

const probe = h('div', '', document.body)
probe.id = 'probe'

function layout() {
  const cs = getComputedStyle(probe)
  const ins = { t: parseFloat(cs.paddingTop) || 0, r: parseFloat(cs.paddingRight) || 0, b: parseFloat(cs.paddingBottom) || 0, l: parseFloat(cs.paddingLeft) || 0 }
  const W = innerWidth
  const H = innerHeight
  fx.resize()
  const left = ins.l + 12
  const right = W - ins.r - 12
  const topY = ins.t + 8
  const bottom = H - Math.max(ins.b, 12) - 8
  const topH = 44
  const chipH = 44
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
    size = Math.min(right - left, avail, 760)
    const free = avail - size
    cy = head + free * 0.42 + size / 2
    dx = cx
    dy = cy + size / 2 + free * 0.3 + block / 2
  } else {
    dh = clamp(H * 0.2, 96, 168)
    const gutter = dh * 0.72 + 112
    size = Math.min(bottom - head - 8, right - left - 2 * gutter, 760)
    cy = head + (bottom - head - 8) / 2
    dx = (cx + size / 2 + right) / 2
    dy = cy
  }
  const k = 0.9
  const d = Math.min(96, (k * Math.PI * size) / (20 + k * Math.PI))
  ring.layout(cx, cy, size, d)
  const cw = Math.min(size * 0.6, 300)
  const chipY = Math.max(topY + topH + 8 + chipH / 2, (topY + topH + (cy - size / 2)) / 2)
  deck.layout({ deck: { x: dx, y: dy, w: dh * 0.72, h: dh }, card: { x: cx, y: cy, w: cw, h: cw * 1.4 }, chip: { x: cx, y: chipY } })
  const ab = againBtn.style
  ab.left = dx + 'px'
  ab.top = dy + 'px'
  if (snap) render(snap, snap)
}

// ---- render: snapshot -> view ----

function ringMode(s: Snapshot | null): RingMode {
  if (!s) return 'idle'
  switch (s.phase) {
    case 'lobby':
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
  const me = player(s.you)
  const isHost = s.host === s.you
  const room = inner()
  const n = s.players.length

  // people
  const stripRoom = innerWidth - 2 * (44 + 16) - 16
  strip.sync(s.players, phase === 'play' || phase === 'card' ? s.turn : null, s.you, clamp(stripRoom / Math.max(1, n) - 8, 20, 34))
  if (phase === 'lobby') orbit.sync(s.players, { you: s.you, isHost, radius: room * 0.34, a: clamp(room * 0.15, 34, 64) })
  else orbit.reset()

  const online = s.players.filter((x) => x.online).length
  playBtn.classList.toggle('on', phase === 'lobby' && isHost)
  playBtn.disabled = online < 2
  waitEl.classList.toggle('on', phase === 'lobby' && !isHost)
  againBtn.classList.toggle('on', phase === 'over' && isHost)
  shareBtn.classList.toggle('hint', phase === 'lobby' && online < 2)

  // ring
  ring.sync(s.letters)
  ring.setMode(ringMode(s))
  const live = phase === 'play' && s.turn === s.you && !pending && !!me && !me.out
  ring.setLive(live, me ? pc(me.color) : CREAM)
  if (live && p !== s && !(p && p.phase === 'play' && p.turn === s.you)) {
    audio.play('yourturn')
    navigator.vibrate?.(30)
  }

  // hero in the centre
  const heroId = phase === 'play' ? s.turn : phase === 'boom' ? s.loser : phase === 'over' ? s.winner : null
  const hp = player(heroId)
  if (hp) hero.show(hp, { mine: phase === 'play' && hp.id === s.you, crown: phase === 'over' })
  else hero.hide()

  // card / chip
  if (s.card && phase === 'card') {
    if (deck.n !== s.card.n) {
      if (dealAt && performance.now() - dealAt < 1500) deck.setCard(s.card)
      else deck.midJoin(s.card, (s.cardUntil ?? s.now) - s.now)
    }
  } else if (s.card && (phase === 'play' || phase === 'boom')) {
    if (deck.n === s.card.n && (deck.stage === 'center' || deck.stage === 'revealed')) void deck.go()
    else if (deck.stage !== 'chip' || deck.n !== s.card.n) deck.showChip(s.card)
  } else if (deck.stage !== 'none') deck.clear()

  // the deck is also the "next round" button
  const active = s.players.filter((x) => !x.out).length
  const sinceBoom = boomAt ? performance.now() - boomAt : 1e9
  const boomReady = isHost && phase === 'boom' && active > 1 && sinceBoom > 1250
  deck.setInteractive((isHost && phase === 'card') || boomReady)
  deck.setReady(boomReady)
  deck.setDim(phase === 'lobby' || !s)
  clearTimeout(readyTimer)
  if (isHost && phase === 'boom' && active > 1 && !boomReady) readyTimer = setTimeout(() => snap && render(snap, snap), 1260 - sinceBoom)

  // fuse
  if (phase === 'play') startFuse()
  else stopFuse()
  if (phase !== 'play' && phase !== 'boom') setHeat(0)

  fx.setAmbient(phase === 'lobby')
  void wake(phase === 'card' || phase === 'play' || phase === 'boom')
}

function onState(s: Snapshot) {
  const p = snap
  snap = s
  namebox.hide()
  // Optimistic tap never confirmed: the snapshot wins.
  if (pending && performance.now() - pending.at > 1200) {
    const l = s.letters.find((x) => x.ch === pending!.ch)
    ring.unhold(pending.ch, l?.used ?? false)
    pending = null
  }
  render(s, p)
}

// ---- events: one-shot juice ----

function onEvent(e: ServerEvent) {
  const s = snap
  if (!s) return
  switch (e.type) {
    case 'joined':
      if (e.id !== s.you) audio.play('join')
      break
    case 'deal':
      dealAt = performance.now()
      setHeat(0)
      ring.calm()
      if (s.phase === 'lobby' || s.phase === 'over') audio.play('start')
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
      const mine = e.by === s.you
      if (mine && pending?.ch === e.letter) {
        pending = null
        ring.hold(e.letter, 0)
      } else {
        if (mine) pending = null
        if (ring.pop(e.letter, colorOf(e.by))) audio.tap(0.8)
      }
      const from = ring.pos(e.letter)
      fx.comet(from.x, from.y, ring.cx, ring.cy - inner() * 0.04, colorOf(e.next), 280)
      audio.play('whoosh', { gain: 0.45, rate: 0.95 + Math.random() * 0.15 })
      break
    }
    case 'skip':
      audio.play('whoosh', { gain: 0.45 })
      break
    case 'tick':
      onTick(e.heat)
      break
    case 'refill':
      setTimeout(() => {
        ring.refill()
        audio.play('refill')
        fx.shock(ring.cx, ring.cy, CREAM, ring.size * 0.55, 0.7, 4)
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

const inner = () => ring.size - 2 * ring.d - 16

function setHeat(v: number) {
  heat = v
  stage.style.setProperty('--heat', heatColor(v))
}

function onTick(v: number) {
  setHeat(v)
  audio.play('tick', { rate: 0.9 + 0.9 * v, gain: 0.5 + 0.4 * v })
  ring.pulse(v)
  hero.thump(v)
  anim(edge, [{ opacity: 0.12 + 0.6 * v * v }, { opacity: 0 }], { duration: 160 + 300 * (1 - v), easing: E.out })
}

function startFuse() {
  if (fuseOff) return
  // A spark runs round the band like a lit fuse: faster and hotter with heat.
  let a = -Math.PI / 2
  let acc = 0
  fuseOff = fx.hook((dt) => {
    a += dt * (0.9 + heat * 5.5)
    const R = ring.R
    // Ride the outer edge of the band so tiles stay readable.
    const off = ring.d / 2 + 6
    const ox = ring.cx + Math.cos(a) * (R + off)
    const oy = ring.cy + Math.sin(a) * (R + off)
    acc += dt * (reduced ? 12 : 40 + heat * 80)
    const col = heatColor(heat)
    while (acc >= 1) {
      acc--
      const tx = -Math.sin(a)
      const ty = Math.cos(a)
      const sp = 20 + Math.random() * 60
      fx.spark(ox, oy, -tx * sp + (Math.random() - 0.5) * 40, -ty * sp + (Math.random() - 0.5) * 40, Math.random() < 0.3 ? '#FFF4D6' : col, 1.6 + Math.random() * 1.8, 0.35 + Math.random() * 0.3, 0, 2)
    }
  })
}

function stopFuse() {
  fuseOff?.()
  fuseOff = null
}

function shake(power: number) {
  if (reduced) return
  const kf: Keyframe[] = []
  for (let i = 0; i <= 10; i++) {
    const k = power * (1 - i / 10) ** 1.6
    kf.push({ transform: `translate(${(Math.random() - 0.5) * 2 * k}px,${(Math.random() - 0.5) * 2 * k}px) rotate(${(Math.random() - 0.5) * k * 0.12}deg)` })
  }
  kf.push({ transform: 'none' })
  anim(stage, kf, { duration: 620, easing: 'linear', fill: 'none' })
}

function onBoom(loserId: string, out: boolean) {
  boomAt = performance.now()
  pending = null
  const col = colorOf(loserId)
  audio.play('boom')
  if (out) audio.play('out', { delay: 1000 })
  navigator.vibrate?.([70, 40, 220])
  setHeat(1)
  stopFuse()
  anim(flash, [{ opacity: reduced ? 0.4 : 0.95 }, { opacity: 0 }], { duration: 480, easing: E.out })
  shake(16)
  const { cx, cy, size } = ring
  fx.burst(cx, cy, { colors: [HOT, '#FFB020', CREAM, GOLD], n: 170, speed: [260, 980], size: [2.5, 6], life: [0.6, 1.4], g: 320, drag: 2, streak: 0.5, radius: 20 })
  fx.shock(cx, cy, CREAM, size * 0.62, 0.6, 12)
  fx.shock(cx, cy, HOT, size * 0.95, 0.95, 7)
  setTimeout(() => {
    const c = hero.discCenter()
    fx.burst(c.x, c.y, { colors: [col, col, CREAM], n: 70, speed: [120, 460], size: [2, 5], radius: c.r * 0.8, g: 60, life: [0.6, 1.1] })
    fx.stars(c.x, c.y, { colors: [col, CREAM], n: 10, radius: c.r * 1.4 })
  }, 260)
  ring.knock()
  hero.pipDelay = 700
  ring.setLive(false, CREAM)
  setTimeout(() => setHeat(0), 1600)
}

function onWin(winnerId: string) {
  const col = colorOf(winnerId)
  audio.play('win')
  fx.confetti([col, col, CREAM, GOLD], 4200)
  setTimeout(() => {
    const c = hero.discCenter()
    if (c.r) {
      fx.burst(c.x, c.y, { colors: [col, GOLD, CREAM], n: 80, speed: [150, 600], g: 120, streak: 0.3, radius: c.r * 0.6 })
      fx.shock(c.x, c.y, GOLD, c.r * 3, 0.8, 6)
    }
  }, 200)
}

function onErr(msg: string) {
  if (msg === 'removed') {
    net.forget()
    snap = null
    orbit.reset()
    hero.hide()
    deck.clear()
    playBtn.classList.remove('on')
    waitEl.classList.remove('on')
    againBtn.classList.remove('on')
    delete stage.dataset.phase
    ring.setMode('idle')
    namebox.show(localStorage.getItem(NAME_KEY) ?? '')
    return
  }
  if (/2 players/i.test(msg)) refuse(playBtn)
}

function refuse(el: HTMLElement) {
  anim(el, [{ translate: '0 0' }, { translate: '-6px 0' }, { translate: '6px 0' }, { translate: '-3px 0' }, { translate: '0 0' }], { duration: 300, easing: 'linear', fill: 'none' })
}

// ---- input ----

ring.onTap = (slot) => {
  audio.unlock()
  const s = snap
  if (!s || s.phase !== 'play') return
  const me = player(s.you)
  if (slot.used) return
  if (s.turn !== s.you || pending || !me || me.out) {
    ring.nudge(slot.ch)
    return
  }
  pending = { ch: slot.ch, at: performance.now() }
  net.send({ t: 'tap', letter: slot.ch })
  ring.hold(slot.ch, 1500)
  ring.pop(slot.ch, pc(me.color))
  ring.setLive(false, pc(me.color))
  audio.tap()
  navigator.vibrate?.(10)
  const ch = slot.ch
  setTimeout(() => {
    if (pending?.ch !== ch || !snap) return
    pending = null
    const l = snap.letters.find((x) => x.ch === ch)
    ring.unhold(ch, l?.used ?? false)
    render(snap, snap)
  }, 1600)
}

playBtn.addEventListener('click', () => {
  audio.unlock()
  if (playBtn.disabled) return refuse(playBtn)
  anim(playBtn, [{ scale: '1' }, { scale: '.86' }, { scale: '1' }], { duration: 260, easing: E.out, fill: 'none' })
  net.send({ t: 'start' })
})

againBtn.addEventListener('click', () => {
  audio.unlock()
  audio.play('ui')
  net.send({ t: 'again' })
})

orbit.onKick = (id) => {
  audio.play('ui')
  net.send({ t: 'kick', id })
}
orbit.onJoinFx = (x, y, color) => {
  fx.burst(x, y, { colors: [color, color, CREAM], n: 34, speed: [120, 380], size: [2, 4.5], g: 80, life: [0.4, 0.9], streak: 0.3 })
  fx.shock(x, y, color, 46, 0.5, 4)
  fx.stars(x, y, { colors: [color, CREAM], n: 5, radius: 34 })
}

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

namebox.onSubmit = (name) => {
  audio.unlock()
  audio.play('ui')
  localStorage.setItem(NAME_KEY, name)
  namebox.hide()
  net.join(playerId(), name)
}

// Unlock audio on the very first gesture, wherever it lands.
for (const t of ['pointerdown', 'keydown', 'touchend'] as const) addEventListener(t, () => audio.unlock(), { capture: true, passive: true })
// No pinch / double-tap zoom, no context menus: it's a game.
document.addEventListener('gesturestart', (e) => e.preventDefault())
document.addEventListener('dblclick', (e) => e.preventDefault())
document.addEventListener('contextmenu', (e) => e.preventDefault())

// ---- screen wake lock during a game ----

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
layout()
ring.sync([...'ABCDEFGHIJKLMNOPRSTW'].map((ch) => ({ ch, used: false })))
ring.setMode('idle')
fx.setAmbient(true)
deck.setDim(true)

const stored = localStorage.getItem(NAME_KEY)
if (stored) net.join(playerId(), stored)
else namebox.show('')

// Attract shimmer around the ring while idle.
setInterval(() => {
  if (!snap || snap.phase === 'lobby') ring.shimmer()
}, 5200)
