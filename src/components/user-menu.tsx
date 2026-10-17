import { getAdminStatus } from "@/lib/admin/auth";
import { Skeleton } from "@/components/ui/skeleton";
import { AccountMenu } from "./account-menu";
import { GuestMenu } from "./guest-menu";

export async function UserMenu() {
  const { user, isAdmin } = await getAdminStatus();

  if (!user) {
    return <GuestMenu />;
  }

  return <AccountMenu user={user} isAdmin={isAdmin} />;
}

export function UserMenuSkeleton() {
  return <Skeleton className="h-9 w-24 rounded-md" aria-hidden />;
}
