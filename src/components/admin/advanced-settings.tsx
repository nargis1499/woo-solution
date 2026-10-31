"use client";
import { useState, useTransition } from "react";
import { DownloadIcon, DatabaseIcon, ShieldCheckIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

export function AdvancedSettings() {
  const [copy, setCopy] = useState(true);
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  function download() {
    setError("");
    start(async () => {
      try {
        const response = await fetch(
          `/api/nemesis/client-setup?settings=${copy ? "current" : "defaults"}`,
          { cache: "no-store" },
        );
        if (!response.ok) {
          const body = (await response.json()) as { error?: string };
          throw new Error(body.error || "Could not download setup SQL.");
        }
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `fresh-client-setup-${new Date().toISOString().slice(0, 10)}.sql`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        // Let the browser start the download before releasing the object URL.
        window.setTimeout(() => URL.revokeObjectURL(url), 30000);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Export failed.");
      }
    });
  }
  return (
    <section className="space-y-5 rounded-xl border bg-card p-5 shadow-sm">
      <div className="flex items-start gap-3">
        <DatabaseIcon className="mt-1 size-5 shrink-0 text-primary" />
        <div>
          <h2 className="text-lg font-semibold">Fresh client setup SQL</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Download the current live application schema and bootstrap
            configuration for a new, empty Supabase project.
          </p>
        </div>
      </div>
      <label className="flex items-start gap-3 text-sm">
        <input
          type="checkbox"
          className="mt-1 accent-primary"
          checked={copy}
          disabled={pending}
          onChange={(e) => setCopy(e.target.checked)}
        />
        <span>
          Use current safe template settings
          <span className="mt-1 block text-xs text-muted-foreground">
            Copy saved currency, theme/layout switches, shipping options, AI
            model/language preferences and log retention. Uncheck to use
            database defaults. Unsaved form changes are not included.
          </span>
        </span>
      </label>
      <div className="rounded-lg bg-muted/40 p-4 text-sm">
        <p className="flex items-center gap-2 font-medium">
          <ShieldCheckIcon className="size-4 text-primary" />
          No existing store records or credentials
        </p>
        <p className="mt-2 text-muted-foreground">
          Includes tables, enums, sequences, functions, indexes, triggers, RLS,
          grants, Storage bucket definitions and supported Nemesis cron jobs.
          Excludes users, orders, products, logs, files, API/payment keys,
          wallet destinations, old contact details, custom instructions and
          project URLs. AI and online payment gateways start disabled; search
          indexing starts disabled.
        </p>
      </div>
      <p className="text-sm text-muted-foreground">
        Each click reads the live database—not the old complete-setup.sql.
        Future supported schema changes are picked up automatically. New
        settings fields must be explicitly approved in the export registry by a
        migration; unknown values are never copied blindly. Advanced unsupported
        database objects stop the export rather than producing a misleading
        partial file.
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <Button isPending={pending} isDisabled={pending} onPress={download}>
          <DownloadIcon />
          {pending ? "Preparing SQL…" : "Download fresh setup SQL"}
        </Button>
        <span className="text-xs text-muted-foreground">
          Run once on a fresh project, never on an existing client store.
        </span>
      </div>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <div className="border-t pt-4 text-sm">
        <h3 className="font-medium">Cloudflare Workers · quick setup</h3>
        <ol className="mt-2 list-decimal space-y-1 pl-5 text-muted-foreground">
          <li>
            Copy this app into the client’s own private GitHub repository and
            create their Supabase project. Run the exported SQL.
          </li>
          <li>
            In their repository’s wrangler.jsonc, use a unique worker name and
            set WORKER_SELF_REFERENCE’s service to the same name.
          </li>
          <li>
            Connect the repository in the client’s Cloudflare account → Workers
            Builds. Use Node 22, install: npm ci --legacy-peer-deps, build: npm
            run cf:build, deploy: npx wrangler deploy.
          </li>
          <li>
            Configure their Supabase URL/publishable key and site URL for both
            build and runtime. Add their server-only service-role key only as a
            runtime secret.
          </li>
          <li>
            Set Supabase Auth URLs, sign up, promote the client’s user to admin,
            then review branding, storage, payment/AI keys and SEO before
            launch.
          </li>
        </ol>
        <p className="mt-3 text-xs text-muted-foreground">
          Full instructions, admin SQL and future-migration rules:
          README-CLIENT-SETUP.md in the repository. This download is a bootstrap
          snapshot, not a full backup or a migration to apply over an existing
          database.
        </p>
      </div>
    </section>
  );
}
