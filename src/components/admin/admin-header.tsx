"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { ExternalLinkIcon, SparklesIcon } from "lucide-react";
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage } from "@/components/ui/breadcrumb";
import { Button, LinkButton } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { ThemeToggle } from "@/components/theme-toggle";
import { useNemesisAi } from "./ai/ai-context";
import { ADMIN_NAV } from "./app-sidebar";

/** Sticky top bar of the dashboard: sidebar toggle, breadcrumb, theme + "view store". */
export function AdminHeader({ bell }: { bell?: ReactNode }) {
  const pathname = usePathname();
  const { setOpen: setAiOpen } = useNemesisAi();
  const section = ADMIN_NAV.find((n) => (n.exact ? pathname === n.href : pathname.startsWith(n.href.split("?")[0])));
  // a nav href may carry a query (?tab=extra) – the root of the section is still its path
  const isSectionRoot = section ? pathname === section.href.split("?")[0] : false;

  return (
    <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-2 border-b bg-background/80 px-4 backdrop-blur md:rounded-t-xl">
      <SidebarTrigger className="-ml-1" />
      <Separator orientation="vertical" className="mr-2 data-[orientation=vertical]:h-4" />
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>{section && section.exact ? <BreadcrumbPage>Dashboard</BreadcrumbPage> : <BreadcrumbLink href="/nemesis">Dashboard</BreadcrumbLink>}</BreadcrumbItem>
          {section && !section.exact && (
            <BreadcrumbItem>{isSectionRoot ? <BreadcrumbPage>{section.label}</BreadcrumbPage> : <BreadcrumbLink href={section.href}>{section.label}</BreadcrumbLink>}</BreadcrumbItem>
          )}
          {section && !section.exact && !isSectionRoot && (
            <BreadcrumbItem>
              <BreadcrumbPage>{pathname.endsWith("/new") ? "New" : "Details"}</BreadcrumbPage>
            </BreadcrumbItem>
          )}
        </BreadcrumbList>
      </Breadcrumb>
      <div className="ml-auto flex items-center gap-1">
        <Button
          variant="outline"
          size="sm"
          onPress={() => setAiOpen(true)}
          className="gap-1.5 border-primary/30 bg-primary/[0.04] hover:bg-primary/10"
          data-testid="header-nemesis-ai-trigger"
        >
          <SparklesIcon className="size-3.5 text-primary" />
          <span className="hidden sm:inline">Nemesis AI</span>
          <kbd className="hidden rounded border bg-muted px-1 py-0.2 font-mono text-[10px] text-muted-foreground md:inline">
            ⌘K
          </kbd>
        </Button>
        {bell}
        <LinkButton href="/" target="_blank" variant="ghost" size="sm" className="hidden sm:inline-flex">
          <ExternalLinkIcon /> View store
        </LinkButton>
        <ThemeToggle />
      </div>
    </header>
  );
}
