"use server";
import { adminClient, expireTag } from "@/lib/admin/form";
import { revalidatePath } from "next/cache";
import { SITE_SETTINGS_TAG } from "@/lib/site-settings";
import {
  validateTypographyChanges,
  type Typography,
} from "@/lib/typography/catalog";
export async function saveTypography(
  input: unknown,
): Promise<
  { ok: true; typography: Typography } | { ok: false; error: string }
> {
  try {
    const { supabase } = await adminClient();
    const changes = validateTypographyChanges(input);
    const { data, error } = await supabase
      .rpc("save_typography", {
        p: changes,
      })
      .abortSignal(AbortSignal.timeout(15000));
    if (error) {
      if (error.code === "PGRST202" || error.code === "42703")
        return {
          ok: false,
          error:
            "Typography needs database migration 20261059000000_typography.sql. Your changes have not been saved.",
        };
      return {
        ok: false,
        error:
          "Could not save typography. Check your permissions or connection and try again. Your edits are still here.",
      };
    }
    const saved = validateTypographyChanges(data);
    if (!saved.store || !saved.admin)
      return {
        ok: false,
        error:
          "The server returned incomplete typography settings. Refresh and try again.",
      };
    expireTag(SITE_SETTINGS_TAG);
    revalidatePath("/", "layout");
    return { ok: true, typography: { store: saved.store, admin: saved.admin } };
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error
          ? error.message
          : "Typography could not be saved.",
    };
  }
}
