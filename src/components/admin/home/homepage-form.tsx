"use client";

import { useId, useMemo } from "react";
import Link from "next/link";
import { Text, Label } from "react-aria-components";
import {
  ArrowUpRightIcon,
  CheckIcon,
  FileTextIcon,
  HouseIcon,
  LayoutTemplateIcon,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Combobox,
  ComboboxContent,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  useComboboxAnchor,
} from "@/components/ui/combobox";
import type { PageOption } from "@/lib/admin/data";

const DEFAULT_KEY = "default-storefront";
type HomepageChoice = {
  id: string;
  title: string;
  path: string;
  kind: "default" | "page" | "missing";
};

/** Controlled picker: the parent owns the single form, save action and baseline. */
export function HomepagePicker({
  value,
  onChange,
  dirty,
  pending,
  pages,
  available,
}: {
  value: string;
  onChange: (value: string) => void;
  dirty: boolean;
  pending: boolean;
  pages: PageOption[];
  available: boolean;
}) {
  const anchor = useComboboxAnchor();
  const helpId = useId();
  const published = useMemo(
    () => pages.filter((page) => page.status === "published"),
    [pages],
  );
  const missing = Boolean(
    value && !published.some((page) => page.id === value),
  );
  const choices = useMemo<HomepageChoice[]>(
    () => [
      {
        id: DEFAULT_KEY,
        title: "Default storefront",
        path: "/",
        kind: "default",
      },
      ...(missing
        ? [
            {
              id: value,
              title: "Unavailable page",
              path: "Unpublished or deleted",
              kind: "missing" as const,
            },
          ]
        : []),
      ...published.map((page) => ({
        id: page.id,
        title: page.title,
        path: `/${page.slug}`,
        kind: "page" as const,
      })),
    ],
    [published, missing, value],
  );
  const current = choices.find(
    (choice) => choice.id === (value || DEFAULT_KEY),
  )!;
  const ContentIcon = !value ? LayoutTemplateIcon : FileTextIcon;

  return (
    <Card className="gap-0 overflow-visible py-0">
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-4 border-b px-6 py-5">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-primary/20 bg-primary/10 text-primary">
            <HouseIcon className="size-5" />
          </span>
          <div className="space-y-1">
            <CardTitle className="text-lg font-semibold tracking-tight">
              Homepage
            </CardTitle>
            <CardDescription>
              Choose what visitors see when they arrive at your store.
            </CardDescription>
          </div>
        </div>
        <span
          role="status"
          className={`flex items-center gap-1.5 text-xs ${dirty ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground"}`}
        >
          {dirty ? (
            <span className="size-1.5 rounded-full bg-amber-500" />
          ) : (
            <CheckIcon className="size-3.5" />
          )}
          {pending
            ? "Saving…"
            : dirty
              ? "Unsaved changes"
              : "All changes saved"}
        </span>
      </CardHeader>
      <CardContent className="px-6 py-6">
        <div className="space-y-5">
          {/* Only a selected option is submitted, never the search query. */}
          <input type="hidden" name="home_page_id" value={value} />
          <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] lg:gap-8">
            <div className="min-w-0 space-y-2.5">
              <Combobox<HomepageChoice>
                selectedKey={value || DEFAULT_KEY}
                defaultItems={choices}
                disabledKeys={missing ? [value] : []}
                onSelectionChange={(key) => {
                  if (key === DEFAULT_KEY) onChange("");
                  else if (
                    typeof key === "string" &&
                    published.some((page) => page.id === key)
                  )
                    onChange(key);
                }}
                defaultFilter={(text, input) =>
                  text.toLowerCase().includes(input.toLowerCase())
                }
                isDisabled={pending || !available}
                allowsCustomValue={false}
                allowsEmptyCollection
                aria-describedby={helpId}
                className="w-full space-y-2"
              >
                <Label className="text-sm font-medium">Homepage content</Label>
                <div ref={anchor}>
                  <ComboboxInput
                    placeholder="Search pages by name or address…"
                    className="h-11 w-full rounded-lg bg-background"
                    disabled={pending || !available}
                  />
                </div>
                <ComboboxContent
                  anchor={anchor}
                  placement="bottom start"
                  className="max-w-[calc(100vw-2rem)] rounded-xl border border-border shadow-xl ring-0"
                >
                  <ComboboxList<HomepageChoice>
                    className="p-1.5"
                    renderEmptyState={() => (
                      <div className="px-4 py-6 text-center text-sm text-muted-foreground">
                        No published pages match your search.
                      </div>
                    )}
                  >
                    {(choice) => (
                      <ComboboxItem
                        id={choice.id}
                        textValue={`${choice.title} · ${choice.path}`}
                        className="gap-3 rounded-lg py-3 pl-3 data-selected:bg-primary/10"
                      >
                        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border bg-muted/50 text-muted-foreground">
                          {choice.kind === "default" ? (
                            <LayoutTemplateIcon className="size-4" />
                          ) : (
                            <FileTextIcon className="size-4" />
                          )}
                        </span>
                        <span className="min-w-0 flex-1">
                          <Text
                            slot="label"
                            className="block truncate font-medium"
                          >
                            {choice.title}
                          </Text>
                          <Text
                            slot="description"
                            className="mt-0.5 block truncate text-xs text-muted-foreground"
                          >
                            {choice.kind === "default"
                              ? "Built-in sections and product collections"
                              : choice.path}
                          </Text>
                        </span>
                        {choice.kind === "page" && (
                          <span
                            aria-hidden="true"
                            className="shrink-0 rounded-md bg-emerald-500/10 px-2 py-1 text-[10px] font-medium text-emerald-600 dark:text-emerald-400"
                          >
                            Published
                          </span>
                        )}
                      </ComboboxItem>
                    )}
                  </ComboboxList>
                </ComboboxContent>
              </Combobox>
              <p
                id={helpId}
                className="text-xs leading-relaxed text-muted-foreground"
              >
                Search by page title or address. Only published pages are
                available.
              </p>
            </div>
            <div className="min-w-0 rounded-xl border bg-muted/20 p-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <span className="text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">
                  {dirty ? "Selected homepage" : "Current homepage"}
                </span>
                <span className="rounded-md border bg-background px-2 py-0.5 text-xs text-muted-foreground">
                  Shown at <span className="font-mono text-foreground">/</span>
                </span>
              </div>
              <div className="flex items-start gap-3">
                <span className="mt-0.5 text-primary">
                  <ContentIcon className="size-5" />
                </span>
                <div className="min-w-0 space-y-1">
                  <p className="truncate text-sm font-semibold">
                    {current.title}
                  </p>
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    {missing
                      ? "The default storefront is used until this page is published again or replaced."
                      : value
                        ? "Uses this page’s content and SEO. Its original address redirects to your homepage."
                        : "Uses the sections and collections configured below."}
                  </p>
                </div>
              </div>
            </div>
          </div>
          {!available && (
            <p
              role="alert"
              className="rounded-lg border border-destructive/20 bg-destructive/5 p-3 text-sm text-destructive"
            >
              Apply migration 20261060000000_static_homepage.sql to enable this
              setting.
            </p>
          )}
          {missing && (
            <p role="status" className="text-sm text-muted-foreground">
              Select another published page or choose Default storefront to
              restore the built-in homepage.
            </p>
          )}
          <div className="flex flex-wrap items-center justify-between gap-4 border-t pt-5">
            <p className="max-w-md text-xs leading-relaxed text-muted-foreground">
              Changes stay local until saved. Your storefront section settings
              are preserved.
            </p>
            <div className="flex flex-wrap items-center gap-4">
              <Link
                href="/nemesis/pages"
                className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
              >
                Manage pages <ArrowUpRightIcon className="size-3.5" />
              </Link>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
