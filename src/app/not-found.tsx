import { ButtonLink } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="container-page grid place-items-center py-24 text-center">
      <p className="text-sm font-semibold uppercase tracking-widest text-brand-700">404</p>
      <h1 className="mt-2 text-3xl font-bold tracking-tight">Page not found</h1>
      <p className="mt-2 text-neutral-500">The page you&apos;re looking for doesn&apos;t exist or has been moved.</p>
      <ButtonLink href="/shop" className="mt-6">Back to shop</ButtonLink>
    </div>
  );
}
