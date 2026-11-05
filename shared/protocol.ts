// Wire protocol shared by server and client. The server is authoritative:
// it sends a full `state` snapshot after every change, plus one-shot `ev`
// events so clients can fire animations and sounds.

export const LETTERS = 'ABCDEFGHIJKLMNOPRSTW'.split('') as readonly string[]
export const MAX_MARKS = 3
export const MAX_NAME = 14

export type Phase =
  | 'lobby' // waiting for players, host starts
  | 'card' // deck shuffles, category card is revealed (fuse not lit yet)
  | 'play' // fuse is lit, players tap letters
  | 'boom' // fuse blew, loser shown
  | 'over' // one player left standing

export interface PlayerView {
  id: string
  name: string
  color: number // index into the client palette (0-11)
  marks: number // rounds lost, out at MAX_MARKS
  out: boolean
  online: boolean
}

export interface CategoryCard {
  emoji: string
  text: string
  /** Increments every draw so clients can replay the shuffle/flip animation. */
  n: number
}

export interface Snapshot {
  phase: Phase
  /** Server clock (ms) when this snapshot was made, for clock-offset estimates. */
  now: number
  you: string // the receiving player's id
  host: string // player id that can start / draw
  players: PlayerView[] // join order = turn order, clockwise
  card: CategoryCard | null
  /** letters still available this round, in ring order (index 0 = top, clockwise). */
  letters: { ch: string; used: boolean }[]
  turn: string | null // player id whose turn it is
  loser: string | null // set during 'boom'
  winner: string | null // set during 'over'
  round: number // 1-based
  /** Deadline (server ms) for the 'card' phase to end, so the client can pace the animation. */
  cardUntil: number | null
}

// ---- client -> server ----
export type ClientMsg =
  | { t: 'join'; id?: string; name: string }
  | { t: 'start' } // host, lobby -> first card
  | { t: 'draw' } // host, draw/redraw a category card (lobby is not valid; boom and card are)
  | { t: 'tap'; letter: string } // current player only
  | { t: 'again' } // host, over -> lobby (marks reset)
  | { t: 'kick'; id: string } // host

// ---- server -> client ----
export type ServerEvent =
  | { type: 'joined'; id: string }
  | { type: 'left'; id: string }
  | { type: 'deal' } // a new card is drawn: play the shuffle sound/animation
  | { type: 'reveal' } // card flips face up
  | { type: 'go'; turn: string } // fuse lit, round starts
  | { type: 'tap'; letter: string; by: string; next: string }
  | { type: 'skip'; next: string } // turn holder dropped offline, turn moves on
  | { type: 'tick'; heat: number } // 0..1, fuse tick; frequency rises with heat
  | { type: 'refill' } // all letters used, ring refills
  | { type: 'boom'; loser: string; out: boolean }
  | { type: 'win'; winner: string }

export type ServerMsg =
  | { t: 'state'; s: Snapshot }
  | { t: 'ev'; e: ServerEvent }
  | { t: 'err'; msg: string }
