// WebAudio sound layer, built to be loud and to actually play on phones.
// - The context is created at boot (suspended) so every file is fetched and decoded
//   before the first tap; any gesture anywhere resumes it (iOS needs a gesture).
// - iOS: audioSession 'playback' + a looping silent <audio> so the ring switch doesn't mute us.
// - Master chain: gain -> compressor/limiter -> out, so it's loud without clipping.
// - Every file is optional and retried lazily, so sounds that appear later get picked up.

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
const RETRY_MS = 4000
const LOUD = 1.8

// 1-sample silent WAV, looped by a media element to route audio as "playback" on iOS.
const SILENT_WAV = 'data:audio/wav;base64,UklGRiYAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQIAAACAgA=='

type Opts = { rate?: number; gain?: number; delay?: number }

export class Audio {
  private ctx: AudioContext | null = null
  private master: GainNode | null = null
  private bufs = new Map<Sfx, AudioBuffer>()
  private loading = new Set<Sfx>()
  private failedAt = new Map<Sfx, number>()
  private queued: { name: Sfx; o: Opts; at: number } | null = null
  private silent: HTMLAudioElement | null = null
  private logged = false
  muted = localStorage.getItem(MUTE_KEY) === '1'

  constructor() {
    try {
      const nav = navigator as Navigator & { audioSession?: { type: string } }
      if (nav.audioSession) nav.audioSession.type = 'playback'
    } catch {
      /* not supported */
    }
    this.boot()
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') this.resume()
    })
  }

  private boot() {
    if (this.ctx) return
    try {
      const AC: typeof AudioContext | undefined =
        window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (!AC) return
      const ctx = (this.ctx = new AC())
      const comp = ctx.createDynamicsCompressor()
      comp.threshold.value = -6
      comp.knee.value = 0
      comp.ratio.value = 12
      comp.attack.value = 0.002
      comp.release.value = 0.12
      comp.connect(ctx.destination)
      this.master = ctx.createGain()
      this.master.gain.value = this.muted ? 0 : LOUD
      this.master.connect(comp)
      for (const n of SFX) this.load(n)
    } catch {
      this.ctx = null
    }
  }

  get state() {
    return this.ctx?.state ?? 'none'
  }
  get loaded() {
    return this.bufs.size
  }

  /** Call from any user gesture: resume (iOS), blip a silent buffer, start the media keep-alive. */
  unlock() {
    this.boot()
    const ctx = this.ctx
    if (!ctx) return
    try {
      if (ctx.state !== 'running') {
        const b = ctx.createBuffer(1, 1, 22050)
        const s = ctx.createBufferSource()
        s.buffer = b
        s.connect(ctx.destination)
        s.start(0)
      }
      this.resume()
      if (!this.silent) {
        const a = (this.silent = document.createElement('audio'))
        a.src = SILENT_WAV
        a.loop = true
        a.setAttribute('playsinline', '')
        a.setAttribute('x-webkit-airplay', 'deny')
        void a.play().catch(() => (this.silent = null))
      }
    } catch {
      /* no audio, no problem */
    }
    if (!this.logged) {
      this.logged = true
      setTimeout(() => console.info(`[hotring] audio ${ctx.state}, ${this.bufs.size}/${SFX.length} sounds decoded`), 300)
    }
  }

  private resume() {
    const ctx = this.ctx
    if (ctx && ctx.state !== 'running' && ctx.state !== 'closed') void ctx.resume().catch(() => {})
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
        // A sound asked for while still decoding plays now if it's still fresh.
        const q = this.queued
        if (q && q.name === name && performance.now() - q.at < 700) {
          this.queued = null
          this.play(name, q.o)
        }
      })
      .catch(() => this.failedAt.set(name, performance.now()))
      .finally(() => this.loading.delete(name))
  }

  play(name: Sfx, o: Opts = {}) {
    const ctx = this.ctx
    if (!ctx || !this.master || this.muted) return
    this.resume()
    const buf = this.bufs.get(name)
    if (!buf) {
      this.queued = { name, o, at: performance.now() }
      return this.load(name)
    }
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
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(m ? 0 : LOUD, this.ctx.currentTime, 0.02)
  }
}
