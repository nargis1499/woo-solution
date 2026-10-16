import { redirect } from "next/navigation";

/**
 * The dashboard navigation links straight to `/nemesis/ui?tab=extra`; this
 * route keeps a typed-in `/nemesis/extra` (or a bookmark) working.
 */
export default function AdminExtraPage() {
  redirect("/nemesis/ui?tab=extra");
}
