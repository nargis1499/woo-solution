import type { Metadata } from "next";
import { Suspense } from "react";
import { SignupForm } from "@/components/auth-forms";

export const metadata: Metadata = { title: "Create account" };

type SearchParams = Promise<{ next?: string }>;

export default function SignupPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <div className="container-page flex justify-center py-16">
      <div className="card w-full max-w-md p-6 sm:p-8">
        <h1 className="mb-1 text-2xl font-bold tracking-tight">Create an account</h1>
        <p className="mb-6 text-sm text-neutral-500">Track orders, check out faster and more.</p>
        <Suspense fallback={<div className="h-80 animate-pulse rounded-lg bg-neutral-100" />}>
          <SignupFormWithParams searchParams={searchParams} />
        </Suspense>
      </div>
    </div>
  );
}

async function SignupFormWithParams({ searchParams }: { searchParams: SearchParams }) {
  const { next } = await searchParams;
  const safeNext = next && next.startsWith("/") && !next.startsWith("//") ? next : "/";
  return <SignupForm next={safeNext} />;
}
