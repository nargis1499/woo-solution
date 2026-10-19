import Link from "next/link";
import { ExternalLinkIcon, ListIcon } from "lucide-react";
import { deleteMenuItem, reorderMenuItems } from "@/app/nemesis/ui/actions";
import type { PageOption } from "@/lib/admin/data";
import {
  MENU_KIND_LABELS,
  MENU_LOCATIONS,
  menuItemHref,
  menuLocationLabel,
  menuPath,
} from "@/lib/menu-config";
import type { Category, MenuItem, MenuLocation } from "@/lib/types";
import { cn } from "@/lib/utils";
import { DeleteButton } from "@/components/admin/form-bits";
import { DataTable, EmptyState, ToneBadge } from "@/components/admin/ui";
import { buttonVariants } from "@/components/ui/button-variants";
import { AddMenuItems } from "./add-menu-items";
import { HeaderMenuTree } from "./header-menu-tree";
import { MenuItemEditButton } from "./menu-item-edit";

const KIND_TONE = { page: "blue", category: "brand", custom: "neutral" } as const;

/**
 * UI → Menu: one storefront navigation (header or footer) at a time.
 * Header menu supports drag-and-drop dropdown nesting; Footer menu is a flat drag-and-drop list.
 */
export function MenuEditor({
  location,
  items,
  pages,
  categories,
}: {
  location: MenuLocation;
  items: MenuItem[];
  pages: PageOption[];
  categories: Category[];
}) {
  const current = MENU_LOCATIONS.find((l) => l.id === location) ?? MENU_LOCATIONS[0];
  const label = menuLocationLabel(location).toLowerCase();
  const usedPages = new Set(items.filter((i) => i.kind === "page").map((i) => i.page_id));
  const usedCategories = new Set(
    items.filter((i) => i.kind === "category").map((i) => i.category_id),
  );

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div
          role="group"
          aria-label="Menu location"
          data-testid="menu-location"
          className="inline-flex w-fit items-center gap-1 rounded-lg border bg-muted/40 p-1"
        >
          {MENU_LOCATIONS.map((l) => {
            const active = l.id === location;
            return (
              <Link
                key={l.id}
                href={menuPath(l.id)}
                aria-current={active ? "page" : undefined}
                className={cn(
                  buttonVariants({ variant: active ? "default" : "ghost", size: "sm" }),
                  !active && "text-muted-foreground",
                )}
              >
                {l.label}
              </Link>
            );
          })}
        </div>
        <p className="text-sm text-muted-foreground">{current.hint}</p>
      </div>

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(280px,1fr)_minmax(0,2fr)]">
        <AddMenuItems
          location={location}
          pages={pages.filter((p) => !usedPages.has(p.id))}
          categories={categories.filter((c) => !usedCategories.has(c.id))}
          totalPages={pages.length}
          totalCategories={categories.length}
        />

        <div className="min-w-0 space-y-3" data-testid="menu-items">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-base font-semibold">
              {current.label}{" "}
              <span className="font-normal text-muted-foreground">
                · {items.length === 1 ? "1 item" : `${items.length} items`}
              </span>
            </h2>
            {items.length > 1 && (
              <p className="text-sm text-muted-foreground">
                {location === "header"
                  ? "Drag vertically to reorder, or drop onto a parent / drag right to create a dropdown menu."
                  : "Drag the handle to reorder – the storefront follows immediately."}
              </p>
            )}
          </div>
          {items.length === 0 ? (
            <EmptyState title={`The ${label} is empty`} icon={<ListIcon />}>
              Add pages, categories or custom links from the panel – until then the storefront
              shows no {location} navigation.
            </EmptyState>
          ) : location === "header" ? (
            <HeaderMenuTree initialItems={items} />
          ) : (
            <DataTable
              label={current.label}
              tableClassName="min-w-[560px]"
              columns={[
                { id: "title", label: "Link text", className: "pl-2" },
                { id: "kind", label: "Type" },
                { id: "target", label: "Links to", cellClassName: "text-muted-foreground" },
                {
                  id: "actions",
                  label: "Actions",
                  srOnly: true,
                  align: "right",
                  className: "pr-4",
                },
              ]}
              reorder={{ action: reorderMenuItems, savedMessage: "Menu order saved." }}
              rows={items.map((item) => {
                const href = menuItemHref(item);
                const draft = item.kind === "page" && item.page?.status !== "published";
                return {
                  id: item.id,
                  label: item.title,
                  cells: [
                    <span key="t" className="font-medium">
                      {item.title}
                    </span>,
                    <ToneBadge key="k" tone={KIND_TONE[item.kind]} className="normal-case">
                      {MENU_KIND_LABELS[item.kind]}
                    </ToneBadge>,
                    <span
                      key="h"
                      className="inline-flex max-w-[28ch] flex-wrap items-center gap-x-2 gap-y-1"
                    >
                      {href ? (
                        <a
                          href={href}
                          target="_blank"
                          rel="noreferrer"
                          className="truncate hover:underline"
                        >
                          {href}
                        </a>
                      ) : (
                        <span>—</span>
                      )}
                      {draft && (
                        <ToneBadge tone="amber" className="normal-case">
                          Draft – hidden
                        </ToneBadge>
                      )}
                      {item.open_in_new_tab && (
                        <span
                          className="inline-flex items-center gap-1 text-xs"
                          title="Opens in a new tab"
                        >
                          <ExternalLinkIcon className="size-3.5" aria-hidden />
                          <span className="sr-only">Opens in a new tab</span>
                        </span>
                      )}
                    </span>,
                    <div key="a" className="flex items-center justify-end gap-2">
                      <MenuItemEditButton item={item} href={href} />
                      <DeleteButton
                        action={deleteMenuItem}
                        id={item.id}
                        label="Remove"
                        title={`Remove "${item.title}" from the ${label}?`}
                        description={
                          item.kind === "custom"
                            ? "The link is removed from the menu."
                            : `Only the menu entry is removed – the ${item.kind} itself stays.`
                        }
                      />
                    </div>,
                  ],
                };
              })}
            />
          )}
        </div>
      </div>
    </div>
  );
}
