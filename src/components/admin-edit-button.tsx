import Link from "next/link";
import { Suspense } from "react";
import { PencilIcon } from "lucide-react";
import type { VariantProps } from "class-variance-authority";
import { isCurrentUserAdmin } from "@/lib/admin/auth";
import { buttonVariants } from "@/components/ui/button-variants";
import { cn } from "@/lib/utils";

type AdminEditButtonProps = {
  href: string;
  label?: string;
  ariaLabel?: string;
  variant?: VariantProps<typeof buttonVariants>["variant"];
  size?: VariantProps<typeof buttonVariants>["size"];
  className?: string;
};

/**
 * Storefront edit shortcut rendered exclusively for verified admins.
 * Streams behind Suspense so public pages never block on auth cookies and
 * non-admin visitors receive zero markup.
 */
export function AdminEditButton(props: AdminEditButtonProps) {
  return (
    <Suspense fallback={null}>
      <AdminEditButtonInner {...props} />
    </Suspense>
  );
}

async function AdminEditButtonInner({
  href,
  label = "Edit",
  ariaLabel,
  variant = "outline",
  size = "sm",
  className,
}: AdminEditButtonProps) {
  if (!(await isCurrentUserAdmin())) return null;

  return (
    <Link
      href={href}
      prefetch={false}
      aria-label={ariaLabel}
      data-testid="admin-edit-button"
      className={cn(buttonVariants({ variant, size }), className)}
    >
      <PencilIcon aria-hidden />
      <span>{label}</span>
    </Link>
  );
}
