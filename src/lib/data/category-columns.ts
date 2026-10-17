import { MEDIA_REF_COLUMNS } from "@/lib/media/shared";

/**
 * Column lists for every `categories` query, newest shape first.
 *
 * Migration 22 (`20261035000000_category_images.sql`) adds the tile picture,
 * migration 23 (`20261036000000_category_icons.sql`) the picked icon and
 * migration 25 (`20261038000000_category_no_icon.sql`) the "Remove icon" switch. A database
 * that has not run the latest one yet simply has no picture / icon: the call
 * sites step down a list instead of failing the page.
 */
export const CATEGORY_COLUMNS = "id, name, slug, sort_order";

/** Migration 22 — the picture behind `image_url` / `image_media_id`. */
export const CATEGORY_IMAGE_COLUMNS = `image_url, image_media_id, image_media:media!categories_image_media_id_fkey(${MEDIA_REF_COLUMNS})`;

/** Migration 23 — the icon id picked in the admin. */
export const CATEGORY_ICON_COLUMN = "icon";

/** Migration 24 — the fill behind that icon (null = the theme primary). */
export const CATEGORY_ICON_COLOR_COLUMN = "icon_color";

/** Migration 25 — the admin's "Remove icon" switch (image-only tiles). */
export const CATEGORY_ICON_DISABLED_COLUMN = "icon_disabled";

/** `suffix` is for extra selects such as `, products(count)`. */
export function categoryColumnSets(suffix = ""): string[] {
  return [
    `${CATEGORY_COLUMNS}, ${CATEGORY_ICON_COLUMN}, ${CATEGORY_ICON_COLOR_COLUMN}, ${CATEGORY_ICON_DISABLED_COLUMN}, ${CATEGORY_IMAGE_COLUMNS}${suffix}`,
    `${CATEGORY_COLUMNS}, ${CATEGORY_ICON_COLUMN}, ${CATEGORY_ICON_COLOR_COLUMN}, ${CATEGORY_IMAGE_COLUMNS}${suffix}`,
    `${CATEGORY_COLUMNS}, ${CATEGORY_ICON_COLUMN}, ${CATEGORY_IMAGE_COLUMNS}${suffix}`,
    `${CATEGORY_COLUMNS}, ${CATEGORY_IMAGE_COLUMNS}${suffix}`,
    `${CATEGORY_COLUMNS}${suffix}`,
  ];
}
