# Slime Arcade

A 90s-Nickelodeon-style tap-anything game for toddlers. Four mini-games —
shapes, colors, counting, sounds — in one self-contained HTML page. No build
step, no framework, no external assets (sounds are synthesized with WebAudio).

    public/index.html    the entire game
    wrangler.toml        static-assets Worker, served at henry.muns.dev

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
