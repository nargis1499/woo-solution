"use client";

import { useState } from "react";
import { ChevronDownIcon, MenuIcon, ShoppingBag } from "lucide-react";
import { Link } from "react-aria-components";
import type { MenuLink } from "@/lib/menu";
import { Button } from "@/components/ui/button";
import { SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { buttonVariants } from "@/components/ui/button-variants";
import { cn } from "@/lib/utils";

/** Hamburger menu for small screens: the main navigation (including dropdown sub-items) inside a slide-over sheet. */
export function MobileNav({ items, storeName }: { items: MenuLink[]; storeName: string }) {
  const [open, setOpen] = useState(false);
  const [expandedIds, setExpandedIds] = useState<Record<string, boolean>>({});

  function toggleGroup(id: string) {
    setExpandedIds((prev) => ({ ...prev, [id]: !prev[id] }));
  }

  return (
    <SheetTrigger isOpen={open} onOpenChange={setOpen}>
      <Button variant="ghost" size="icon" className="md:hidden" aria-label="Open menu">
        <MenuIcon />
      </Button>
      <SheetContent side="left" className="w-80">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <span className="grid size-7 place-items-center rounded-md bg-primary text-primary-foreground">
              <ShoppingBag className="size-3.5" aria-hidden />
            </span>
            {storeName}
          </SheetTitle>
        </SheetHeader>
        {items.length > 0 && (
          <nav className="flex flex-col gap-1 px-2" aria-label="Main">
            {items.map((item) => {
              const children = item.children ?? [];
              if (children.length === 0) {
                return (
                  <Link
                    key={item.id}
                    href={item.href}
                    target={item.newTab ? "_blank" : undefined}
                    rel={item.newTab || item.external ? "noreferrer" : undefined}
                    onPress={() => setOpen(false)}
                    className={cn(
                      buttonVariants({ variant: "ghost", size: "lg" }),
                      "justify-start text-base",
                    )}
                  >
                    {item.label}
                  </Link>
                );
              }

              const isExpanded = Boolean(expandedIds[item.id]);

              return (
                <div key={item.id} className="space-y-1">
                  <button
                    type="button"
                    aria-expanded={isExpanded}
                    onClick={() => toggleGroup(item.id)}
                    className={cn(
                      buttonVariants({ variant: "ghost", size: "lg" }),
                      "w-full justify-between text-base",
                    )}
                  >
                    <span>{item.label}</span>
                    <ChevronDownIcon
                      className={cn(
                        "size-4 text-muted-foreground transition-transform duration-200",
                        isExpanded && "rotate-180",
                      )}
                      aria-hidden
                    />
                  </button>

                  {isExpanded && (
                    <div className="ml-4 flex flex-col gap-0.5 border-l-2 border-primary/30 pl-3">
                      {item.href && item.href !== "#" && (
                        <Link
                          href={item.href}
                          target={item.newTab ? "_blank" : undefined}
                          rel={item.newTab || item.external ? "noreferrer" : undefined}
                          onPress={() => setOpen(false)}
                          className="rounded-md px-3 py-2 text-xs font-bold tracking-wider text-primary uppercase hover:bg-muted"
                        >
                          All {item.label}
                        </Link>
                      )}
                      {children.map((child) => (
                        <Link
                          key={child.id}
                          href={child.href}
                          target={child.newTab ? "_blank" : undefined}
                          rel={child.newTab || child.external ? "noreferrer" : undefined}
                          onPress={() => setOpen(false)}
                          className="rounded-md px-3 py-2 text-sm font-medium text-foreground/90 transition-colors hover:bg-muted hover:text-primary"
                        >
                          {child.label}
                        </Link>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </nav>
        )}
      </SheetContent>
    </SheetTrigger>
  );
}
