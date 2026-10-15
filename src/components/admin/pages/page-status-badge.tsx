import { ToneBadge } from "@/components/admin/ui";
import type { PageStatus } from "@/lib/types";

/** Draft / Published chip – the same colours as the product status badges. */
export function PageStatusBadge({ status, className }: { status: PageStatus; className?: string }) {
  return (
    <ToneBadge tone={status === "published" ? "emerald" : "neutral"} className={className}>
      {status === "published" ? "Published" : "Draft"}
    </ToneBadge>
  );
}
