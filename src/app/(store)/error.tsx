"use client";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button, LinkButton } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const looksLikeConfig = /supabase|fetch failed|NEXT_PUBLIC|Invalid URL|ENOTFOUND/i.test(error.message ?? "");

  return (
    <div className="container-page py-24">
      <Card className="mx-auto max-w-xl">
        <CardHeader className="text-center">
          <p className="text-sm font-semibold tracking-widest text-destructive uppercase">Something went wrong</p>
          <CardTitle className="text-2xl">We couldn&apos;t load this page</CardTitle>
          <CardDescription>{error.message}</CardDescription>
        </CardHeader>
        {looksLikeConfig && (
          <CardContent>
            <Alert>
              <AlertDescription>
                This usually means the Supabase connection isn&apos;t configured yet. Copy <code>.env.example</code> to <code>.env.local</code>, fill in
                your project URL and key, run the SQL in <code>supabase/</code>, then restart the dev server.
              </AlertDescription>
            </Alert>
          </CardContent>
        )}
        <CardFooter className="justify-center gap-3">
          <Button onPress={reset}>Try again</Button>
          <LinkButton href="/" variant="outline">
            Go home
          </LinkButton>
        </CardFooter>
      </Card>
    </div>
  );
}
