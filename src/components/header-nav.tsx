"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ChevronDownIcon, ExternalLinkIcon } from "lucide-react";
import type { MenuLink } from "@/lib/menu";
import { buttonVariants } from "@/components/ui/button-variants";
import { cn } from "@/lib/utils";
import { NavLink } from "./nav-link";

function HeaderDropdownItem({ item }: { item: MenuLink }) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hoverOpenedAtRef = useRef<number>(0);

  function clearCloseTimer() {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }

  function handleMouseEnter() {
    clearCloseTimer();
    if (!open) {
      hoverOpenedAtRef.current = Date.now();
      setOpen(true);
    }
  }

  function handleMouseLeave() {
    clearCloseTimer();
    closeTimerRef.current = setTimeout(() => {
      setOpen(false);
    }, 150);
  }

  function handleTriggerClick() {
    clearCloseTimer();
    if (!open) {
      setOpen(true);
      return;
    }
    // Avoid immediately closing when a mouse user hovers onto the button and clicks right away
    if (Date.now() - hoverOpenedAtRef.current < 400) {
      return;
    }
    setOpen(false);
  }

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [open]);

  const children = item.children ?? [];
  const hasRealHref = Boolean(item.href && item.href !== "#");

  return (
    <div
      ref={containerRef}
      className="relative"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      data-testid={`header-dropdown-${item.id}`}
    >
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={handleTriggerClick}
        data-testid={`header-dropdown-trigger-${item.id}`}
        className={cn(
          buttonVariants({ variant: "ghost", size: "sm" }),
          "gap-1",
          open && "bg-muted text-foreground",
        )}
      >
        <span>{item.label}</span>
        <ChevronDownIcon
          className={cn(
            "size-3.5 opacity-75 transition-transform duration-200",
            open && "rotate-180",
          )}
          aria-hidden
        />
      </button>

      {open && (
        <div
          role="menu"
          aria-label={item.label}
          data-testid={`header-dropdown-menu-${item.id}`}
          className="absolute top-full left-0 z-50 min-w-56 pt-1.5"
        >
          <div className="overflow-hidden rounded-xl border border-border/80 bg-popover/95 p-1.5 text-popover-foreground shadow-xl ring-1 ring-foreground/5 backdrop-blur-md animate-in fade-in-0 zoom-in-95 duration-150">
            {hasRealHref && (
              <div className="mb-1 border-b border-border/60 pb-1">
                {item.external ? (
                  <a
                    href={item.href}
                    target={item.newTab ? "_blank" : undefined}
                    rel={item.newTab || item.external ? "noreferrer" : undefined}
                    role="menuitem"
                    onClick={() => setOpen(false)}
                    className="flex items-center justify-between gap-2 rounded-lg px-3 py-2 text-xs font-semibold tracking-wider text-primary uppercase transition-colors hover:bg-primary/10"
                  >
                    <span>All {item.label}</span>
                    {item.external && <ExternalLinkIcon className="size-3" aria-hidden />}
                  </a>
                ) : (
                  <Link
                    href={item.href}
                    target={item.newTab ? "_blank" : undefined}
                    rel={item.newTab ? "noreferrer" : undefined}
                    role="menuitem"
                    onClick={() => setOpen(false)}
                    className="flex items-center justify-between gap-2 rounded-lg px-3 py-2 text-xs font-semibold tracking-wider text-primary uppercase transition-colors hover:bg-primary/10"
                  >
                    <span>All {item.label}</span>
                  </Link>
                )}
              </div>
            )}

            <div className="space-y-0.5">
              {children.map((child) => {
                const target = child.newTab ? "_blank" : undefined;
                const rel = child.newTab || child.external ? "noreferrer" : undefined;
                const itemClasses =
                  "flex items-center justify-between gap-2.5 rounded-lg px-3 py-2 text-sm font-medium text-popover-foreground/90 transition-colors hover:bg-primary/10 hover:text-primary focus-visible:bg-primary/10 focus-visible:text-primary outline-none";

                if (child.external) {
                  return (
                    <a
                      key={child.id}
                      href={child.href}
                      target={target}
                      rel={rel}
                      role="menuitem"
                      onClick={() => setOpen(false)}
                      data-testid={`header-dropdown-item-${child.id}`}
                      className={itemClasses}
                    >
                      <span className="truncate">{child.label}</span>
                      <ExternalLinkIcon className="size-3.5 shrink-0 opacity-60" aria-hidden />
                    </a>
                  );
                }

                return (
                  <Link
                    key={child.id}
                    href={child.href}
                    target={target}
                    rel={rel}
                    role="menuitem"
                    onClick={() => setOpen(false)}
                    data-testid={`header-dropdown-item-${child.id}`}
                    className={itemClasses}
                  >
                    <span className="truncate">{child.label}</span>
                  </Link>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export function HeaderNav({ items }: { items: MenuLink[] }) {
  if (items.length === 0) return null;

  return (
    <nav className="hidden items-center gap-1 md:flex" aria-label="Main">
      {items.map((item) =>
        item.children && item.children.length > 0 ? (
          <HeaderDropdownItem key={item.id} item={item} />
        ) : (
          <NavLink
            key={item.id}
            item={item}
            className={buttonVariants({ variant: "ghost", size: "sm" })}
          />
        ),
      )}
    </nav>
  );
}
