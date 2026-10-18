"use client";

import { ExternalLinkIcon } from "lucide-react";
import { updateHomeSections } from "@/app/nemesis/actions";
import { FREE_SHIPPING_THRESHOLD_MICROS } from "@/lib/config";
import {
  DEFAULT_HOME_HERO_BADGE,
  DEFAULT_HOME_HERO_PRIMARY_CTA_HREF,
  DEFAULT_HOME_HERO_PRIMARY_CTA_TEXT,
  DEFAULT_HOME_HERO_SECONDARY_CTA_HREF,
  DEFAULT_HOME_HERO_SECONDARY_CTA_TEXT,
  defaultHomeHeroSubtitle,
  defaultHomeHeroTitle,
  HOME_FILTER_TITLE_MAX,
  HOME_FILTER_TITLE_PLACEHOLDER,
  HOME_HERO_BADGE_MAX,
  HOME_HERO_CTA_HREF_MAX,
  HOME_HERO_CTA_TEXT_MAX,
  HOME_HERO_SUBTITLE_MAX,
  HOME_HERO_TITLE_MAX,
  HOME_SECTIONS,
} from "@/lib/home-sections";
import { formatMoney, moneyFromSettings } from "@/lib/money";
import type { SiteSettings } from "@/lib/types";
import { SwitchRow } from "@/components/admin/form-bits";
import { SettingsCard } from "@/components/admin/settings-forms";
import { buttonVariants } from "@/components/ui/button-variants";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

/**
 * UI → Home page: one switch per storefront home section (in storefront order),
 * dynamic Hero section fields, and the heading of the filtered-products section.
 * One form, one Save – the same card as the Settings tabs, so the behaviour
 * (toast, errors, in-place save) is identical.
 */
export function HomeSectionsForm({ settings }: { settings: SiteSettings }) {
  const fallbackTitle = defaultHomeHeroTitle(settings.store_name);
  const fallbackSubtitle = defaultHomeHeroSubtitle(
    formatMoney(FREE_SHIPPING_THRESHOLD_MICROS, moneyFromSettings(settings)),
  );

  return (
    <SettingsCard
      title="Home page sections"
      description="Switch a section off and visitors no longer see it. Changes go live immediately."
      action={updateHomeSections}
      footer={
        <a
          href="/"
          target="_blank"
          rel="noreferrer"
          className={buttonVariants({ variant: "ghost", size: "sm" })}
        >
          View home page <ExternalLinkIcon />
        </a>
      }
    >
      {({ v, err }) => (
        <div className="space-y-3" data-testid="home-sections">
          {HOME_SECTIONS.map((section) => (
            <SwitchRow
              key={section.id}
              id={section.id}
              name={section.id}
              label={section.label}
              description={section.description}
              defaultSelected={settings[section.id]}
            >
              {section.id === "home_show_hero" && (
                <div className="space-y-4" data-testid="home-hero-fields">
                  <div className="grid gap-4 sm:grid-cols-[220px_1fr]">
                    <Field data-invalid={Boolean(err.home_hero_badge) || undefined}>
                      <FieldLabel htmlFor="home_hero_badge">Badge text</FieldLabel>
                      <Input
                        id="home_hero_badge"
                        name="home_hero_badge"
                        maxLength={HOME_HERO_BADGE_MAX}
                        placeholder={DEFAULT_HOME_HERO_BADGE}
                        defaultValue={v.home_hero_badge ?? settings.home_hero_badge ?? ""}
                        aria-invalid={Boolean(err.home_hero_badge) || undefined}
                      />
                      <FieldError>{err.home_hero_badge}</FieldError>
                    </Field>

                    <Field data-invalid={Boolean(err.home_hero_title) || undefined}>
                      <FieldLabel htmlFor="home_hero_title">Hero heading</FieldLabel>
                      <Input
                        id="home_hero_title"
                        name="home_hero_title"
                        maxLength={HOME_HERO_TITLE_MAX}
                        placeholder={fallbackTitle}
                        defaultValue={v.home_hero_title ?? settings.home_hero_title ?? fallbackTitle}
                        aria-invalid={Boolean(err.home_hero_title) || undefined}
                      />
                      <FieldError>{err.home_hero_title}</FieldError>
                    </Field>
                  </div>

                  <Field data-invalid={Boolean(err.home_hero_subtitle) || undefined}>
                    <FieldLabel htmlFor="home_hero_subtitle">Hero description</FieldLabel>
                    <Textarea
                      id="home_hero_subtitle"
                      name="home_hero_subtitle"
                      rows={2}
                      maxLength={HOME_HERO_SUBTITLE_MAX}
                      placeholder={fallbackSubtitle}
                      defaultValue={
                        v.home_hero_subtitle ?? settings.home_hero_subtitle ?? fallbackSubtitle
                      }
                      aria-invalid={Boolean(err.home_hero_subtitle) || undefined}
                    />
                    <FieldError>{err.home_hero_subtitle}</FieldError>
                  </Field>

                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field data-invalid={Boolean(err.home_hero_primary_cta_text) || undefined}>
                      <FieldLabel htmlFor="home_hero_primary_cta_text">
                        Primary button text
                      </FieldLabel>
                      <Input
                        id="home_hero_primary_cta_text"
                        name="home_hero_primary_cta_text"
                        maxLength={HOME_HERO_CTA_TEXT_MAX}
                        placeholder={DEFAULT_HOME_HERO_PRIMARY_CTA_TEXT}
                        defaultValue={
                          v.home_hero_primary_cta_text ?? settings.home_hero_primary_cta_text ?? ""
                        }
                        aria-invalid={Boolean(err.home_hero_primary_cta_text) || undefined}
                      />
                      <FieldError>{err.home_hero_primary_cta_text}</FieldError>
                    </Field>

                    <Field data-invalid={Boolean(err.home_hero_primary_cta_href) || undefined}>
                      <FieldLabel htmlFor="home_hero_primary_cta_href">
                        Primary button link
                      </FieldLabel>
                      <Input
                        id="home_hero_primary_cta_href"
                        name="home_hero_primary_cta_href"
                        maxLength={HOME_HERO_CTA_HREF_MAX}
                        placeholder={DEFAULT_HOME_HERO_PRIMARY_CTA_HREF}
                        defaultValue={
                          v.home_hero_primary_cta_href ??
                          settings.home_hero_primary_cta_href ??
                          DEFAULT_HOME_HERO_PRIMARY_CTA_HREF
                        }
                        aria-invalid={Boolean(err.home_hero_primary_cta_href) || undefined}
                      />
                      <FieldError>{err.home_hero_primary_cta_href}</FieldError>
                    </Field>
                  </div>

                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field data-invalid={Boolean(err.home_hero_secondary_cta_text) || undefined}>
                      <FieldLabel htmlFor="home_hero_secondary_cta_text">
                        Secondary link text
                      </FieldLabel>
                      <Input
                        id="home_hero_secondary_cta_text"
                        name="home_hero_secondary_cta_text"
                        maxLength={HOME_HERO_CTA_TEXT_MAX}
                        placeholder={DEFAULT_HOME_HERO_SECONDARY_CTA_TEXT}
                        defaultValue={
                          v.home_hero_secondary_cta_text ??
                          settings.home_hero_secondary_cta_text ??
                          ""
                        }
                        aria-invalid={Boolean(err.home_hero_secondary_cta_text) || undefined}
                      />
                      <FieldError>{err.home_hero_secondary_cta_text}</FieldError>
                    </Field>

                    <Field data-invalid={Boolean(err.home_hero_secondary_cta_href) || undefined}>
                      <FieldLabel htmlFor="home_hero_secondary_cta_href">
                        Secondary link URL
                      </FieldLabel>
                      <Input
                        id="home_hero_secondary_cta_href"
                        name="home_hero_secondary_cta_href"
                        maxLength={HOME_HERO_CTA_HREF_MAX}
                        placeholder={DEFAULT_HOME_HERO_SECONDARY_CTA_HREF}
                        defaultValue={
                          v.home_hero_secondary_cta_href ??
                          settings.home_hero_secondary_cta_href ??
                          DEFAULT_HOME_HERO_SECONDARY_CTA_HREF
                        }
                        aria-invalid={Boolean(err.home_hero_secondary_cta_href) || undefined}
                      />
                      <FieldError>{err.home_hero_secondary_cta_href}</FieldError>
                    </Field>
                  </div>
                </div>
              )}

              {section.id === "home_show_filter" && (
                <Field data-invalid={Boolean(err.home_filter_title) || undefined}>
                  <FieldLabel htmlFor="home_filter_title">Section title</FieldLabel>
                  <Input
                    id="home_filter_title"
                    name="home_filter_title"
                    maxLength={HOME_FILTER_TITLE_MAX}
                    placeholder={HOME_FILTER_TITLE_PLACEHOLDER}
                    defaultValue={v.home_filter_title ?? settings.home_filter_title ?? ""}
                    aria-invalid={Boolean(err.home_filter_title) || undefined}
                  />
                  <FieldError>{err.home_filter_title}</FieldError>
                </Field>
              )}
            </SwitchRow>
          ))}
        </div>
      )}
    </SettingsCard>
  );
}
