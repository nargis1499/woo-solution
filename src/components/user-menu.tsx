import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";
import { signOut } from "@/app/auth/actions";
import { UserIcon } from "./icons";

export async function UserMenu() {
  const user = await getCurrentUser();

  if (!user) {
    return (
      <div className="flex items-center gap-1">
        <Link
          href="/login"
          className="rounded-md px-3 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-100"
        >
          Sign in
        </Link>
        <Link
          href="/signup"
          className="hidden rounded-md bg-neutral-900 px-3 py-2 text-sm font-medium text-white hover:bg-neutral-800 sm:inline-flex"
        >
          Create account
        </Link>
      </div>
    );
  }

  const label = user.name?.split(" ")[0] || user.email || "Account";

  return (
    <div className="flex items-center gap-1">
      <Link
        href="/orders"
        className="flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-100"
        title={user.email ?? undefined}
      >
        <UserIcon className="h-4 w-4" />
        <span className="hidden sm:inline">{label}</span>
      </Link>
      <form action={signOut}>
        <button
          type="submit"
          className="rounded-md px-3 py-2 text-sm font-medium text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900"
        >
          Sign out
        </button>
      </form>
    </div>
  );
}

export function UserMenuSkeleton() {
  return <div className="h-9 w-28 animate-pulse rounded-md bg-neutral-200" aria-hidden />;
}
