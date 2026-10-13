"use client";

/** Me › Preferences: the signed-in user's own display and notification choices. Stored on the server, so they follow the user to any browser. */

import { useMemo } from "react";
import { toast } from "sonner";
import { Button, Card, Field, PageFrame, PageHeader, Select, Switch } from "@/design";
import { resetSavedViews } from "@/design/table/views";
import { useAuroraPrefs, type DensityTier, type Theme } from "@/hooks/use-theme";
import { usePreferences } from "@/hooks/use-preferences";
import { formatDate } from "@/lib/format";
import { localeOptions, timezoneOptions, type DigestFrequency } from "@/lib/preferences";

const THEMES: { value: Theme; label: string }[] = [
  { value: "light", label: "Light" }, { value: "system", label: "System" }, { value: "dark", label: "Dark" },
];
const DENSITIES: { value: DensityTier; label: string }[] = [
  { value: "compact", label: "Compact" }, { value: "default", label: "Default" }, { value: "comfortable", label: "Comfortable" },
];
const DIGESTS: { value: DigestFrequency; label: string }[] = [
  { value: "daily", label: "Daily" }, { value: "weekly", label: "Weekly" }, { value: "off", label: "Off" },
];
/** Select cannot hold an empty value, so "not set" is a named choice that clears the preference. */
const AUTO = "auto";

export default function PreferencesPage() {
  const { theme, density, setTheme, setDensity } = useAuroraPrefs();
  const { prefs, update } = usePreferences();

  const locales = useMemo(() => {
    const own = prefs.locale && !localeOptions().includes(prefs.locale) ? [prefs.locale] : [];
    return [{ value: AUTO, label: "Browser default" }, ...[...own, ...localeOptions()].map((l) => ({ value: l, label: l }))];
  }, [prefs.locale]);
  const zones = useMemo(() => {
    const all = timezoneOptions();
    const own = prefs.timezone && !all.includes(prefs.timezone) ? [prefs.timezone] : [];
    return [{ value: AUTO, label: "UTC (default)" }, ...[...own, ...all.filter((z) => z !== "UTC")].map((z) => ({ value: z, label: z.replace(/_/g, " ") }))];
  }, [prefs.timezone]);

  const digest = prefs.notifications?.digest ?? "daily";
  const critical = prefs.notifications?.immediate_critical ?? true;

  const replayTours = () => {
    try {
      Object.keys(window.localStorage).filter((k) => k.startsWith("m-tour:")).forEach((k) => window.localStorage.removeItem(k));
    } catch {
      /* storage blocked: the stored list below is the source of truth */
    }
    update({ tours_done: null });
    toast.success("Tours will show again");
  };

  return (
    <PageFrame gap={4}>
      <PageHeader title="Preferences" meta="Saved to your account, so they follow you to any browser" />
      <Card title="Display">
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Theme"><Select value={theme} onValueChange={(v) => setTheme(v as Theme)} options={THEMES} /></Field>
          <Field label="Row density"><Select value={density} onValueChange={(v) => setDensity(v as DensityTier)} options={DENSITIES} /></Field>
          <Field label="Language and region">
            <Select value={prefs.locale ?? AUTO} onValueChange={(v) => update({ locale: v === AUTO ? null : v })} options={locales} />
          </Field>
          <Field label="Time zone">
            <Select value={prefs.timezone ?? AUTO} onValueChange={(v) => update({ timezone: v === AUTO ? null : v })} options={zones} />
          </Field>
        </div>
        <p className="m-text-meta mt-3" style={{ color: "var(--m-ink-3)" }}>Dates look like {formatDate(new Date(), "datetime")}</p>
      </Card>
      <Card title="Notifications" meta="Where and how alerts reach you">
        <div className="flex flex-col gap-4">
          <Field label="Digest">
            <Select value={digest} onValueChange={(v) => update({ notifications: { digest: v as DigestFrequency } })} options={DIGESTS} />
          </Field>
          <Switch label="Tell me at once about critical findings" checked={critical} onCheckedChange={(on) => update({ notifications: { immediate_critical: on } })} />
        </div>
      </Card>
      <Card title="Guidance and saved views">
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={replayTours}>Replay tours</Button>
          <Button variant="secondary" onClick={() => { resetSavedViews(); toast.success("Saved views removed"); }}>Reset saved views</Button>
        </div>
      </Card>
    </PageFrame>
  );
}
