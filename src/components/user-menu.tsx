import Link from "next/link";
import { getAdminStatus } from "@/lib/admin/auth";
import { signOut } from "@/app/auth/actions";
import { ShieldIcon, UserIcon } from "./icons";

export async function UserMenu() {
  const { user, isAdmin } = await getAdminStatus();

  if (!user) {
    return (
      <div className="flex items-center gap-1">
        <Link
          href="/login"
          className="rounded-md px-3 py-2 text-sm font-medium text-neutral-700 transition-colors hover:bg-neutral-100"
        >
          Sign in
        </Link>
        <Link
          href="/signup"
          className="hidden rounded-md bg-neutral-900 px-3 py-2 text-sm font-medium text-neutral-50 transition-colors hover:bg-neutral-800 sm:inline-flex"
        >
          Create account
        </Link>
      </div>
    );
  }

  const label = user.name?.split(" ")[0] || user.email || "Account";

  return (
    <div className="flex items-center gap-1">
      {isAdmin && (
        <Link
          href="/nemesis"
          className="hidden items-center gap-1.5 rounded-md px-3 py-2 text-sm font-medium text-brand-700 dark:text-brand-300 transition-colors hover:bg-brand-50 md:flex"
          title="Admin dashboard"
        >
          <ShieldIcon className="h-4 w-4" />
          Admin
        </Link>
      )}
      <Link
        href="/orders"
        className="flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-neutral-700 transition-colors hover:bg-neutral-100"
        title={user.email ?? undefined}
      >
        {user.avatarUrl ? (
          // Plain <img>: avatars are tiny and Google's CDN rate-limits image proxies,
          // so skipping the Next.js optimizer is both faster and more reliable here.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={user.avatarUrl}
            alt=""
            width={24}
            height={24}
            className="h-6 w-6 rounded-full bg-neutral-200 object-cover"
            referrerPolicy="no-referrer"
          />
        ) : (
          <UserIcon className="h-4 w-4" />
        )}
        <span className="hidden sm:inline">{label}</span>
      </Link>
      <form action={signOut}>
        <button
          type="submit"
          className="rounded-md px-3 py-2 text-sm font-medium text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-neutral-900"
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
