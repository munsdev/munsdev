#!/usr/bin/env node
/**
 * Pre-generates every spoken phrase in Henry's Arcade as an MP3, using Google
 * Cloud Text-to-Speech (Chirp 3 HD) -- the same engine crap-app uses for its
 * read-aloud feature.
 *
 * WHY THIS EXISTS
 * ---------------
 * The app used to speak through the browser's speechSynthesis API. That API
 * does not render audio: it hands the text to the platform's TTS engine
 * (Google Speech Services on Android), which renders it outside the browser
 * entirely. That means the voice, its quality, and its sample rate are not
 * ours to control or fix from application code -- which is why every previous
 * attempt to clean up the audio graph left the voices sounding exactly the
 * same. They were never in the audio graph.
 *
 * The vocabulary here is fixed and tiny (~61 phrases per language), so the
 * whole thing can be synthesised once, at build time, and shipped as static
 * assets. At runtime the app just plays a decoded buffer: no API key in the
 * client, no network call when a toddler taps a pad, no per-play cost, and it
 * keeps working offline as a PWA.
 *
 * USAGE
 * -----
 *   GOOGLE_CLOUD_TTS_API_KEY=... node tools/gen-voices.mjs
 *
 *   --force            re-synthesise clips that already exist on disk
 *   --only <id>        just one clip id (e.g. --only letter-a)
 *   --lang <en|de>     just one language
 *   --voice <name>     override the manifest voice, for auditioning
 *                      (e.g. --voice Puck, or a full en-US-Chirp3-HD-Puck)
 *   --out <dir>        output root (default: public/voice)
 *   --dry-run          print what would be generated, call nothing
 *
 * Existing files are skipped unless --force, so re-running is free and you can
 * retune a single pronunciation without paying for the whole set again.
 */

import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const MANIFEST = join(HERE, 'voice-manifest.json');
const ENDPOINT = 'https://texttospeech.googleapis.com/v1/text:synthesize';

// Chirp 3 HD is billed per character. Used only to print a rough figure so you
// can see at a glance that a re-run costs nothing worth thinking about.
const USD_PER_MILLION_CHARS = 30;

// Polite parallelism. The whole set is ~120 short requests; four at a time
// finishes in seconds without tripping any rate limit.
const CONCURRENCY = 4;

function parseArgs(argv) {
  const args = { force: false, dryRun: false, only: null, lang: null, voice: null, out: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--force') args.force = true;
    else if (a === '--dry-run') args.dryRun = true;
    else if (a === '--only') args.only = argv[++i];
    else if (a === '--lang') args.lang = argv[++i];
    else if (a === '--voice') args.voice = argv[++i];
    else if (a === '--out') args.out = argv[++i];
    else {
      console.error(`Unknown argument: ${a}`);
      process.exit(2);
    }
  }
  if (args.lang && args.lang !== 'en' && args.lang !== 'de') {
    console.error(`--lang must be "en" or "de", got "${args.lang}"`);
    process.exit(2);
  }
  return args;
}

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Chirp 3 HD rejects pitch and speakingRate -- those knobs fight the model's
 * own prosody -- so audioConfig carries nothing but the encoding. This is the
 * same lesson crap-app's worker/src/tts.ts learned; don't add them back.
 */
async function synthesize(apiKey, { text, languageCode, voice }) {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': apiKey },
    body: JSON.stringify({
      input: { text },
      voice: { languageCode, name: voice },
      audioConfig: { audioEncoding: 'MP3' },
    }),
  });

  if (!res.ok) {
    throw new Error(`TTS ${res.status}: ${(await res.text()).slice(0, 400)}`);
  }

  const { audioContent } = await res.json();
  if (!audioContent) throw new Error('TTS returned no audioContent');
  return Buffer.from(audioContent, 'base64');
}

/** Lets --voice take either a bare name ("Puck") or a full voice id. */
function resolveVoice(override, manifestVoice, languageCode) {
  if (!override) return manifestVoice;
  return override.includes('-') ? override : `${languageCode}-Chirp3-HD-${override}`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const manifest = JSON.parse(await readFile(MANIFEST, 'utf8'));
  const outRoot = args.out ? resolve(args.out) : resolve(HERE, '..', 'public', 'voice');

  // Flatten the manifest into one job per (language, clip).
  const langs = args.lang ? [args.lang] : Object.keys(manifest.locale);
  const jobs = [];
  for (const lang of langs) {
    const languageCode = manifest.locale[lang];
    const voice = resolveVoice(args.voice, manifest.voice[lang], languageCode);
    for (const [id, texts] of Object.entries(manifest.clips)) {
      if (args.only && id !== args.only) continue;
      const text = texts[lang];
      if (!text) {
        console.warn(`! ${lang}/${id} has no text in the manifest — skipping`);
        continue;
      }
      jobs.push({ id, lang, text, languageCode, voice, path: join(outRoot, lang, `${id}.mp3`) });
    }
  }

  if (jobs.length === 0) {
    console.error('Nothing to do — check --only / --lang against the manifest.');
    process.exit(1);
  }

  // Decide what actually needs synthesising before touching the network.
  const todo = [];
  let skipped = 0;
  for (const job of jobs) {
    if (!args.force && (await exists(job.path))) skipped++;
    else todo.push(job);
  }

  const chars = todo.reduce((n, j) => n + j.text.length, 0);
  const cost = (chars / 1_000_000) * USD_PER_MILLION_CHARS;
  console.log(
    `${jobs.length} clip(s) in manifest · ${skipped} already on disk · ${todo.length} to generate\n` +
      `${chars} characters ≈ $${cost.toFixed(4)}\n` +
      `output: ${outRoot}\n`
  );

  if (args.dryRun) {
    for (const j of todo) console.log(`  would write ${j.lang}/${j.id}.mp3  "${j.text}"  [${j.voice}]`);
    return;
  }
  if (todo.length === 0) {
    console.log('Everything is already generated. Use --force to redo it.');
    return;
  }

  const apiKey = process.env.GOOGLE_CLOUD_TTS_API_KEY;
  if (!apiKey) {
    console.error(
      'GOOGLE_CLOUD_TTS_API_KEY is not set.\n' +
        'It is the same key crap-app\'s worker uses. Run:\n' +
        '  GOOGLE_CLOUD_TTS_API_KEY=... node tools/gen-voices.mjs'
    );
    process.exit(1);
  }

  for (const lang of langs) await mkdir(join(outRoot, lang), { recursive: true });

  // Simple worker pool: CONCURRENCY runners pulling off one shared queue.
  const queue = [...todo];
  const failures = [];
  let done = 0;

  async function runner() {
    for (;;) {
      const job = queue.shift();
      if (!job) return;
      try {
        const audio = await synthesize(apiKey, job);
        await writeFile(job.path, audio);
        done++;
        console.log(`  ✓ ${job.lang}/${job.id}.mp3  (${(audio.length / 1024).toFixed(1)} KB)  "${job.text}"`);
      } catch (err) {
        failures.push({ job, err });
        console.error(`  ✗ ${job.lang}/${job.id}  ${err.message}`);
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, runner));

  console.log(`\nGenerated ${done}/${todo.length}.`);
  if (failures.length) {
    console.error(`${failures.length} failed. Re-run to retry just those (finished clips are skipped).`);
    process.exit(1);
  }
  console.log('Listen through them, fix any wrong pronunciation in voice-manifest.json,');
  console.log('then re-run with:  --force --only <id>');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
