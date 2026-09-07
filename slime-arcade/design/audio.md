# AUDIO — design notes

Status: **built**, after three rounds of a recurring "it sounds crunchy /
overdriven / choppy" report that survived several genuinely correct fixes.
This doc exists so the next person doesn't repeat the same three rounds.

---

## 1. The complaint, and why the obvious fixes didn't hold

Every earlier fix was real and measurable, and none of them stuck:

1. **Levels/clipping.** Measured peaks via `OfflineAudioContext` — never
   clipping. Fixed speech `rate`/`pitch` to exactly `1` anyway (any other
   value forces the platform voice to time-stretch/pitch-shift itself,
   which is audibly torn on "compact" voices most phones ship), added a
   limiter and output headroom, stopped an unconditional
   `speechSynthesis.cancel()` before every utterance. Real improvement.
   Not the root cause.
2. **CPU on the main thread.** Convolution reverb cost 2.3-4x everything
   else in the graph for an inaudible wet level — removed. Live geometry
   sampling (`getPointAtLength`, used by the train screen) cost 9ms/frame
   under load — replaced with a cached 720-point lookup table. Real,
   measurable, worth keeping. Still not the root cause.
3. **A literal memory leak.** Zero `disconnect()` calls existed anywhere
   in the app — every oscillator/gain/filter stayed wired into the master
   bus forever. Rendering 1s of audio cost 5.6ms clean vs. 45.8ms with
   ~2000 leaked nodes (roughly ten minutes of a toddler tapping). Fixed
   with `onended` handlers. Also real. **Also not the root cause** — the
   complaint came back a fourth time after this shipped.

## 2. The actual root cause

**Every measurement above used `OfflineAudioContext`, which renders as
fast as it can with no realtime deadline to miss.** It is structurally
incapable of reproducing a realtime buffer underrun, because it isn't
bound by one. A live oscillator/filter graph does its envelope
automation (`setValueAtTime`, `exponentialRampToValueAtTime`, etc.) on
the realtime audio thread, every callback, for as long as that voice is
alive. On a phone under *any* load — and a toddler mashing pads is
exactly that — missing that thread's deadline is what "crunchy" actually
is. It has nothing to do with amplitude, and nothing an offline render
can surface.

## 3. The fix: don't synthesize live, ever, for one-shot sounds

Every `tone()` and `noise()` call is rendered **once** per distinct set
of parameters through an `OfflineAudioContext`, and the finished PCM
buffer is cached (`soundCache`, keyed by a string built from
type/pitch/glide/duration/volume, or duration/filter/volume for noise).
Playing a cached sound is then just **one `AudioBufferSourceNode` wired
straight to the bus** — no live oscillator, no per-play automation,
nothing for the realtime thread to compute beyond copying samples.

The first time a given pitch is ever used there's a render to wait on —
a `.then()` on the `OfflineAudioContext`'s promise — but that render
happens off the realtime thread entirely and is typically sub-5ms even
under load. Every repeat after that (which is nearly every tap, since a
toddler mashes the same few pads over and over) is instant. `startAt` is
captured at call time, before the async gap, so even a first-time render
that takes a moment doesn't drift the sound's intended timing — worst
case it plays as soon as the buffer's ready instead of at the exact
scheduled offset, which is inaudible on a game like this.

Two more pieces of defense-in-depth, both cheap and worth keeping:

- **A hard voice cap** (`MAX_VOICES = 16`, gated by `voiceGate()`/
  `voiceDone()`). Bounds how many simultaneous buffer sources can exist
  no matter how fast someone mashes; a rejected call is just silently
  dropped, which is inaudible in a wall of overlapping taps.
- **`latencyHint: "playback"`** on the `AudioContext`, not `"balanced"`
  or the default `"interactive"`. This app never needed low latency; it
  needed the biggest buffer the platform would give it, for maximum
  glitch resistance.
- **A cap on live confetti particles** (`MAX_BITS = 70` in `burst()`).
  Not audio at all, but the same root cause applies to it: DOM churn on
  the main thread from rapid-fire bursts is exactly the kind of load
  that can starve the realtime audio thread's scheduling on a weaker
  phone. Dropping particles past the cap is invisible to a toddler; a
  starved audio callback is not.

## 4. What's still live-synthesized, on purpose

The draw screen's drag tone (continuous pitch/timbre while a finger
moves across the color pad) stays a genuine live oscillator with
automated `frequency`/filter parameters. It's a single sustained voice,
not a rapid-fire polyphony hazard — the failure mode this whole
architecture exists to prevent doesn't apply to it.

## 5. If you add a new sound

Call `tone(opts)` or `noise(dur, at, filterFreq, vol)`. Do not call
`ctx.createOscillator()` or `ctx.createBufferSource()` directly outside
of those two functions and the draw screen's drag tone — every one-shot
sound effect in the app is expected to go through the cache, and a new
direct oscillator call is exactly how this regressed silently the first
time.
