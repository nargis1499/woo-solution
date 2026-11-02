"use client";
import {
  useEffect,
  useRef,
  useState,
  useTransition,
  type CSSProperties,
} from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  CheckIcon,
  RotateCcwIcon,
  SaveIcon,
  TypeIcon,
  ShoppingBagIcon,
  PanelLeftIcon,
  ArrowUpRightIcon,
  LoaderCircleIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Combobox,
  ComboboxContent,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxEmpty,
  useComboboxAnchor,
} from "@/components/ui/combobox";
import {
  DEFAULT_TYPOGRAPHY,
  FONT_NAMES,
  ROLES,
  fontFamily,
  isFontName,
  selectedFonts,
  typographyVariables,
  recoverTypographyDraft,
  type FontName,
  type FontRoles,
  type Typography,
  type TypographyScope,
} from "@/lib/typography/catalog";
import { fontFaceCss } from "@/lib/typography/css";
import { TYPOGRAPHY_SAVED_EVENT } from "@/components/typography/typography-scope";

type SaveAction = (
  changes: Partial<Typography>,
) => Promise<
  { ok: true; typography: Typography } | { ok: false; error: string }
>;
const fonts = FONT_NAMES.map((name) => ({ id: name, name }));
const draftKey = "commerce:typography-draft:v1";
function FontSelect({
  label,
  value,
  onChange,
  onInspect,
  disabled,
}: {
  label: string;
  value: FontName;
  onChange: (font: FontName) => void;
  onInspect: (font: FontName | null) => void;
  disabled: boolean;
}) {
  const anchor = useComboboxAnchor();
  return (
    <div className="space-y-2">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <Combobox<{ id: FontName; name: FontName }>
        aria-label={label}
        defaultItems={fonts}
        selectedKey={value}
        onSelectionChange={(key) => {
          if (isFontName(key)) onChange(key);
        }}
        defaultFilter={(text, input) =>
          text.toLowerCase().includes(input.toLowerCase())
        }
        onOpenChange={(open) => {
          if (!open) onInspect(null);
        }}
        isDisabled={disabled}
        allowsCustomValue={false}
        className="w-full"
      >
        <div ref={anchor} style={{ fontFamily: fontFamily(value) }}>
          <ComboboxInput placeholder="Search 23 fonts…" className="w-full" />
        </div>
        <ComboboxContent anchor={anchor} className="min-w-64">
          <ComboboxList<{ id: FontName; name: FontName }>>
            {(item) => (
              <ComboboxItem
                id={item.id}
                textValue={item.name}
                onHoverStart={() => onInspect(item.id)}
                onFocus={() => onInspect(item.id)}
                style={{ fontFamily: fontFamily(item.id) }}
              >
                {item.name}
              </ComboboxItem>
            )}
          </ComboboxList>
          <ComboboxEmpty>No matching font</ComboboxEmpty>
        </ComboboxContent>
      </Combobox>
    </div>
  );
}
function FontPreview({
  scope,
  roles,
}: {
  scope: TypographyScope;
  roles: FontRoles;
}) {
  const store = scope === "store";
  return (
    <div
      data-typography-preview={scope}
      style={typographyVariables(roles) as CSSProperties}
      className="mt-5 overflow-hidden rounded-xl border bg-background"
    >
      <div className="flex items-center justify-between border-b bg-muted/30 px-4 py-3">
        <span className="text-[10px] font-semibold tracking-[.16em] text-muted-foreground uppercase">
          {store ? "Customer experience" : "Your workspace"}
        </span>
        <span className="flex items-center gap-1.5 text-[10px] text-emerald-600 dark:text-emerald-400">
          <span className="size-1.5 rounded-full bg-emerald-500" />
          Live preview
        </span>
      </div>
      <div className="space-y-4 p-5 sm:p-6">
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
          {store ? (
            <ShoppingBagIcon className="size-3.5" />
          ) : (
            <PanelLeftIcon className="size-3.5" />
          )}
          {store ? "THE EVERYDAY COLLECTION" : "OVERVIEW / YOUR BUSINESS"}
        </div>
        <h3 className="text-3xl leading-tight font-bold tracking-tight">
          {store ? (
            <>
              Good design.
              <br />
              Great first impressions.
            </>
          ) : (
            <>
              A clearer view.
              <br />A better workflow.
            </>
          )}
        </h3>
        <p className="max-w-md text-sm leading-relaxed text-muted-foreground">
          {store
            ? "Thoughtful essentials, made for your everyday. Discover quality products and a shopping experience that feels just right."
            : "Stay focused on what matters. Manage your products, keep track of orders, and move your business forward."}
        </p>
        {!store && (
          <div className="flex items-center justify-between rounded-lg border bg-muted/20 px-3 py-2.5 text-xs">
            <span>Orders this month</span>
            <span className="font-semibold tabular-nums">
              128{" "}
              <span className="ml-2 text-[10px] text-emerald-600 dark:text-emerald-400">
                +12.4%
              </span>
            </span>
          </div>
        )}
        <Button type="button" size="sm" className="gap-2" onPress={() => {}}>
          {store ? "Explore collection" : "View dashboard"}
          <ArrowUpRightIcon className="size-3.5" />
        </Button>
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 border-t px-4 py-2.5 text-[10px] text-muted-foreground">
        <span>Title · {roles.title}</span>
        <span>Body · {roles.body}</span>
        <span>Button · {roles.button}</span>
      </div>
    </div>
  );
}
export function TypographyEditor({
  saved,
  saveAction,
  available = true,
}: {
  saved: Typography;
  saveAction: SaveAction;
  available?: boolean;
}) {
  const [baseline, setBaseline] = useState(saved);
  const [draft, setDraft] = useState(saved);
  const [inspected, setInspected] = useState<FontName | null>(null);
  const [error, setError] = useState("");
  const [busy, start] = useTransition();
  const ready = useRef(false);
  const router = useRouter();
  const dirty = JSON.stringify(draft) !== JSON.stringify(baseline);
  // Recover local unsaved changes after browser back/reload without a database write.
  useEffect(() => {
    try {
      const restored = recoverTypographyDraft(
        saved,
        sessionStorage.getItem(draftKey),
      );
      if (restored)
        queueMicrotask(() => {
          setBaseline(saved);
          setDraft(restored);
        });
    } catch {
      /* storage is optional */
    }
    ready.current = true;
  }, [saved]);
  useEffect(() => {
    if (!ready.current) return;
    try {
      if (dirty)
        sessionStorage.setItem(
          draftKey,
          JSON.stringify({ base: JSON.stringify(baseline), value: draft }),
        );
      else sessionStorage.removeItem(draftKey);
    } catch {
      /* private browsing / full storage */
    }
  }, [draft, baseline, dirty]);
  useEffect(() => {
    if (!dirty) return;
    const unload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    const navigation = (event: MouseEvent) => {
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
        return;
      const link = (event.target as Element)?.closest?.(
        "a[href]",
      ) as HTMLAnchorElement | null;
      if (
        !link ||
        link.target === "_blank" ||
        link.hasAttribute("download") ||
        link.href === location.href ||
        link.getAttribute("href")?.startsWith("#")
      )
        return;
      if (
        !confirm(
          "You have unsaved typography changes. Leave this page? Your draft will be kept in this tab.",
        )
      ) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    window.addEventListener("beforeunload", unload);
    document.addEventListener("click", navigation, true);
    return () => {
      window.removeEventListener("beforeunload", unload);
      document.removeEventListener("click", navigation, true);
    };
  }, [dirty]);
  function save() {
    setError("");
    const changes: Partial<Typography> = {};
    for (const scope of ["store", "admin"] as const)
      if (JSON.stringify(draft[scope]) !== JSON.stringify(baseline[scope]))
        changes[scope] = draft[scope];
    start(async () => {
      try {
        const result = await saveAction(changes);
        if (!result.ok) {
          setError(result.error);
          toast.error(result.error);
          return;
        }
        setBaseline(result.typography);
        setDraft(result.typography);
        window.dispatchEvent(
          new CustomEvent(TYPOGRAPHY_SAVED_EVENT, {
            detail: result.typography,
          }),
        );
        toast.success("Typography saved. Your fonts are now live.");
        router.refresh();
      } catch {
        setError(
          "Could not connect. Your changes have not been lost. Please try again.",
        );
        toast.error("Could not save typography.");
      }
    });
  }
  function reset(scope: TypographyScope) {
    setDraft((prev) => ({
      ...prev,
      [scope]: { ...DEFAULT_TYPOGRAPHY[scope] },
    }));
    setError("");
  }
  const activeFonts = [
    ...new Set([
      ...selectedFonts(draft.store),
      ...selectedFonts(draft.admin),
      ...(inspected ? [inspected] : []),
    ]),
  ];
  return (
    <section
      className="space-y-5"
      aria-label="Typography settings"
      aria-busy={busy}
    >
      <style data-typography-preview-fonts>{fontFaceCss(activeFonts)}</style>
      <div className="sticky top-14 z-20 flex flex-wrap items-center justify-between gap-4 rounded-xl border bg-card/95 p-5 shadow-xs backdrop-blur-sm">
        <div className="flex items-center gap-3">
          <span className="flex size-11 items-center justify-center rounded-xl border border-primary/20 bg-primary/10 text-primary">
            <TypeIcon className="size-5" />
          </span>
          <div>
            <h2 className="text-xl font-semibold tracking-tight">Typography</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Two experiences. Their own personality.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span
            className={`flex items-center gap-1.5 text-xs ${dirty ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground"}`}
          >
            {dirty ? (
              <>
                <span className="size-1.5 rounded-full bg-amber-500" />
                Unsaved changes
              </>
            ) : (
              <>
                <CheckIcon className="size-3.5" />
                All changes saved
              </>
            )}
          </span>
          <Button
            type="button"
            onPress={save}
            isDisabled={!dirty || busy || !available}
            className="gap-2"
          >
            {busy ? (
              <LoaderCircleIcon className="size-4 animate-spin" />
            ) : (
              <SaveIcon className="size-4" />
            )}
            {busy ? "Saving…" : "Save changes"}
          </Button>
        </div>
      </div>
      {!available && (
        <p
          role="alert"
          className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive"
        >
          Database update required: apply migration
          20261059000000_typography.sql before saving. Preview is still
          available.
        </p>
      )}
      {error && (
        <p
          role="alert"
          className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive"
        >
          {error}
        </p>
      )}
      <div className="grid items-start gap-5 xl:grid-cols-2">
        {(["store", "admin"] as const).map((scope) => (
          <article
            key={scope}
            className="rounded-xl border bg-card p-5 sm:p-6"
            aria-label={
              scope === "store"
                ? "Store Typography"
                : "Admin Dashboard Typography"
            }
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="mb-2 flex items-center gap-2 text-primary">
                  {scope === "store" ? (
                    <ShoppingBagIcon className="size-4" />
                  ) : (
                    <PanelLeftIcon className="size-4" />
                  )}
                  <span className="text-[10px] font-semibold tracking-[.15em] uppercase">
                    {scope === "store" ? "Storefront" : "Admin workspace"}
                  </span>
                </div>
                <h3 className="text-lg font-semibold tracking-tight">
                  {scope === "store"
                    ? "Store Typography"
                    : "Admin Dashboard Typography"}
                </h3>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onPress={() => reset(scope)}
                isDisabled={busy}
                aria-label={`Reset ${scope} typography to defaults`}
                className="gap-1.5 text-xs text-muted-foreground"
              >
                <RotateCcwIcon className="size-3.5" />
                Reset defaults
              </Button>
            </div>
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
              {scope === "store"
                ? "Set the tone across your shop, product pages, and checkout."
                : "Make your dashboard comfortable, clear, and distinctly yours."}
            </p>
            <div className="mt-5 grid gap-4 sm:grid-cols-3">
              {ROLES.map((role) => (
                <FontSelect
                  key={role}
                  label={`${scope === "store" ? "Store" : "Admin"} ${role.charAt(0).toUpperCase() + role.slice(1)} Font`}
                  value={draft[scope][role]}
                  onChange={(font) => {
                    setDraft((prev) => ({
                      ...prev,
                      [scope]: { ...prev[scope], [role]: font },
                    }));
                    setError("");
                  }}
                  onInspect={setInspected}
                  disabled={busy}
                />
              ))}
            </div>
            <FontPreview scope={scope} roles={draft[scope]} />
            <p className="mt-3 text-[11px] text-muted-foreground">
              {scope === "store"
                ? "Store changes never affect the Admin Dashboard."
                : "Admin changes never affect the customer-facing Store."}
            </p>
          </article>
        ))}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-dashed bg-muted/15 px-5 py-4 text-xs text-muted-foreground">
        <span className="flex items-center gap-2">
          <CheckIcon className="size-3.5 text-emerald-500" />
          Self-hosted fonts · Selected families only · No Google requests
        </span>
        <span>23 font families · Changes stay local until saved</span>
      </div>
    </section>
  );
}
