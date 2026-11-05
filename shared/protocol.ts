// Wire protocol shared by server and client. One shared table per room: no names, no turns.
// The server is authoritative: it sends a full `state` snapshot after every change, plus
// one-shot `ev` events so clients can fire animations and sounds.

export const LETTERS = 'ABCDEFGHIJKLMNOPRSTW'.split('') as readonly string[]

export type Phase =
  | 'idle' // nothing drawn yet, the deck invites a tap
  | 'card' // deck shuffles, category card is revealed (ring locked)
  | 'play' // ring live. The hidden fuse is lit by each tap (not before the first one)
  | 'boom' // the fuse ran out; tap the deck for the next card

/** A phone at the table. Only a color, so taps can be tinted per phone. */
export interface Device {
  id: string
  color: number // palette index 0-11
}

export interface CategoryCard {
  emoji: string
  text: string
  /** Increments every draw so clients can replay the shuffle/flip animation. */
  n: number
}

export interface Snapshot {
  phase: Phase
  /** Server clock (ms) when this snapshot was made. */
  now: number
  you: string // the receiving device's id
  devices: Device[] // online phones, join order
  card: CategoryCard | null
  /** letters in ring order (index 0 = top, clockwise). */
  letters: { ch: string; used: boolean }[]
  /** Letter taps this round (drives intensity). */
  taps: number
  /** Whether the fuse is currently burning (a tap has happened and it hasn't blown). */
  lit: boolean
  /** Server deadline (ms) for the 'card' phase to end. */
  cardUntil: number | null
  /** Server time (ms) the card flips face up; null outside the card phase. */
  revealAt: number | null
}

// ---- client -> server ----
export type ClientMsg =
  | { t: 'join'; id?: string }
  | { t: 'tap'; letter: string } // anyone, in 'play'
  | { t: 'draw' } // anyone, any phase: shuffle and draw a new category card

// ---- server -> client ----
export type ServerEvent =
  | { type: 'joined'; id: string }
  | { type: 'left'; id: string }
  | { type: 'deal' } // new card drawn: play the shuffle sound/animation
  | { type: 'reveal' } // card flips face up
  | { type: 'go' } // card phase over, ring is live
  | { type: 'tap'; letter: string; by: string }
  | { type: 'tick'; heat: number } // 0..1 since the last tap; ticks quicken as heat rises
  | { type: 'refill' } // all 20 used, ring refills (fuse keeps burning)
  | { type: 'boom' }

export type ServerMsg =
  | { t: 'state'; s: Snapshot }
  | { t: 'ev'; e: ServerEvent }
  | { t: 'err'; msg: string }
