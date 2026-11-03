"use server";

import { updateHomeSections } from "@/app/nemesis/actions";
import type { AdminFormState } from "@/lib/admin/form";

/** Compatibility for the former assignment-only form; validation and persistence
 * now share the same save path as the complete home settings form. */
export async function saveHomepage(
  previous: AdminFormState,
  formData: FormData,
): Promise<AdminFormState> {
  return updateHomeSections(previous, formData);
}
