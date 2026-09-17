# ElectionLog Graphic Maker — handoff

An internal tool for the ElectionLog social team. It makes the campaign's
social graphics: a line of type, an optional photo, the ElectionLog.org mark,
exported as PNGs at three sizes.

Read this before changing anything. Section 4 is the part that will bite you.

---

## 1 — W H A T   T H I S   I S

**One tool, one campaign, one team.**

**SCOPE**
It exists to produce the "X? LOG IT." campaign set and nothing else. It is not
a product, it has no users beyond the team, and it does not need to grow
features for anyone else. Requests to generalise it should be met with a
question about who is asking.

**WHAT IT DOES**
One graphic at a time: a top line, a bottom line, a layout, and an optional
photo. Preview on canvas, and every graphic is made at all three sizes -- 1:1,
4:5, 9:16 -- whether it is saved into a collection or downloaded on the spot
as a zip with a captions.txt alongside.

**WHAT IT NEVER DOES**
No accounts. No analytics. Nothing from a third-party host: `default-src
'none'` and `connect-src 'self'`, set by the Worker and checked by
`csptest.mjs`. A change that needs a new host in the CSP is pulling something
in from outside, and that is the bug.

**WHAT IT USED TO NEVER DO**
It had no server and no network at all, and photos never left the browser.
That was deliberate, and it was given up on purpose: photos could not survive
a reload without a server (this was section 9's first known limitation). Words
and layouts now live in D1, photos in R2, and the whole thing sits behind one
shared password. Everything it talks to is its own origin. There is no offline
copy -- a file you could open from disk would only be a trap, because its
state lives on the server now.

---

## 2 — T H E   F I L E S

**Three sources, one build output, twice.**

**SOURCE (edit these)**
- `shell.html` — the whole UI: markup, CSS, layout, responsive rules. Contains
  two placeholders, `/*FONTS*/` and `/*APP*/`.
- `app.js` — all application logic. Plain script, no modules, no framework.
- `embedded-fonts.css` — five base64 woff2 faces (~100KB). Generated once from
  the npm @fontsource packages archivo-black, archivo, public-sans and
  ibm-plex-mono, renamed to ElectionLog Display / Struct / Body / Mono. You
  will not normally touch this.

**BUILD OUTPUT (never edit this by hand)**
- `worker/src/page.html` — the single-file app, ~215KB, compiled into the
  Worker bundle as a text module. Generated, and not in git.

**THE SERVER**
`worker/` holds the Worker that serves the page, gates it behind the password,
and owns the D1 and R2 bindings. Read `worker/README.md` before changing it.
`worker/schema.sql` is the database; `schema-library.sql` adds the library and
`schema-brands.sql` the `rev` column (and the `brands` table, which nothing
reads any more -- see section 10).

**ONE-OFF SCRIPTS, KEPT AS A RECORD**
`migrate.mjs` brought the editor's 46 lines into the library, `makeorg.mjs`
made the four outreach graphics, and `repair.mjs` cleaned up after test runs
that had been pointed at production. They all drive the app's own save path in
a real browser, which is why the graphics they made are ordinary graphics.
None of them needs running again.

**BUILD**
```
node build.mjs
```
It writes `worker/src/page.html` and nothing else.
It fails loudly if either placeholder is missing. There is no bundler, no npm
build step, no watch mode. Playwright is the only dependency and it is only
for the tests.

**IF ALL YOU HAVE IS page.html**
Stop and get the three source files. Editing the built file works once and
then the next build overwrites it.

---

## 3 — R U N N I N G   A N D   T E S T I N G

**Open the file. That is the whole dev loop.**

**RUN**
```
cd worker && npx wrangler dev --port 8787
```
then open http://127.0.0.1:8787 and enter the password. Opening a file from
disk no longer works: the state is on the server. Local D1 and R2 are
simulated, so nothing you do here touches the real data.

**TESTS** (Playwright, headless Chromium at `/opt/pw-browsers/chromium`)
All of them need `wrangler dev` running first. `testlib.mjs` logs in through
the real gate and wipes the **local** database between runs, so each test
starts empty and the app seeds its 46 lines the way it used to from an empty
localStorage. It generates its own photo fixture; none is committed.
- `node audit-func.mjs` — 46 controls clicked end to end. Expect `FAILURES: 0`
  and `errors: none`. Run this after every change.
- `node test8.mjs` — canvas constancy across five viewports. Every line must
  say `constant: true`.
- `node sweep.mjs` and `node sweep2.mjs` — adversarial: messy input, injection
  strings, 200 items, storage failure, persistence.
- `node csptest.mjs` — reads the CSP off a real response, checks the
  directives, and proves the zip and PNG exports still download under it.
  Exports are what a tightened policy silently breaks.
- `node audit-geom.mjs` — reachability and touch-target geometry. **The
  baseline is 0.** It was 89 when the rail, the list panel and the contact
  sheet were still there; anything above zero now is a regression.
- `node uxaudit.mjs` — drives every control in every state and reports
  anything unreachable, blocked, contradictory or left over. Also 0.
- `node hometest.mjs` — the create flow: home, the photo question, and what
  each answer offers.
- `node savetest.mjs` — save to library end to end, and the revision the
  Worker commits renders through.
- `node libtest.mjs` — the library browser: collections, the design cards,
  the platform bar, all three download paths.

**LOOKING AT IT**
```
node look.mjs            # six viewports -> /tmp/look
node look.mjs ip14 se    # just those two
```
Not a test: it drives the whole arc at each viewport and leaves screenshots
to **look at**. Several things nothing asserts -- a card at the wrong aspect,
a column of empty black, a preview clipped by the size switcher -- were only
ever found by opening these. `prodshot.mjs` is the same idea against the real
library: `SM_BASE=https://socialmaker.muns.dev node prodshot.mjs`.

**WHAT "BROKEN" LOOKS LIKE**
Any `FAIL`, any `errors:` other than `none`, or any `constant: false`.

---

## 4 — T H E   R U L E S   T H A T   L O O K   L I K E   U N T I D Y   C O D E

**Each of these is a bug fix someone had to find twice.**

**RESERVED SPACE IS NOT DEAD SPACE**
`.stage` reserves `--panelw` / `--sheeth` as padding whether or not a panel is
open. That is deliberate: the preview canvas must be measured against a box
that never changes size, or the graphic resizes when a panel opens. Three
separate stale CSS rules have overridden this padding in the past. If you find
yourself writing `body.drawer-open .stage{padding:...}`, you are reintroducing
the bug. `test8.mjs` is what catches it.

**ONE SOURCE OF TRUTH FOR THE PHOTO RECTANGLE**
`photoRect()` is used by both the renderer and the drag handler. Do not compute
photo geometry anywhere else, or dragging will stop matching what is drawn.

**RESOLUTION INDEPENDENCE**
Every dimension in `render()` derives from `W` and `H` via `metrics()`. No
absolute pixel sizes. The same function draws a 1080px export and a 360px
contact-sheet card. A hardcoded pixel value will look fine in the preview and
wrong in the export.

**TEXT SIZE IS AUTOMATIC, ON PURPOSE**
`fitText()` binary-searches the largest size that fits its box. There is no
manual size control and the team did not ask for one. Words never break
mid-word: `wrapLine()` returns one line per hard line, and only splits at a
space when a line exceeds `MAX_CHARS` (32). Automatic hyphenation was built,
hated, and removed. Do not bring it back.

**A KEY IS WRITTEN ONLY WHEN IT APPLIES**
The Darken control is hidden on every layout except Full bleed, because it
only does anything where type sits on the photo. `.drawer .field[hidden]
{display:none}` exists because the label grid rule was defeating the `hidden`
attribute. Removing that line silently resurrects a dead control.

**GOLD CARRIES DARK TEXT, NEVER WHITE**
Brand rule, and the reason the gold band, Split and Slab layouts flip the text
colour.

---

## 5 — H O W   T H E   R E N D E R E R   W O R K S

**One function draws everything, at every size.**

**ENTRY POINT**
`render(ctx, W, H, item, guides)` in `app.js`. `renderTo(canvas, W, H, ...)`
sizes a canvas and calls it. Everything downstream — the preview, the three
saved renders, the quick download — goes through it.

**GEOMETRY**
`metrics(W,H)` returns the margin `M`, the safe areas (the 1080x1920 size holds
240px clear top and bottom so nothing lands under a platform's own buttons),
the logo bar position, and the content band. `m.ch` is the content height and
almost every layout is expressed as a fraction of it.

**LAYOUTS** (seven, `it.variant`)
- `stack` — line above, photo, line below. Falls back to `type` when there is
  no photo, via `effVariant()`.
- `bleed` — full-frame photo, type over it, scrim plus measured contrast floor.
- `band` — photo up top, gold band across the middle carrying the top line.
- `type` — gold rule full width, type on dark.
- `split` — dark upper half, gold lower half, edge to edge.
- `slab` — gold sheet, second line reversed out of a dark block.
- `stamp` — gold rule drawn all the way round, type centred inside.

`TEXT_ONLY` is the set that never takes a photo: `type`, `split`, `slab`,
`stamp`. Adding a text-only layout means adding it to that set, to `VNAME`
(alt text), and to the `#segVariant` buttons in `shell.html`. Miss `VNAME` and
the alt text in captions.txt reads "undefined".

**LEGIBILITY**
`ensureContrast()` samples the pixels that actually landed behind a text block
and darkens that strip until it can be read. It runs regardless of the Darken
slider. It is a floor, not a preference.

---

## 6 — S T A T E   A N D   P E R S I S T E N C E

**One object, one localStorage key, no migrations.**

**STATE**
`S` holds `items`, `sel`, `sizes`, `images`, `pv`, `guides` and `caption`. Each
item is `{id, top, bot, variant, align, img, zoom, fx, fy, scrim}`. `IMG` and
`THUMB` are runtime Maps, not state.

**SAVE**
Words and layouts go to D1; `localStorage` under
`electionlog-graphic-maker-v1` stays on as a write-through cache, so typing is
still instant and a dropped connection costs nothing.

`LAST` holds the items exactly as the server last confirmed them, and a push
sends the diff. Nothing has to remember to mark itself dirty, which is why
there is no `markDirty()` anywhere -- adding one would be reintroducing a
problem this replaced. `LAST` is also the retry queue: it is only updated
after the server accepts, so a failed push resends itself.

Because only changed items go, two people editing different graphics no longer
overwrite each other. Same graphic, same moment, is still last-write-wins.

`flush()` on `pagehide` uses `keepalive` so an edit made inside the 800ms
debounce is not lost when the tab closes. Without it the cache would hold the
edit and the next load would take the server's older copy.

The amber header strip now means the server is unreachable, not that
localStorage is full. Photos are in R2, so the quota is no longer what breaks.

**IMAGES**
Photos are downscaled to 2000px on the longest edge (`MAXPX`). PNG, WebP, GIF
and SVG keep alpha and stay PNG; anything else is re-encoded as JPEG at 0.88.
Re-encoding a transparent image as JPEG turns it black, which is why that check
exists.

They are then content-addressed: the sha256 of the downscaled bytes is the
key, so the same photo on six graphics is one object in R2. The client asks
`/api/have/<sha>` before uploading. A 72px thumbnail is stored alongside, so
opening the app pulls a few KB per photo for the list cards instead of every
2000px original.

`S.images[sha]` is the URL `/img/<sha>`, not a data URL. `decode()` takes
either, which is why the change was small. **Keep the bytes same-origin.**
Serving them from a public R2 domain would taint the export canvas, and
`canvas.toBlob()` would throw and take the whole zip with it.

Deleting a photo detaches it immediately but leaves the bytes in R2 until the
undo toast expires. Deleting first would make undo a re-upload.

**FIRST RUN**
The app opens on home with an empty bench. `GROUPS` still holds the campaign's
46 lines, but nothing in the UI loads them any more: the library holds the
finished versions, and `bench()` in `testlib.mjs` is the only thing that reads
`ALL_LINES` now.

---

## 7 — E X P O R T

**A zip, written by hand, with no compression.**

**THE QUICK DOWNLOAD**
The graphic on the bench, at all three sizes, plus `captions.txt`, in one zip.
There is no size picker: a graphic is made at 1:1, 4:5 and 9:16 or not at all,
which is also what `saveToLibrary()` does. The panel is for a graphic you have
not saved yet -- the library is where finished work is downloaded from, and it
can hand you a folder per platform.

**THE ZIP WRITER**
Hand-rolled, store method only, because PNGs are already compressed. Local file
headers, central directory, EOCD, CRC32 table, DOS time and date. It is ~40
lines and it works. Do not add a compression library to save a few percent.

**CAPTIONS**
`captions.txt` carries, per graphic, the filenames, the caption text and an
image description for alt text. The header says plainly that nothing in it is
approved copy.

**THE DEFAULT CAPTION**
`S.caption` currently reads "Site opens shortly. Bookmark it now:
electionlog.org". Someone has to change that when the site actually launches.
It is editable in the Export panel.

---

## 8 — D E P L O Y

**One Worker, one command.**

```
node build.mjs                    # writes worker/src/page.html
cd worker && npx wrangler deploy
```

**HEADERS**
The Worker sets noindex, nosniff, frame-deny, no-referrer, a permissions
policy and the CSP on every response. `csptest.mjs` checks them against a real
response and proves exports still download. If a change needs a new host in
the CSP, that is a signal the change is pulling something in from outside,
which this tool still does not do.

**THE PASSWORD**
`GATE_PASSWORD` and `GATE_SECRET` are Worker secrets, never in the bundle and
never in `wrangler.toml`. `worker/README.md` says what the gate does and,
plainly, what it does not.

**ROBOTS**
`robots.txt` disallows everything and every response carries
`X-Robots-Tag: noindex`. This is an internal tool and should not be indexed.

---

## 9 — K N O W N   L I M I T A T I O N S ,   P R E C I S E L Y

- **320px-wide screens scroll sideways by 192px.** A 320x568 screen (original
  iPhone SE) is too short for the bottom-sheet layout and too narrow for the
  side-panel layout it falls back to, so both fail. 375px-wide phones are fine.
  Not fixed because no one on the team uses one.
- **Two people editing the same graphic is last-write-wins.** Different
  graphics are safe; the same one at the same moment is not. There is no
  merge and no conflict warning. Fine for a team of a few, and the thing to
  revisit first if that stops being true.
- **The tool is useless without the network.** That is the deliberate trade
  for photos that survive a reload. There is no offline copy by design.
- **One shared password, no revocation.** It stops discovery and casual use.
  It is not access control -- see `worker/README.md`.
- **Undo is one step, via the toast.** Dismiss the toast and the removal is
  final. There is no history.
- **`audit-geom.mjs`'s baseline is 0, and `uxaudit.mjs`'s is 0.** Anything
  above zero is a regression, not a baseline to compare against.
- **Alt text is generated, not written.** It describes the layout and repeats
  the words. It is a starting point for whoever posts, not finished copy.
- **`embedded-fonts.css` has no regeneration script.** If a font ever needs
  replacing, the base64 was produced by hand from the npm packages named in
  section 2.
- **Text size cannot be set by hand.** By design, see section 4. The only lever
  is pressing Enter in a Words field to force a line break, which changes the
  wrap and therefore the size it lands on.
- **Nothing here has been used in anger yet.** It has been tested hard but the
  campaign has not run through it.
- **Running a test suite against production writes to production.** The suites
  seed a bench and save graphics; `testlib.mjs` only ever wipes the **local**
  database. Two stray test graphics and four restyled real ones had to be
  cleaned out of the live library afterwards -- see `repair.mjs`, which is the
  record of it. Point tests at `wrangler dev`; `prodshot.mjs` is read-only and
  is the one thing meant for the real site.
- **A graphic can only be re-rendered by a script.** Brand styles were what
  drove it from the UI and they are gone. The Worker still commits renders
  through `rev+1`, so `repair.mjs` shows the shape of it if a re-render is
  ever needed again.


## 1 0 — T H E   L I B R A R Y

**Library > Collections > Graphics. A finished graphic is finished.**

**THE RULE THAT REMOVES THE MACHINERY**
A graphic in the library is never edited again. That single rule is why there
is no version history, no publishes table and no staleness tracking: nothing
can drift from a source it no longer has. Two tables do the whole job:
`collections` and `graphics`.

**THE ROW KEEPS THE RECIPE**
`graphics` stores what a graphic was made from -- words, layout, align, photo,
per-size crops. This is not live state and nothing reads it back into an
editor. It exists so the library can be searched by wording, so alt text can
be written without decoding a PNG, and so a graphic can be re-rendered from
its own description rather than by hand. Delete the recipe and `repair.mjs`
would have had no way to put four graphics back into the house style.

**THE REVISION IS IN THE KEY**
R2 keys are `renders/<id>/<rev>/<size>.png`, served immutable for a year.
That `rev` is not decoration. Without it a re-render overwrites in place and
every browser that already loaded a graphic keeps serving the old bytes until
the cache expires -- the re-render appears to work and silently does nothing.
This was a real bug, shipped and then caught.

A re-render writes `rev+1`, and `/finish` commits the row only after
confirming every size is really in the bucket. The superseded revision is
swept after. So an abandoned one -- closed tab, dropped connection -- is a
no-op: the graphic still points at renders that all exist. Deleting sweeps
every revision, not just the live one. **Do not remove the rev from the key
to tidy it up.** Nothing in the app re-renders today, so every live graphic
sits at rev 1; that is the mechanism being unused, not absent.

**COLOURS ARE ROLES, NOT NAMES**
`B` names `ground`, `on_ground`, `accent`, `on_accent`, `muted`, `bar`,
`on_bar`, `accent_on_bar` and a display face. The renderer asks for "the type
on the accent", never for "gold". Section 4's rule that gold carries dark text
stops being three hardcoded constants at three call sites and becomes a
property of the style that can be checked.

There used to be twenty styles, a brand editor, a contrast gate on the Worker
and ten woff2 faces in R2 to draw them with. **They were taken out**, along
with the restyle-a-collection flow: one house style, and a graphic made here
cannot come out off brand because there is nothing to set. The `brands` table
and `seed-brands.sql` are still in the database and the repo, unread by
anything -- the cheapest possible way to keep the work if it is ever wanted
back. Do not wire them up again without being asked: the point of removing
them was that the tool is not Canva.

**FONTS**
The renderer draws with the display face at weight 400 and nothing else. `FM`
is declared near the top and never reaches an export. The face is embedded in
`embedded-fonts.css`; the ten brand faces and the `/f/<file>.woff2` route that
served them went with the styles.

**SAVING MAKES EVERY SIZE, ALWAYS**
`saveToLibrary()` renders 1:1, 4:5 and 9:16, uploads each, then calls
`/finish`. The row only points at the new renders once the Worker has
confirmed every one is really in the bucket, so a save that dies halfway
leaves nothing half-finished in the library. There is no size picker anywhere
and `S.sizes` no longer exists: the preview switcher under the graphic only
chooses which size you are **looking at**.

`savetest.mjs` drives the whole flow in a real browser and is the test to
run after touching any of it.

**TAP THE WORDS TO CHANGE THEM**
There is no Words tab. `drawFit()` returns the rectangle it actually painted
into and `render()` leaves both on the preview context as `ctx.__rects`;
`hitText()` tests a pointer against them with a fingertip's worth of padding,
and a hit opens `#p-text` on that line alone, focused, with a dashed marker
over the type on the canvas. Making a graphic drops you straight into the top
line.

Three things that look incidental and are not:
- The hit test runs **before** the photo drag in the same `pointerdown`.
  Full bleed puts type on the photo, and it is the layout people reach for:
  without this, tapping the headline pans the picture.
- The handler calls `preventDefault()`. Otherwise the press completes, the
  page takes focus back, and the field is focused and blurred in the same
  gesture -- it looks like the keyboard opens and typing goes nowhere.
- The stage's click handler closes an open panel when you click empty stage.
  A tap on the words is a click on the canvas, so `tappedText` tells it to
  leave this one alone.
Hit-testing the *layout box* rather than the painted rectangle would swallow
half the canvas: the box a line is fitted into is several times the height of
the type that lands in it.

**THE DELETE ON A PHOTO IS ONLY EVER ON ONE PHOTO**
The thumbnail strip used to carry a red × on every thumbnail, over 42px
pictures. On a phone that is a row of tripwires -- reported from the field as
"the thumbnails are too tiny and I accidentally click the X". Thumbnails are
56px on a phone and 64px elsewhere, and the × is rendered only on the photo
the graphic is actually using. Undo still catches a real mis-tap; the point is
that there is now one delete on screen instead of seven.

**ONE GRAPHIC AT A TIME**
The app opens on `#home`: make one, or browse. Making one asks whether it
uses a photo before anything else, and that answer decides which layouts you
are offered -- `PHOTO_VARIANTS` or `TEXT_ONLY`. That is also what stops
anyone reaching `effVariant()`'s stack-with-no-photo fallback by accident.

Saving clears the bench. A finished graphic is finished, and leaving it open
would invite edits that change nothing in the library.

`audit-geom`'s baseline is **0**. Most of the original 89 was the rail, the
List panel and the contact sheet; all three are now gone from the code as
well as the screen.

**THE LIBRARY BROWSES DESIGNS, NOT FILES**
A card is a graphic at the shape it was composed in -- 4:5, the one the editor
opens on -- at a fixed aspect, so a collection reads as a wall of designs
rather than a pile of exports. `designSize()` picks that render; the
per-platform files live one level in, on the graphic itself, which is the only
place a shape is a decision anyone makes. Collections carry a `cover`
(`"<graphic id>/<rev>"` for the newest finished graphic, computed in the
collection query) so the shelf has pictures on it without a round trip per
collection.

Two traps in those cards, both already paid for:
- The `<img>` carries `width`/`height` attributes so the browser reserves the
  right box before the PNG arrives. Those map to presentational width and
  height, and **a specified height beats `aspect-ratio`** -- without
  `height:auto` the card renders 1350px tall.
- `drawLibGraphic()` sets `display:block` on the grid to let one graphic fill
  the pane. `drawLib()` puts it back. Miss that and the next screen renders
  its first card at the full width of the window.

**BROWSING**
The library reads finished PNGs straight out of R2 and never re-renders. A
row whose `sizes` is empty is skipped: that is a save that died before its
renders landed, and its PNGs would 404.

**PLATFORMS ARE NOT SIZES**
`PLATFORMS` maps each place you post to the shape it wants. Several share a
shape, so they share the render; only the download duplicates the bytes into
a folder per platform. Do not add a platform folder to R2 -- that would
triple the storage for 9:16 to no purpose.

**PER-SIZE CROPS**
`forSize()` resolves a size's override wherever a size is known. A size with
no override uses the graphic's own crop, which is why `per` stays empty until
somebody tunes one. Choosing a size to tune also switches the preview to it,
because showing a 9:16 crop on a 4:5 preview would be a lie.

**THE HIDDEN ATTRIBUTE NEEDS HELP**
`[hidden]{display:none!important}` near the top of the stylesheet is
load-bearing. The hidden attribute only sets `display:none` at the weakest
specificity there is, so every class that declares its own display -- `.btn`,
`.seg button`, `.chip` -- silently beats it. Without that rule the photo
question sets `.hidden` on four layout buttons and all seven keep showing,
which is exactly how it shipped broken once.

**SEGMENTS ARE FLEX, NOT GRID**
`.seg` was a fixed four-column grid, so hiding a button left a hole. Flex
closes the row up around whatever is visible. Do not put the columns back.

**NO NATIVE DIALOGS**
`alert()`, `confirm()` and `prompt()` block the page, cannot appear over the
library overlay, and look nothing like the rest of this. Use `say()`,
`ask()` and `confirmThat()`. A blocking dialog also makes every other
control appear dead, which is a miserable thing to debug.

**LEGACY STATE HAS NO PHOTO ANSWER**
A graphic saved before the photo question existed has no `S.withPhoto`, so
boot infers it from the graphic itself. Without that, anyone resuming older
work gets all seven layouts and a photo panel on type-only graphics.

**TWO HAZARDS, BOTH ALREADY HANDLED -- DO NOT UNDO THEM**
- `ensurePhoto()` is awaited before every real render. `effVariant()`
  downgrades `stack` to `type` when the `IMG` lookup misses, so rendering
  before the image has decoded produces the wrong layout, with no error, for
  every graphic in a collection. Removing that await reintroduces it.
- `pngBlob()` checks what `toBlob` returned. It falls back to PNG for a type
  it cannot encode without saying so, and `putRender` hardcodes the content
  type, so an unchecked blob would file the wrong bytes under a .png key.
- A render served from `/r/` is `immutable` for a year. Anything asserting a
  superseded revision is gone must fetch with `cache:'no-store'`, or the
  browser answers from its own cache and the assertion proves nothing.

**THE FACE IS EMBEDDED AGAIN, BECAUSE THERE IS ONLY ONE**
The ten brand faces lived in R2 behind `/f/<file>.woff2`, outside the password
gate. Both went with the brand styles. The house faces are base64 in
`embedded-fonts.css` and always were. If a second face ever comes back, note
what the old code had to do: wait for it to load before rendering, because
`fitText()` measures whatever is loaded and a fallback exports type at the
wrong size.
