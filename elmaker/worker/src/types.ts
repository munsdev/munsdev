export interface Env {
  DB: D1Database;
  IMAGES: R2Bucket;
  /** The one shared password. Set with `wrangler secret put GATE_PASSWORD`. */
  GATE_PASSWORD: string;
  /** HMAC key for the session cookie. `wrangler secret put GATE_SECRET`. */
  GATE_SECRET: string;
}

export interface ItemRow {
  id: string;
  ord: number;
  top: string;
  bot: string;
  variant: string;
  align: string;
  image_sha: string | null;
  zoom: number;
  fx: number;
  fy: number;
  scrim: number;
}
