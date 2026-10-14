import type { ReactNode } from "react";

/** Re-mounts on every navigation → gives each page a soft fade/slide-in. */
export default function Template({ children }: { children: ReactNode }) {
  return <div className="animate-page-in">{children}</div>;
}
