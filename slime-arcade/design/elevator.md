# THE ELEVATOR — design

A new mini-game for Henry's Arcade. You are standing *inside* a station
elevator. You push the buttons, the doors close, the car moves, the doors open
somewhere else. That is the whole game.

It is the companion piece to TRAIN: same station, different vehicle. Where
TRAIN gives you a machine to drive around a loop, ELEVATOR gives you a machine
that takes you somewhere and shows you what is there.

Status: **design only**. No game code written yet; `public/index.html` is
untouched.

---

## 1. What we are copying from TRAIN

The train screen already settled every hard question this game would otherwise
re-open. ELEVATOR inherits its answers rather than inventing new ones.

| TRAIN does this | ELEVATOR does the same |
| --- | --- |
| Flat "paper cutout" art: absolutely-positioned `div`s, flat fills, no images, no SVG art | Car interior, doors and every floor scene are `div` boxes |
| Chunky ink outlines (`--ink #241A2E`), hard drop shadows, Bungee display type | Identical, so the two screens read as one arcade |
| One brushed-metal console (`.controlCard`) holding the real controls | The car's wall panel is the same panel, rotated to portrait |
| Buttons *light up* to show state (`.lit`), reverse blinks | Floor buttons stay lit until the car arrives; direction arrow blinks while moving |
| Bottom `.soundRow` of announcement buttons, German-first, with the platform gong | Same row, same gong, elevator/station phrases |
| Every one-shot sound pre-rendered through `OfflineAudioContext` and cached (`tone()`, `noise()`) | Ding, door motor, button beep all go through `tone()`/`noise()` — no new audio machinery |
| One `requestAnimationFrame` loop, started in `go()` on entering the screen, cancelled on leaving and on the parent timer expiring | Same lifecycle hooks: `startLiftLoop()` / `stopLiftLoop()` |
| `onTap()` (pointerdown, movement-tolerant) for every control | Same |
| Bilingual via the `STR` tables; spoken announcements German-first | Same |

Nothing new enters the codebase except one screen's worth of markup, CSS and
state. Still one file, still no build step, still no external assets.

### What it deliberately does *not* copy

* **No path maths.** TRAIN's hardest code hangs a rigid drawing on a curved
  rail. The elevator moves on one axis. A single `translateY` on the scene
  behind the doors is the entire animation.
* **No throttle.** A range input was right for a locomotive; an elevator has
  no speed control. Pressing a floor button *is* the whole input.
* **No vehicle picker.** TRAIN cycles five trains on tap. Here the variety is
  the four floors, and you get to them by riding.

---

## 2. The building

A composite German main station, the kind Henry actually stands in: U-Bahn
deep below, the S-Bahn and the main hall at street level, shops above that,
long-distance platforms up top. Four floors — enough that a ride can be long
or short, few enough that the panel is four fat buttons.

Panel order is top-down, the way a real panel reads:

```
   ┌──────┐
   │  2   │   FERNBAHN      ICE under the glass roof, sky behind
   ├──────┤
   │  1   │   GESCHÄFTE     bakery awning, pretzel, ice cream, bench
   ├──────┤
   │  E   │   S-BAHN        main hall, green S, red/ochre S-Bahn at the platform
   ├──────┤
   │  U   │   U-BAHN        tiled tunnel, blue U, yellow BVG train
   └──────┘
```

| Key | Indicator | German | English | Scene behind the doors |
| --- | --- | --- | --- | --- |
| `U` | `U` on BVG blue `#0063AF` | Untergeschoss · U-Bahn | Basement · Subway | Dark tiled tunnel wall, tunnel lamp, yellow `#FFD814` train flank with a black window band — the U-Bahn car from TRAIN, seen head-on |
| `E` | `E` on S-Bahn green `#008D4F` | Erdgeschoss · S-Bahn und Haupthalle | Ground floor · S-Bahn and main hall | Bright hall, green S roundel, red/ochre S-Bahn flank `#C1121F` / `#E8A020`, a departure board with rolling rows |
| `1` | `1` on cream | Erste Etage · Geschäfte | First floor · Shops | Bakery awning in stripes, pretzel, ice-cream cone, a bench, a potted tree |
| `2` | `2` on cream | Zweite Etage · Fernbahn | Second floor · Long distance | White ICE nose with the red cheat line (`#F4F4F2` / `#D0021B`, the exact TRAIN colours) under a glass arch, blue sky |

The floor scenes are the reward for pressing a button, so they carry the
detail. Each is only as wide as the doorway plus a margin — one screen-width
slab per floor, stacked in a column that slides vertically behind the doors.

---

## 3. The car

```
 ┌───────────────────────────────────────────┐
 │  ◀ HAUS            AUFZUG!                │   header, as every screen
 ├───────────────────────────────────────────┤
 │ ┌───────────────────────────────────────┐ │
 │ │  ▲    ┌───┐   Erdgeschoss             │ │   indicator strip:
 │ │       │ E │   S-Bahn                  │ │   arrow · floor tile · name
 │ │  ▼    └───┘                           │ │
 │ ├─────────────────────────────┬─────────┤ │
 │ │                             │  ┌───┐  │ │
 │ │   ░░ scene behind ░░        │  │ 2 │  │ │   wall panel, portrait
 │ │   ░░ the doorway  ░░        │  ├───┤  │ │   version of TRAIN's
 │ │ ┌───────────┬───────────┐   │  │ 1 │  │ │   brushed console
 │ │ │           │           │   │  ├───┤  │ │
 │ │ │   left    │   right   │   │  │ E │  │ │
 │ │ │   leaf    │   leaf    │   │  ├───┤  │ │
 │ │ │           │           │   │  │ U │  │ │
 │ │ └───────────┴───────────┘   │  └───┘  │ │
 │ │                             │ ◀▌▐▶ ▶▌▐◀│ │  door open / close
 │ └─────────────────────────────┴─────────┘ │
 ├───────────────────────────────────────────┤
 │  🔔    ◀▌▐▶   ▶▌▐◀   🚉   ➜   💬          │   sound row (TRAIN's .soundRow)
 └───────────────────────────────────────────┘
```

**Doorway.** Two leaves in brushed metal with a rubber edge, meeting in the
middle, each `translateX`-ing 100 % of its own width to open. Behind them sits
the floor column. A drop shadow inside the frame keeps the scene reading as
"out there" rather than wallpaper.

**Indicator strip.** A dark inset bar across the top: an up arrow and a down
arrow (the moving one blinks, exactly like TRAIN's reverse notch), the current
floor as a big tile in that floor's sign colour, and the floor name in Bungee.
While the car moves the tile flips at each floor it passes, with a soft tick —
so counting floors is something you can watch and hear.

**Wall panel.** TRAIN's `.controlCard` gradient, border and inset highlight,
laid out as a portrait column: four round floor buttons stacked 2 / 1 / E / U,
then the door-open and door-close pair underneath. Buttons are round because
elevator buttons are round and because it distinguishes them at a glance from
TRAIN's square console.

**Sound row.** The existing `.soundRow`, six buttons, same lit-for-4s
behaviour: bell, doors-opening, doors-closing, "next stop", "mind the gap",
welcome.

**Portrait vs. landscape.** Portrait is the design above. In landscape the
wall panel moves to the right of a wider doorway and the indicator strip stays
full-width; both are one flex-direction swap at a media query, no JS.

---

## 4. How a ride works

State: `currentFloor`, `targetFloor`, `doorState` (`closed` / `opening` /
`open` / `closing`), `carState` (`parked` / `moving`).

Pressing floor button **F** (or ▲ / ▼, which just compute `F` as one floor up
or down):

1. **Beep + light.** The button lights and stays lit. If `F` is the current
   floor and the doors are open, they simply re-open — no ride, no error.
2. **Doors close.** 0.8 s. Motor hiss (`noise()`), then
   *"Zurückbleiben bitte, die Türen schließen."*
3. **Travel.** 1.0 s per floor of distance, ease-in-out on the whole trip so
   it starts and stops softly. The floor column slides; the direction arrow
   blinks; a low hum plays; the indicator tile flips at each floor passed,
   with a tick.
4. **Arrival.** The hum stops, a two-tone gong sounds (the German
   *ding-dong*, 1046 Hz then 784 Hz), the button unlights.
5. **Doors open.** 0.9 s, then the floor is announced:
   *"Erdgeschoss. S-Bahn und Haupthalle."*

Rules that keep it toddler-proof:

* Presses during a ride are ignored with a short low buzz and a flash — no
  queue, no interruption, nothing to get wrong. (A queue is the first thing to
  add later if he wants it.)
* ▲ at the top floor and ▼ at the bottom do the same buzz. Nothing is ever
  disabled-looking; nothing ever fails.
* Door open / close only respond while parked.
* `prefers-reduced-motion`: doors and car snap instead of sliding, hum and
  ticks still play. Same rule TRAIN follows.

### Sound

Everything comes from the existing cached synthesis — no new audio code.

| Event | Sound |
| --- | --- |
| Button press | `tone({f:660, dur:.09, type:"square", vol:.18})` |
| Ignored press | `tone({f:150, dur:.14, type:"square", vol:.16})` |
| Doors moving | `noise(.5, 0, 900, .18)` |
| Travel hum | one looping `AudioBufferSourceNode` (a pre-rendered second of low filtered noise, `loop = true`), started on departure, stopped on arrival — a single voice, the same approach the draw pad's sustained tone already uses |
| Floor passed | `tone({f:880, dur:.05, type:"sine", vol:.1})` |
| Arrival gong | `tone({f:1046, dur:.5})` then `tone({f:784, at:.22, dur:.6})` |
| Announcement | existing `stationChime()` + `sayAnnouncement()` |

### Words

German first, English mirror, exactly as TRAIN handles announcements.

| Key | German | English |
| --- | --- | --- |
| close | Zurückbleiben bitte, die Türen schließen. | Stand back please, the doors are closing. |
| open | Vorsicht, die Türen öffnen sich. | Please stand clear, the doors are opening. |
| arrive `U` | Untergeschoss. U-Bahn. | Basement level. Subway. |
| arrive `E` | Erdgeschoss. S-Bahn und Haupthalle. | Ground floor. S-Bahn and main hall. |
| arrive `1` | Erste Etage. Geschäfte. | First floor. Shops. |
| arrive `2` | Zweite Etage. Fernbahn. | Second floor. Long-distance trains. |
| next | Nächster Halt: … | Next stop: … |
| gap | Bitte auf die Lücke achten. | Please mind the gap. |
| welcome | Sehr geehrte Fahrgäste, willkommen im Bahnhof. | Dear passengers, welcome to the station. |

---

## 5. Where it lands in the code

One screen's worth of additions to `public/index.html`, nothing else:

| Where | What |
| --- | --- |
| Home menu | An eighth tile, `t8`, 🛗, `data-go="lift"`. `t7` loses its `grid-column:1 / -1` so TRAIN and ELEVATOR share the last row |
| `STR.en` / `STR.de` | `titles.lift` / `tiles.lift` (`ELEVATOR!` / `AUFZUG!`), floor names, announcement table |
| Markup | `<section class="screen" id="lift">`: header, `.liftStage` (indicator, doorway, panel), `.soundRow` |
| CSS | `.liftStage`, `.floorCol`, `.floorScene` + per-floor part classes, `.doorLeaf`, `.indicator`, `.liftPanel`, `.floorBtn` — sharing `.controlCard` and `.sndBtn` rather than restyling them |
| JS | `FLOORS` table, ride state machine, `startLiftLoop()` / `stopLiftLoop()`, hooked into `go()` and into the parent timer's shutdown next to `stopTrainLoop()` |

Rough size: ~120 lines of CSS, ~180 of JS, in the same style as the rest.
Estimated effort, one sitting.

Deployment is unchanged — `npx wrangler deploy`, and the service worker's
stale-while-revalidate strategy picks the new file up on the next launch with
no cache bump.

---

## 6. Deliberately left out

Worth saying out loud so nobody has to re-litigate them:

* **Passengers to pick up, a score, "take this person to floor 3".** That is a
  different, older game. This one is a machine you operate.
* **A call panel outside the car / waiting on other floors.** Doubles the
  state machine, adds waiting — the opposite of what a two-year-old wants.
* **Queued stops.** Real, but it means a press can appear to do nothing for
  ten seconds. Ignore-with-a-buzz is honest and instant.
* **Emergency stop / alarm phone.** The bell button covers the fun part of it.
