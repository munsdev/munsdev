# THE ELEVATOR — design

A side-view cutaway of a station, drawn the way an old DOS game would draw
it: three floors stacked up the screen, a lift shaft running the full height
down the left, trains sliding in and out along the right. Little people get off
the trains, walk to the lift, and wait there holding up the number of the floor
they want. You drive the lift and take them there.

No score to lose, no timer, nobody ever gets angry. The whole game is: read the
number over someone's head, press that number, open the doors.

Status: **design only.** `public/index.html` is untouched.

---

## 1. The building, in one screen

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

### The levels are colour-coded, and the colour is the train's

| Floor | Colour | What is there | Where people come from / go |
| --- | --- | --- | --- |
| **3** Ausgang · Geschäfte | **blue** `#2D7DD2` | Street entrance on the right — glass doors and a bakery. Sky‑blue walls: the level you walk out into | People **enter** the station here and **leave** here |
| **2** S-Bahn | **red** `#E33629` | Platform, hazard stripe, the red S‑Bahn pulling in from the right | Trains drop passengers and take them away |
| **1** U-Bahn | **yellow** `#FFC61A` | Platform, tiled tunnel wall, the BVG‑yellow U‑Bahn | Trains drop passengers and take them away |

Yellow at the bottom because the U‑Bahn is BVG yellow; red in the middle
because the S‑Bahn is red; blue on top because that is the sky. The level's
colour comes from the thing that lives there, so it is never arbitrary.

One colour per level, used in exactly four places and nowhere else:

```
   the floor sign  ─┐
   the wall itself ─┼─►  one hue per level, so the whole band of screen
   people's badges ─┤     reads as "this is floor 2" before you read a word
   its console button ─┘
```

The walls are that hue knocked back to a pale paper tint (`#EFD79A`,
`#D9948C`, `#A9CBE8`) so the saturated version — sign, badge, button ring,
train — stays the thing your eye lands on. Every badge also sits on a cream
paper mount, which keeps a yellow badge readable against a yellow wall.

The lift shaft is the left ~24 % of the screen, floor to ceiling, with the car
running in it. The trains keep coming whether or not the lift ever moves — the
station is alive on its own, and driving it is optional.

> Open question: "schooling center" on the top floor — I've drawn it as the
> street entrance with shops (`Ausgang · Geschäfte`), which is what a German
> station has up top. If you actually meant a school / kids' centre, it's a
> different sign and a different bit of scenery on the right; say the word.

---

## 2. Numbers over people's heads — the thinking

The ask was arrows first, then numbers. Numbers are right, and it's worth
saying exactly why, because it changes the whole shape of the game.

**An arrow is a call. A number is a destination.** A real lift's up/down button
says "come get me, I'm going that way", and the car's own panel holds the
destinations. With three floors, an arrow carries almost no information: from
floor 1 the only possible arrow is up, from floor 3 the only possible arrow is
down. Two of the three floors are unambiguous, so on those floors the arrow
tells you nothing you couldn't see already. Only the middle floor's arrow is a
real fact — and even there it only narrows it to one of two answers.

**A number is a matching game; an arrow is an inference.** Badge says 3, press
3. One step, no reasoning, immediately correct or not. An arrow needs a second
thought ("up from 2 means 3") that a two‑year‑old does not have yet, and which
would make the game about deduction instead of about driving a lift.

**A number survives the ride.** Once someone is inside the car, an arrow is
spent — you can no longer tell who should get out where. The badge rides with
them, so when the doors open at 2 it is visible at a glance which of the three
passengers is getting off. That is what makes a car with several people in it
readable instead of confusing.

**It plugs into a game he already has.** COUNT already teaches 1‑2‑3 in both
languages. Tapping a waiting person says their number out loud — *"Zwei!"* —
so the lift screen quietly reinforces the counting screen.

**The number comes off when it's delivered.** The instant the doors open on
the floor a person asked for, their badge pops off in a small puff of paper
and a *"Danke!"* takes its place for a moment. That single rule does a lot of
work:

* **Anyone still wearing a number still needs something.** The screen's
  remaining work is countable at a glance — and countable is the point.
* **It is the reward.** The badge coming off *is* the "well done", visible
  from across the room, with no score to read.
* **It keeps a full car readable.** Three people ride, one gets out at 2, and
  the two numbers left in the car are exactly the two jobs left.
* **It stops the screen from lying.** A delivered person walking to the exit
  is not asking to go anywhere; they should not be holding a request.

**The obvious risk, and the fix.** A toddler who does not yet read numerals
gets nothing from a "3". So the badge is *double‑coded*, three ways for the
same fact:

```
        ┌──────┐
        │  ③   │   the numeral, big, in Bungee
        │ ● ● ● │   that many dots underneath
        └──┬───┘   on that floor's colour  (3 = blue)
           ▼
          🧍       and the floor's button is the same colour
```

Match by numeral, by counting the dots, or by colour alone — blue badge,
blue button. Any one of the
three gets you to the right button, so the game works before numbers do and
teaches them on the way.

**Arrows do not disappear entirely** — they move to where they belong. A
single up/down indicator sits at the top of the shaft showing which way the
*car* is going. That's the lift's own state, not a person's request.

---

## 3. What people do

Each person is a tiny state machine. There are never more than about eight
alive at once.

```
   spawn ─► walk to the lift ─► wait in the queue ─► board ─► ride
                                                                │
   leave ◄── walk to the train / the exit ◄── step out ◄────────┘
```

1. **Spawn.** A train pulls in on floor 1 or 2, its doors open, one to three
   people step out. On floor 3 people walk in through the street entrance
   instead. A new arrival every four to eight seconds, capped at eight alive.
2. **Walk to the lift.** Left along the platform, two‑frame stepping legs, the
   badge bobbing over their head.
3. **Wait.** They line up beside the shaft door, first in front. The queue is
   ordered, so who boards next is never a surprise.
4. **Board.** When the doors are open at their floor, they walk in on their
   own — no tapping, no aiming. The car holds **three**; a fourth person simply
   waits for the next trip.
5. **Ride.** They stand in the car, badges visible.
6. **Step out.** When the doors open at the floor on their badge, they walk
   out, do a little hop, and a *"Danke!"* pops over them.
7. **Leave.** On 1 and 2 they walk right and board the next train; on 3 they
   walk out through the entrance. Either way they leave the screen.

**Nothing punishes you.** Nobody gets impatient, nobody leaves in a huff, no
timer runs out. Miss a train and they wait for the next one — a new one is
always coming. The only feedback is the happy one.

**Optional reward loop.** A row of five little lamps in the top-right corner; each
delivered passenger fills one; the fifth fires the confetti burst and the row
resets. A reason to keep going, with nothing to lose. Easy to leave out if it
clutters the screen.

---

## 4. The console

Classic lift buttons across the bottom, in one brushed panel — the train
screen's `.controlCard`, reused.

```
 ┌──────────────────────────────────────────────────────┐
 │   ╭───╮      ╭───╮      ╭───╮                        │
 │   │ 1 │      │ 2 │      │ 3 │      ◀▌▐▶    ▶▌▐◀   🔔  │
 │   ╰───╯      ╰───╯      ╰───╯      öffnen  schließen  │
 └──────────────────────────────────────────────────────┘
```

* **Floor buttons 1 / 2 / 3.** Round, ivory, ~60 px, each ringed in its floor's
  colour so the badge‑to‑button match can be made on colour alone. Pressing one
  lights it amber; it holds that light for the whole trip and goes out on
  arrival. Left to right is 1‑2‑3, the same direction he counts in.
* **Doors open / doors close.** The exact glyphs the train screen already uses:
  arrows away from the leaves opens, arrows toward them closes.
* **Bell.** The station gong, purely for fun.

Rules, all of them forgiving:

* Doors **open by themselves** on arrival and close again after four idle
  seconds — but never while someone is walking through them.
* Pressing the floor you are already on just re‑opens the doors.
* Pressing a floor mid‑ride is ignored with a soft low buzz. No queue, nothing
  silently pending, nothing to get wrong.
* The car will not move with its doors open; press a floor while they are open
  and they close first, then it goes.
* Tapping a **person** says their number aloud. Tapping a **train** sounds its
  horn. Everything on screen answers to a finger.

---

## 5. Sound and words

Everything routes through the existing pre‑rendered, cached one‑shots — no new
audio machinery, no live oscillators.

| Event | Sound |
| --- | --- |
| Button press | short square beep, 660 Hz |
| Ignored press | low buzz, 150 Hz |
| Doors moving | filtered noise hiss |
| Car moving | one looping low‑noise buffer, started on departure, stopped on arrival |
| Arrival | two‑tone gong, 1046 then 784 Hz |
| Train arriving / leaving | rumble (low noise) + the platform gong |
| Delivered | rising triangle blip and a *"Danke!"* |

Spoken lines, German first, English on the English setting — same
`sayAnnouncement()` the train screen uses:

| Moment | German | English |
| --- | --- | --- |
| Arrive at 1 | Eins. U‑Bahn. | One. Subway. |
| Arrive at 2 | Zwei. S‑Bahn. | Two. City rail. |
| Arrive at 3 | Drei. Ausgang und Geschäfte. | Three. Exit and shops. |
| Doors closing | Zurückbleiben bitte! | Stand back please! |
| Train arriving | Einfahrt. Bitte zurückbleiben. | Train arriving. Stand back. |
| Delivered | Danke schön! | Thank you! |
| Tap a person | Eins / Zwei / Drei | One / Two / Three |

---

## 6. How it looks: paper cutout

Everything on screen is a piece of cut paper laid on another piece of cut
paper. It is the same grammar the trains are drawn in, pushed further:

* **Hard cast shadows.** Every piece drops a solid `2px 3px` ink shadow with
  no blur — the shadow a paper shape makes on the sheet under it, not a
  render.
* **Layers you can count.** Each room is a coloured sheet, a lighter sheet
  laid over it and cut slightly short at the top, then the floor slab, then
  the scenery, then the people. Nothing is a gradient pretending to be depth.
* **Nothing is quite square.** Signs sit at −1.4°, the awning at +1°, badges
  at −4°. Hand‑placed, not machine‑aligned.
* **Fat ink outlines** on every cut edge, and soft corner radii on the things
  that would be cut with scissors — awnings, tags, shoulders, speech
  bubbles — while the architecture stays straight.
* **People are paper dolls**: head, body, two arms, two legs, each its own
  piece with its own outline and shadow, walking on a hard two‑frame leg
  swap rather than a smooth tween.
* **Mounts instead of glows.** A cream paper card behind a badge or a sign is
  how something gets emphasis here — no bloom, no gradient halos.

## 7. How it gets built

Still one file, no build step, no external assets, same drawing grammar as the
trains: absolutely‑positioned `div`s, flat fills, thick ink outlines. The DOS
feeling comes from keeping everything on a coarse grid, using hard two‑frame
animation instead of smooth easing for the walkers, and letting the whole
station be visible at once.

| Piece | Approach |
| --- | --- |
| Station | Three floor rooms in a column plus a shaft column, laid out once per resize into a `FLOORS` geometry table (y of each floor's ground line, in stage px) |
| Car | One `div` in the shaft, `translateY` to the target floor's y, ease‑in‑out; two leaf doors, `translateX` |
| People | One `div` each — head, body, two legs, badge. Position by `translate`, animation state stepped in the existing rAF loop |
| Trains | One `div` per platform, sliding in from the right and back out; the U‑Bahn and S‑Bahn liveries lifted from `TRAIN_SETS` |
| Console | The train screen's `.controlCard`, `.lit` state, and door glyphs |
| Loop | The same single rAF, started in `go()`, cancelled on leaving the screen and by the parent timer |

Rough size: ~180 lines of CSS, ~300 of JS. Bigger than the first sketch of this
screen, because there are now actors in it, but still the smallest kind of
simulation — a handful of `div`s with a five‑state machine each.

Home menu gets an eighth tile (`t8`, 🛗, `data-go="lift"`), and TRAIN gives up
its full‑width row so the two share the last one.

---

## 8. Deliberately not in it

* **A score, a timer, angry passengers.** Nothing here can be lost.
* **Real lift logic** — call buttons on each floor, direction commitment,
  queued stops. Correct, and the opposite of legible for a two‑year‑old.
* **Walking the people yourself.** They walk on their own; the lift is the only
  thing you drive, which is what makes the one control scheme enough.
* **More than three floors.** Three fits the screen at a readable size and
  keeps the badges to 1, 2, 3.
