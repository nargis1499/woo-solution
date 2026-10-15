import { NotFoundContent } from "@/components/not-found-content";
import { StoreShell } from "@/components/store-shell";

/** Unknown URLs render outside every route group → bring the storefront chrome along. */
export default function NotFound() {
  return (
    <StoreShell>
      <NotFoundContent />
    </StoreShell>
  );
}
