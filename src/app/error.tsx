"use client";

import { Button, ButtonLink } from "@/components/ui/button";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const looksLikeConfig =
    /supabase|fetch failed|NEXT_PUBLIC|Invalid URL|ENOTFOUND/i.test(error.message ?? "");

  return (
    <div className="container-page py-24">
      <div className="card mx-auto max-w-xl p-8 text-center">
        <p className="text-sm font-semibold uppercase tracking-widest text-red-600">Something went wrong</p>
        <h1 className="mt-2 text-2xl font-bold tracking-tight">We couldn&apos;t load this page</h1>
        <p className="mt-3 text-sm text-neutral-600">{error.message}</p>
        {looksLikeConfig && (
          <p className="mt-4 rounded-lg bg-amber-50 p-3 text-left text-sm text-amber-900">
            This usually means the Supabase connection isn&apos;t configured yet. Copy <code>.env.example</code> to{" "}
            <code>.env.local</code>, fill in your project URL and key, run the SQL in <code>supabase/</code>, then
            restart the dev server.
          </p>
        )}
        <div className="mt-6 flex justify-center gap-3">
          <Button onClick={reset}>Try again</Button>
          <ButtonLink href="/" variant="outline">Go home</ButtonLink>
        </div>
      </div>
    </div>
  );
}
