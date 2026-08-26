# Henry's Arcade

A 90s-Nickelodeon-style tap-anything game for toddlers. Seven mini-games —
shapes, colors, counting, sounds, letters, draw, train — in one self-contained
HTML page. No build step and no framework. Sound effects are synthesized with
WebAudio; the spoken words are pre-generated MP3s (see Voice clips below).

    public/index.html          the entire game
    public/voice/<lang>/*.mp3  the spoken vocabulary, pre-generated
    tools/voice-manifest.json  every phrase the app says, in both languages
    tools/gen-voices.mjs       generates the MP3s from that manifest
    wrangler.toml              static-assets Worker, served at henry.muns.dev

## Voice clips

The app used to speak through the browser's `speechSynthesis`. That API does
not render audio — it hands the text to the platform's TTS engine (Google
Speech Services on Android), which renders it in another process and plays it
on its own audio path. The voice, its quality and its sample rate are not
reachable from application code, which is why tuning `index.html`'s audio
graph never changed how the voices sounded: they were never in that graph.

So the vocabulary is pre-generated instead, with Google Cloud TTS (Chirp 3 HD,
the same engine `crap-app` uses for read-aloud). It's 61 phrases per language,
about 700 characters total — a couple of cents to synthesize the whole set.
The same voice name exists in both locales, so Henry hears the same person in
English and German, which `speechSynthesis` could never do.

    export GOOGLE_CLOUD_TTS_API_KEY=...      # same key crap-app's worker uses
    node tools/gen-voices.mjs                # writes public/voice/{en,de}/*.mp3

Existing files are skipped, so re-running is free. To retune one pronunciation,
edit its text in `tools/voice-manifest.json` and re-run with
`--force --only <id>`. `--voice Puck` auditions a different Chirp voice,
`--dry-run` shows what would be generated without calling the API.

Commit the generated MP3s — they ship as static assets with the Worker, so
there is no API key in the client, no network call when a pad is tapped, and
it keeps working offline as a PWA.

If a clip is missing, that phrase falls back to `speechSynthesis`, so the app
still talks before the set is generated. The Letters pad's SAY IT button always
uses `speechSynthesis`: it reads whatever word a child typed, which by
definition can't be pre-generated.

## Deploy

Needs a Cloudflare API token with, on this account:

  Account · Workers Scripts · Edit        upload the Worker + its assets
  Account · Account Settings · Read       infer the account ID
  User    · User Details · Read           wrangler whoami
  Zone    · Workers Routes · Edit         attach the custom domain
  Zone    · DNS · Edit                    create the henry.muns.dev record
  Zone    · Zone · Read                   look up the muns.dev zone

Scope Zone Resources to `muns.dev`. Then:

    export CLOUDFLARE_API_TOKEN=...
    npx wrangler deploy

## Local preview

    npx wrangler dev        # or just open public/index.html in a browser
