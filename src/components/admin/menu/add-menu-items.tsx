"use client";

import { useActionState } from "react";
import { addMenuItem } from "@/app/nemesis/ui/actions";
import type { PageOption } from "@/lib/admin/data";
import type { AdminFormState } from "@/lib/admin/form";
import { MENU_TITLE_MAX, menuLocationLabel } from "@/lib/menu-config";
import type { Category, MenuLocation } from "@/lib/types";
import { useFormToast } from "@/components/admin/flash-toast";
import { CheckboxField, SubmitButton } from "@/components/admin/form-bits";
import { Section } from "@/components/admin/ui";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";

/**
 * "Add to menu" panel: a page, a category or a custom link. Each form posts to the same Server
 * Action, which appends the item to the end of the current menu and comes back with a toast.
 * Pages / categories that are already in this menu are left out of the pickers.
 */
export function AddMenuItems({
  location,
  pages,
  categories,
  totalPages,
  totalCategories,
}: {
  location: MenuLocation;
  pages: PageOption[];
  categories: Category[];
  totalPages: number;
  totalCategories: number;
}) {
  const [pageState, pageAction] = useActionState<AdminFormState, FormData>(addMenuItem, null);
  const [categoryState, categoryAction] = useActionState<AdminFormState, FormData>(addMenuItem, null);
  const [linkState, linkAction] = useActionState<AdminFormState, FormData>(addMenuItem, null);
  useFormToast(pageState);
  useFormToast(categoryState);
  useFormToast(linkState);
  const link = linkState?.values ?? {};
  const linkErr = linkState?.fieldErrors ?? {};
  const label = menuLocationLabel(location).toLowerCase();

  return (
    <Section title="Add to menu" description={`New items join the end of the ${label}.`} className="lg:sticky lg:top-20" data-testid="menu-add">
      <div className="space-y-5">
        {/* ── Pages ─────────────────────────────────────────────────────── */}
        <form action={pageAction} className="space-y-2" noValidate>
          <input type="hidden" name="location" value={location} />
          <input type="hidden" name="kind" value="page" />
          <Field data-invalid={Boolean(pageState?.fieldErrors?.page_id) || undefined}>
            <FieldLabel htmlFor="menu-page">Page</FieldLabel>
            <div className="flex gap-2">
              <Select name="page_id" aria-label="Page" placeholder={pages.length ? "Choose a page" : totalPages ? "All pages are in this menu" : "No pages yet"} isDisabled={pages.length === 0} className="min-w-0 flex-1">
                <SelectTrigger id="menu-page" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {pages.map((p) => (
                    <SelectItem key={p.id} id={p.id} textValue={p.title}>
                      <span className="truncate">{p.title}</span>
                      {p.status !== "published" && <span className="ml-1 text-xs text-muted-foreground">(draft)</span>}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <SubmitButton variant="outline" pendingLabel="Adding…" className="shrink-0" disabled={pages.length === 0}>
                Add
              </SubmitButton>
            </div>
            <FieldError>{pageState?.fieldErrors?.page_id}</FieldError>
          </Field>
        </form>

        <Separator />

        {/* ── Categories ────────────────────────────────────────────────── */}
        <form action={categoryAction} className="space-y-2" noValidate>
          <input type="hidden" name="location" value={location} />
          <input type="hidden" name="kind" value="category" />
          <Field data-invalid={Boolean(categoryState?.fieldErrors?.category_id) || undefined}>
            <FieldLabel htmlFor="menu-category">Category</FieldLabel>
            <div className="flex gap-2">
              <Select
                name="category_id"
                aria-label="Category"
                placeholder={categories.length ? "Choose a category" : totalCategories ? "All categories are in this menu" : "No categories yet"}
                isDisabled={categories.length === 0}
                className="min-w-0 flex-1"
              >
                <SelectTrigger id="menu-category" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {categories.map((c) => (
                    <SelectItem key={c.id} id={c.id} textValue={c.name}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <SubmitButton variant="outline" pendingLabel="Adding…" className="shrink-0" disabled={categories.length === 0}>
                Add
              </SubmitButton>
            </div>
            <FieldError>{categoryState?.fieldErrors?.category_id}</FieldError>
          </Field>
        </form>

        <Separator />

        {/* ── Custom link ───────────────────────────────────────────────── */}
        <form action={linkAction} className="space-y-3" noValidate>
          <input type="hidden" name="location" value={location} />
          <input type="hidden" name="kind" value="custom" />
          <Field data-invalid={Boolean(linkErr.title) || undefined}>
            <FieldLabel htmlFor="menu-link-title">Custom link · text</FieldLabel>
            <Input id="menu-link-title" name="title" maxLength={MENU_TITLE_MAX} placeholder="e.g. Help centre" defaultValue={link.title ?? ""} aria-invalid={Boolean(linkErr.title) || undefined} />
            <FieldError>{linkErr.title}</FieldError>
          </Field>
          <Field data-invalid={Boolean(linkErr.url) || undefined}>
            <FieldLabel htmlFor="menu-link-url">URL</FieldLabel>
            <Input id="menu-link-url" name="url" inputMode="url" placeholder="https://example.com or /about" defaultValue={link.url ?? ""} aria-invalid={Boolean(linkErr.url) || undefined} />
            <FieldError>{linkErr.url}</FieldError>
          </Field>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <CheckboxField id="menu-link-new-tab" name="open_in_new_tab" label="Open in a new tab" defaultChecked={link.open_in_new_tab === "on"} />
            <SubmitButton variant="outline" pendingLabel="Adding…">
              Add link
            </SubmitButton>
          </div>
        </form>
      </div>
    </Section>
  );
}
