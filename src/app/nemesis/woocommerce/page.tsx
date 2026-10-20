import { redirect } from "next/navigation";

type SearchParams = Promise<{ tab?: string }>;

export default async function LegacyWoocommerceRedirect({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const { tab } = await searchParams;
  redirect(tab ? `/nemesis/ecommerce?tab=${encodeURIComponent(tab)}` : "/nemesis/ecommerce");
}
