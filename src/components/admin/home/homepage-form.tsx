"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { saveHomepage } from "@/app/nemesis/ui/homepage-actions";
import { useFormToast } from "@/components/admin/flash-toast";
import { SubmitButton } from "@/components/admin/form-bits";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { PageOption } from "@/lib/admin/data";

export function HomepageForm({
  selected,
  pages,
  available,
}: {
  selected: string | null;
  pages: PageOption[];
  available: boolean;
}) {
  const [state, action, pending] = useActionState(saveHomepage, null);
  const [value, setValue] = useState(selected ?? "");
  useFormToast(state);
  const published = pages.filter((page) => page.status === "published");
  const missing = Boolean(
    value && !published.some((page) => page.id === value),
  );
  return (
    <Card>
      <CardHeader>
        <CardTitle>Homepage</CardTitle>
        <CardDescription>
          Use the default storefront or display a published page directly at
          your store’s main address.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <form action={action} className="space-y-4" aria-busy={pending}>
          <div className="space-y-2">
            <label
              htmlFor="homepage-page"
              className="block text-sm font-medium"
            >
              Homepage content
            </label>
            <select
              id="homepage-page"
              name="home_page_id"
              value={value}
              onChange={(event) => setValue(event.target.value)}
              disabled={pending || !available}
              aria-describedby="homepage-help"
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm disabled:opacity-50"
            >
              <option value="">Default storefront</option>
              {missing && (
                <option value={value} disabled>
                  Selected page is unavailable or unpublished
                </option>
              )}
              {published.map((page) => (
                <option key={page.id} value={page.id}>
                  {page.title} (/{page.slug})
                </option>
              ))}
            </select>
            <p
              id="homepage-help"
              className="text-xs leading-relaxed text-muted-foreground"
            >
              {value
                ? "The page’s content and SEO appear at /. Its original address redirects to /. If unpublished or deleted, the default storefront is shown."
                : "The storefront sections below control the default homepage."}{" "}
              Selections only go live when you save. Both options keep your
              existing section settings.
            </p>
          </div>
          {!available && (
            <p role="alert" className="text-sm text-destructive">
              Apply migration 20261060000000_static_homepage.sql to enable this
              setting.
            </p>
          )}
          {missing && (
            <p role="status" className="text-sm text-muted-foreground">
              The default storefront is currently used. Publish the page again,
              select another, or restore the default.
            </p>
          )}
          {state?.error && (
            <p role="alert" className="text-sm text-destructive">
              {state.error}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-4">
            <SubmitButton pending={pending} disabled={!available || missing}>
              Save homepage
            </SubmitButton>
            <Link
              href="/nemesis/pages"
              className="text-sm text-primary underline-offset-4 hover:underline"
            >
              Manage pages
            </Link>
          </div>
        </form>
        <p className="text-xs text-muted-foreground">
          Static pages use their own SEO title, description, social image and
          indexing preferences. Their homepage canonical URL is always /.
        </p>
      </CardContent>
    </Card>
  );
}
