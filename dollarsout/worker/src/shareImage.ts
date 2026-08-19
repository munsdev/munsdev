import { Resvg, initWasm } from "@resvg/resvg-wasm";
// @ts-ignore -- wrangler bundles .wasm imports as a Module per its Workers build support.
import RESVG_WASM from "@resvg/resvg-wasm/index_bg.wasm";
import type { Env } from "./types";

const PALETTE = {
  bg: "#FFD426",
  ink: "#14130F",
  cream: "#FFF6D6",
  white: "#FFFFFF",
  grnSolid: "#00873E",
  purSolid: "#5B2FB3",
  ornSolid: "#C93E0B",
};

export interface ShareCard {
  kind: "claim" | "badge" | "ledger";
  headline: string; // action/badge title or "My DollarsOut ledger"
  subline: string; // e.g. "Badge unlocked" / "Logged" / "Redirected this year"
  moneyLabel?: string | null; // e.g. "€70/yr" -- self-reported, never invented (spec S9)
  whatBroke?: string | null; // verbatim, never embellished (spec S9)
}

const SHARE_TTL_SECONDS = 60 * 60 * 24 * 365;

export async function createShare(env: Env, card: ShareCard): Promise<string> {
  const id = crypto.randomUUID().slice(0, 8);
  await env.COUNTERS.put(`share:${id}`, JSON.stringify(card), { expirationTtl: SHARE_TTL_SECONDS });
  return id;
}

export async function getShare(env: Env, id: string): Promise<ShareCard | null> {
  const raw = await env.COUNTERS.get(`share:${id}`);
  return raw ? JSON.parse(raw) : null;
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function wrapText(text: string, maxCharsPerLine: number): string[] {
  const words = text.split(" ");
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    if ((line + " " + w).trim().length > maxCharsPerLine) {
      if (line) lines.push(line.trim());
      line = w;
    } else {
      line = (line + " " + w).trim();
    }
  }
  if (line) lines.push(line);
  return lines.slice(0, 4);
}

/** Hand-built 1080x1080 SVG card in the locked brand palette -- see spec S2/S9. */
export function buildCardSvg(card: ShareCard): string {
  const headlineLines = wrapText(card.headline, 22);
  const bandY = 660;

  const moneyBlock = card.moneyLabel
    ? `<text x="80" y="${bandY + 90}" font-family="Archivo Black, sans-serif" font-size="72" fill="${PALETTE.ink}">${esc(card.moneyLabel)}</text>
       <text x="80" y="${bandY + 130}" font-family="Archivo, sans-serif" font-size="24" font-weight="700" fill="${PALETTE.ink}" opacity="0.7">SELF-REPORTED, REDIRECTED</text>`
    : "";

  const whatBrokeBlock = card.whatBroke
    ? `<rect x="80" y="${bandY + (card.moneyLabel ? 160 : 20)}" width="920" height="130" rx="16" fill="${PALETTE.white}" stroke="${PALETTE.ink}" stroke-width="4"/>
       <text x="110" y="${bandY + (card.moneyLabel ? 205 : 65)}" font-family="Archivo, sans-serif" font-size="22" font-weight="800" fill="${PALETTE.ink}" opacity="0.6">WHAT BROKE</text>
       <text x="110" y="${bandY + (card.moneyLabel ? 240 : 100)}" font-family="Archivo, sans-serif" font-size="28" font-weight="600" fill="${PALETTE.ink}">${esc(card.whatBroke.slice(0, 70))}</text>`
    : "";

  return `<svg width="1080" height="1080" viewBox="0 0 1080 1080" xmlns="http://www.w3.org/2000/svg">
    <rect width="1080" height="1080" fill="${PALETTE.bg}"/>
    <rect x="24" y="24" width="1032" height="1032" rx="40" fill="none" stroke="${PALETTE.ink}" stroke-width="8"/>
    <text x="80" y="140" font-family="Archivo Black, sans-serif" font-size="48" fill="${PALETTE.ink}">DOLLARSOUT</text>
    <rect x="80" y="170" width="200" height="6" fill="${PALETTE.ornSolid}"/>

    <rect x="80" y="240" width="920" height="8" fill="${PALETTE.ink}" opacity="0"/>
    <text x="80" y="330" font-family="Archivo, sans-serif" font-size="30" font-weight="800" fill="${PALETTE.purSolid}">${esc(card.subline.toUpperCase())}</text>
    ${headlineLines
      .map(
        (line, i) =>
          `<text x="80" y="${400 + i * 84}" font-family="Archivo Black, sans-serif" font-size="72" fill="${PALETTE.ink}">${esc(line)}</text>`
      )
      .join("\n")}

    ${moneyBlock}
    ${whatBrokeBlock}

    <text x="80" y="1010" font-family="Archivo, sans-serif" font-size="26" font-weight="700" fill="${PALETTE.ink}" opacity="0.7">dollarsout.1stand.org</text>
  </svg>`;
}

let wasmReady: Promise<void> | null = null;
function ensureWasm(): Promise<void> {
  if (!wasmReady) {
    wasmReady = initWasm(RESVG_WASM as unknown as WebAssembly.Module);
  }
  return wasmReady;
}

export async function renderCardPng(card: ShareCard): Promise<Uint8Array> {
  await ensureWasm();
  const svg = buildCardSvg(card);
  const resvg = new Resvg(svg, { fitTo: { mode: "width", value: 1080 } });
  const rendered = resvg.render();
  return rendered.asPng();
}
