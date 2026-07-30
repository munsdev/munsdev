export interface Env {
  SESSIONS: KVNamespace;

  ALLOWED_ORIGIN: string;
  SESSION_COOKIE_DOMAIN: string;

  WEBFLOW_SITE_ID: string;
  WEBFLOW_COLLECTION_ID: string;
  PHOTO_FIELD_SLUG: string;
  DATE_FIELD_SLUG: string;
  STATUS_FIELD_SLUG: string;

  // secrets
  AUTH_PAIRS: string;
  WEBFLOW_API_TOKEN: string;
}
