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
A list of graphics, each one a top line, a bottom line, a layout, and an
optional photo. Preview on canvas, export every graphic at every ticked size
as a zip, with a captions.txt alongside.

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
- `worker/src/page.html` — the single-file app, ~187KB, compiled into the
  Worker bundle as a text module. Generated, and not in git.

**THE SERVER**
`worker/` holds the Worker that serves the page, gates it behind the password,
and owns the D1 and R2 bindings. Read `worker/README.md` before changing it.
`worker/schema.sql` is the database.

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
sizes a canvas and calls it. Everything downstream — preview, list thumbnails,
contact sheet, export — goes through it.

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
An empty store loads all 46 campaign lines from `GROUPS`. Saved work is never
overwritten. The `All 46` button in the list footer and `Load all 46 lines` in
the List panel both append the same set.

---

## 7 — E X P O R T

**A zip, written by hand, with no compression.**

**BATCH**
Renders every item at every ticked size, names files
`01_slug-of-top-line_1080x1350.png` (the numeric prefix exists because two
items with the same words used to overwrite each other in the zip), appends
`captions.txt`, and downloads one zip. 46 graphics at three sizes is about
12MB and takes under three seconds.

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
- **`audit-geom.mjs` reports ~89 issues as its baseline.** They are mostly
  small controls inside panels on phones. The count has not been driven to
  zero and the number alone means nothing; compare against this baseline.
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
- **`migrate.mjs` has not been run against production.** It was rehearsed
  against a local copy of the real rows, 46 of 46. Running it for real is one
  command, and the editor's own rows should be cleared afterwards or the app
  will keep opening on a bench full of graphics that are already filed.
- **A restyle is still one browser tab's work.** It renders and uploads from
  the page that started it, so closing the tab stops it. That is survivable:
  it can be stopped on purpose, and running it again skips whatever already
  carries the new brand, so it resumes rather than starting over.
- **The 45 graphics in the editor are stranded.** They predate the library and
  there is no in-app path to bring them across, because creation is being
  reshaped to one graphic at a time. They need a one-time migration that
  drives the real renderer through headless Chromium. A migration is not a
  feature, so it does not reopen bulk creation.


## 1 0 — T H E   L I B R A R Y   A N D   B R A N D S

**Library > Collections > Graphics. A finished graphic is finished.**

**THE RULE THAT REMOVES THE MACHINERY**
A graphic in the library is never edited again. That single rule is why there
is no version history, no publishes table and no staleness tracking: nothing
can drift from a source it no longer has. Two tables do the whole job,
`collections` and `graphics`, plus `brands`.

**THE ROW KEEPS THE RECIPE**
`graphics` stores what a graphic was made from -- words, layout, align, photo,
per-size crops. This is not live state and nothing reads it back into an
editor. It exists so the library can be searched by wording, so alt text can
be written without decoding a PNG, and -- the reason that matters -- so a
collection can be re-rendered in a different brand. Delete the recipe and a
restyle becomes 46 graphics remade by hand.

**THE REVISION IS IN THE KEY**
R2 keys are `renders/<id>/<rev>/<size>.png`, served immutable for a year.
That `rev` is not decoration. Without it a restyle overwrites in place and
every browser that already loaded a graphic keeps serving the old bytes until
the cache expires -- the restyle appears to work and silently does nothing.
This was a real bug, shipped and then caught.

A restyle writes `rev+1`, and `/finish` commits the row only after confirming
every size is really in the bucket. The superseded revision is swept after.
So an abandoned restyle -- closed tab, dropped connection -- is a no-op: the
graphic still points at renders that all exist. Deleting sweeps every
revision, not just the live one. **Do not remove the rev from the key to tidy
it up.**

**BRANDS ARE ROLES, NOT COLOURS**
A brand names `ground`, `on_ground`, `accent`, `on_accent`, `muted`, `bar`,
`on_bar`, `accent_on_bar` and a display face. The renderer asks for "the type
on the accent", never for "gold". Section 4's rule that gold carries dark text
stops being three hardcoded constants at three call sites and becomes a
property of the brand that can be checked.

Twenty brands are seeded from the site's theme set. Those are *site* themes:
light paper, dark ink, wordmark knocked out of a dark band. The graphics
invert that. Copying tokens across ships `letterpress` with a near-white mark
on the near-white bar -- it renders, it exports, nobody sees it until it is
posted. So roles are derived **by luminance, not by token name**, and each
brand takes whichever polarity gives its accent room to read. That is what
rescues `docket`, `gadsden`, `plain` and `riso`, whose accents are dark
colours meant for light paper.

**THE CONTRAST FLOOR IS 3:1, DELIBERATELY**
A brand edit that drops any of the four pairs below 3:1 is refused, naming
what failed. It is not 4.5:1 because that would reject the house style: the
gold LOG on the near-white mark bar is 1.9:1 and always has been. Every line
goes through `fitText()` and lands as display type at 1080px wide, which is
WCAG large text, where 3:1 is the correct threshold.

**FONTS**
The renderer draws with the display face at weight 400 and nothing else. `FM`
is declared on line 9 and never reaches an export. So a brand costs one woff2
of about 19KB, not the 445KB of all 28 faces. They no longer need base64
inlining either -- that existed only for `file://`, which is gone.

**SAVING**
`saveToLibrary()` renders every size, uploads each, then calls `/finish`.
The row only points at the new renders once the Worker has confirmed every
one is really in the bucket, so a save that dies halfway leaves nothing
half-finished in the library. `restyleGraphic()` is the same path at rev+1.

`savetest.mjs` drives the whole flow in a real browser and is the test to
run after touching any of it.

**ONE GRAPHIC AT A TIME**
The app opens on `#home`: make one, or browse. Making one asks whether it
uses a photo before anything else, and that answer decides which layouts you
are offered -- `PHOTO_VARIANTS` or `TEXT_ONLY`. That is also what stops
anyone reaching `effVariant()`'s stack-with-no-photo fallback by accident.

Saving clears the bench. A finished graphic is finished, and leaving it open
would invite edits that change nothing in the library.

`audit-geom`'s baseline is **12**, not 89. Most of that count was the rail,
the List panel and the contact sheet, and they are gone.

**BRAND STYLES**
`brandview` lists the twenty and edits one: a name, a typeface from the ten
that ship, and the eight colour roles. The preview draws **every layout** in
the draft style, because a colour is only judged properly on the thing it
will produce. Nothing is written until Save, and Save goes through the
Worker's contrast gate -- a refusal comes back naming the pairing that
failed, which is the only reason that gate is worth having.

Editing a style does not touch collections already made in it. Restyling a
collection is what applies it, and that is deliberate: a brand edit should
not silently rewrite 46 finished graphics.

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

**FONTS ARE NOT INLINED ANY MORE**
Ten display faces live in R2 and are served from `/f/<file>.woff2`, immutable.
They sit **outside** the password gate on purpose: they are public typefaces
carrying no campaign content, and a font request made from the login page
would fail if they were behind it. `applyBrand()` awaits the face before
swapping, because `fitText()` measures whatever is loaded and a fallback
would export type at the wrong size.
