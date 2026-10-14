import type { Metadata } from "next";
import { Suspense } from "react";
import { LoginForm } from "@/components/auth-forms";

export const metadata: Metadata = { title: "Sign in" };

type SearchParams = Promise<{ next?: string; error?: string; message?: string }>;

export default function LoginPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <div className="container-page flex justify-center py-16">
      <div className="card w-full max-w-md p-6 sm:p-8">
        <h1 className="mb-1 text-2xl font-bold tracking-tight">Sign in</h1>
        <p className="mb-6 text-sm text-neutral-500">Welcome back! Sign in to continue to checkout and view your orders.</p>
        <Suspense fallback={<div className="h-64 animate-pulse rounded-lg bg-neutral-100" />}>
          <LoginFormWithParams searchParams={searchParams} />
        </Suspense>
      </div>
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
