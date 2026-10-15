import type { ReactNode } from "react";

/** Re-mounts on every storefront navigation → gives each page a soft fade/slide-in. */
export default function StoreTemplate({ children }: { children: ReactNode }) {
  return <div className="animate-page-in">{children}</div>;
}
