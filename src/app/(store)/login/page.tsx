import type { Metadata } from "next";
import { Suspense } from "react";
import { LoginForm } from "@/components/auth-forms";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export const metadata: Metadata = { title: "Sign in" };

type SearchParams = Promise<{ next?: string; error?: string; message?: string }>;

export default function LoginPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <div className="container-page flex justify-center py-16">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-2xl">Sign in</CardTitle>
          <CardDescription>Welcome back! Sign in to continue to checkout and view your orders.</CardDescription>
        </CardHeader>
        <CardContent>
          <Suspense fallback={<Skeleton className="h-64 w-full" />}>
            <LoginFormWithParams searchParams={searchParams} />
          </Suspense>
        </CardContent>
      </Card>
    </div>
  );
}

async function LoginFormWithParams({ searchParams }: { searchParams: SearchParams }) {
  const { next, error, message } = await searchParams;
  const safeNext = next && next.startsWith("/") && !next.startsWith("//") ? next : "/";
  let errorMessage: string | undefined;
  if (error === "auth-code-error") {
    errorMessage = "That sign-in link is invalid or has expired. Please try again.";
  } else if (error === "oauth") {
    errorMessage = `Google sign-in failed: ${message ?? "unknown error"}`;
  }
  return <LoginForm next={safeNext} error={errorMessage} />;
}
