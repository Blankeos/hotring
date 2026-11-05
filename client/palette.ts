// Flat colors only. 12 player colors tuned to read on the ink background.

export const INK = '#130F22'
export const CREAM = '#F3ECDD'
export const HOT = '#FF3D3D'
export const GOLD = '#FFD23F'

export const PLAYER_COLORS = [
  '#FF5A5F', // coral
  '#FF9F1C', // orange
  '#FFD93D', // yellow
  '#A3E635', // lime
  '#3DDC84', // green
  '#22D3EE', // cyan
  '#5B8CFF', // blue
  '#A78BFA', // violet
  '#E879F9', // orchid
  '#FF8FB8', // pink
  '#EDE6D3', // bone
  '#D4A373', // tan
] as const

export const pc = (i: number) => PLAYER_COLORS[((i % 12) + 12) % 12]!

/** Category card face tints, picked by card.n. */
export const CARD_ACCENTS = ['#FF7A59', '#FFC94D', '#5EE6A8', '#5CC8FF', '#B49CFF', '#FF8FB8', '#A3E635'] as const
export const cardAccent = (n: number) => CARD_ACCENTS[((n % CARD_ACCENTS.length) + CARD_ACCENTS.length) % CARD_ACCENTS.length]!

// Fuse heat: calm teal -> amber -> red, lerped as flat colors.
const HEAT: [number, number, number][] = [
  [46, 196, 182],
  [255, 176, 32],
  [255, 61, 61],
]
export function heatColor(h: number): string {
  const t = Math.max(0, Math.min(1, h)) * (HEAT.length - 1)
  const i = Math.min(HEAT.length - 2, Math.floor(t))
  const f = t - i
  const a = HEAT[i]!
  const b = HEAT[i + 1]!
  const c = a.map((v, k) => Math.round(v + (b[k]! - v) * f))
  return `rgb(${c[0]},${c[1]},${c[2]})`
}

export function rgbOf(color: string): [number, number, number] {
  if (color.startsWith('#')) {
    const n = parseInt(color.slice(1), 16)
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
  }
  const m = color.match(/\d+/g) ?? ['255', '255', '255']
  return [Number(m[0]), Number(m[1]), Number(m[2])]
}

/** Flat darker shade of a color (for the extruded side of discs and keys). */
export function shade(color: string, k = 0.38): string {
  const [r, g, b] = rgbOf(color)
  const f = (v: number) => Math.round(v * (1 - k))
  return `rgb(${f(r)},${f(g)},${f(b)})`
}
