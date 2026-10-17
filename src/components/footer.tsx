import { MailIcon, MessageCircleIcon, SendIcon } from "lucide-react";
import { getMenu } from "@/lib/menu";
import { getSiteSettings, telegramHref, whatsappHref } from "@/lib/site-settings";
import { Separator } from "@/components/ui/separator";
import { NavLink } from "./nav-link";

/** Current year for the footer copyright line. */
async function copyrightYear() {
  return new Date().getFullYear();
}

export async function Footer() {
  // Footer links come from UI → Menu → Footer menu.
  const [{ store_name, tagline, support_email, whatsapp, telegram }, nav, year] = await Promise.all([getSiteSettings(), getMenu("footer"), copyrightYear()]);
  const contacts = [
    support_email && { label: support_email, href: `mailto:${support_email}`, icon: MailIcon, title: "E-mail" },
    whatsappHref(whatsapp) && { label: "WhatsApp", href: whatsappHref(whatsapp)!, icon: MessageCircleIcon, title: `WhatsApp +${whatsapp!.replace(/\D/g, "")}` },
    telegramHref(telegram) && { label: `@${telegram}`, href: telegramHref(telegram)!, icon: SendIcon, title: "Telegram" },
  ].filter((c): c is { label: string; href: string; icon: typeof MailIcon; title: string } => Boolean(c));

  return (
    <footer className="theme-footer mt-16 border-t" data-testid="site-footer">
      <div className="container-page flex flex-col gap-6 py-10 text-sm text-muted-foreground sm:flex-row sm:items-start sm:justify-between">
        <div className="max-w-md space-y-3">
          <div className="space-y-1">
            <p className="text-base font-semibold text-foreground">{store_name}</p>
            {tagline && <p>{tagline}</p>}
          </div>
          {contacts.length > 0 && (
            <ul className="flex flex-wrap items-center gap-x-5 gap-y-2" aria-label="Contact">
              {contacts.map((c) => (
                <li key={c.href}>
                  <a
                    href={c.href}
                    title={c.title}
                    target={c.href.startsWith("mailto:") ? undefined : "_blank"}
                    rel={c.href.startsWith("mailto:") ? undefined : "noreferrer"}
                    className="inline-flex items-center gap-1.5 font-medium text-foreground underline-offset-4 hover:underline"
                  >
                    <c.icon className="size-4 text-muted-foreground" aria-hidden />
                    {c.label}
                  </a>
                </li>
              ))}
            </ul>
          )}
        </div>
        {nav.length > 0 && (
          <nav className="flex flex-wrap gap-x-6 gap-y-2 sm:max-w-sm sm:justify-end" aria-label="Footer">
            {nav.map((item) => (
              <NavLink key={item.id} item={item} className="hover:text-foreground" />
            ))}
          </nav>
        )}
      </div>
      <Separator />
      <div className="container-page py-4 text-xs text-muted-foreground">
        © {year} {store_name}. Built with Next.js, Supabase and shadcn/ui.
      </div>
    </footer>
  );
}
