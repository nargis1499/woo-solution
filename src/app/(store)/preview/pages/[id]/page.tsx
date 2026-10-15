import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { EyeIcon, PencilIcon } from "lucide-react";
import { adminGetPage } from "@/lib/admin/data";
import { requireAdmin } from "@/lib/admin/auth";
import { NOINDEX } from "@/lib/seo";
import { pageHref } from "@/lib/pages/shared";
import { PageArticle } from "@/components/page-article";
import { buttonVariants } from "@/components/ui/button-variants";

/*
 * Admin-only preview of a page as visitors will see it (storefront layout),
 * drafts included. Signed-out users are sent to the login page, everyone else
 * gets a 404 – and the page is never indexed or cached.
 */

export const metadata: Metadata = { title: "Page preview", robots: NOINDEX };
export const instant = false; // admin-only, rendered per request
export default async function PagePreview({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requireAdmin(`/preview/pages/${id}`);
  const page = await adminGetPage(id);
  if (!page) notFound();

  return (
    <>
      <div className="border-b border-amber-300/60 bg-amber-50 text-amber-950 dark:border-amber-900 dark:bg-amber-950/60 dark:text-amber-100" role="status" data-testid="preview-banner">
        <div className="container-page flex flex-wrap items-center justify-between gap-3 py-2.5 text-sm">
          <p className="inline-flex items-center gap-2">
            <EyeIcon className="size-4" aria-hidden />
            <span>
              <span className="font-semibold">Preview</span> – {page.status === "published" ? "this is how the live page looks right now." : "this page is a draft; only admins can see it."}
            </span>
          </p>
          <span className="flex items-center gap-2">
            {page.status === "published" && (
              <Link href={pageHref(page.slug)} className={buttonVariants({ variant: "ghost", size: "sm" })}>
                View live page
              </Link>
            )}
            <Link href={`/nemesis/pages/${page.id}`} className={buttonVariants({ variant: "outline", size: "sm" })}>
              <PencilIcon /> Edit page
            </Link>
          </span>
        </div>
      </div>
      <PageArticle page={page} />
    </>
  );
}
