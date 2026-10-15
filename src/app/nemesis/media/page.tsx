import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { MediaLibrary } from "@/components/admin/media/media-library";
import { PageHeader } from "@/components/admin/ui";
import { getMediaTotals, getMediaUsage, listMedia, listMediaFolders } from "@/lib/media/server";
import { MEDIA_PER_PAGE_COOKIE, MEDIA_VIEW_COOKIE, formatBytes, mediaHref, parseMediaParams, parseMediaPerPage, type MediaView } from "@/lib/media/shared";

export const metadata: Metadata = { title: "Media" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function AdminMediaPage({ searchParams }: { searchParams: SearchParams }) {
  const [sp, cookieStore] = await Promise.all([searchParams, cookies()]);
  const viewCookie = cookieStore.get(MEDIA_VIEW_COOKIE)?.value;
  const params = parseMediaParams(sp, {
    per: parseMediaPerPage(cookieStore.get(MEDIA_PER_PAGE_COOKIE)?.value),
    view: viewCookie === "list" || viewCookie === "grid" ? (viewCookie as MediaView) : undefined,
  });

  let data: Awaited<ReturnType<typeof loadLibrary>>;
  try {
    data = await loadLibrary(params);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (/media|schema cache|does not exist/i.test(message)) {
      return (
        <>
          <PageHeader title="Media" description="Upload, organise and reuse files across the shop." />
          <Alert variant="destructive">
            <AlertTitle>Database update required</AlertTitle>
            <AlertDescription>
              Run supabase/migrations/20261019000000_media_library.sql in the Supabase SQL Editor to create the media tables and the “media” storage bucket, then reload this page.
              <span className="mt-1 block font-mono text-xs opacity-80">{message}</span>
            </AlertDescription>
          </Alert>
        </>
      );
    }
    throw e;
  }

  const { page, folders, totals, usage } = data;
  // keep the URL honest when the requested page no longer exists
  if (page.page !== params.page) redirect(mediaHref({ ...params, page: page.page }));

  const count = params.trash ? totals.trash_count : totals.library_count;
  const bytes = params.trash ? totals.trash_bytes : totals.library_bytes;

  return (
    <>
      <PageHeader
        title={params.trash ? "Media · Trash" : "Media"}
        description={
          params.trash
            ? `${count} ${count === 1 ? "file" : "files"} waiting in the trash (${formatBytes(bytes)}). Restore them or delete them for good.`
            : `${count} ${count === 1 ? "file" : "files"} · ${formatBytes(bytes)} used. Upload once, reuse everywhere.`
        }
      />
      <MediaLibrary params={params} page={page} folders={folders} totals={totals} usage={usage} aiAlt={Boolean(process.env.OPENAI_API_KEY)} />
    </>
  );
}

async function loadLibrary(params: ReturnType<typeof parseMediaParams>) {
  const [page, folders, totals] = await Promise.all([listMedia(params), listMediaFolders(), getMediaTotals()]);
  const usage = page.items.length ? await getMediaUsage(page.items.map((i) => i.id)) : {};
  return { page, folders, totals, usage };
}
