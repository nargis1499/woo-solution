import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

export function UserAvatar({ name, email, src, size = "default" }: { name?: string | null; email?: string | null; src?: string | null; size?: "default" | "lg" }) {
  const initial = (name || email || "?").trim().slice(0, 1).toUpperCase();
  return (
    <Avatar size={size}>
      {/* Plain <img>: avatars are tiny and Google's CDN rate-limits image proxies */}
      {src && <AvatarImage src={src} alt="" referrerPolicy="no-referrer" />}
      <AvatarFallback className="bg-primary/10 text-primary">{initial}</AvatarFallback>
    </Avatar>
  );
}
