"use server";

import { revalidatePath } from "next/cache";
import {
  adminClient,
  echo,
  expireTag,
  friendlyError,
  revalidateStore,
  UUID_RE,
  type AdminFormState,
} from "@/lib/admin/form";
import { MENU_TAG } from "@/lib/menu";
import { SITE_SETTINGS_TAG } from "@/lib/site-settings";

export async function saveHomepage(
  _previous: AdminFormState,
  formData: FormData,
): Promise<AdminFormState> {
  const values = echo(formData);
  try {
    const { supabase } = await adminClient();
    const raw = formData.get("home_page_id");
    if (typeof raw !== "string" || (raw !== "" && !UUID_RE.test(raw))) {
      return {
        error: "Choose the default storefront or a published page.",
        values,
      };
    }
    const id = raw || null;
    if (id) {
      const { data, error } = await supabase
        .from("pages")
        .select("id")
        .eq("id", id)
        .eq("status", "published")
        .abortSignal(AbortSignal.timeout(10000))
        .maybeSingle();
      if (error) throw error;
      if (!data)
        return {
          error:
            "That page is no longer published. Select another page or the default storefront.",
          values,
        };
    }
    const { data, error } = await supabase
      .from("site_settings")
      .update({ home_page_id: id })
      .eq("id", 1)
      .select("id")
      .abortSignal(AbortSignal.timeout(10000))
      .maybeSingle();
    if (error) {
      if (error.code === "42703" || error.code === "PGRST204")
        return {
          error:
            "Apply migration 20261060000000_static_homepage.sql before changing the homepage.",
          values,
        };
      throw error;
    }
    if (!data)
      return {
        error:
          "The settings row is missing or you do not have permission to update it.",
        values,
      };
    expireTag(SITE_SETTINGS_TAG);
    expireTag(MENU_TAG);
    revalidateStore();
    revalidatePath("/nemesis/ui");
    return {
      success: id
        ? "Published page set as homepage."
        : "Default storefront restored.",
      values,
    };
  } catch (error) {
    return { error: friendlyError(error), values };
  }
}
