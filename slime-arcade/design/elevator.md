# THE ELEVATOR — design notes

Status: **built, and substantially revised since.** This replaces the
original pre-build proposal below the fold in spirit (kept as history at
the bottom) with what's actually running in `public/index.html` today.
`elevator-mockups.html` in this folder is the *original* three-floor/
numbered-console concept — useful for seeing where the idea started, but
the numbers, the console, and the door mechanics it shows were all
removed after the first real build. Read this file for what's live.

---

## 1. What it is, today

A side-view cutaway of a station: three floors stacked up the screen, a
lift shaft down the left, vehicles sliding in and out along the right.
Little people get off a train (or the bus), walk to the lift, wait, ride,
and get out where they're going. There's no console — **you call the car
by tapping the floor you want**, directly on the room itself.

| Floor | Letter | Color | What's there |
| --- | --- | --- | --- |
| 1 | **U** | yellow `--f1` | U-Bahn platform, tiled tunnel wall |
| 2 | **S** | red `--f2` | S-Bahn platform, hazard stripe |
| 3 | **H** | blue `--f3` | Haltestelle — a road, a bus stop pole, a bus |

## 2. The two biggest reversals from the original design, and why

**Numbers came out; a letter and a color went in.** The original proposal
(see below) spent a full section arguing for numerals as a destination
badge — matching game, survives the ride, reinforces the counting screen.
That reasoning wasn't wrong, but the direction from actual use was to
remove every digit from the screen and lean harder on color instead. A
letter is not a digit, though, and German transit signage already solves
exactly this problem: **U** for U-Bahn, **S** for S-Bahn, **H** for
Haltestelle. So the floor sign, the rider's badge, and the shaft readout
all now show the same letter-on-color chip — real signage, not an
invented numeral system, and it doesn't reopen "no numbers."

**The console came out; tap-the-floor went in.** Floor buttons, an
open/close pair, and a bell used to live in a bottom panel. Two things
killed it: it ate a third of the screen for controls a toddler didn't
need (the room *is* the button), and its door-open/close state machine
was the reason a new floor request had to wait for the current trip to
fully resolve before it would even be accepted. Tapping a floor's room
now retargets the car **immediately**, whether it's parked or already
mid-ride — `startTravel()` always measures from the car's live position
(`carFrom = carY`), so a redirect just bends the trip toward the new
floor instead of finishing the old one first.

Doors followed the same logic: they're **glass** now, always
see-through, so there's nothing to open or close and no wait built
around them. The car services whichever floor it's parked at
continuously (`service()`), boarding and unloading without a door-state
gate at all.

## 3. A real bug worth knowing about if you touch the pedestrian layer

`.lpedLayer` (the people) is a full-stage absolutely-positioned overlay,
same as `.ltrainLayer`. The train layer already had `pointer-events:none`
with `pointer-events:auto` re-enabled only on individual `.ltrain`
elements — exactly the pattern needed so empty space doesn't swallow
taps meant for what's underneath. The people layer was missing it, which
meant **every tap on a floor's empty space was silently eaten** the whole
time the console existed (it didn't matter then, because the console did
the calling). The moment floor-tapping became the only way to call the
car, this became a real, ship-blocking bug. Fixed the same way the train
layer already did it. If you add another full-stage layer here, give it
`pointer-events:none` and re-enable only on the interactive children.

## 4. The bus, and how three vehicles share one system

`trainList` was originally sized for two vehicles (U-Bahn train, S-Bahn
train). The bus is a third entry with `f: 2`, reusing the *exact* same
travel rig — `awayX()`/`stopX()`, the away → in → stop → out state
machine, `groundY[tr.f]` for its vertical position — because that rig
never assumed there'd only ever be two. Only the art differs: the bus
skips the rail-vehicle's nose wedge, gets a flat windshield-style front,
two wheels instead of four, and a paved `.lroad` (with a dashed line)
instead of the rail floors' `.ltrack`/`.ltunnel`. It's still a `.ltrain`
element with a `.bus` modifier class, not a separate system — if you add
a fourth vehicle type, extend `trainList`'s loop bound and give it its
own art branch, not a parallel implementation.

The old floor-3 scenery (a lawn, a snack counter, a stairwell down to
"the surface") came out entirely once floor 3 became the literal surface
— there's nothing to exit to when you're already standing on the street.

## 5. Known constraints worth knowing before you extend this

- Redirecting mid-flight recomputes `carDur` from the car's actual
  remaining pixel distance (`Math.abs(carTo - carFrom) / (floorH / 0.85)`),
  not from a floor-index difference — get this wrong again and a
  redirect near the destination will move at full-floor speed for a
  fraction of a floor's distance, which looks like a lurch.
- `FLOOR_LETTER`, `FLOOR_COLOR_KEY`, and `FLOOR_COLOR_VAR` are three
  parallel arrays indexed by floor (0/1/2 = U/S/H) — keep them in sync if
  a floor ever changes identity.
- All sound here goes through the app's pre-rendered buffer cache (see
  `design/audio.md`); don't add a live oscillator for a new elevator
  sound effect.
- The reward-lamp row (`pipRow`, five lamps + a confetti burst every
  fifth delivery) from the original proposal survived the rewrite
  unchanged and still works the same way.

---

## Appendix: the original pre-build proposal

Everything below is the design as first proposed, before the first real
build. Numbers-as-badges, the console, and open/close doors described
here were all built, then removed for the reasons in §2 above. Kept for
history, not as documentation of current behavior.

A side-view cutaway of a station, drawn the way an old DOS game would draw
it: three floors stacked up the screen, a lift shaft running the full height
down the left, trains sliding in and out along the right. Little people get off
the trains, walk to the lift, and wait there holding up the number of the floor
they want. You drive the lift and take them there.

No score to lose, no timer, nobody ever gets angry. The whole game is: read the
number over someone's head, press that number, open the doors.

### The building, in one screen

```
 ┌──────────────────────────────────────────────────────┐
 │  ◀ HAUS               AUFZUG!                        │
 ├──────────┬───────────────────────────────────────────┤
 │ ╔══════╗ │  ③ AUSGANG · GESCHÄFTE                   │
 │ ║ ┌──┐ ║ │        🧍②                    ┌─────────┐ │  floor 3
 │ ║ │██│ ║ │      🧍①  🧍②                 │ ▯ EXIT ▯│ │  street level
 │ ║ └──┘ ║ │  ▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔ │
 │ ╠══════╣ │  ② S-BAHN                                │
 │ ║      ║ │     🧍③                 ┌───────────────┐ │  floor 2
 │ ║      ║ │                         │▄▄ S-Bahn ▄▄▄▄▄│ │
 │ ║      ║ │  ▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔ │
 │ ╠══════╣ │  ① U-BAHN                                │
 │ ║      ║ │   🧍②  🧍③              ┌───────────────┐ │  floor 1
 │ ║      ║ │                         │▄▄ U-Bahn ▄▄▄▄▄│ │
 │ ╚══════╝ │  ▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔ │
 ├──────────┴───────────────────────────────────────────┤
 │        ⑴      ⑵      ⑶        ◀▌▐▶   ▶▌▐◀    🔔      │  the console
 └──────────────────────────────────────────────────────┘
```

Yellow at the bottom because the U-Bahn is BVG yellow; red in the middle
because the S-Bahn is red; blue on top because that is the sky. One
colour per level, used in exactly four places: the floor sign, the wall
itself, people's badges, its console button.

### Numbers over people's heads — the original thinking

The ask was arrows first, then numbers. **An arrow is a call. A number is
a destination.** With three floors, an arrow carries almost no
information — from floor 1 the only possible arrow is up, from floor 3
the only possible arrow is down. **A number is a matching game; an arrow
is an inference.** Badge says 3, press 3. **A number survives the ride** —
once someone is inside the car, an arrow is spent, but the badge rides
with them. **It plugs into a game he already has** — COUNT already
teaches 1-2-3 in both languages.

The badge was double-coded three ways against the risk that a toddler who
doesn't read numerals yet gets nothing from a "3": the numeral, that many
dots underneath, and the floor's colour. Match by numeral, by counting
dots, or by colour alone.

### The console

Classic lift buttons across the bottom: round floor buttons 1/2/3 ringed
in their floor's colour, doors open/close using the train screen's door
glyphs, and a bell for fun. Doors opened themselves on arrival and closed
after four idle seconds; pressing a floor mid-ride was ignored with a
low buzz rather than queued.

### Deliberately not in it

A score, a timer, angry passengers, real lift call-button logic, walking
the people yourself, more than three floors. All of that still holds.
