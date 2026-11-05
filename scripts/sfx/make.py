"""hotring sound effects generator.

Run:  ~/tools/earshot-venv/bin/python -I scripts/sfx/make.py [name ...]
Renders every sound to public/sfx/<name>.mp3 (mono, 44.1 kHz, 128k) by layering earshot bank
sounds with a little numpy synthesis. Deterministic (fixed seeds). Needs /opt/homebrew/bin/ffmpeg.
Also writes .wav previews to scripts/sfx/_wav/ (gitignore-able) for auditioning.
"""
import os
import subprocess
import sys

import numpy as np
from scipy import signal
from scipy.io import wavfile

sys.path.insert(0, os.path.expanduser('~/tools/earshot'))
from earshot.forge import bank  # noqa: E402
from earshot.forge.knobs import KnobError  # noqa: E402

SR = 44100
FF = '/opt/homebrew/bin/ffmpeg'
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, '..', '..', 'public', 'sfx')
WAV = os.path.join(HERE, '_wav')


# ------------------------------------------------------------------ helpers
def S(sid, pitch=None, dur=None, gain=1.0, speed=1.0, seed=None):
    """a bank sound as mono float, optionally tuned (pitch), trimmed (dur, s), resampled (speed)"""
    try:
        y, _ = bank.render(sid, seed=seed, pitch=pitch, sr=SR, checks=False, peak_db=-1.0)
    except KnobError as e:       # pitch outside the recipe's range: render native, resample instead
        import re
        native = float(re.search(r'its own note is \S+ \(([\d.]+) Hz\)', str(e)).group(1))
        y, _ = bank.render(sid, seed=seed, sr=SR, checks=False, peak_db=-1.0)
        speed *= (pitch if isinstance(pitch, (int, float)) else hz(pitch)) / native
    y = y.mean(axis=1) if y.ndim == 2 else y
    if speed != 1.0:
        y = np.interp(np.arange(0, len(y) - 1, speed), np.arange(len(y)), y)
    if dur:
        y = y[:int(dur * SR)].copy()
        k = min(len(y), int(0.01 * SR))
        y[-k:] *= np.linspace(1, 0, k)
    return y * gain


def hp(x, f, o=2): return signal.sosfilt(signal.butter(o, f, 'high', fs=SR, output='sos'), x)
def lp(x, f, o=2): return signal.sosfilt(signal.butter(o, f, 'low', fs=SR, output='sos'), x)
def bp(x, a, b, o=2): return signal.sosfilt(signal.butter(o, [a, b], 'band', fs=SR, output='sos'), x)


def noise(dur, seed):
    return np.random.default_rng(seed).uniform(-1, 1, int(round(dur * SR)))


class Mix:
    def __init__(self, dur): self.b = np.zeros(int(dur * SR))

    def add(self, x, t=0.0, g=1.0):
        i = int(round(t * SR))
        x = np.asarray(x)[:max(0, len(self.b) - i)].copy()
        k = min(len(x), int(0.004 * SR))
        if k > 2:
            x[-k:] *= np.linspace(1, 0, k)
        if len(x) > 3:
            x[:3] *= np.array([.2, .6, .9])
        self.b[i:i + len(x)] += x * g
        return self

    def out(self, dur=None):
        return self.b[:int(dur * SR)] if dur else self.b


def thud(dur, f0, f1, d=0.12, tau=0.03):
    t = np.arange(int(dur * SR)) / SR
    ph = 2 * np.pi * np.cumsum(f1 + (f0 - f1) * np.exp(-t / tau)) / SR
    return np.sin(ph) * np.exp(-t / d)


def ping(f, dur, d, partials=((1, 1.0),), seed=0):
    """damped modal 'ping': sum of decaying sines, d = decay time constant (s)"""
    t = np.arange(int(dur * SR)) / SR
    return sum(a * np.sin(2 * np.pi * f * r * t) * np.exp(-t / (d / (1 + 0.5 * (r - 1)))) for r, a in partials)


def swoosh(dur, seed, f0, f1, q=1.2, shape=(0.2, 0.7)):
    """sweeping state-variable bandpass over noise, smooth rise/fall"""
    n = int(dur * SR)
    x = noise(dur, seed)
    fc = np.geomspace(f0, f1, n)
    k = 2 * np.sin(np.pi * np.clip(fc, 50, 9000) / SR)
    lo = bpv = 0.0
    out = np.zeros(n)
    for i in range(n):
        lo += k[i] * bpv
        hi = x[i] - lo - bpv / q
        bpv += k[i] * hi
        out[i] = bpv
    u = np.linspace(0, 1, n)
    return out * np.minimum(u / shape[0], 1) * np.clip((1 - u) / (1 - shape[1]), 0, 1)


def hz(note):
    names = {'C': 0, 'D': 2, 'E': 4, 'F': 5, 'G': 7, 'A': 9, 'B': 11}
    n = names[note[0]] + (1 if '#' in note else 0)
    o = int(note[-1])
    return 440.0 * 2 ** ((n + 12 * (o + 1) - 69) / 12)


# ------------------------------------------------------------------ sounds
def tap(i):
    # soft rounded pop (pitch-dropping sine) + a dry wood knock + a tiny glassy sparkle; 3 pitch variants
    k = [1.0, 1.19, 0.89][i]
    t = np.arange(int(0.16 * SR)) / SR
    ph = 2 * np.pi * np.cumsum(k * (400 + 500 * np.exp(-t / 0.02))) / SR
    m = Mix(0.18)
    m.add(np.sin(ph) * np.exp(-t / 0.05) * np.minimum(t / 0.002, 1), 0, 1.0)
    m.add(ping(900 * 2.1 * k, 0.05, 0.008), 0, 0.15)
    m.add(S('knock/wood', dur=0.08, speed=1.3 * k), 0, 0.4)
    m.add(hp(S('mallet/glock', pitch=['E7', 'G7', 'D7'][i], dur=0.12), 2500), 0.012, 0.07)
    return m.out(0.17)


def tick(_=0):
    # dry wood/clock tick: two inharmonic woody partials + a short noise click
    t = np.arange(int(0.07 * SR)) / SR
    wood = (np.sin(2 * np.pi * 1450 * t) * np.exp(-t / 0.008)
            + 0.6 * np.sin(2 * np.pi * 2380 * t) * np.exp(-t / 0.006)
            + 0.3 * np.sin(2 * np.pi * 3650 * t) * np.exp(-t / 0.004))
    click = hp(noise(0.07, 5), 2200) * np.exp(-t / 0.0018)
    x = wood + 0.7 * click
    return x[:int(0.065 * SR)]


def boom():
    m = Mix(1.3)
    m.add(S('cut_hit/punch', dur=0.35), 0, 0.9)
    m.add(thud(0.5, 150, 48, 0.16, 0.04), 0, 1.1)             # sub thump
    m.add(hp(noise(0.12, 9), 1200) * np.exp(-np.arange(int(0.12 * SR)) / (0.02 * SR)), 0, 0.8)  # burst
    m.add(S('glitch/hit', dur=0.25, speed=1.4), 0.0, 0.35)      # cartoon pop
    # rattly tail: scattered bouncing knocks falling in pitch and level, plus fizzy crackle
    r = np.random.default_rng(3)
    t = 0.09
    gap = 0.07
    g = 0.7
    while t < 1.05:
        m.add(S(r.choice(['knock/wood', 'knock/plastic', 'pro_tap/knock']), speed=r.uniform(0.55, 1.1), dur=0.12), t, g)
        t += gap
        gap *= 1.17
        g *= 0.85
    for tt in np.sort(r.uniform(0.05, 0.9, 38)):
        n = int(r.uniform(0.002, 0.008) * SR)
        c = hp(noise(n / SR, int(r.integers(1e9))), 1500) * np.exp(-np.arange(n) / (n * 0.3))
        m.add(c, tt, 0.35 * (1 - tt / 1.0))
    m.add(lp(S('pop/2', speed=0.8, dur=0.3), 3000), 0.0, 0.5)
    return m.out(1.25)


def shuffle():
    # two interleaved riffling halves: short papery flaps, rate swells then eases, a soft settle at the end
    d = 1.45
    m = Mix(d)
    r = np.random.default_rng(7)
    for half in range(2):
        t = 0.02 + 0.01 * half
        while t < 1.25:
            u = t / 1.25
            rate = 18 + 30 * np.sin(np.pi * min(u * 1.1, 1)) ** 0.8
            n = int(r.uniform(0.006, 0.014) * SR)
            f = r.uniform(1500, 4500)
            x = bp(noise(n / SR, int(r.integers(1e9))), f * 0.6, f * 1.6) * np.hanning(n * 2)[n // 3:n // 3 + n]
            m.add(x, t, r.uniform(0.4, 1) * (0.3 + 0.7 * np.sin(np.pi * u) ** 0.5))
            t += 1 / rate * r.uniform(0.8, 1.2)
    m.add(S('knock/desk', speed=1.3, dur=0.1), 1.25, 0.3)
    return m.out(1.4)


def flip():
    m = Mix(0.4)
    m.add(hp(S('swish/flick', dur=0.14, speed=1.15), 1500), 0.0, 0.9)               # lift
    m.add(S('pro_tap/soft', dur=0.1, speed=1.1), 0.1, 0.3)                           # slap
    m.add(hp(lp(noise(0.06, 4), 5000), 600) * np.exp(-np.arange(int(0.06 * SR)) / (0.01 * SR)), 0.1, 1.0)
    m.add(hp(S('mallet/glock', pitch='E7', dur=0.25), 2500), 0.13, 0.10)            # light sparkle tail
    m.add(hp(S('mallet/celesta', pitch='B7', dur=0.22), 3000), 0.19, 0.06)
    return m.out(0.36)


def whoosh():
    d = 0.26
    x = swoosh(d, 13, 900, 3200, 1.0, (0.35, 0.65))
    x = hp(x, 500)
    n = len(x)
    u = np.linspace(0, 1, n)
    x *= np.sin(np.pi * u) ** 1.3
    return x


def yourturn():
    m = Mix(0.55)
    for t, p, g in ((0.0, 'G5', 0.8), (0.14, 'C6', 1.0)):
        m.add(S('mallet/glock', pitch=p, dur=0.4), t, g)
        m.add(S('mallet/celesta', pitch=p, dur=0.3), t, 0.3)
    return m.out(0.5)


def join():
    m = Mix(0.35)
    m.add(S('drip/bubble', pitch='G4', dur=0.25), 0, 1.0)
    m.add(S('drip/plink', pitch='C6', dur=0.25), 0.05, 0.4)
    m.add(S('pro_pop/bloop', dur=0.15, speed=1.3), 0.08, 0.5)
    return m.out(0.3)


def start():
    m = Mix(1.0)
    m.add(hp(swoosh(0.45, 31, 500, 5000, 1.2, (0.7, 0.9)), 400), 0.0, 0.5)         # rising air
    for t, p, g in ((0.0, 'C5', 0.7), (0.1, 'E5', 0.75), (0.2, 'G5', 0.8), (0.3, 'C6', 0.9)):
        m.add(S('mallet/celesta', pitch=p, dur=0.5), t, g)
        m.add(S('mallet/glock', pitch=p, dur=0.3), t, 0.25)
    m.add(S('mallet/glock', pitch='G6', dur=0.6), 0.42, 0.9)
    m.add(S('mallet/celesta', pitch='C7', dur=0.5), 0.42, 0.5)
    m.add(thud(0.3, 180, 90, 0.07), 0.42, 0.4)
    m.add(hp(S('pro_shimmer/m3', dur=0.6), 2500), 0.42, 0.12)
    return m.out(0.95)


def refill():
    notes = ['C6', 'D6', 'E6', 'G6', 'A6', 'C7', 'D7', 'E7']
    m = Mix(0.9)
    for k, p in enumerate(notes):
        t = k * 0.045
        g = 0.55 + 0.45 * k / 7
        m.add(S('mallet/celesta', pitch=p, dur=0.35), t, g)
        m.add(hp(S('mallet/glock', pitch=p, dur=0.25), 1500), t + 0.005, 0.2)
    m.add(hp(S('pro_shimmer/m3', dur=0.6), 2500), 0.15, 0.14)
    return m.out(0.82)


def out():
    # comedic sink: pitch-dropping wobbly 'wowp' + a final plop
    d = 1.0
    t = np.arange(int(d * SR)) / SR
    f = 700 * np.exp(-t * 2.2) + 90
    f *= 1 + 0.025 * np.sin(2 * np.pi * 7 * t)
    ph = 2 * np.pi * np.cumsum(f) / SR
    tone = (np.sin(ph) + 0.35 * np.sin(2 * ph) + 0.15 * np.sin(3 * ph))
    env = np.minimum(t / 0.015, 1) * np.exp(-np.clip(t - 0.35, 0, None) / 0.22)
    tone = lp(tone, 4000) * env
    m = Mix(d)
    m.add(tone, 0, 0.6)
    m.add(S('downlifter/sub_sink', dur=0.9, speed=1.3), 0, 0.3)
    m.add(S('drip/bloop', pitch='C4', dur=0.35), 0.62, 0.7)                        # sad plop
    m.add(thud(0.2, 120, 60, 0.07), 0.62, 0.4)
    return m.out(1.0)


def win():
    d = 2.35
    m = Mix(d)
    run = [('C5', 0.0), ('E5', 0.09), ('G5', 0.18), ('C6', 0.27), ('E6', 0.4), ('G6', 0.53)]
    for p, t in run:
        m.add(S('mallet/celesta', pitch=p, dur=0.5), t, 0.7)
        m.add(S('mallet/glock', pitch=p, dur=0.35), t, 0.3)
    # landing chord at 0.7 with a bloom
    chord = [('C5', 0.8), ('E5', 0.6), ('G5', 0.7), ('C6', 0.9), ('E6', 0.6), ('G6', 0.7), ('C7', 0.6)]
    for p, g in chord:
        m.add(S('mallet/marimba', pitch=p, dur=0.6) if hz(p) < 1100 else S('mallet/glock', pitch=p, dur=1.0), 0.72, g * 0.6)
        m.add(S('mallet/celesta', pitch=p, dur=0.9), 0.72, g * 0.5)
    m.add(thud(0.4, 150, 60, 0.1), 0.72, 0.5)
    b = S('logo_sting/soft_bloom', dur=1.5)
    m.add(hp(b, 1200), 0.72, 0.55)
    m.add(hp(S('shimmer/m0', dur=1.5), 3000), 0.75, 0.22)
    # sparkle sprinkles
    r = np.random.default_rng(4)
    for k in range(9):
        p = ['E7', 'G7', 'C7', 'A6', 'D7'][k % 5]
        m.add(hp(S('mallet/glock', pitch=p, dur=0.4), 2000), 0.95 + k * 0.1 + r.uniform(0, 0.03), 0.16 * (1 - k / 11))
    return m.out(2.25)


def ui():
    m = Mix(0.08)
    m.add(S('hover_tick/detent', dur=0.08), 0, 0.6)
    m.add(lp(S('click/thock', dur=0.08), 4000), 0, 0.6)
    return m.out()


# name -> (builder, peak ceiling dBFS, target LUFS as measured by earshot or None for very short sounds).
# Quiet little sounds (tap/tick/ui) sit lower; boom/win/start are the loud ones.
SOUNDS = {
    'tap': (lambda: tap(0), -7.0, None), 'tap2': (lambda: tap(1), -7.0, None), 'tap3': (lambda: tap(2), -7.0, None),
    'tick': (tick, -7.0, None),
    'boom': (boom, -3.5, -13.0),
    'shuffle': (shuffle, -5.0, -16.5),
    'flip': (flip, -5.0, None),
    'whoosh': (whoosh, -6.0, None),
    'yourturn': (yourturn, -4.0, -15.5),
    'join': (join, -4.5, None),
    'start': (start, -3.0, -13.0),
    'refill': (refill, -4.0, -13.5),
    'out': (out, -4.0, -13.5),
    'win': (win, -3.0, -13.0),
    'ui': (ui, -8.0, None),
}


def measure_lufs(x):
    import tempfile
    from earshot import features
    with tempfile.TemporaryDirectory() as td:
        p = os.path.join(td, 'm.wav')
        wavfile.write(p, SR, x.astype(np.float32))
        return features.measure(p, light=True)['lufs']


def finish(x, peak_db, target=None):
    x = np.asarray(x, np.float64)
    x = x - np.mean(x)
    x = hp(x, 40, 1)
    x = lp(x, 14000, 1)
    n = len(x)
    a, f = int(0.003 * SR), min(int(0.012 * SR), n // 3)    # short in-fade (keeps the transient), longer out-fade
    x[:a] *= np.linspace(0, 1, a)
    x[-f:] *= np.cos(np.linspace(0, np.pi / 2, f)) ** 2
    ceil = 10 ** (peak_db / 20)
    x = x / (np.abs(x).max() + 1e-9)
    if target is not None:
        # raise loudness to the target; a tanh soft limiter holds the peak ceiling (gentle density, no hard clip)
        g = 1.0
        for _ in range(5):
            y = np.tanh(x * g) / np.tanh(g) if g > 1 else x * g
            g *= 10 ** ((target - measure_lufs(y * ceil)) / 20)
        x = np.tanh(x * g) / np.tanh(g) if g > 1 else x * g
        print('   drive %.2f' % g, end='')
    return x * ceil


def write(name, x):
    os.makedirs(OUT, exist_ok=True)
    os.makedirs(WAV, exist_ok=True)
    w = os.path.join(WAV, name + '.wav')
    wavfile.write(w, SR, x.astype(np.float32))
    mp3 = os.path.join(OUT, name + '.mp3')
    subprocess.run([FF, '-y', '-loglevel', 'error', '-i', w, '-ac', '1', '-ar', str(SR),
                    '-c:a', 'libmp3lame', '-b:a', '128k', mp3], check=True)
    return mp3


if __name__ == '__main__':
    names = sys.argv[1:] or list(SOUNDS)
    for n in names:
        fn, pk, tg = SOUNDS[n]
        y = finish(fn(), pk, tg)
        write(n, y)
        print(' ', n, '%.2fs' % (len(y) / SR))
    with open(os.path.join(OUT, 'CREDITS.txt'), 'w') as fh:
        fh.write('Synthesized with earshot, no samples.\n')
