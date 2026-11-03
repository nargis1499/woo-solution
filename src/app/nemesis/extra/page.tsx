import { redirect } from "next/navigation";

/**
 * The sidebar entry for the UI page points at `/nemesis/ui` (its first tab); this
 * route keeps a typed-in `/nemesis/extra` (or a bookmark) working.
 */
export default function AdminExtraPage() {
  redirect("/nemesis/ui?tab=extra");
}
