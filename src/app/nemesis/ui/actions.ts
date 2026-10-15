"use server";

import { updateTag } from "next/cache";
import { redirect } from "next/navigation";
import { MENU_TAG } from "@/lib/menu";
import { MENU_ITEMS_MAX, MENU_TITLE_MAX, isMenuLocation, menuLocationLabel, menuPath, normalizeMenuUrl } from "@/lib/menu-config";
import type { MenuItemKind, MenuLocation } from "@/lib/types";
import { UUID_RE, adminClient, bool, echo, failure, friendlyError, isRedirectError, notice, revalidateStore, str, type AdminFormState } from "@/lib/admin/form";

const KINDS: MenuItemKind[] = ["page", "category", "custom"];

function refreshMenus() {
  updateTag(MENU_TAG); // storefront header + footer (static shell)
  revalidateStore(); // router cache, incl. /nemesis/ui
}

/* ──────────────────────────────────────────────────────────────────────────
 * Add: a page, a category or a custom link – appended to the end of the menu
 * ────────────────────────────────────────────────────────────────────────── */

export async function addMenuItem(_prev: AdminFormState, formData: FormData): Promise<AdminFormState> {
  const values = echo(formData);
  const location = str(formData, "location", 20);
  const kind = str(formData, "kind", 20) as MenuItemKind;
  if (!isMenuLocation(location) || !KINDS.includes(kind)) return { error: "Invalid menu item.", values };
  const label = menuLocationLabel(location).toLowerCase();

  const fieldErrors: Record<string, string> = {};
  let row: { title: string; page_id?: string; category_id?: string; url?: string; open_in_new_tab: boolean } | null = null;

  try {
    const { supabase } = await adminClient();

    if (kind === "page") {
      const pageId = str(formData, "page_id", 40);
      if (!UUID_RE.test(pageId)) return { error: "Choose a page first.", fieldErrors: { page_id: "Choose a page." }, values };
      const { data: page, error } = await supabase.from("pages").select("id, title").eq("id", pageId).maybeSingle();
      if (error) throw error;
      if (!page) return { error: "That page no longer exists.", values };
      row = { title: page.title.slice(0, MENU_TITLE_MAX), page_id: page.id, open_in_new_tab: false };
    } else if (kind === "category") {
      const categoryId = str(formData, "category_id", 40);
      if (!UUID_RE.test(categoryId)) return { error: "Choose a category first.", fieldErrors: { category_id: "Choose a category." }, values };
      const { data: category, error } = await supabase.from("categories").select("id, name").eq("id", categoryId).maybeSingle();
      if (error) throw error;
      if (!category) return { error: "That category no longer exists.", values };
      row = { title: category.name.slice(0, MENU_TITLE_MAX), category_id: category.id, open_in_new_tab: false };
    } else {
      const title = str(formData, "title", MENU_TITLE_MAX + 1);
      const url = normalizeMenuUrl(str(formData, "url", 600));
      if (!title) fieldErrors.title = "Enter the link text.";
      else if (title.length > MENU_TITLE_MAX) fieldErrors.title = `Keep it under ${MENU_TITLE_MAX} characters.`;
      if ("error" in url) fieldErrors.url = url.error;
      if (Object.keys(fieldErrors).length) return { error: "Please fix the highlighted fields.", fieldErrors, values };
      row = { title, url: (url as { url: string }).url, open_in_new_tab: bool(formData, "open_in_new_tab") };
    }

    const { data: existing, error: countError } = await supabase.from("menu_items").select("sort_order").eq("location", location).order("sort_order", { ascending: false });
    if (countError) throw countError;
    if ((existing ?? []).length >= MENU_ITEMS_MAX) return { error: `A menu can hold up to ${MENU_ITEMS_MAX} items.`, values };

    const { error: insertError } = await supabase.from("menu_items").insert({ ...row, location, kind, sort_order: (existing?.[0]?.sort_order ?? -1) + 1 });
    if (insertError) throw insertError;

    refreshMenus();
    redirect(notice(menuPath(location), `"${row.title}" added to the ${label}.`));
  } catch (e) {
    if (isRedirectError(e)) throw e;
    return { error: friendlyError(e), values };
  }
}

/* ──────────────────────────────────────────────────────────────────────────
 * Edit: display text, URL (custom links) and the new-tab flag
 * ────────────────────────────────────────────────────────────────────────── */

export async function updateMenuItem(_prev: AdminFormState, formData: FormData): Promise<AdminFormState> {
  const values = echo(formData);
  const id = str(formData, "id", 40);
  if (!UUID_RE.test(id)) return { error: "Invalid menu item.", values };

  const title = str(formData, "title", MENU_TITLE_MAX + 1);
  const fieldErrors: Record<string, string> = {};
  if (!title) fieldErrors.title = "Enter the link text.";
  else if (title.length > MENU_TITLE_MAX) fieldErrors.title = `Keep it under ${MENU_TITLE_MAX} characters.`;

  try {
    const { supabase } = await adminClient();
    const { data: item, error } = await supabase.from("menu_items").select("id, kind").eq("id", id).maybeSingle();
    if (error) throw error;
    if (!item) return { error: "That menu item no longer exists – the list has been refreshed.", values };

    const patch: { title: string; open_in_new_tab: boolean; url?: string } = { title, open_in_new_tab: bool(formData, "open_in_new_tab") };
    if (item.kind === "custom") {
      const url = normalizeMenuUrl(str(formData, "url", 600));
      if ("error" in url) fieldErrors.url = url.error;
      else patch.url = url.url;
    }
    if (Object.keys(fieldErrors).length) return { error: "Please fix the highlighted fields.", fieldErrors, values };

    const { error: updateError } = await supabase.from("menu_items").update(patch).eq("id", id);
    if (updateError) throw updateError;

    refreshMenus();
    return { success: `"${title}" updated.` };
  } catch (e) {
    return { error: friendlyError(e), values };
  }
}

/* ──────────────────────────────────────────────────────────────────────────
 * Remove (the page / category itself is untouched)
 * ────────────────────────────────────────────────────────────────────────── */

export async function deleteMenuItem(formData: FormData): Promise<void> {
  const id = str(formData, "id", 40);
  if (!UUID_RE.test(id)) redirect(failure("/nemesis/ui", "Invalid menu item."));
  let path = "/nemesis/ui";
  try {
    const { supabase } = await adminClient();
    const { data: item, error } = await supabase.from("menu_items").select("id, title, location").eq("id", id).maybeSingle();
    if (error) throw error;
    if (!item) redirect(failure(path, "That menu item no longer exists."));
    path = menuPath(item.location as MenuLocation);

    const { error: deleteError } = await supabase.from("menu_items").delete().eq("id", id);
    if (deleteError) throw deleteError;

    refreshMenus();
    redirect(notice(path, `"${item.title}" removed from the ${menuLocationLabel(item.location as MenuLocation).toLowerCase()}.`));
  } catch (e) {
    if (isRedirectError(e)) throw e;
    redirect(failure(path, friendlyError(e)));
  }
}

/* ──────────────────────────────────────────────────────────────────────────
 * Reorder – every id of one menu in its new order (drag-and-drop in the list)
 * ────────────────────────────────────────────────────────────────────────── */

export async function reorderMenuItems(ids: string[]): Promise<{ error?: string }> {
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > MENU_ITEMS_MAX || !ids.every((id) => typeof id === "string" && UUID_RE.test(id))) {
    return { error: "Invalid menu order." };
  }
  if (new Set(ids).size !== ids.length) return { error: "Invalid menu order." };
  try {
    const { supabase } = await adminClient();
    const { data: existing, error: loadError } = await supabase.from("menu_items").select("id, location").in("id", ids);
    if (loadError) throw loadError;
    const rows = existing ?? [];
    if (rows.length !== ids.length || new Set(rows.map((r) => r.location)).size !== 1) {
      return { error: "The menu changed in the meantime – the list has been refreshed." };
    }

    const results = await Promise.all(ids.map((id, index) => supabase.from("menu_items").update({ sort_order: index }).eq("id", id)));
    const failed = results.find((r) => r.error);
    if (failed?.error) throw failed.error;

    refreshMenus();
    return {};
  } catch (e) {
    return { error: friendlyError(e) };
  }
}
