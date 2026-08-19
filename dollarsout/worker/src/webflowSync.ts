import type { Env } from "./types";
import { listCategories } from "./db";

interface WebflowItemResponse {
  id: string;
  fieldData: {
    name?: string;
    "short-description"?: string;
    "long-description"?: string;
    website?: { url?: string } | string;
  };
}

/**
 * Refreshes each category's copy from its source Webflow Actions CMS item (spec S8: Webflow is
 * the single editable source for this text, this app must never hand-author it). Only the 7
 * category-level fields are synced this way -- the granular sub-actions in content/actions.json
 * are this app's own companion data and are not touched here (see content/README.md).
 */
export async function syncCategoriesFromWebflow(env: Env): Promise<{ updated: number; errors: string[] }> {
  const categories = await listCategories(env);
  let updated = 0;
  const errors: string[] = [];

  for (const category of categories) {
    if (!category.webflowItemId) continue;
    try {
      const resp = await fetch(
        `https://api.webflow.com/v2/collections/${env.WEBFLOW_ACTIONS_COLLECTION_ID}/items/${category.webflowItemId}`,
        { headers: { Authorization: `Bearer ${env.WEBFLOW_API_TOKEN}` } }
      );
      if (!resp.ok) {
        errors.push(`${category.id}: HTTP ${resp.status}`);
        continue;
      }
      const data = (await resp.json()) as WebflowItemResponse;
      const shortDesc = data.fieldData["short-description"] ?? category.shortDescription;
      const longDesc = data.fieldData["long-description"] ?? category.longDescriptionHtml;
      const name = data.fieldData.name ?? category.name;

      await env.DB.prepare(
        "UPDATE categories SET name = ?, short_description = ?, long_description_html = ?, updated_at = datetime('now') WHERE id = ?"
      )
        .bind(name, shortDesc, longDesc, category.id)
        .run();
      updated++;
    } catch (err) {
      errors.push(`${category.id}: ${(err as Error).message}`);
    }
  }

  return { updated, errors };
}
