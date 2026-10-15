"use client";

import { useState } from "react";
import { ArrowLeftIcon, ArrowRightIcon, ImageIcon, ImagesIcon, LinkIcon, PlusIcon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { MAX_PRODUCT_GALLERY as MAX_GALLERY, mediaPreviewUrl, mediaUrl } from "@/lib/media/shared";
import type { MediaItem, MediaRef } from "@/lib/types";
import { MediaThumb } from "./media-bits";
import { MediaPickerDialog } from "./media-picker";

type ImageMode = "keep" | "media" | "url" | "remove";

/**
 * Main image + gallery for the product form. Everything is submitted through
 * hidden inputs so the surrounding `<form action>` stays a plain server-action
 * form:
 *   image_mode      keep | media | url | remove
 *   image_media_id  (media)   library file id
 *   image_url       (url)     external URL
 *   gallery_ids     comma-separated media ids in display order
 */
export function ProductMediaFields({
  currentUrl,
  currentMedia,
  gallery: initialGallery,
  errors = {},
}: {
  /** `products.image_url` as stored (library URL or external). */
  currentUrl: string | null;
  /** Library file behind `currentUrl`, when there is one. */
  currentMedia: MediaRef | null;
  gallery: MediaRef[];
  errors?: Record<string, string | undefined>;
}) {
  const [mode, setMode] = useState<ImageMode>(currentUrl ? "keep" : "remove");
  const [picked, setPicked] = useState<MediaRef | null>(null);
  const [url, setUrl] = useState(currentUrl && !currentMedia ? currentUrl : "");
  const [showUrl, setShowUrl] = useState(false);
  const [gallery, setGallery] = useState<MediaRef[]>(initialGallery);
  const [picker, setPicker] = useState<"main" | "gallery" | null>(null);

  const preview =
    mode === "media" && picked ? (mediaPreviewUrl(picked, "medium") ?? mediaUrl(picked.path))
    : mode === "url" ? url.trim() || null
    : mode === "keep" ? (currentMedia ? (mediaPreviewUrl(currentMedia, "medium") ?? currentUrl) : currentUrl)
    : null;
  const previewAlt = mode === "media" ? (picked?.alt ?? "") : mode === "keep" ? (currentMedia?.alt ?? "") : "";
  const label = mode === "media" && picked ? picked.name : mode === "keep" && currentMedia ? currentMedia.name : mode === "url" && url ? "External URL" : mode === "keep" && currentUrl ? "External URL" : null;

  function setMainImage(items: MediaItem[]) {
    const item = items[0];
    if (!item) return;
    setPicked(item);
    setMode("media");
    setShowUrl(false);
  }
  function addToGallery(items: MediaItem[]) {
    setGallery((prev) => {
      const seen = new Set(prev.map((g) => g.id));
      const next = [...prev];
      for (const it of items) if (!seen.has(it.id) && next.length < MAX_GALLERY) next.push(it);
      return next;
    });
  }
  function move(index: number, delta: -1 | 1) {
    setGallery((prev) => {
      const next = [...prev];
      const j = index + delta;
      if (j < 0 || j >= next.length) return prev;
      [next[index], next[j]] = [next[j], next[index]];
      return next;
    });
  }

  const mainMediaId = mode === "media" ? (picked?.id ?? "") : "";
  const excluded = [...gallery.map((g) => g.id), ...(mainMediaId ? [mainMediaId] : currentMedia && mode === "keep" ? [currentMedia.id] : [])];

  return (
    <>
      <input type="hidden" name="image_mode" value={mode} />
      <input type="hidden" name="image_media_id" value={mainMediaId} />
      {mode !== "url" && <input type="hidden" name="image_url" value="" />}
      <input type="hidden" name="gallery_ids" value={gallery.map((g) => g.id).join(",")} />

      {/* ── main image ─────────────────────────────────────────────────── */}
      <Card data-testid="product-main-image">
        <CardHeader>
          <CardTitle>Image</CardTitle>
          <CardDescription>Shown in listings and as the first picture on the product page.</CardDescription>
        </CardHeader>
        <CardContent className="gap-4">
          <div className="relative aspect-square w-full overflow-hidden rounded-lg border border-dashed bg-muted">
            {preview ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={preview} alt={previewAlt} className="h-full w-full object-cover" data-testid="main-image-preview" />
            ) : (
              <div className="grid h-full place-items-center text-center text-xs text-muted-foreground">
                <span>
                  <ImageIcon className="mx-auto mb-2 size-6" />
                  No image
                </span>
              </div>
            )}
            {preview && (
              <Button
                variant="secondary"
                size="icon-sm"
                className="absolute top-2 right-2 bg-background/90 shadow-sm ring-1 ring-foreground/10"
                aria-label="Remove image"
                onPress={() => {
                  setMode("remove");
                  setPicked(null);
                  setShowUrl(false);
                }}
              >
                <XIcon />
              </Button>
            )}
          </div>
          {label && (
            <p className="truncate text-xs text-muted-foreground" title={label}>
              {label}
            </p>
          )}
          <div className="grid grid-cols-2 gap-2">
            <Button variant="outline" onPress={() => setPicker("main")} data-testid="choose-main-image">
              <ImagesIcon /> {preview ? "Change image" : "Add image"}
            </Button>
            <Button
              variant={mode === "url" ? "secondary" : "outline"}
              onPress={() => {
                setShowUrl((v) => !v);
                if (!showUrl) setMode("url");
                else setMode(currentUrl ? "keep" : "remove");
              }}
              aria-pressed={mode === "url"}
            >
              <LinkIcon /> Use a URL
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">“Add image” lets you upload a new file or select one from the Media Library.</p>
          {(mode === "url" || showUrl) && (
            <Field data-invalid={Boolean(errors.image_url) || undefined}>
              <FieldLabel htmlFor="image_url">Image URL</FieldLabel>
              <Input id="image_url" name="image_url" type="url" placeholder="https://…" value={url} onChange={(e) => setUrl(e.target.value)} aria-invalid={Boolean(errors.image_url) || undefined} />
              <FieldError>{errors.image_url}</FieldError>
            </Field>
          )}
          {errors.image_media_id && <p className="text-sm text-destructive">{errors.image_media_id}</p>}
        </CardContent>
      </Card>

      {/* ── gallery ─────────────────────────────────────────────────────── */}
      <Card data-testid="product-gallery">
        <CardHeader>
          <CardTitle>Gallery</CardTitle>
          <CardDescription>
            Extra pictures for the product page ({gallery.length}/{MAX_GALLERY}).
          </CardDescription>
        </CardHeader>
        <CardContent className="gap-3">
          {gallery.length > 0 && (
            <ul className="grid grid-cols-3 gap-2" aria-label="Gallery images">
              {gallery.map((g, i) => (
                <li key={g.id} className="group relative" data-media-id={g.id}>
                  <MediaThumb item={g} variant="thumbnail" className="aspect-square w-full" rounded="rounded-lg" />
                  <div className="absolute inset-x-1 bottom-1 flex justify-between gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                    <Button variant="secondary" size="icon-xs" aria-label={`Move ${g.name} left`} isDisabled={i === 0} onPress={() => move(i, -1)} className="bg-background/90 shadow-sm">
                      <ArrowLeftIcon />
                    </Button>
                    <Button variant="secondary" size="icon-xs" aria-label={`Move ${g.name} right`} isDisabled={i === gallery.length - 1} onPress={() => move(i, 1)} className="bg-background/90 shadow-sm">
                      <ArrowRightIcon />
                    </Button>
                  </div>
                  <Button
                    variant="secondary"
                    size="icon-xs"
                    aria-label={`Remove ${g.name} from gallery`}
                    className="absolute top-1 right-1 bg-background/90 opacity-0 shadow-sm transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
                    onPress={() => setGallery((prev) => prev.filter((x) => x.id !== g.id))}
                  >
                    <XIcon />
                  </Button>
                </li>
              ))}
            </ul>
          )}
          <Button variant="outline" onPress={() => setPicker("gallery")} isDisabled={gallery.length >= MAX_GALLERY} data-testid="add-gallery-images">
            <PlusIcon /> Add images
          </Button>
          {errors.gallery_ids && <p className="text-sm text-destructive">{errors.gallery_ids}</p>}
        </CardContent>
      </Card>

      <MediaPickerDialog
        isOpen={picker !== null}
        onOpenChange={(open) => !open && setPicker(null)}
        multiple={picker === "gallery"}
        kind="image"
        excludeIds={picker === "gallery" ? excluded : []}
        title={picker === "gallery" ? "Add gallery images" : "Product image"}
        confirmLabel={picker === "gallery" ? undefined : "Use as product image"}
        onSelect={(items) => (picker === "gallery" ? addToGallery(items) : setMainImage(items))}
      />
    </>
  );
}
