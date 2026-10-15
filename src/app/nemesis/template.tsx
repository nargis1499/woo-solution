import type { ReactNode } from "react";

/**
 * Re-mounts on every dashboard navigation → the page content fades/slides in.
 * Deliberately placed *inside* the admin shell (layout → template → page): the
 * animated element must not wrap the sidebar, whose `position: fixed` would
 * otherwise be measured against the animated box instead of the viewport.
 */
export default function AdminTemplate({ children }: { children: ReactNode }) {
  return <div className="animate-page-in">{children}</div>;
}
