import Link from "next/link";
import { buttonVariants } from "@/components/ui/button-variants";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";

export function NotFoundContent() {
  return (
    <div className="container-page py-24">
      <Empty>
        <EmptyHeader>
          <p className="text-sm font-semibold tracking-widest text-primary uppercase">404</p>
          <EmptyTitle className="text-3xl font-bold tracking-tight">Page not found</EmptyTitle>
          <EmptyDescription>The page you&apos;re looking for doesn&apos;t exist or has been moved.</EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Link href="/shop" className={buttonVariants()}>
            Back to shop
          </Link>
        </EmptyContent>
      </Empty>
    </div>
  );
}
