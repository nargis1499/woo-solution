"use client";

import { useCallback, useState, useTransition, type ReactNode } from "react";
import { CheckIcon, CopyIcon, FileArchiveIcon, FileAudioIcon, FileIcon, FileImageIcon, FileSpreadsheetIcon, FileTextIcon, FileVideoIcon, PresentationIcon } from "lucide-react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import type { VariantProps } from "class-variance-authority";
import { Button } from "@/components/ui/button";
import type { buttonVariants } from "@/components/ui/button-variants";
import { Spinner } from "@/components/ui/spinner";
import { Tooltip, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { formatLabel, mediaPreviewUrl, mediaUrl } from "@/lib/media/shared";
import type { MediaItem, MediaRef, MediaUsage, MediaVariantName } from "@/lib/types";

/* ─── Icons per type ──────────────────────────────────────────────────────── */

type IconKind = "image" | "video" | "audio" | "sheet" | "slides" | "archive" | "text" | "file";

function iconKind(mime: string, name: string): IconKind {
  const m = mime.toLowerCase();
  if (m.startsWith("image/")) return "image";
  if (m.startsWith("video/")) return "video";
  if (m.startsWith("audio/")) return "audio";
  if (/spreadsheet|excel|csv/.test(m) || /\.(xlsx?|csv)$/i.test(name)) return "sheet";
  if (/presentation|powerpoint/.test(m) || /\.pptx?$/i.test(name)) return "slides";
  if (/zip|compressed|tar|7z|rar/.test(m) || /\.(zip|7z|rar|tar|gz)$/i.test(name)) return "archive";
  if (m.startsWith("text/") || /pdf|msword|wordprocessing|rtf|epub/.test(m)) return "text";
  return "file";
}

/** Lucide icon matching a file type (used wherever there is no thumbnail). */
export function FileTypeIcon({ mime, name, className, strokeWidth }: { mime: string; name: string; className?: string; strokeWidth?: number }) {
  switch (iconKind(mime, name)) {
    case "image":
      return <FileImageIcon className={className} strokeWidth={strokeWidth} />;
    case "video":
      return <FileVideoIcon className={className} strokeWidth={strokeWidth} />;
    case "audio":
      return <FileAudioIcon className={className} strokeWidth={strokeWidth} />;
    case "sheet":
      return <FileSpreadsheetIcon className={className} strokeWidth={strokeWidth} />;
    case "slides":
      return <PresentationIcon className={className} strokeWidth={strokeWidth} />;
    case "archive":
      return <FileArchiveIcon className={className} strokeWidth={strokeWidth} />;
    case "text":
      return <FileTextIcon className={className} strokeWidth={strokeWidth} />;
    default:
      return <FileIcon className={className} strokeWidth={strokeWidth} />;
  }
}

/** Square tile: image thumbnail or a type icon + extension label. */
export function MediaThumb({
  item,
  className,
  variant = "thumbnail",
  rounded = "rounded-md",
}: {
  item: MediaRef;
  className?: string;
  variant?: MediaVariantName;
  rounded?: string;
}) {
  const src = mediaPreviewUrl(item, variant);
  return (
    <div className={cn("relative grid shrink-0 place-items-center overflow-hidden bg-muted text-muted-foreground", rounded, className)} aria-hidden>
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover" />
      ) : (
        <div className="flex flex-col items-center gap-1">
          <FileTypeIcon mime={item.mime_type} name={item.name} className="size-7" strokeWidth={1.5} />
          <span className="text-[10px] font-semibold tracking-wide uppercase">{formatLabel(item.mime_type, item.name)}</span>
        </div>
      )}
    </div>
  );
}

/* ─── Clipboard / download helpers ────────────────────────────────────────── */

export function useCopy() {
  const [copied, setCopied] = useState(false);
  const copy = useCallback(async (text: string, label = "URL copied.") => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // older browsers / insecure contexts – fall back to a hidden textarea
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
    }
    setCopied(true);
    toast.success(label);
    window.setTimeout(() => setCopied(false), 1500);
  }, []);
  return { copied, copy };
}

export function CopyUrlButton({ item, size = "icon-sm", variant = "ghost", label = "Copy URL", className }: { item: MediaItem; size?: "icon-sm" | "icon-xs" | "sm" | "default"; variant?: "ghost" | "outline" | "secondary"; label?: string; className?: string }) {
  const { copied, copy } = useCopy();
  const iconOnly = size.startsWith("icon");
  return (
    <TooltipTrigger delay={300}>
      <Button variant={variant} size={size} aria-label={label} className={className} onPress={() => copy(mediaUrl(item.path))}>
        {copied ? <CheckIcon /> : <CopyIcon />}
        {!iconOnly && (copied ? "Copied" : label)}
      </Button>
      <Tooltip>{label}</Tooltip>
    </TooltipTrigger>
  );
}

/** One id → the file itself; several → a zip. */
export function downloadHref(ids: string | string[]): string {
  const list = Array.isArray(ids) ? ids : [ids];
  return list.length === 1 ? `/nemesis/media/download?id=${list[0]}` : `/nemesis/media/download?ids=${list.join(",")}`;
}

/** Navigates to an attachment URL without leaving the page. */
export function triggerDownload(href: string) {
  const a = document.createElement("a");
  a.href = href;
  a.rel = "noopener";
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  window.setTimeout(() => a.remove(), 1000);
}

export function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.round(diff / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days} d ago`;
  return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export function dimensionsOf(item: Pick<MediaItem, "width" | "height">): string | null {
  return item.width && item.height ? `${item.width} × ${item.height}` : null;
}

/* ─── usage ────────────────────────────────────────────────────────────────── */

/** "Used in 2 products" – products are counted once even when a file is both main image and gallery. */
/** "Used in 2 products · favicon" – products are counted once even when a file is main image *and* in the gallery. */
export function usageLabel(rows: MediaUsage[] | undefined): string | null {
  if (!rows?.length) return null;
  const parts: string[] = [];
  const products = new Set(rows.filter((r) => !isPageUsage(r)).map((r) => r.product_id).filter(Boolean)).size;
  const pages = new Set(rows.filter(isPageUsage).map((r) => r.product_id).filter(Boolean)).size;
  if (products) parts.push(`${products} product${products === 1 ? "" : "s"}`);
  if (pages) parts.push(`${pages} page${pages === 1 ? "" : "s"}`);
  if (rows.some((r) => r.role === "favicon")) parts.push("site favicon");
  if (rows.some((r) => r.role === "share_image")) parts.push("social share image");
  return `Used in ${parts.join(" · ")}`;
}

/** `page_*` rows carry the page id / title in the `product_*` columns. */
export const isPageUsage = (u: MediaUsage) => u.role.startsWith("page_");

/** Admin link for a usage row (product form, page editor or the settings tab). */
export function usageHref(u: MediaUsage): string {
  if (u.role === "favicon") return "/nemesis/settings";
  if (u.role === "share_image") return "/nemesis/settings?tab=seo";
  return isPageUsage(u) ? `/nemesis/pages/${u.product_id}` : `/nemesis/products/${u.product_id}`;
}

export const USAGE_ROLE_LABEL: Record<MediaUsage["role"], string> = {
  image: "main image",
  gallery: "gallery",
  favicon: "Site favicon",
  share_image: "Social share image",
  page_image: "featured image",
  page_share_image: "share image",
  page_content: "in the content",
};

/* ─── confirm button (AlertDialog) ─────────────────────────────────────────── */

export function ConfirmButton({
  label,
  title,
  description,
  confirmLabel = "Delete",
  pendingLabel = "Working…",
  onConfirm,
  variant = "destructive",
  size = "sm",
  icon,
  isDisabled,
  className,
  tone = "destructive",
}: {
  label: ReactNode;
  title: string;
  description: ReactNode;
  confirmLabel?: string;
  pendingLabel?: string;
  onConfirm: () => Promise<unknown> | unknown;
  variant?: VariantProps<typeof buttonVariants>["variant"];
  size?: VariantProps<typeof buttonVariants>["size"];
  icon?: ReactNode;
  isDisabled?: boolean;
  className?: string;
  tone?: "destructive" | "default";
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  function confirm() {
    startTransition(async () => {
      await onConfirm();
      setOpen(false);
    });
  }
  return (
    <AlertDialogTrigger isOpen={open} onOpenChange={setOpen}>
      <Button variant={variant} size={size} isDisabled={isDisabled} className={className}>
        {icon}
        {label}
      </Button>
      <AlertDialog isDismissable={!pending}>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel isDisabled={pending}>Cancel</AlertDialogCancel>
          <Button variant={tone === "destructive" ? "destructive" : "default"} onPress={confirm} isPending={pending} aria-busy={pending}>
            {pending && <Spinner />}
            {pending ? pendingLabel : confirmLabel}
          </Button>
        </AlertDialogFooter>
      </AlertDialog>
    </AlertDialogTrigger>
  );
}
