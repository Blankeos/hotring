// Sound layer with two paths, built to actually be heard on every phone.
//
// WebAudio (preferred): context created at boot so files decode before the first tap;
// gain -> limiter -> out so it's loud without clipping; pitch-shifted ticks.
//
// HTMLAudio (fallback): pooled <audio> elements. Used when the context isn't 'running'
// after a gesture (stuck/interrupted, some in-app browsers), or on iOS without
// navigator.audioSession (older iOS: WebAudio is muted by the ringer switch, media isn't).
// Force it with ?audio=html (or localStorage hotring.audio = 'html') for debugging.
//
// Everything logs with a `[hotring audio]` prefix for remote debugging.

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

export type AudioStatus = 'idle' | 'running' | 'html' | 'blocked'

const MUTE_KEY = 'hotring.muted'
const RETRY_MS = 4000
const LOUD = 1.8
const CLONES = 4

// 1-sample silent WAV, looped by a media element to route audio as "playback" on iOS.
const SILENT_WAV = 'data:audio/wav;base64,UklGRiYAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQIAAACAgA=='

type Opts = { rate?: number; gain?: number; delay?: number }
const log = (...a: unknown[]) => console.info('[hotring audio]', ...a)

const ua = navigator.userAgent
const IOS = /iP(hone|ad|od)/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)
const forced = (() => {
  try {
    return new URL(location.href).searchParams.get('audio') === 'html' || localStorage.getItem('hotring.audio') === 'html'
  } catch {
    return false
  }
})()

export class Audio {
  private ctx: AudioContext | null = null
  private master: GainNode | null = null
  private bufs = new Map<Sfx, AudioBuffer>()
  private loading = new Set<Sfx>()
  private failedAt = new Map<Sfx, number>()
  private queued: { name: Sfx; o: Opts; at: number } | null = null
  private silent: HTMLAudioElement | null = null
  private pool = new Map<Sfx, HTMLAudioElement[]>()
  private gestured = false
  private judged = false
  private warmed = false
  /** fell back because the context was stuck (not forced, not the iOS rule) */
  private autoHtml = false
  private checkT: ReturnType<typeof setTimeout> | undefined
  /** true: play through <audio> elements */
  html = false
  muted = localStorage.getItem(MUTE_KEY) === '1'
  onStatus: (s: AudioStatus) => void = () => {}

  constructor() {
    const nav = navigator as Navigator & { audioSession?: { type: string } }
    let session = false
    try {
      if (nav.audioSession) {
        nav.audioSession.type = 'playback'
        session = true
      }
    } catch {
      /* not supported */
    }
    this.html = forced || (IOS && !session)
    this.boot()
    this.buildPool()
    log(`boot: path=${this.html ? 'html' : 'webaudio'}${forced ? ' (forced)' : ''} ios=${IOS} audioSession=${session} ctx=${this.ctx?.state ?? 'none'}`)
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        this.resume()
        this.check()
      }
    })
  }

  private boot() {
    if (this.ctx) return
    try {
      const AC: typeof AudioContext | undefined =
        window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (!AC) {
        this.html = true
        return
      }
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
      ctx.addEventListener?.('statechange', () => this.check())
      for (const n of SFX) this.load(n)
    } catch {
      this.ctx = null
      this.html = true
    }
  }

  private buildPool() {
    for (const n of SFX) {
      const a = document.createElement('audio')
      a.src = `/sfx/${n}.mp3`
      a.preload = 'auto'
      a.setAttribute('playsinline', '')
      this.pool.set(n, [a])
    }
  }

  get state() {
    return this.ctx?.state ?? 'none'
  }
  get loaded() {
    return this.bufs.size
  }
  get status(): AudioStatus {
    if (!this.gestured) return 'idle'
    if (this.html) return 'html'
    return this.ctx?.state === 'running' ? 'running' : 'blocked'
  }

  /**
   * Call synchronously inside a user gesture (pointerdown/touchend/click): iOS only
   * honours resume() and media play() from inside the gesture itself.
   */
  unlock(activating = true) {
    this.boot()
    // touchstart / touch pointerdown don't grant user activation (touchend does), so only
    // judge whether WebAudio came up after an activating gesture.
    const first = activating && !this.judged
    if (activating) this.judged = true
    this.gestured = true
    const ctx = this.ctx
    try {
      if (ctx && ctx.state !== 'running') {
        const b = ctx.createBuffer(1, 1, 22050)
        const s = ctx.createBufferSource()
        s.buffer = b
        s.connect(ctx.destination)
        s.start(0)
        void ctx.resume().catch(() => {})
      }
      if (!this.silent) {
        const a = (this.silent = document.createElement('audio'))
        a.src = SILENT_WAV
        a.loop = true
        a.setAttribute('playsinline', '')
        a.setAttribute('x-webkit-airplay', 'deny')
        void a.play().catch(() => (this.silent = null))
      }
      // Warm every media element inside the gesture so later plays are allowed.
      if (activating && !this.warmed) {
        this.warmed = true
        for (const [, [a]] of this.pool)
          if (a) {
            a.muted = true
            void a
              .play()
              .then(() => {
                a.pause()
                a.currentTime = 0
                a.muted = false
              })
              .catch(() => (a.muted = false))
          }
      }
    } catch {
      /* no audio, no problem */
    }
    if (first) {
      clearTimeout(this.checkT)
      this.checkT = setTimeout(() => {
        this.check()
        log(`after first tap: ctx=${this.state} path=${this.html ? 'html' : 'webaudio'} decoded=${this.bufs.size}/${SFX.length}`)
      }, 400)
    }
    this.onStatus(this.status)
  }

  /** WebAudio didn't come up after a gesture: switch to media elements. */
  private check() {
    if (this.judged && !this.html && this.ctx && this.ctx.state !== 'running') {
      this.html = this.autoHtml = true
      log(`context is '${this.ctx.state}' after a gesture: switching to html audio`)
    } else if (this.autoHtml && this.ctx?.state === 'running') {
      this.html = this.autoHtml = false
      log('context is running again: back to webaudio')
    }
    this.onStatus(this.status)
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
    if (this.muted) return
    if (this.html) return this.playHtml(name, o)
    const ctx = this.ctx
    if (!ctx || !this.master) return this.playHtml(name, o)
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

  /** Media-element path: a free element from the pool (cloned for overlap). */
  private playHtml(name: Sfx, o: Opts) {
    const list = this.pool.get(name)
    if (!list) return
    const go = () => {
      let a = list.find((x) => x.paused || x.ended)
      if (!a) {
        if (list.length >= CLONES) a = list[0]!
        else {
          a = list[0]!.cloneNode(true) as HTMLAudioElement
          list.push(a)
        }
      }
      const el = a as HTMLAudioElement & { preservesPitch?: boolean; webkitPreservesPitch?: boolean; mozPreservesPitch?: boolean }
      el.preservesPitch = el.webkitPreservesPitch = el.mozPreservesPitch = false
      el.playbackRate = o.rate ?? 1
      el.volume = Math.min(1, (o.gain ?? 1) * 0.9 + 0.1)
      try {
        el.currentTime = 0
      } catch {
        /* not seekable yet */
      }
      void el.play().catch(() => {})
    }
    if (o.delay) setTimeout(go, o.delay)
    else go()
  }

  tap(gain = 1) {
    const names: Sfx[] = ['tap', 'tap2', 'tap3']
    this.play(names[Math.floor(Math.random() * 3)]!, { rate: 0.94 + Math.random() * 0.12, gain })
  }

  setMuted(m: boolean) {
    this.muted = m
    localStorage.setItem(MUTE_KEY, m ? '1' : '0')
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(m ? 0 : LOUD, this.ctx.currentTime, 0.02)
    if (m) for (const list of this.pool.values()) for (const a of list) a.pause()
    this.onStatus(this.status)
  }
}
