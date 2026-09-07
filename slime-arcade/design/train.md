# THE TRAIN — design notes

Status: **built.** This is a record of how the Train screen in
`public/index.html` actually works and why, so the reasoning survives a
context switch. Unlike `elevator.md` (a pre-build proposal), the game
described here is live.

`train-mockup.html` in this folder is the approved visual reference —
the mockup that got a flat "boom. yes. build it all and make the whole
app look like that style" before any of it was wired into the real app.
If you're re-deriving the paper-cutout look from scratch, open that file
first; it's the ground truth for the art style, not just a sketch.

---

## 1. What it is

A steam/city train runs a rounded-rectangle loop around the edge of the
screen. A toddler drives it with a throttle and three stacked
direction buttons, taps the train itself to cycle through five real
train types, and can pull it up alongside a platform. Announcement
buttons along the bottom play German/English station phrases.

## 2. The one rule that mattered most

> "We don't need four different things... that would be fine with just
> one graphic that just rotates around like it does."

Every vehicle is a **single flat side-view drawing** that stays tangent
to the rail and turns a full 360° around the loop. No swapped poses for
the straights vs. the corners, no mirroring, no flip. Two earlier
approaches were built and explicitly rejected before this one:

- **4 poses swapped at the corners** — rejected: too much apparatus for
  what a single rotating drawing already does.
- **A card-flip when the train reverses along a straight** — rejected:
  "too much... just rotation."

The mockup in this folder is the one that survived: one `<div>` per
vehicle, rotated frame-by-frame to match the tangent of the path it's
riding on.

## 3. How the placement math actually works

This is the part most likely to bite you if you touch it later.

**A rigid drawing pivoting on a single point lifts its wheels off the
rail on curves.** A real wagon's wheels sit on a chord across the curve,
not a single point. So each vehicle carries two axle positions
(`axleA`, `axleB`, measured in its own local art-pixel coordinates), and
every frame:

1. Sample the path at the point under each axle (`at(lenAt + axleA...)`,
   `at(lenAt + axleB...)`).
2. The vehicle's rotation is `atan2` between those two sampled points —
   not the tangent at the vehicle's center.
3. The vehicle is translated to the midpoint of the two axle points, then
   translated back by its own local center so the art lines up.

`getPointAtLength` is the correct API for this but is too slow to call a
dozen times a frame — it pegged the main thread under any CPU load.
Fixed by sampling the path once per layout into a 720-point
`Float32Array` (`buildPathSamples`) and interpolating between the two
nearest samples in `at()`. Per-frame geometry calls went from ~700/sec to
zero; this also turned out to matter for audio glitching (see the
session's audio work — main-thread stalls were part of what made sound
crackle under load).

**Corner radius is generous (up to 90px) and the loop's inset is
`max(bodyOverhang*scale + margin, 17% of the shorter screen dimension)`**
— both exist so a vehicle's body, which stands off the rail rather than
being centered on it, never gets clipped or run off the visible area at
the corners.

**Car spacing uses body extents, not axle span.** A vehicle's true visual
footprint (`front`/`back`, measured from its own center) is wider than
the span between its axles. Spacing coupled cars by axle distance made
them visually overlap; the fix sums `(leader's half-width − leader's
back overhang) + coupling gap + (follower's front overhang − follower's
half-width)`.

**Platforms are sized to the actual train**, not the whole straight —
computed as `(tail car's offset + half its width + half the lead car's
width) * scale`, clamped to whatever room the straight actually has.
Whichever pair of opposite straights (top/bottom vs. left/right) is
longer gets the platforms, since that flips between portrait and
landscape.

## 4. Controls

S-Bahn-style, built after an explicit rejection of a horizontal-then-
vertical-then-icon-heavy layout: throttle on the left, three stacked
direction buttons — forward (green), stop (red), reverse (blinking red)
— icons and color only, no words, with the active state shown by
illuminating the right button. Announcement buttons live in a row along
the bottom of the screen (elevator-door-style icons), and speak the
correct phrase in whichever of English/German is currently active.

## 5. Known constraints worth knowing before you extend this

- `SPEED_PX` is a straight px/sec constant scaled by the throttle
  fraction, not physically simulated acceleration.
- `TRAIN_ORDER` (steam / ice / railjet / ubahn / shinkansen) is the tap-
  to-cycle order; each entry in `TRAIN_SETS` lists its cars with
  `w`/`axleA`/`axleB`/`back`/`front` — get these wrong and cars either
  hover off their wheels on curves or overlap at speed.
- All audio in the app (including this screen's whistle/announcements)
  now goes through a pre-rendered buffer cache with a hard voice cap —
  see the `tone()`/`noise()` implementation in `public/index.html` before
  adding new sounds; don't call `createOscillator` directly.
