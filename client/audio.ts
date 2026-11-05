// WebAudio sound layer: decode once, play buffers. Every file is optional and
// retried later, so sounds that appear on disk after page load get picked up.

export const SFX = [
  'tap',
  'tap2',
  'tap3',
  'tick',
  'boom',
  'shuffle',
  'flip',
  'whoosh',
  'yourturn',
  'join',
  'start',
  'refill',
  'out',
  'win',
  'ui',
] as const
export type Sfx = (typeof SFX)[number]

const MUTE_KEY = 'hotring.muted'
const RETRY_MS = 5000

export class Audio {
  private ctx: AudioContext | null = null
  private master: GainNode | null = null
  private bufs = new Map<Sfx, AudioBuffer>()
  private loading = new Set<Sfx>()
  private failedAt = new Map<Sfx, number>()
  muted = localStorage.getItem(MUTE_KEY) === '1'

  /** Call from a user gesture (iOS needs the context created/resumed inside one). */
  unlock() {
    try {
      if (!this.ctx) {
        const AC: typeof AudioContext | undefined =
          window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
        if (!AC) return
        this.ctx = new AC()
        this.master = this.ctx.createGain()
        this.master.gain.value = this.muted ? 0 : 0.9
        this.master.connect(this.ctx.destination)
        // A silent blip fully unlocks output on older iOS.
        const b = this.ctx.createBuffer(1, 1, 22050)
        const s = this.ctx.createBufferSource()
        s.buffer = b
        s.connect(this.ctx.destination)
        s.start(0)
        for (const n of SFX) this.load(n)
      }
      if (this.ctx.state !== 'running') void this.ctx.resume().catch(() => {})
    } catch {
      /* no audio, no problem */
    }
  }

  private load(name: Sfx) {
    const ctx = this.ctx
    if (!ctx || this.bufs.has(name) || this.loading.has(name)) return
    const failed = this.failedAt.get(name)
    if (failed && performance.now() - failed < RETRY_MS) return
    this.loading.add(name)
    fetch(`/sfx/${name}.mp3`, { cache: failed ? 'reload' : 'default' })
      .then((r) => {
        if (!r.ok) throw new Error(String(r.status))
        return r.arrayBuffer()
      })
      .then(
        (ab) =>
          new Promise<AudioBuffer>((res, rej) => {
            // Callback form works on old Safari, promise form everywhere else.
            const p = ctx.decodeAudioData(ab, res, rej) as Promise<AudioBuffer> | undefined
            p?.catch?.(rej)
          }),
      )
      .then((buf) => {
        this.bufs.set(name, buf)
        this.failedAt.delete(name)
      })
      .catch(() => this.failedAt.set(name, performance.now()))
      .finally(() => this.loading.delete(name))
  }

  play(name: Sfx, o: { rate?: number; gain?: number; delay?: number } = {}) {
    const ctx = this.ctx
    if (!ctx || !this.master) return
    if (ctx.state === 'suspended') void ctx.resume().catch(() => {})
    const buf = this.bufs.get(name)
    if (!buf) return this.load(name)
    if (this.muted) return
    try {
      const src = ctx.createBufferSource()
      src.buffer = buf
      src.playbackRate.value = o.rate ?? 1
      const g = ctx.createGain()
      g.gain.value = o.gain ?? 1
      src.connect(g)
      g.connect(this.master)
      src.start(ctx.currentTime + (o.delay ?? 0) / 1000)
    } catch {
      /* ignore */
    }
  }

  tap(gain = 1) {
    const names: Sfx[] = ['tap', 'tap2', 'tap3']
    this.play(names[Math.floor(Math.random() * 3)]!, { rate: 0.94 + Math.random() * 0.12, gain })
  }

  setMuted(m: boolean) {
    this.muted = m
    localStorage.setItem(MUTE_KEY, m ? '1' : '0')
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(m ? 0 : 0.9, this.ctx.currentTime, 0.02)
  }
}
