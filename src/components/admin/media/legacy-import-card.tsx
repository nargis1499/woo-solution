"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArchiveRestoreIcon, CheckCircle2Icon, Trash2Icon, XCircleIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress, ProgressLabel, ProgressValue } from "@/components/ui/progress";
import { formatBytes } from "@/lib/media/shared";
import type { LegacyObject } from "@/lib/media/legacy";
import { importLegacyObject, legacyMediaStatus, removeLegacyBuckets, type LegacyStatus } from "@/app/nemesis/media/actions";

type RowState = { key: string; name: string; status: "pending" | "working" | "done" | "error"; detail?: string };

const CONCURRENCY = 2;

/**
 * One-off helper shown while the pre-Media-Library buckets (product-images,
 * site-media) still exist: moves their files into the library – products and
 * settings that used them are updated – and removes the empty buckets.
 * Renders nothing once both buckets are gone.
 */
export function LegacyImportCard() {
  const router = useRouter();
  const [status, setStatus] = useState<LegacyStatus | null>(null);
  const [rows, setRows] = useState<RowState[]>([]);
  const [running, start] = useTransition();
  const [finished, setFinished] = useState(false);

  useEffect(() => {
    let cancelled = false;
    legacyMediaStatus().then((res) => {
      if (!cancelled && res.ok) setStatus(res.data);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!status || status.buckets.length === 0) return null;

  const objects: LegacyObject[] = status.buckets.flatMap((b) => b.objects);
  const total = objects.reduce((n, o) => n + o.size, 0);
  const done = rows.filter((r) => r.status === "done" || r.status === "error").length;
  const failed = rows.filter((r) => r.status === "error").length;

  async function cleanupBuckets() {
    const res = await removeLegacyBuckets();
    if (!res.ok) return void toast.error(res.error);
    if (res.data.removed.length) toast.success(`Removed the empty ${res.data.removed.map((b) => `“${b}”`).join(" and ")} bucket${res.data.removed.length === 1 ? "" : "s"}.`);
    for (const r of res.data.remaining) toast.warning(`The ${r.id} bucket ${r.reason}.`);
    const next = await legacyMediaStatus();
    if (next.ok) setStatus(next.data);
  }

  function run() {
    const queue = [...objects];
    const initial: RowState[] = queue.map((o) => ({ key: `${o.bucket}/${o.path}`, name: o.path.split("/").pop() ?? o.path, status: "pending" }));
    setRows(initial);
    setFinished(false);
    const update = (key: string, patch: Partial<RowState>) => setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));

    start(async () => {
      let products = 0;
      let settings = 0;
      let reused = 0;
      let imported = 0;
      const worker = async () => {
        for (let o = queue.shift(); o; o = queue.shift()) {
          const key = `${o.bucket}/${o.path}`;
          update(key, { status: "working" });
          const res = await importLegacyObject(o.bucket, o.path);
          if (res.ok) {
            imported += 1;
            reused += res.data.reused ? 1 : 0;
            products += res.data.products;
            settings += res.data.settings;
            update(key, { status: "done", detail: `${res.data.reused ? "already in the library" : "moved"} as ${res.data.item.name}${res.data.products ? ` · ${res.data.products} product${res.data.products === 1 ? "" : "s"} updated` : ""}${res.data.settings ? " · settings updated" : ""}` });
          } else {
            update(key, { status: "error", detail: res.error });
          }
        }
      };
      await Promise.all(Array.from({ length: Math.min(CONCURRENCY, objects.length) }, worker));

      const summary = [`${imported} of ${objects.length} file${objects.length === 1 ? "" : "s"} moved into the Media Library`];
      if (reused) summary.push(`${reused} already existed`);
      if (products) summary.push(`${products} product${products === 1 ? "" : "s"} updated`);
      if (settings) summary.push("settings updated");
      (imported === objects.length ? toast.success : toast.warning)(summary.join(" · "));

      await cleanupBuckets();
      setFinished(true);
      router.refresh();
    });
  }

  return (
    <Card className="mb-4" data-testid="legacy-import">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ArchiveRestoreIcon className="size-4" aria-hidden /> Files from before the Media Library
        </CardTitle>
        <CardDescription>
          {objects.length > 0
            ? `${objects.length} file${objects.length === 1 ? "" : "s"} (${formatBytes(total)}) still live in the old ${status.buckets.map((b) => `“${b.id}”`).join(" and ")} bucket${status.buckets.length === 1 ? "" : "s"}. Move them here – products and settings that use them are updated automatically – and the empty buckets are removed.`
            : `The old ${status.buckets.map((b) => `“${b.id}”`).join(" and ")} bucket${status.buckets.length === 1 ? " is" : "s are"} empty and no longer needed.`}
        </CardDescription>
      </CardHeader>
      {(rows.length > 0 || objects.length > 0) && (
        <CardContent className="gap-3">
          {rows.length > 0 && (
            <Progress value={Math.round((done / rows.length) * 100)} className="gap-1.5" aria-label="Import progress" data-testid="legacy-progress">
              <div className="flex items-center justify-between text-sm">
                <ProgressLabel className="text-foreground">
                  {done} of {rows.length} processed{failed ? ` · ${failed} failed` : ""}
                </ProgressLabel>
                <ProgressValue className="tabular-nums text-muted-foreground" />
              </div>
            </Progress>
          )}
          <ul className="divide-y rounded-lg border text-sm" data-testid="legacy-rows">
            {(rows.length ? rows : objects.map<RowState>((o) => ({ key: `${o.bucket}/${o.path}`, name: o.path.split("/").pop() ?? o.path, status: "pending", detail: `${o.bucket} · ${formatBytes(o.size)}` }))).map((r) => (
              <li key={r.key} className="flex items-center gap-3 px-3 py-2" data-status={r.status}>
                {r.status === "done" ? (
                  <CheckCircle2Icon className="size-4 shrink-0 text-emerald-600" aria-label="Done" />
                ) : r.status === "error" ? (
                  <XCircleIcon className="size-4 shrink-0 text-destructive" aria-label="Failed" />
                ) : (
                  <span className="size-4 shrink-0 rounded-full border" aria-hidden />
                )}
                <span className="min-w-0 flex-1 truncate font-medium" title={r.name}>
                  {r.name}
                </span>
                {r.detail && (
                  <span className="min-w-0 max-w-[60%] truncate text-xs text-muted-foreground" title={r.detail}>
                    {r.detail}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </CardContent>
      )}
      <CardFooter className="gap-2 border-t">
        {objects.length > 0 ? (
          <Button onPress={run} isDisabled={running || finished} data-testid="legacy-import-run">
            <ArchiveRestoreIcon /> {running ? "Moving files…" : `Move ${objects.length} file${objects.length === 1 ? "" : "s"} into the Media Library`}
          </Button>
        ) : (
          <Button variant="outline" onPress={() => start(cleanupBuckets)} isDisabled={running} data-testid="legacy-remove-buckets">
            <Trash2Icon /> Remove the empty bucket{status.buckets.length === 1 ? "" : "s"}
          </Button>
        )}
      </CardFooter>
    </Card>
  );
}
