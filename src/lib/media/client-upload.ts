"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { prepareUploads, registerUpload, type UploadTicket } from "@/app/nemesis/media/actions";
import type { MediaItem } from "@/lib/types";
import { MEDIA_BUCKET, validateMediaFile } from "./shared";

/* ──────────────────────────────────────────────────────────────────────────
 * Low-level helpers
 * ────────────────────────────────────────────────────────────────────────── */

export async function sha256File(file: File): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Streams one file straight into Supabase Storage with XHR (fetch has no upload
 * progress). The bucket's RLS policies + the admin's own JWT guard the write.
 */
export function uploadToStorage(opts: {
  path: string;
  file: Blob;
  contentType: string;
  token: string;
  upsert?: boolean;
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
}): Promise<void> {
  const base = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/\/$/, "");
  const url = `${base}/storage/v1/object/${MEDIA_BUCKET}/${opts.path.split("/").map(encodeURIComponent).join("/")}`;
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);
    xhr.setRequestHeader("authorization", `Bearer ${opts.token}`);
    xhr.setRequestHeader("apikey", process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "");
    xhr.setRequestHeader("x-upsert", opts.upsert ? "true" : "false");
    xhr.setRequestHeader("cache-control", "max-age=31536000");
    xhr.setRequestHeader("content-type", opts.contentType || "application/octet-stream");
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && opts.onProgress) opts.onProgress(e.total ? e.loaded / e.total : 0);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) return resolve();
      let message = `Upload failed (${xhr.status}).`;
      try {
        const body = JSON.parse(xhr.responseText) as { message?: string; error?: string };
        if (body.message) message = body.message;
        else if (body.error) message = body.error;
      } catch {}
      if (xhr.status === 413 || /exceeded the maximum allowed size|Payload too large/i.test(message)) message = "The file is larger than the bucket allows (5 MB).";
      if (xhr.status === 401 || xhr.status === 403) message = "You are not allowed to upload here – please sign in again.";
      reject(new Error(message));
    };
    xhr.onerror = () => reject(new Error("Network error while uploading."));
    xhr.onabort = () => reject(new Error("Upload cancelled."));
    if (opts.signal) opts.signal.addEventListener("abort", () => xhr.abort(), { once: true });
    xhr.send(opts.file);
  });
}

/* ──────────────────────────────────────────────────────────────────────────
 * Upload queue (drag & drop panel + media picker share it)
 * ────────────────────────────────────────────────────────────────────────── */

export type UploadStatus = "hashing" | "duplicate" | "queued" | "uploading" | "processing" | "done" | "error" | "skipped";

export type UploadEntry = {
  id: string;
  file: File;
  name: string;
  size: number;
  status: UploadStatus;
  /** 0–1 of the bytes sent (uploading) */
  progress: number;
  error: string | null;
  duplicateOf: { id: string; name: string } | null;
  item: MediaItem | null;
  path: string | null;
  hash: string | null;
};

const CONCURRENCY = 3;
let seq = 0;
const nextId = () => `u${Date.now().toString(36)}-${(seq++).toString(36)}`;

export function useMediaUploader(options: {
  folderId?: string | null;
  /** Optional filter, e.g. "image" – other kinds are rejected before upload. */
  accept?: (file: File) => string | null;
  onUploaded?: (item: MediaItem) => void;
  /** Fires once when every entry of a batch reached a final state. */
  onSettled?: (uploaded: MediaItem[]) => void;
}) {
  const [entries, setEntries] = useState<UploadEntry[]>([]);
  const tokenRef = useRef<string | null>(null);
  const activeRef = useRef(0);
  const queueRef = useRef<string[]>([]);
  const entriesRef = useRef<UploadEntry[]>([]);
  const batchDone = useRef<MediaItem[]>([]);
  const optionsRef = useRef(options);
  useEffect(() => {
    optionsRef.current = options;
  });

  // entriesRef is the synchronous source of truth (the queue reads it right after a
  // patch, before React has flushed the state update); `entries` mirrors it for rendering.
  const commit = useCallback((next: UploadEntry[]) => {
    entriesRef.current = next;
    setEntries(next);
  }, []);
  const patch = useCallback(
    (id: string, changes: Partial<UploadEntry>) => {
      commit(entriesRef.current.map((e) => (e.id === id ? { ...e, ...changes } : e)));
    },
    [commit],
  );

  const settleCheck = useCallback(() => {
    const pending = entriesRef.current.some((e) => ["hashing", "queued", "uploading", "processing"].includes(e.status));
    if (!pending && activeRef.current === 0 && queueRef.current.length === 0) {
      const done = batchDone.current;
      batchDone.current = [];
      if (done.length || entriesRef.current.length) optionsRef.current.onSettled?.(done);
    }
  }, []);

  const pump = useCallback(() => {
    while (activeRef.current < CONCURRENCY && queueRef.current.length > 0) {
      const id = queueRef.current.shift()!;
      const entry = entriesRef.current.find((e) => e.id === id);
      if (!entry || !entry.path || !tokenRef.current) {
        if (entry) patch(id, { status: "error", error: "Upload could not be started." });
        continue;
      }
      activeRef.current++;
      patch(id, { status: "uploading", progress: 0 });
      const run = async () => {
        try {
          await uploadToStorage({
            path: entry.path!,
            file: entry.file,
            contentType: entry.file.type,
            token: tokenRef.current!,
            onProgress: (p) => patch(id, { progress: p }),
          });
          patch(id, { status: "processing", progress: 1 });
          const res = await registerUpload({ path: entry.path!, name: entry.name, type: entry.file.type, folderId: optionsRef.current.folderId ?? null });
          if (!res.ok) throw new Error(res.error);
          patch(id, { status: "done", item: res.data });
          batchDone.current.push(res.data);
          optionsRef.current.onUploaded?.(res.data);
        } catch (e) {
          patch(id, { status: "error", error: e instanceof Error ? e.message : "Upload failed." });
        } finally {
          activeRef.current--;
          pump();
          settleCheck();
        }
      };
      void run();
    }
  }, [patch, settleCheck]);

  const enqueue = useCallback(
    (ids: string[]) => {
      queueRef.current.push(...ids);
      pump();
    },
    [pump],
  );

  /** Adds files: validates, hashes, asks the server for upload tickets (duplicates!), then uploads. */
  const addFiles = useCallback(
    async (files: File[] | FileList) => {
      const list = Array.from(files);
      if (list.length === 0) return;
      const fresh: UploadEntry[] = list.map((file) => {
        const problem = validateMediaFile(file) ?? optionsRef.current.accept?.(file) ?? null;
        return {
          id: nextId(),
          file,
          name: file.name,
          size: file.size,
          status: problem ? "error" : "hashing",
          progress: 0,
          error: problem,
          duplicateOf: null,
          item: null,
          path: null,
          hash: null,
        };
      });
      commit([...entriesRef.current, ...fresh]);

      const valid = fresh.filter((e) => e.status === "hashing");
      if (valid.length === 0) {
        settleCheck();
        return;
      }
      const hashes = await Promise.all(valid.map((e) => sha256File(e.file).catch(() => "")));
      valid.forEach((e, i) => patch(e.id, { hash: hashes[i] }));

      const res = await prepareUploads(valid.map((e, i) => ({ name: e.name, size: e.size, type: e.file.type, hash: hashes[i] })));
      if (!res.ok) {
        valid.forEach((e) => patch(e.id, { status: "error", error: res.error }));
        settleCheck();
        return;
      }
      tokenRef.current = res.data.token;
      const ready: string[] = [];
      valid.forEach((e, i) => {
        const ticket: UploadTicket | undefined = res.data.tickets[i];
        if (!ticket || ticket.error || !ticket.path) {
          patch(e.id, { status: "error", error: ticket?.error ?? "Upload rejected." });
        } else if (ticket.duplicateOf) {
          patch(e.id, { status: "duplicate", duplicateOf: ticket.duplicateOf, path: ticket.path });
        } else {
          patch(e.id, { status: "queued", path: ticket.path });
          ready.push(e.id);
        }
      });
      enqueue(ready);
      settleCheck();
    },
    [commit, enqueue, patch, settleCheck],
  );

  /** Decision for a duplicate: upload it anyway or skip it. */
  const resolveDuplicate = useCallback(
    (id: string, upload: boolean) => {
      const entry = entriesRef.current.find((e) => e.id === id);
      if (!entry || entry.status !== "duplicate") return;
      if (upload) {
        patch(id, { status: "queued" });
        enqueue([id]);
      } else {
        patch(id, { status: "skipped" });
        settleCheck();
      }
    },
    [enqueue, patch, settleCheck],
  );

  const resolveAllDuplicates = useCallback(
    (upload: boolean) => {
      entriesRef.current.filter((e) => e.status === "duplicate").forEach((e) => resolveDuplicate(e.id, upload));
    },
    [resolveDuplicate],
  );

  const clearFinished = useCallback(() => {
    commit(entriesRef.current.filter((e) => !["done", "error", "skipped"].includes(e.status)));
  }, [commit]);

  const summary = useMemo(() => {
    const active = entries.filter((e) => ["hashing", "queued", "uploading", "processing", "duplicate"].includes(e.status));
    const bytesTotal = entries.filter((e) => e.status !== "error" && e.status !== "skipped").reduce((s, e) => s + e.size, 0);
    const bytesDone = entries.reduce((s, e) => {
      if (e.status === "done" || e.status === "processing") return s + e.size;
      if (e.status === "uploading") return s + e.size * e.progress;
      return s;
    }, 0);
    return {
      total: entries.length,
      active: active.length,
      done: entries.filter((e) => e.status === "done").length,
      failed: entries.filter((e) => e.status === "error").length,
      duplicates: entries.filter((e) => e.status === "duplicate").length,
      busy: entries.some((e) => ["hashing", "queued", "uploading", "processing"].includes(e.status)),
      overall: bytesTotal > 0 ? Math.min(1, bytesDone / bytesTotal) : 0,
    };
  }, [entries]);

  return { entries, summary, addFiles, resolveDuplicate, resolveAllDuplicates, clearFinished };
}
