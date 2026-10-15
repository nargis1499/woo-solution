"use client";

import { ExternalLinkIcon } from "lucide-react";
import { updateHomeSections } from "@/app/nemesis/actions";
import { HOME_FILTER_TITLE_MAX, HOME_FILTER_TITLE_PLACEHOLDER, HOME_SECTIONS } from "@/lib/home-sections";
import type { SiteSettings } from "@/lib/types";
import { SwitchRow } from "@/components/admin/form-bits";
import { SettingsCard } from "@/components/admin/settings-forms";
import { buttonVariants } from "@/components/ui/button-variants";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

/**
 * UI → Home page: one switch per storefront home section (in storefront order) and the
 * heading of the filtered-products section. One form, one Save – the same card as the
 * Settings tabs, so the behaviour (toast, errors, in-place save) is identical.
 */
export function HomeSectionsForm({ settings }: { settings: SiteSettings }) {
  return (
    <SettingsCard
      title="Home page sections"
      description="Switch a section off and visitors no longer see it. Changes go live immediately."
      action={updateHomeSections}
      footer={
        <a href="/" target="_blank" rel="noreferrer" className={buttonVariants({ variant: "ghost", size: "sm" })}>
          View home page <ExternalLinkIcon />
        </a>
      }
    >
      {({ v, err }) => (
        <div className="space-y-3" data-testid="home-sections">
          {HOME_SECTIONS.map((section) => (
            <SwitchRow key={section.id} id={section.id} name={section.id} label={section.label} description={section.description} defaultSelected={settings[section.id]}>
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
