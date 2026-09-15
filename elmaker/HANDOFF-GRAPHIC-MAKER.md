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
- `node audit-geom.mjs` — reachability and touch-target geometry. This one
  reports roughly 89 nits as its baseline; read the diff, not the count.

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
