import { cn } from "@/lib/utils";

export function UserAvatar({ name, email, src, size = "md" }: { name?: string | null; email?: string | null; src?: string | null; size?: "md" | "lg" }) {
  const initial = (name || email || "?").trim().slice(0, 1).toUpperCase();
  const cls = cn("shrink-0 rounded-full object-cover", size === "lg" ? "h-10 w-10" : "h-9 w-9");
  if (src) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src} alt="" width={size === "lg" ? 40 : 36} height={size === "lg" ? 40 : 36} className={cn(cls, "bg-neutral-200")} referrerPolicy="no-referrer" />;
  }
  return (
    <span className={cn(cls, "grid place-items-center bg-brand-100 text-sm font-semibold text-brand-800")} aria-hidden>
      {initial}
    </span>
  );
}
