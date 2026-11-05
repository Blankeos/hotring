// The one loud moment: "{NAME} LOST" after a boom (a few seconds, tap to dismiss),
// "{NAME} IS OUT", "BOOM!" with no roster, and "{NAME} WINS" that stays until the next draw.
import { E, anim, h, initial, reduced } from './dom'
import type { Fx } from './fx'
import { CREAM, GOLD, HOT, shade } from './palette'

const LOST_LINES = [
  'Brain: 404',
  'Skill issue.',
  'Embarrassing.',
  'Say sorry to your phone.',
  'The category was easy...',
  'Thinking is free, you know.',
  'Bold strategy. Did not work.',
  'Someone call their mom.',
  'Speedrun to losing.',
  'Your brain buffered.',
  'Not your finest moment.',
  'The silence was loud.',
  'Tick tock, boom.',
  'Blink and you lose.',
  'Legend says they’re still thinking.',
  'Mouth open, nothing out.',
  'That was painful to watch.',
  'Hot potato champion.',
  'Should’ve said literally anything.',
  'Main character of losing.',
  'Fumbled it.',
  'Words are hard, huh?',
]
const OUT_LINES = ['Gone. Reduced to atoms.', 'Pack your bags.', 'Thanks for playing!', 'Rest in pieces.', 'Spectator mode: on.', 'Benched. Forever.']
const BOOM_LINES = ['Too slow!', 'Somebody say something!', 'Nobody? Nobody??', 'The ring wins again.', 'Kaboom.', 'Everyone lost a little.']
const WIN_LINES = ['Undefeated. Unbothered.', 'Big brain energy.', 'Bow down.', 'Words: mastered.', 'Talk your way to the top.', 'Untouchable.']
const LOST_EMOJI = ['💀', '🤡', '😭', '🫠', '🧨', '🥴', '😵‍💫', '🙈', '🤯', '🐔']

const last = new Map<string[], string>()
function pickFresh(list: string[]) {
  let v = list[Math.floor(Math.random() * list.length)]!
  if (list.length > 1) while (v === last.get(list)) v = list[Math.floor(Math.random() * list.length)]!
  last.set(list, v)
  return v
}

export type TakeoverKind = 'lost' | 'out' | 'boom' | 'win'

export class Takeover {
  el: HTMLDivElement
  private icon: HTMLDivElement
  private name: HTMLDivElement
  private word: HTMLDivElement
  private line: HTMLDivElement
  kind: TakeoverKind | null = null
  private timer: ReturnType<typeof setTimeout> | undefined
  private wobble: Animation | null = null

  constructor(parent: HTMLElement, private fx: Fx) {
    this.el = h('div', '', parent)
    this.el.id = 'takeover'
    const box = h('div', 'box', this.el)
    this.icon = h('div', 'mega', box)
    this.name = h('div', 'big name', box)
    this.word = h('div', 'big word', box)
    this.line = h('div', 'line', box)
    this.el.addEventListener('pointerdown', () => {
      if (this.kind && this.kind !== 'win') this.hide()
    })
  }

  show(kind: TakeoverKind, o: { name?: string; color?: string; quiet?: boolean } = {}) {
    clearTimeout(this.timer)
    this.kind = kind
    const color = o.color ?? HOT
    const name = (o.name ?? '').toUpperCase()
    this.el.dataset.kind = kind
    this.el.style.setProperty('--c', color)
    this.el.style.setProperty('--cd', shade(color, 0.5))
    this.name.textContent = kind === 'boom' ? 'BOOM!' : name
    this.word.textContent = kind === 'lost' ? 'LOST' : kind === 'out' ? 'IS OUT' : kind === 'win' ? 'WINS' : ''
    this.line.textContent = pickFresh(kind === 'lost' ? LOST_LINES : kind === 'out' ? OUT_LINES : kind === 'win' ? WIN_LINES : BOOM_LINES)
    // Giant type that still fits a 390px phone.
    const len = Math.max(4, [...this.name.textContent].length)
    const W = Math.min(innerWidth, 900)
    this.name.style.fontSize = Math.min(W * 0.92 / (len * 0.66), innerHeight * 0.13, 132) + 'px'
    this.word.style.fontSize = Math.min(W * 0.92 / (Math.max(4, this.word.textContent.length) * 0.66), innerHeight * 0.1, 104) + 'px'
    this.icon.innerHTML = ''
    if (kind === 'out' && o.name) {
      // The player's disc, cracked by a big cross.
      const d = h('div', 'disc', this.icon)
      d.textContent = initial(o.name)
      h('div', 'x', d, '<svg viewBox="0 0 100 100"><path d="M22 22 78 78M78 22 22 78" stroke="currentColor" stroke-width="14" stroke-linecap="round" fill="none"/></svg>')
    } else this.icon.textContent = kind === 'win' ? '👑' : kind === 'out' ? '💀' : pickFresh(LOST_EMOJI)
    this.el.classList.add('on')

    const slam = (el: Element, delay: number, rot: number) =>
      anim(
        el,
        reduced
          ? [{ opacity: 0 }, { opacity: 1 }]
          : [
              { transform: `scale(2.6) rotate(${rot}deg)`, opacity: 0 },
              { transform: `scale(.9) rotate(${-rot * 0.3}deg)`, opacity: 1, offset: 0.55, easing: E.out },
              { transform: 'scale(1.04)', offset: 0.78 },
              { transform: 'scale(1) rotate(0)', opacity: 1 },
            ],
        { duration: reduced ? 200 : 460, delay, easing: E.in, fill: 'backwards' },
      )
    anim(this.el, [{ opacity: 0 }, { opacity: 1 }], { duration: 160, fill: 'none' })
    anim(this.icon, reduced ? [{ opacity: 0 }, { opacity: 1 }] : [{ transform: 'scale(0) rotate(-200deg)' }, { transform: 'scale(1.25) rotate(10deg)', offset: 0.6 }, { transform: 'scale(1) rotate(0)' }], {
      duration: 560,
      easing: E.out,
      fill: 'backwards',
    })
    slam(this.name, 90, -8)
    slam(this.word, 240, 6)
    anim(this.line, [{ transform: 'translateY(16px)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 360, delay: 520, easing: E.out, fill: 'backwards' })
    if (kind === 'out') {
      const x = this.icon.querySelector('.x')
      if (x) anim(x, [{ transform: 'scale(3) rotate(-40deg)', opacity: 0 }, { transform: 'scale(1) rotate(0)', opacity: 1 }], { duration: 360, delay: 520, easing: E.springHard, fill: 'backwards' })
    }
    // Goofy wobble of the big emoji.
    this.wobble?.cancel()
    if (!reduced)
      this.wobble = this.icon.animate(
        kind === 'win'
          ? [{ transform: 'translateY(0) rotate(-4deg)' }, { transform: 'translateY(-10px) rotate(4deg)' }, { transform: 'translateY(0) rotate(-4deg)' }]
          : [{ transform: 'rotate(-14deg) scale(1)' }, { transform: 'rotate(14deg) scale(1.08)' }, { transform: 'rotate(-14deg) scale(1)' }],
        { duration: kind === 'win' ? 1600 : 360, iterations: Infinity, delay: 600, easing: 'ease-in-out' },
      )
    if (!o.quiet) {
      if (kind === 'win') this.fx.emojis(['👑', '🎉', '⭐', '🏆'], 2200, 8)
      else this.fx.emojis(kind === 'out' ? ['💀', '🪦', '💀'] : [this.icon.textContent || '💀', '💀', '🤡', '😭'], 1600, 12)
      if (kind !== 'win') {
        const r = this.icon.getBoundingClientRect()
        setTimeout(() => this.fx.stars(r.left + r.width / 2, r.top + r.height / 2, { colors: [color, CREAM, GOLD], n: 10, radius: r.width }), 300)
      }
    }
    if (kind !== 'win') this.timer = setTimeout(() => this.hide(), 2600)
  }

  hide() {
    if (!this.kind) return
    clearTimeout(this.timer)
    this.kind = null
    this.wobble?.cancel()
    this.wobble = null
    anim(this.el, [{ opacity: 1, transform: 'scale(1)' }, { opacity: 0, transform: 'scale(1.06)' }], { duration: 220, easing: E.in, fill: 'none' })
      .finished.then(() => {
        if (!this.kind) this.el.classList.remove('on')
      })
      .catch(() => {})
  }
}
