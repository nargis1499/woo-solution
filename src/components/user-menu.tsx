import Link from "next/link";
import { getAdminStatus } from "@/lib/admin/auth";
import { buttonVariants } from "@/components/ui/button-variants";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { AccountMenu } from "./account-menu";

export async function UserMenu() {
  const { user, isAdmin } = await getAdminStatus();

  if (!user) {
    return (
      <div className="flex items-center gap-1">
        <Link href="/login" className={buttonVariants({ variant: "ghost", size: "sm" })}>
          Sign in
        </Link>
        <Link href="/signup" className={cn(buttonVariants({ size: "sm" }), "hidden sm:inline-flex")}>
          Create account
        </Link>
      </div>
    );
  }

  return <AccountMenu user={user} isAdmin={isAdmin} />;
}

export function UserMenuSkeleton() {
  return <Skeleton className="h-9 w-24 rounded-md" aria-hidden />;
}
