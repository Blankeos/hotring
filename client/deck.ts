// The deck (bottom), the flying category card (center) and the category chip (top).
// Sequence per draw: riffle shuffle -> lift & fly to center -> flip on `reveal`
// -> fold into the chip on `go`.
import type { CategoryCard } from '../shared/protocol'
import type { Audio } from './audio'
import { E, anim, h, reduced } from './dom'
import type { Fx } from './fx'
import { CREAM, cardAccent } from './palette'

const N = 6
// Rest pose of each card in the stack, bottom (0) to top (N-1).
const REST = [
  { x: -3, y: 10, r: -9 },
  { x: 4, y: 8, r: 6 },
  { x: -2, y: 6, r: -4.5 },
  { x: 3, y: 4, r: 3 },
  { x: -1, y: 2, r: -1.5 },
  { x: 0, y: 0, r: 0 },
]
const pose = (i: number, dy = 0, extra = '') => {
  const p = REST[i]!
  return `translate(${p.x}px,${p.y - 5 + dy}px) rotate(${p.r}deg)${extra}`
}

export type DeckStage = 'none' | 'shuffle' | 'fly' | 'center' | 'revealed' | 'chip'

export interface DeckLayout {
  deck: { x: number; y: number; w: number; h: number }
  card: { x: number; y: number; w: number; h: number }
  chip: { x: number; y: number }
}

export class Deck {
  btn: HTMLButtonElement
  private stack: HTMLDivElement
  private cards: HTMLDivElement[] = []
  private fly: HTMLDivElement
  private floater: HTMLDivElement
  private flip: HTMLDivElement
  private front: HTMLDivElement
  private emo: HTMLDivElement
  private txt: HTMLDivElement
  private shine: HTMLDivElement
  chip: HTMLDivElement
  private pill: HTMLDivElement
  private chipEmo: HTMLSpanElement
  private chipTxt: HTMLSpanElement
  private L: DeckLayout | null = null
  private seq = 0
  private chipTok = 0
  private tossing = false
  private revealWanted = false
  private floatAnim: Animation | null = null
  stage: DeckStage = 'none'
  n = -1
  card: CategoryCard | null = null
  onStage: (s: DeckStage) => void = () => {}
  onDraw: () => void = () => {}

  constructor(parent: HTMLElement, private fx: Fx, private audio: Audio) {
    this.btn = h('button', '', parent)
    this.btn.id = 'deck'
    this.btn.type = 'button'
    this.btn.setAttribute('aria-label', 'draw')
    this.btn.disabled = true
    this.stack = h('div', 'stack', this.btn)
    for (let i = 0; i < N; i++) {
      const c = h('div', 'cardback', this.stack)
      c.style.transform = pose(i)
      this.cards.push(c)
    }
    this.btn.addEventListener('click', () => {
      if (this.btn.disabled) return
      anim(this.stack, [{ transform: 'scale(1)' }, { transform: 'scale(.9,.86)', offset: 0.3 }, { transform: 'scale(1)' }], {
        duration: 320,
        easing: E.out,
        fill: 'none',
      })
      this.onDraw()
    })

    this.fly = h('div', '', parent)
    this.fly.id = 'fly'
    this.floater = h('div', 'floater', this.fly)
    this.flip = h('div', 'flip', this.floater)
    h('div', 'side cardback', this.flip)
    this.front = h('div', 'side front', this.flip)
    this.emo = h('div', 'emo', this.front)
    this.txt = h('div', 'txt', this.front)
    this.shine = h('div', 'shine', this.front)

    this.chip = h('div', '', parent)
    this.chip.id = 'chip'
    this.pill = h('div', 'pill', this.chip)
    this.chipEmo = h('span', 'emo', this.pill)
    this.chipTxt = h('span', 'txt', this.pill)
  }

  layout(L: DeckLayout) {
    this.L = L
    const b = this.btn.style
    b.left = L.deck.x - L.deck.w / 2 + 'px'
    b.top = L.deck.y - L.deck.h / 2 + 'px'
    b.width = L.deck.w + 'px'
    b.height = L.deck.h + 'px'
    this.btn.style.setProperty('--dw', L.deck.w + 'px')
    const f = this.fly.style
    f.left = L.card.x - L.card.w / 2 + 'px'
    f.top = L.card.y - L.card.h / 2 + 'px'
    f.width = L.card.w + 'px'
    f.height = L.card.h + 'px'
    this.fly.style.setProperty('--cw', L.card.w + 'px')
    this.fly.style.setProperty('--dw', L.card.w + 'px')
    this.chip.style.top = L.chip.y + 'px'
  }

  setInteractive(on: boolean) {
    this.btn.disabled = !on
  }

  setReady(on: boolean) {
    this.btn.classList.toggle('ready', on)
  }

  setDim(on: boolean) {
    this.btn.classList.toggle('dim', on)
  }

  private setStage(s: DeckStage) {
    this.stage = s
    this.onStage(s)
  }

  setCard(card: CategoryCard) {
    this.card = card
    this.n = card.n
    // Don't repaint the card that is being thrown away.
    if (this.tossing) return
    this.paint(card)
  }

  private paint(card: CategoryCard) {
    const acc = cardAccent(card.n)
    this.front.style.setProperty('--acc', acc)
    this.pill.style.setProperty('--acc', acc)
    this.emo.textContent = card.emoji
    this.txt.textContent = card.text
    this.chipEmo.textContent = card.emoji
    this.chipTxt.textContent = card.text
    this.pill.classList.toggle('long', card.text.length > 30)
    // Long category names get a smaller face size.
    const n = card.text.length
    this.txt.style.fontSize = `calc(var(--cw) * ${n > 40 ? 0.086 : n > 28 ? 0.092 : n > 18 ? 0.096 : 0.112})`
  }

  /** Card position transform (relative to the centre slot) for the top of the deck. */
  private deckTransform(extra = '') {
    const L = this.L!
    const s = L.deck.w / L.card.w
    const top = REST[N - 1]!
    return `translate(${L.deck.x - L.card.x + top.x}px,${L.deck.y - L.card.y + top.y - 5}px) scale(${s})${extra}`
  }

  /** `deal` event: run the whole shuffle -> fly sequence. */
  async deal() {
    const my = ++this.seq
    this.revealWanted = false
    this.n = -1
    this.hideChip()
    if (this.fly.classList.contains('on')) {
      this.tossing = true
      await this.toss()
      this.tossing = false
      if (this.card && this.n === this.card.n) this.paint(this.card)
    }
    if (my !== this.seq) return
    this.setStage('shuffle')
    this.audio.play('shuffle')
    await this.riffle()
    if (my !== this.seq) return
    await this.lift()
    if (my !== this.seq) return
    this.setStage('center')
    this.startFloat()
    if (this.revealWanted) this.doReveal()
  }

  /** Joined mid card phase: put the card in the middle without the shuffle. */
  midJoin(card: CategoryCard, faceUp: boolean) {
    this.seq++
    this.setCard(card)
    this.hideChip()
    this.showFly(faceUp)
    anim(this.fly, [{ transform: 'scale(.6)', opacity: 0 }, { transform: 'scale(1)', opacity: 1 }], { duration: 420, easing: E.spring })
    this.setStage(faceUp ? 'revealed' : 'center')
    if (!faceUp) this.startFloat()
  }

  /** `reveal` event. */
  reveal() {
    this.revealWanted = true
    if (this.stage === 'center') this.doReveal()
  }

  /** `go` event (or play snapshot): fold the card into the chip. */
  async go() {
    if (this.stage === 'chip') return
    const my = ++this.seq
    if (!this.card) return
    if (this.stage !== 'center' && this.stage !== 'revealed') return this.showChip(this.card)
    this.stopFloat()
    if (this.stage === 'center') anim(this.flip, [{ transform: 'rotateY(180deg)' }], 1)
    this.setStage('chip')
    const L = this.L!
    const dx = L.chip.x - L.card.x
    const dy = L.chip.y - L.card.y
    const a = anim(
      this.fly,
      [
        { transform: 'none', opacity: 1 },
        { transform: 'translate(0,10px) scale(1.04,.96)', opacity: 1, offset: 0.2, easing: E.out },
        { transform: `translate(${dx}px,${dy}px) scale(.16)`, opacity: 0 },
      ],
      { duration: reduced ? 260 : 460, easing: E.in },
    )
    setTimeout(() => {
      if (my === this.seq) this.popChip()
    }, reduced ? 200 : 330)
    // Belt and braces: never leave the card hovering if the animation is starved.
    setTimeout(() => {
      if (my === this.seq) this.hideFly()
    }, reduced ? 520 : 720)
    await a.finished.catch(() => {})
    if (my !== this.seq) return
    this.hideFly()
    this.returnTop()
  }

  showChip(card: CategoryCard) {
    this.seq++
    this.setCard(card)
    this.hideFly()
    this.returnTop(true)
    if (this.stage !== 'chip' || !this.chip.classList.contains('on')) this.popChip()
    this.setStage('chip')
  }

  clear() {
    this.seq++
    this.hideFly()
    this.hideChip()
    this.returnTop(true)
    this.n = -1
    this.card = null
    if (this.stage !== 'none') this.setStage('none')
  }

  // ---- pieces ----

  private riffle() {
    const L = this.L!
    const w = L.deck.w
    const dur = reduced ? 500 : 980
    // Cut: bottom half goes left, top half goes right. Then they interleave.
    const order = [0, 3, 1, 4, 2, 5] // drop order, bottom to top
    const anims: Animation[] = []
    this.cards.forEach((c, i) => {
      const left = i < N / 2
      const j = left ? i : i - N / 2
      const sx = (left ? -1 : 1) * w * 0.58
      const rot = left ? -12 : 12
      const k = order.indexOf(i)
      const drop = 0.42 + k * 0.065
      c.style.zIndex = String(i)
      anims.push(
        c.animate(
          [
            { transform: pose(i), zIndex: i, offset: 0 },
            { transform: `translate(${sx * 0.35}px,${-4 - j * 3}px) rotate(${rot * 0.4}deg)`, zIndex: i, offset: 0.1, easing: E.out },
            { transform: `translate(${sx}px,${-10 - j * 3}px) rotate(${rot}deg)`, zIndex: i, offset: 0.24, easing: E.inOut },
            { transform: `translate(${sx * 0.92}px,${-14 - j * 3}px) rotate(${rot * 1.45}deg) scale(1,.97)`, zIndex: i, offset: drop - 0.06, easing: E.in },
            { transform: pose(k, 3), zIndex: 10 + k, offset: drop, easing: E.out },
            { transform: pose(k), zIndex: 10 + k, offset: Math.min(0.92, drop + 0.08) },
            { transform: pose(k, 0, ' scale(1.04,.94)'), zIndex: 10 + k, offset: 0.94 },
            { transform: pose(k), zIndex: 10 + k, offset: 1 },
          ],
          { duration: dur, easing: 'linear', fill: 'forwards' },
        ),
      )
      if (!reduced)
        setTimeout(() => {
          const r = this.btn.getBoundingClientRect()
          if (Math.random() < 0.6) this.fx.stars(r.left + r.width / 2, r.top + r.height / 2, { colors: [CREAM], n: 1, radius: w * 0.6, size: [3, 6], life: [0.3, 0.5] })
        }, drop * dur)
    })
    return Promise.all(anims.map((a) => a.finished.catch(() => {}))).then(() => {
      // Commit the new order so rest poses line up with the interleave.
      const next: HTMLDivElement[] = []
      this.cards.forEach((c, i) => (next[order.indexOf(i)] = c))
      this.cards = next
      this.cards.forEach((c, k) => {
        c.getAnimations().forEach((a) => a.cancel())
        c.style.transform = pose(k)
        c.style.zIndex = String(k)
      })
    })
  }

  private async lift() {
    this.setStage('fly')
    const top = this.cards[N - 1]!
    top.style.visibility = 'hidden'
    this.showFly(false)
    const from = this.deckTransform()
    const squat = this.deckTransform(' translateY(10px) scale(1.04,.92)')
    const a = anim(
      this.fly,
      [
        { transform: from, offset: 0 },
        { transform: squat, offset: 0.14, easing: E.out },
        { transform: 'translate(0,-14px) scale(1.04) rotate(2deg)', offset: 0.78, easing: E.out },
        { transform: 'translate(0,0) scale(1) rotate(0)', offset: 1 },
      ],
      { duration: reduced ? 380 : 640, easing: E.inOut },
    )
    // Little trail of sparks off the card as it leaves the deck.
    if (!reduced) {
      const L = this.L!
      setTimeout(() => this.fx.stars(L.deck.x, L.deck.y, { colors: [CREAM, '#FFC94D'], n: 5, radius: L.deck.w * 0.6 }), 120)
    }
    await a.finished.catch(() => {})
  }

  private startFloat() {
    if (reduced) return
    this.floatAnim?.cancel()
    this.floatAnim = this.floater.animate(
      [{ transform: 'translateY(0) rotate(0)' }, { transform: 'translateY(-6px) rotate(-.8deg)' }, { transform: 'translateY(0) rotate(0)' }],
      { duration: 1600, iterations: Infinity, easing: 'ease-in-out' },
    )
  }

  private stopFloat() {
    this.floatAnim?.cancel()
    this.floatAnim = null
  }

  private doReveal() {
    if (this.stage !== 'center') return
    this.setStage('revealed')
    this.audio.play('flip')
    const L = this.L!
    anim(
      this.flip,
      [
        { transform: 'rotateY(0) scale(1)' },
        { transform: 'rotateY(-12deg) scale(.97)', offset: 0.12, easing: E.out },
        { transform: 'rotateY(100deg) scale(1.12)', offset: 0.5, easing: E.in },
        { transform: 'rotateY(196deg) scale(1.06)', offset: 0.78, easing: E.out },
        { transform: 'rotateY(180deg) scale(1)' },
      ],
      { duration: reduced ? 300 : 680, easing: 'linear' },
    )
    setTimeout(() => {
      const acc = cardAccent(this.n)
      this.fx.stars(L.card.x, L.card.y, { colors: [CREAM, acc, '#FFD23F'], n: 18, w: L.card.w, h: L.card.h, size: [5, 12], life: [0.6, 1.2] })
      this.fx.burst(L.card.x, L.card.y, { colors: [acc, CREAM], n: 36, speed: [200, 560], size: [2, 4], g: 120, radius: L.card.w * 0.3, streak: 0.4 })
      anim(this.shine, [{ transform: 'translateX(-160%) skewX(-18deg)' }, { transform: 'translateX(460%) skewX(-18deg)' }], {
        duration: 720,
        easing: E.inOut,
      })
      if (!reduced) anim(this.emo, [{ transform: 'scale(.4) rotate(-20deg)' }, { transform: 'scale(1.15) rotate(6deg)', offset: 0.55 }, { transform: 'scale(1)' }], { duration: 560, easing: E.out })
    }, reduced ? 150 : 400)
  }

  private toss() {
    this.stopFloat()
    const a = anim(this.fly, [{ opacity: 1 }, { transform: 'translate(40px,-120%) rotate(24deg) scale(.7)', opacity: 0 }], { duration: 300, easing: E.in })
    return a.finished.catch(() => {}).then(() => {
      this.hideFly()
      this.returnTop(true)
    })
  }

  private showFly(faceUp: boolean) {
    this.fly.getAnimations().forEach((a) => a.cancel())
    this.flip.getAnimations().forEach((a) => a.cancel())
    this.flip.style.transform = faceUp ? 'rotateY(180deg)' : 'rotateY(0)'
    this.fly.classList.add('on')
  }

  private hideFly() {
    this.stopFloat()
    this.fly.classList.remove('on')
    this.fly.getAnimations().forEach((a) => a.cancel())
  }

  private returnTop(instant = false) {
    const top = this.cards[N - 1]!
    if (top.style.visibility !== 'hidden') return
    top.style.visibility = ''
    if (!instant) anim(top, [{ transform: pose(N - 1, 16), opacity: 0 }, { transform: pose(N - 1), opacity: 1 }], { duration: 380, easing: E.spring, fill: 'none' })
  }

  private popChip() {
    this.chipTok++
    this.chip.classList.add('on')
    anim(
      this.pill,
      [
        { transform: 'scale(.3)', opacity: 0 },
        { transform: 'scale(1.12)', opacity: 1, offset: 0.55, easing: E.out },
        { transform: 'scale(.97)', offset: 0.8 },
        { transform: 'scale(1)', opacity: 1 },
      ],
      { duration: 480, easing: E.out },
    )
    const r = this.chip.getBoundingClientRect()
    if (r.width) this.fx.stars(r.left + r.width / 2, r.top + r.height / 2, { colors: [CREAM, cardAccent(this.n)], n: 8, w: r.width, h: r.height, size: [4, 8] })
  }

  private hideChip() {
    if (!this.chip.classList.contains('on')) return
    const tok = ++this.chipTok
    const a = anim(this.pill, [{ transform: 'scale(1)', opacity: 1 }, { transform: 'scale(.5)', opacity: 0 }], { duration: 200, easing: E.in })
    a.finished.then(() => tok === this.chipTok && this.chip.classList.remove('on')).catch(() => {})
  }
}
