"use client";

import { createElement, startTransition, useActionState, useId, useState } from "react";
import {
  DndContext,
  MouseSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { restrictToVerticalAxis } from "@dnd-kit/modifiers";
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  ExternalLinkIcon,
  Gamepad2Icon,
  GripVerticalIcon,
  HeadphonesIcon,
  LaptopIcon,
  LayoutGridIcon,
  ListIcon,
  SmartphoneIcon,
  type LucideIcon,
} from "lucide-react";
import { updateHomeSections, type AdminFormState } from "@/app/nemesis/actions";
import { CATEGORY_ICON_BY_ID, DEFAULT_CATEGORY_ICON } from "@/lib/category-icons";
import { FREE_SHIPPING_THRESHOLD_MICROS } from "@/lib/config";
import {
  DEFAULT_HOME_HERO_BADGE,
  DEFAULT_HOME_HERO_PRIMARY_CTA_HREF,
  DEFAULT_HOME_HERO_PRIMARY_CTA_TEXT,
  DEFAULT_HOME_HERO_SECONDARY_CTA_HREF,
  DEFAULT_HOME_HERO_SECONDARY_CTA_TEXT,
  defaultHomeHeroSubtitle,
  defaultHomeHeroTitle,
  HOME_CATEGORY_BANNER_STYLES,
  HOME_CATEGORY_LIMIT_OPTIONS,
  HOME_FILTER_TITLE_MAX,
  HOME_FILTER_TITLE_PLACEHOLDER,
  HOME_HERO_BADGE_MAX,
  HOME_HERO_CTA_HREF_MAX,
  HOME_HERO_CTA_TEXT_MAX,
  HOME_HERO_SUBTITLE_MAX,
  HOME_HERO_TITLE_MAX,
  HOME_SECTIONS,
  resolveHomeCategorySections,
} from "@/lib/home-sections";
import { formatMoney, moneyFromSettings } from "@/lib/money";
import type {
  Category,
  HomeCategoryBannerStyle,
  HomeCategoryDisplayMode,
  HomeCategorySectionConfig,
  SiteSettings,
} from "@/lib/types";
import { useFormToast } from "@/components/admin/flash-toast";
import { SubmitButton, SwitchRow } from "@/components/admin/form-bits";
import { buttonVariants } from "@/components/ui/button-variants";
import { Card, CardContent, CardDescription, CardTitle } from "@/components/ui/card";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

function categoryIconFor(category: Category): LucideIcon {
  if (category.icon && CATEGORY_ICON_BY_ID[category.icon]) {
    return CATEGORY_ICON_BY_ID[category.icon];
  }
  const slug = category.slug.toLowerCase();
  if (slug.includes("laptop") || slug.includes("computer")) return LaptopIcon;
  if (slug.includes("mobile") || slug.includes("phone")) return SmartphoneIcon;
  if (slug.includes("electr") || slug.includes("audio")) return HeadphonesIcon;
  if (slug.includes("gam") || slug.includes("access")) return Gamepad2Icon;
  return DEFAULT_CATEGORY_ICON;
}

function CategoryRowIcon({ category }: { category: Category }) {
  return createElement(categoryIconFor(category), {
    className: "size-5",
    "aria-hidden": true,
  });
}

type CategorySectionRow = HomeCategorySectionConfig & { category: Category };

function SortableCategorySectionRow({
  row,
  sectionBadge,
  onUpdate,
}: {
  row: CategorySectionRow;
  sectionBadge: string;
  onUpdate: (
    categoryId: string,
    patch: Partial<{
      enabled: boolean;
      limit: number;
      layout: HomeCategoryDisplayMode;
      banner_style: HomeCategoryBannerStyle;
    }>,
  ) => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: row.category_id });
  const { "aria-describedby": dndGeneratedId, ...dndAttributes } = attributes;
  void dndGeneratedId;

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Translate.toString(transform),
        transition,
      }}
      data-dragging={isDragging || undefined}
      data-testid={`home-category-row-${row.category.slug}`}
      className={cn(
        "flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card/70 px-3.5 py-3 transition-shadow select-none",
        isDragging &&
          "relative z-20 border-primary bg-card shadow-lg ring-2 ring-primary/30",
        !row.enabled && "opacity-60",
      )}
    >
      {/* Left: Drag Handle + Icon + Category Name + Section Badge (draggable area) */}
      <div
        {...dndAttributes}
        {...listeners}
        data-drag-handle={row.category_id}
        className="flex min-w-0 flex-1 cursor-grab touch-none items-center gap-3 active:cursor-grabbing"
      >
        <span
          className="text-muted-foreground/70 transition-colors hover:text-foreground"
          title="Drag to reorder"
          aria-hidden
        >
          <GripVerticalIcon className="size-4" />
        </span>
        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary/15 text-primary">
          <CategoryRowIcon category={row.category} />
        </span>
        <div className="flex flex-wrap items-center gap-2.5">
          <span className="text-sm font-bold text-foreground sm:text-base">
            {row.category.name}
          </span>
          <span className="inline-flex items-center rounded-full border border-border/80 bg-muted/60 px-2.5 py-0.5 text-[11px] font-medium text-muted-foreground">
            {sectionBadge}
          </span>
        </div>
      </div>

      {/* Right: Per-category Banner Style + Products limit dropdown + List/Grid toggle + Enable Switch */}
      <div className="flex flex-wrap items-center gap-2.5 sm:gap-3">
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-muted-foreground">Banner:</span>
          <Select
            selectedKey={row.banner_style}
            onSelectionChange={(key) =>
              onUpdate(row.category_id, {
                banner_style: String(key) as HomeCategoryBannerStyle,
              })
            }
            aria-label={`${row.category.name} banner background style`}
          >
            <SelectTrigger
              className="h-8 w-44 text-xs"
              data-testid={`home-category-banner-style-${row.category.slug}`}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {HOME_CATEGORY_BANNER_STYLES.map((style) => (
                <SelectItem key={style.id} id={style.id}>
                  {style.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center gap-1.5">
          <span className="text-xs text-muted-foreground">Products:</span>
          <Select
            selectedKey={String(row.limit)}
            onSelectionChange={(key) =>
              onUpdate(row.category_id, {
                limit: Number(key),
              })
            }
            aria-label={`${row.category.name} product limit`}
          >
            <SelectTrigger
              className="h-8 w-32 text-xs"
              data-testid={`home-category-limit-${row.category.slug}`}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {HOME_CATEGORY_LIMIT_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} id={String(opt.value)}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Per-category List / Grid View Toggle */}
        <div
          className="inline-flex items-center rounded-lg border bg-muted/30 p-0.5"
          role="group"
          aria-label={`${row.category.name} display view`}
        >
          <button
            type="button"
            onClick={() => onUpdate(row.category_id, { layout: "list" })}
            aria-pressed={row.layout === "list"}
            data-testid={`home-category-view-list-${row.category.slug}`}
            className={cn(
              "inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-xs font-semibold transition-all",
              row.layout === "list"
                ? "bg-primary text-primary-foreground shadow-2xs"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <ListIcon className="size-3.5" /> List
          </button>
          <button
            type="button"
            onClick={() => onUpdate(row.category_id, { layout: "grid" })}
            aria-pressed={row.layout === "grid"}
            data-testid={`home-category-view-grid-${row.category.slug}`}
            className={cn(
              "inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-xs font-semibold transition-all",
              row.layout === "grid"
                ? "bg-primary text-primary-foreground shadow-2xs"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <LayoutGridIcon className="size-3.5" /> Grid
          </button>
        </div>

        <Switch
          aria-label={`Show ${row.category.name} section on home page`}
          isSelected={row.enabled}
          onChange={(checked) => onUpdate(row.category_id, { enabled: checked })}
          data-testid={`home-category-toggle-${row.category.slug}`}
        />
      </div>
    </div>
  );
}

/**
 * UI → Home page: one switch per storefront home section (in storefront order),
 * dynamic Hero section fields, Category Product Showcase controls (default layout,
 * default banner background style, independent drag-and-drop section order, item limits,
 * per-category banner style, List/Grid view, and visibility toggles), and the heading of
 * the filtered-products section.
 */
export function HomeSectionsForm({
  settings,
  categories = [],
}: {
  settings: SiteSettings;
  categories?: Category[];
}) {
  const [state, dispatch, isPending] = useActionState<AdminFormState, FormData>(
    updateHomeSections,
    null,
  );
  useFormToast(state);
  const v = state?.values ?? {};
  const err = state?.fieldErrors ?? {};

  const dndId = useId();
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 5 } }),
  );

  const fallbackTitle = defaultHomeHeroTitle(settings.store_name);
  const fallbackSubtitle = defaultHomeHeroSubtitle(
    formatMoney(FREE_SHIPPING_THRESHOLD_MICROS, moneyFromSettings(settings)),
  );

  const [defaultLayout, setDefaultLayout] = useState<HomeCategoryDisplayMode>(
    settings.home_category_default_layout ?? "grid",
  );
  const [bannerStyle, setBannerStyle] = useState<HomeCategoryBannerStyle>(
    settings.home_category_banner_style ?? "soft",
  );
  const [categoryRows, setCategoryRows] = useState(() =>
    resolveHomeCategorySections(
      categories,
      settings.home_category_sections ?? [],
      settings.home_category_default_layout ?? "grid",
      settings.home_category_banner_style ?? "soft",
    ),
  );

  function handleDefaultLayoutChange(nextLayout: HomeCategoryDisplayMode) {
    setDefaultLayout(nextLayout);
    setCategoryRows((rows) => rows.map((r) => ({ ...r, layout: nextLayout })));
  }

  function handleDefaultBannerStyleChange(nextStyle: HomeCategoryBannerStyle) {
    setBannerStyle(nextStyle);
    setCategoryRows((rows) =>
      rows.map((r) => ({ ...r, banner_style: nextStyle })),
    );
  }

  function updateCategoryRow(
    categoryId: string,
    patch: Partial<{
      enabled: boolean;
      limit: number;
      layout: HomeCategoryDisplayMode;
      banner_style: HomeCategoryBannerStyle;
    }>,
  ) {
    setCategoryRows((rows) =>
      rows.map((r) => (r.category_id === categoryId ? { ...r, ...patch } : r)),
    );
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setCategoryRows((rows) => {
      const oldIndex = rows.findIndex((r) => r.category_id === String(active.id));
      const newIndex = rows.findIndex((r) => r.category_id === String(over.id));
      if (oldIndex < 0 || newIndex < 0 || oldIndex === newIndex) return rows;
      return arrayMove(rows, oldIndex, newIndex);
    });
  }

  const serializedSections = JSON.stringify(
    categoryRows.map(({ category_id, enabled, limit, layout, banner_style }) => ({
      category_id,
      enabled,
      limit,
      layout,
      banner_style,
    })),
  );

  return (
    <form
      noValidate
      onSubmit={(e) => {
        if (e.target !== e.currentTarget) return;
        e.preventDefault();
        const formData = new FormData(e.currentTarget);
        startTransition(() => dispatch(formData));
      }}
    >
      <Card className="gap-0 overflow-visible py-0">
        <div
          className="sticky top-14 z-20 rounded-t-xl border-b bg-card/95 px-6 py-5 backdrop-blur supports-[backdrop-filter]:bg-card/85"
          data-testid="home-sections-sticky-header"
        >
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="space-y-1">
              <CardTitle className="text-xl font-bold tracking-tight">
                Home page sections
              </CardTitle>
              <CardDescription>
                Switch a section off and visitors no longer see it. Changes go live immediately.
              </CardDescription>
            </div>
            <div className="flex flex-wrap items-center gap-2.5">
              <SubmitButton pendingLabel="Saving…" pending={isPending}>
                Save changes
              </SubmitButton>
              <a
                href="/"
                target="_blank"
                rel="noreferrer"
                className={buttonVariants({ variant: "outline", size: "default" })}
              >
                View home page <ExternalLinkIcon />
              </a>
            </div>
          </div>
          {state?.error && (
            <div className="mt-2">
              <FieldError>{state.error}</FieldError>
            </div>
          )}
        </div>

        <CardContent className="space-y-3 pt-5 pb-6" data-testid="home-sections">
          <input
            type="hidden"
            name="home_category_default_layout"
            value={defaultLayout}
          />
          <input
            type="hidden"
            name="home_category_banner_style"
            value={bannerStyle}
          />
          <input
            type="hidden"
            name="home_category_sections_json"
            value={serializedSections}
          />

          {HOME_SECTIONS.map((section) => (
            <SwitchRow
              key={section.id}
              id={section.id}
              name={section.id}
              label={section.label}
              description={section.description}
              defaultSelected={settings[section.id]}
            >
              {section.id === "home_show_hero" && (
                <div className="space-y-4" data-testid="home-hero-fields">
                  <div className="grid gap-4 sm:grid-cols-[220px_1fr]">
                    <Field data-invalid={Boolean(err.home_hero_badge) || undefined}>
                      <FieldLabel htmlFor="home_hero_badge">Badge text</FieldLabel>
                      <Input
                        id="home_hero_badge"
                        name="home_hero_badge"
                        maxLength={HOME_HERO_BADGE_MAX}
                        placeholder={DEFAULT_HOME_HERO_BADGE}
                        defaultValue={v.home_hero_badge ?? settings.home_hero_badge ?? ""}
                        aria-invalid={Boolean(err.home_hero_badge) || undefined}
                      />
                      <FieldError>{err.home_hero_badge}</FieldError>
                    </Field>

                    <Field data-invalid={Boolean(err.home_hero_title) || undefined}>
                      <FieldLabel htmlFor="home_hero_title">Hero heading</FieldLabel>
                      <Input
                        id="home_hero_title"
                        name="home_hero_title"
                        maxLength={HOME_HERO_TITLE_MAX}
                        placeholder={fallbackTitle}
                        defaultValue={
                          v.home_hero_title ?? settings.home_hero_title ?? fallbackTitle
                        }
                        aria-invalid={Boolean(err.home_hero_title) || undefined}
                      />
                      <FieldError>{err.home_hero_title}</FieldError>
                    </Field>
                  </div>

                  <Field data-invalid={Boolean(err.home_hero_subtitle) || undefined}>
                    <FieldLabel htmlFor="home_hero_subtitle">Hero description</FieldLabel>
                    <Textarea
                      id="home_hero_subtitle"
                      name="home_hero_subtitle"
                      rows={2}
                      maxLength={HOME_HERO_SUBTITLE_MAX}
                      placeholder={fallbackSubtitle}
                      defaultValue={
                        v.home_hero_subtitle ?? settings.home_hero_subtitle ?? fallbackSubtitle
                      }
                      aria-invalid={Boolean(err.home_hero_subtitle) || undefined}
                    />
                    <FieldError>{err.home_hero_subtitle}</FieldError>
                  </Field>

                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field data-invalid={Boolean(err.home_hero_primary_cta_text) || undefined}>
                      <FieldLabel htmlFor="home_hero_primary_cta_text">
                        Primary button text
                      </FieldLabel>
                      <Input
                        id="home_hero_primary_cta_text"
                        name="home_hero_primary_cta_text"
                        maxLength={HOME_HERO_CTA_TEXT_MAX}
                        placeholder={DEFAULT_HOME_HERO_PRIMARY_CTA_TEXT}
                        defaultValue={
                          v.home_hero_primary_cta_text ??
                          settings.home_hero_primary_cta_text ??
                          ""
                        }
                        aria-invalid={Boolean(err.home_hero_primary_cta_text) || undefined}
                      />
                      <FieldError>{err.home_hero_primary_cta_text}</FieldError>
                    </Field>

                    <Field data-invalid={Boolean(err.home_hero_primary_cta_href) || undefined}>
                      <FieldLabel htmlFor="home_hero_primary_cta_href">
                        Primary button link
                      </FieldLabel>
                      <Input
                        id="home_hero_primary_cta_href"
                        name="home_hero_primary_cta_href"
                        maxLength={HOME_HERO_CTA_HREF_MAX}
                        placeholder={DEFAULT_HOME_HERO_PRIMARY_CTA_HREF}
                        defaultValue={
                          v.home_hero_primary_cta_href ??
                          settings.home_hero_primary_cta_href ??
                          DEFAULT_HOME_HERO_PRIMARY_CTA_HREF
                        }
                        aria-invalid={Boolean(err.home_hero_primary_cta_href) || undefined}
                      />
                      <FieldError>{err.home_hero_primary_cta_href}</FieldError>
                    </Field>
                  </div>

                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field data-invalid={Boolean(err.home_hero_secondary_cta_text) || undefined}>
                      <FieldLabel htmlFor="home_hero_secondary_cta_text">
                        Secondary link text
                      </FieldLabel>
                      <Input
                        id="home_hero_secondary_cta_text"
                        name="home_hero_secondary_cta_text"
                        maxLength={HOME_HERO_CTA_TEXT_MAX}
                        placeholder={DEFAULT_HOME_HERO_SECONDARY_CTA_TEXT}
                        defaultValue={
                          v.home_hero_secondary_cta_text ??
                          settings.home_hero_secondary_cta_text ??
                          ""
                        }
                        aria-invalid={Boolean(err.home_hero_secondary_cta_text) || undefined}
                      />
                      <FieldError>{err.home_hero_secondary_cta_text}</FieldError>
                    </Field>

                    <Field data-invalid={Boolean(err.home_hero_secondary_cta_href) || undefined}>
                      <FieldLabel htmlFor="home_hero_secondary_cta_href">
                        Secondary link URL
                      </FieldLabel>
                      <Input
                        id="home_hero_secondary_cta_href"
                        name="home_hero_secondary_cta_href"
                        maxLength={HOME_HERO_CTA_HREF_MAX}
                        placeholder={DEFAULT_HOME_HERO_SECONDARY_CTA_HREF}
                        defaultValue={
                          v.home_hero_secondary_cta_href ??
                          settings.home_hero_secondary_cta_href ??
                          DEFAULT_HOME_HERO_SECONDARY_CTA_HREF
                        }
                        aria-invalid={Boolean(err.home_hero_secondary_cta_href) || undefined}
                      />
                      <FieldError>{err.home_hero_secondary_cta_href}</FieldError>
                    </Field>
                  </div>
                </div>
              )}

              {section.id === "home_show_category_sections" && (
                <div className="space-y-5" data-testid="home-category-showcase-config">
                  {/* Top controls: Default Display Layout + Default Banner Background Style */}
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field>
                      <FieldLabel>Default Display Layout</FieldLabel>
                      <div className="grid grid-cols-2 gap-2.5">
                        <button
                          type="button"
                          onClick={() => handleDefaultLayoutChange("list")}
                          aria-pressed={defaultLayout === "list"}
                          data-testid="default-layout-list"
                          className={cn(
                            "inline-flex h-10 items-center justify-center gap-2 rounded-lg border px-3 text-xs font-semibold transition-all outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                            defaultLayout === "list"
                              ? "border-primary bg-primary/12 text-primary shadow-2xs"
                              : "border-border bg-background/60 text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                          )}
                        >
                          <ListIcon className="size-4" /> List View
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDefaultLayoutChange("grid")}
                          aria-pressed={defaultLayout === "grid"}
                          data-testid="default-layout-grid"
                          className={cn(
                            "inline-flex h-10 items-center justify-center gap-2 rounded-lg border px-3 text-xs font-semibold transition-all outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                            defaultLayout === "grid"
                              ? "border-primary bg-primary/12 text-primary shadow-2xs"
                              : "border-border bg-background/60 text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                          )}
                        >
                          <LayoutGridIcon className="size-4" /> Grid View
                        </button>
                      </div>
                    </Field>

                    <Field>
                      <FieldLabel htmlFor="home_category_banner_style_select">
                        Default Banner Background Style
                      </FieldLabel>
                      <Select
                        selectedKey={bannerStyle}
                        onSelectionChange={(key) =>
                          handleDefaultBannerStyleChange(
                            String(key) as HomeCategoryBannerStyle,
                          )
                        }
                        aria-label="Default Banner Background Style"
                      >
                        <SelectTrigger
                          id="home_category_banner_style_select"
                          className="h-10 w-full"
                          data-testid="banner-style-select"
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {HOME_CATEGORY_BANNER_STYLES.map((style) => (
                            <SelectItem key={style.id} id={style.id}>
                              {style.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </Field>
                  </div>

                  {/* Per-category reorderable list */}
                  <div className="space-y-3 border-t pt-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-xs font-bold tracking-wider text-muted-foreground uppercase">
                        Manage Category Sections &amp; Item Limits
                      </span>
                      <span className="text-xs text-muted-foreground">
                        Drag handle or cards to reorder sections
                      </span>
                    </div>

                    <DndContext
                      id={dndId}
                      sensors={sensors}
                      collisionDetection={closestCenter}
                      modifiers={[restrictToVerticalAxis]}
                      onDragEnd={handleDragEnd}
                    >
                      <SortableContext
                        items={categoryRows.map((r) => r.category_id)}
                        strategy={verticalListSortingStrategy}
                      >
                        <div
                          className="space-y-2.5"
                          data-testid="home-category-section-rows"
                        >
                          {categoryRows.map((row, idx) => {
                            const enabledOrder = categoryRows
                              .slice(0, idx + 1)
                              .filter((r) => r.enabled).length;
                            const sectionBadge = row.enabled
                              ? `Section ${String(enabledOrder).padStart(2, "0")}`
                              : "Hidden";

                            return (
                              <SortableCategorySectionRow
                                key={row.category_id}
                                row={row}
                                sectionBadge={sectionBadge}
                                onUpdate={updateCategoryRow}
                              />
                            );
                          })}
                        </div>
                      </SortableContext>
                    </DndContext>
                  </div>
                </div>
              )}

              {section.id === "home_show_filter" && (
                <Field data-invalid={Boolean(err.home_filter_title) || undefined}>
                  <FieldLabel htmlFor="home_filter_title">Section title</FieldLabel>
                  <Input
                    id="home_filter_title"
                    name="home_filter_title"
                    maxLength={HOME_FILTER_TITLE_MAX}
                    placeholder={HOME_FILTER_TITLE_PLACEHOLDER}
                    defaultValue={v.home_filter_title ?? settings.home_filter_title ?? ""}
                    aria-invalid={Boolean(err.home_filter_title) || undefined}
                  />
                  <FieldError>{err.home_filter_title}</FieldError>
                </Field>
              )}
            </SwitchRow>
          ))}
        </CardContent>
      </Card>
    </form>
  );
}
