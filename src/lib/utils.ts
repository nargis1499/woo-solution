/** Tiny className joiner (avoids pulling in clsx for an MVP). */
export function cn(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(" ");
}
