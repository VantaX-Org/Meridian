"use client";

/** Me › Preferences: the signed-in user's own display and notification choices. Stored on the server, so they follow the user to any browser. */

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { isAxiosError } from "axios";
import { toast } from "sonner";
import { Button, Card, Field, Notice, PageFrame, PageHeader, Select, Switch } from "@/design";
import { resetSavedViews } from "@/design/table/views";
import { useAuroraPrefs, type DensityTier, type Theme } from "@/hooks/use-theme";
import { usePreferences } from "@/hooks/use-preferences";
import { getHealth } from "@/lib/api/health";
import { sendTestNotification } from "@/lib/api/notifications";
import { apiErrorMessage } from "@/lib/error";
import { formatDate } from "@/lib/format";
import { localeOptions, timezoneOptions, type DigestFrequency } from "@/lib/preferences";
import { queryKeys } from "@/lib/query-keys";

const THEMES: { value: Theme; label: string }[] = [
  { value: "light", label: "Light" }, { value: "system", label: "System" }, { value: "dark", label: "Dark" },
];
const DENSITIES: { value: DensityTier; label: string }[] = [
  { value: "compact", label: "Compact" }, { value: "default", label: "Default" }, { value: "comfortable", label: "Comfortable" },
];
/** Order matches the server's meaning: nothing is sent until the user picks a cadence. */
const DIGESTS: { value: DigestFrequency; label: string }[] = [
  { value: "off", label: "Off" }, { value: "daily", label: "Daily" }, { value: "weekly", label: "Weekly" },
];
/** Select cannot hold an empty value, so "not set" is a named choice that clears the preference. */
const AUTO = "auto";

const NO_EMAIL_NOTICE = "Email is not configured on this deployment; you will get in-app notifications only";

export default function PreferencesPage() {
  const { theme, density, setTheme, setDensity } = useAuroraPrefs();
  const { prefs, update } = usePreferences();
  const health = useQuery({ queryKey: queryKeys.health(), queryFn: getHealth, staleTime: 60_000, retry: false });
  const [testing, setTesting] = useState(false);

  const locales = useMemo(() => {
    const own = prefs.locale && !localeOptions().includes(prefs.locale) ? [prefs.locale] : [];
    return [{ value: AUTO, label: "Browser default" }, ...[...own, ...localeOptions()].map((l) => ({ value: l, label: l }))];
  }, [prefs.locale]);
  const zones = useMemo(() => {
    const all = timezoneOptions();
    const own = prefs.timezone && !all.includes(prefs.timezone) ? [prefs.timezone] : [];
    return [{ value: AUTO, label: "UTC (default)" }, ...[...own, ...all.filter((z) => z !== "UTC")].map((z) => ({ value: z, label: z.replace(/_/g, " ") }))];
  }, [prefs.timezone]);

  // Absent means "not opted in", the same reading the worker gives the stored document.
  const digest = prefs.notifications?.digest ?? "off";
  const critical = prefs.notifications?.immediate_critical ?? false;
  const email = prefs.notifications?.channels?.email ?? false;
  const emailConfigured = health.data ? health.data.email_backend !== null : true;

  const replayTours = () => {
    update({ tours_done: null });
    toast.success("Tours will show again");
  };

  const sendTest = async () => {
    setTesting(true);
    try {
      const result = await sendTestNotification();
      if (result.email === "sent") toast.success("Test sent to your email and your inbox");
      else if (result.email === "no_backend") toast.success("Test sent to your inbox; email is not configured here");
      else if (result.email === "sent_unrecorded") toast.success("Email sent; the delivery log could not be updated");
      else toast.error("The email could not be sent; the test is in your inbox");
    } catch (error) {
      if (isAxiosError(error) && error.response?.status === 429) toast.error("You can send three tests an hour; try again later");
      else toast.error(apiErrorMessage(error));
    } finally {
      setTesting(false);
    }
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
          {!emailConfigured ? <Notice tone="info">{NO_EMAIL_NOTICE}</Notice> : null}
          <Field label="Digest of your open items">
            <Select value={digest} onValueChange={(v) => update({ notifications: { digest: v as DigestFrequency } })} options={DIGESTS} />
          </Field>
          <Switch label="Tell me at once about critical findings" checked={critical} onCheckedChange={(on) => update({ notifications: { immediate_critical: on } })} />
          <Switch label="Also email me" checked={email} onCheckedChange={(on) => update({ notifications: { channels: { email: on } } })} />
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="secondary" pending={testing} onClick={sendTest}>Send me a test</Button>
            <span className="m-text-meta" style={{ color: "var(--m-ink-3)" }}>Writes a test to your inbox{emailConfigured ? " and emails your address" : ""}</span>
          </div>
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
