"use client";

import { useState } from "react";
import { patchMyPreferences } from "@/lib/api/v2/admin";
import type { DensityTier, DigestFrequency, Theme } from "@/lib/preferences";
import { useMyPreferences } from "@/lib/v2/admin-queries";
import { t } from "@/lib/v2/i18n";
import { Button, Field, Select, Toggle } from "@/ui/kit";
import { Row, useAct } from "./ops/shared";

/** The person's own settings: look, density, and when to be told. Saved as one patch. */
export function PrefsForm() {
  const q = useMyPreferences();
  const { run, busy } = useAct("me");
  const [d, setD] = useState<{ theme?: Theme; density?: DensityTier; digest?: DigestFrequency; crit?: boolean }>({});
  const p = q.data;
  const theme = d.theme ?? p?.theme ?? "system";
  const density = d.density ?? p?.density ?? "default";
  const digest = d.digest ?? p?.notifications?.digest ?? "daily";
  const crit = d.crit ?? p?.notifications?.immediate_critical ?? true;
  const setTheme = (theme: Theme) => setD((o) => ({ ...o, theme }));
  const setDensity = (density: DensityTier) => setD((o) => ({ ...o, density }));
  const setDigest = (digest: DigestFrequency) => setD((o) => ({ ...o, digest }));
  const setCrit = (crit: boolean) => setD((o) => ({ ...o, crit }));
  const save = () => run(() => patchMyPreferences({ theme, density, notifications: { digest, immediate_critical: crit } }), t("Preferences saved."));
  return (
    <Row>
      <Field label={t("Theme")}><Select value={theme} onChange={(e) => setTheme(e.target.value as Theme)} options={[{ value: "system", label: t("Follow the device") }, { value: "light", label: t("Light") }, { value: "dark", label: t("Dark") }]} /></Field>
      <Field label={t("Density")}><Select value={density} onChange={(e) => setDensity(e.target.value as DensityTier)} options={[{ value: "compact", label: t("Compact") }, { value: "default", label: t("Default") }, { value: "comfortable", label: t("Comfortable") }]} /></Field>
      <Field label={t("Digest")}><Select value={digest} onChange={(e) => setDigest(e.target.value as DigestFrequency)} options={[{ value: "daily", label: t("Daily") }, { value: "weekly", label: t("Weekly") }, { value: "off", label: t("Off") }]} /></Field>
      <Toggle label={t("Tell me at once about critical findings")} checked={crit} onChange={setCrit} />
      <Button variant="primary" disabled={busy} onClick={save}>{t("Save")}</Button>
    </Row>
  );
}
