"use client";

import { useState } from "react";
import { MenuIcon, ShoppingBag } from "lucide-react";
import { Link } from "react-aria-components";
import { Button } from "@/components/ui/button";
import { SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { buttonVariants } from "@/components/ui/button-variants";
import { cn } from "@/lib/utils";

/** Hamburger menu for small screens: the main navigation inside a slide-over sheet. */
export function MobileNav({ items, storeName }: { items: { href: string; label: string }[]; storeName: string }) {
  const [open, setOpen] = useState(false);
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
        <nav className="flex flex-col gap-1 px-2" aria-label="Main">
          {items.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              onPress={() => setOpen(false)}
              className={cn(buttonVariants({ variant: "ghost", size: "lg" }), "justify-start text-base")}
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </SheetContent>
    </SheetTrigger>
  );
}
