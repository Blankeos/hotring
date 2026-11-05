// Tiny DOM + motion helpers shared by every client module.

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls = '',
  parent?: Element | null,
  html?: string,
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag)
  if (cls) e.className = cls
  if (html !== undefined) e.innerHTML = html
  parent?.appendChild(e)
  return e
}

const rm = matchMedia('(prefers-reduced-motion: reduce)')
export let reduced = rm.matches
rm.addEventListener?.('change', () => (reduced = rm.matches))

/** Easing curves. Everything moves on one of these. */
export const E = {
  out: 'cubic-bezier(.16,1,.3,1)',
  spring: 'cubic-bezier(.34,1.56,.64,1)',
  springHard: 'cubic-bezier(.2,1.9,.4,1)',
  inBack: 'cubic-bezier(.36,0,.66,-.56)',
  in: 'cubic-bezier(.55,0,.8,.2)',
  inOut: 'cubic-bezier(.65,0,.35,1)',
  linear: 'linear',
} as const

export function anim(el: Element, kf: Keyframe[], o: number | KeyframeAnimationOptions): Animation {
  const opts: KeyframeAnimationOptions = typeof o === 'number' ? { duration: o, easing: E.out } : o
  return el.animate(kf, { fill: 'both', ...opts })
}

export const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))
export const rand = (a: number, b: number) => a + Math.random() * (b - a)
export const pick = <T>(a: readonly T[]): T => a[Math.floor(Math.random() * a.length)]!
export const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v))

export function centerOf(el: Element) {
  const r = el.getBoundingClientRect()
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
}


const sv = (body: string, vb = '0 0 24 24') =>
  `<svg viewBox="${vb}" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`

export const ICON = {
  sound: sv('<path d="M4 9.5h3.2L12 5.5v13l-4.8-4H4z" fill="currentColor" stroke-width="2"/><path d="M15.5 9a4.2 4.2 0 0 1 0 6M18.2 6.4a8 8 0 0 1 0 11.2"/>'),
  mute: sv('<path d="M4 9.5h3.2L12 5.5v13l-4.8-4H4z" fill="currentColor" stroke-width="2"/><path d="M16 9.5l5 5M21 9.5l-5 5"/>'),
  qr: sv(
    '<rect x="3.5" y="3.5" width="6.5" height="6.5" rx="1.6"/><rect x="14" y="3.5" width="6.5" height="6.5" rx="1.6"/><rect x="3.5" y="14" width="6.5" height="6.5" rx="1.6"/><path d="M14 14h2.5v2.5M20.5 14v.01M14 20.5h.01M17.5 20.5h3v-3"/>',
  ),
}
