// Wire protocol shared by server and client. One shared table per room.
// Players are a roster on the table that anyone in the room can edit; phones are just remotes.
// The server is authoritative: it sends a full `state` snapshot after every change, plus
// one-shot `ev` events so clients can fire animations and sounds.

export const LETTERS = 'ABCDEFGHIJKLMNOPRSTW'.split('') as readonly string[]
export const MAX_MARKS = 3
export const MAX_NAME = 14
export const MAX_PLAYERS = 12

export type Phase =
  | 'idle' // nothing drawn yet, the deck invites a tap
  | 'card' // deck shuffles, category card is revealed (ring locked)
  | 'play' // ring live. The hidden fuse is lit by each tap (not before the first one)
  | 'boom' // the fuse ran out; tap the deck for the next card
  | 'over' // one player left standing (roster of 2+); deck starts a new game

export interface PlayerView {
  id: string
  name: string
  color: number // palette index 0-11
  marks: number // rounds lost; out at MAX_MARKS
  out: boolean
}

export interface CategoryCard {
  emoji: string
  text: string
  /** Increments every draw so clients can replay the shuffle/flip animation. */
  n: number
}

export interface Snapshot {
  phase: Phase
  now: number // server clock (ms)
  /** Number of phones in the room (remotes), for a quiet presence hint. */
  remotes: number
  players: PlayerView[] // turn order, clockwise. May be empty: then it is a plain shared table.
  /** Whose turn it is (the player who "holds" the fuse). null when there are no players. */
  turn: string | null
  loser: string | null // set during 'boom'
  winner: string | null // set during 'over'
  card: CategoryCard | null
  /** letters in ring order (index 0 = top, clockwise). */
  letters: { ch: string; used: boolean }[]
  taps: number // letter taps this round
  lit: boolean // the fuse is burning
  /** ms left on the burning fuse at `now` (null when not lit), and its full length, for a visible timer. */
  fuseLeft: number | null
  fuseLen: number | null
  cardUntil: number | null
  revealAt: number | null
}

// ---- client -> server ----
export type ClientMsg =
  | { t: 'join'; id?: string } // a phone connects (remote)
  | { t: 'tap'; letter: string } // anyone, in 'play'; counts for whoever's turn it is
  | { t: 'draw' } // anyone, any phase: shuffle and draw a new category card
  | { t: 'add'; name: string } // anyone: add a player to the table
  | { t: 'remove'; id: string } // anyone: remove a player
  | { t: 'rename'; id: string; name: string }

// ---- server -> client ----
export type ServerEvent =
  | { type: 'joined' } // a remote connected
  | { type: 'left' } // a remote left
  | { type: 'added'; id: string }
  | { type: 'removed'; id: string }
  | { type: 'deal' }
  | { type: 'reveal' }
  | { type: 'go'; turn: string | null }
  | { type: 'tap'; letter: string; by: string | null; next: string | null }
  | { type: 'tick'; heat: number } // 0..1 since the last tap
  | { type: 'refill' }
  | { type: 'boom'; loser: string | null; out: boolean }
  | { type: 'win'; winner: string }

export type ServerMsg =
  | { t: 'state'; s: Snapshot }
  | { t: 'ev'; e: ServerEvent }
  | { t: 'err'; msg: string }
