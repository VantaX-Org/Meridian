"use client";

import { useAct, useSectionChat, day, Facts, Frame } from "../common";
import { Button, Card, Code, EmptyState, SeverityPill, StatTile } from "@/ui/kit";
import { useLicence } from "@/lib/v2/admin-queries";
import { validateLicence } from "@/lib/api/v2/admin";
import { moduleText } from "@/lib/v2/labels";
import { t, tx } from "@/lib/v2/i18n";
import { whole } from "@/lib/v2/format";

export function Licence() {
  const q = useLicence();
  const { run, busy } = useAct();
  const l = q.data;
  const facts: string[] = l
    ? [
        l.valid ? t("The licence is valid until {date}.", { date: day(l.expiry_date) }) : t("The licence is not valid."),
        t("{used} of {limit} seats are used.", { used: whole(l.seats_used ?? 0), limit: whole(l.seats ?? 0) }),
        t("{n} modules are licensed.", { n: whole(l.enabled_modules.length) }),
      ]
    : [];
  useSectionChat("licence", t("Licence"), facts, [t("When does the licence expire?"), t("How many seats are left?")]);

  return (
    <Frame
      slug="licence"
      title={t("Licence")}
      lead={t("What this deployment is licensed for: modules, seats and validity.")}
      loading={q.isLoading}
      error={q.isError}
      actions={<Button variant="secondary" type="button" disabled={busy} onClick={() => run(() => validateLicence(), t("Licence checked."), ["licence"])}>{t("Check licence now")}</Button>}
    >
      {!l ? <EmptyState heading={t("No licence information")} body={t("The licence service returned nothing.")} /> : (
        <>
          <dl className="mx-tiles">
            <StatTile label={t("Status")} value={tx(l.status)} note={l.company_name ?? ""} bar={l.valid ? 100 : 0} barTone="pass" />
            <StatTile label={t("Days remaining")} value={whole(l.days_remaining ?? 0)} note={day(l.expiry_date)} bar={Math.min(100, ((l.days_remaining ?? 0) / 365) * 100)} barTone="data" />
            <StatTile label={t("Seats used")} value={`${whole(l.seats_used ?? 0)} / ${whole(l.seats ?? 0)}`} note={t("Named users")} bar={l.seats ? Math.min(100, ((l.seats_used ?? 0) / l.seats) * 100) : 0} barTone="data" />
          </dl>
          {l.offline_grace?.active && (
            <Card title={t("Offline grace")} sub={t("The licence service is unreachable. Meridian keeps working on the last signed licence.")}>
              <Facts items={[
                [t("Days left"), whole(l.offline_grace.days_left)],
                [t("Ends"), day(l.offline_grace.ends_at)],
                [t("Grace period"), t("{n} days", { n: whole(l.offline_grace.grace_days) })],
              ]} />
            </Card>
          )}
          <Card title={t("Licence")}>
            <Facts items={[
              [t("Company"), l.company_name ?? t("None")],
              [t("Tier"), l.tier ? tx(l.tier) : t("None")],
              [t("Valid"), <SeverityPill key="v" sev={l.valid ? "info" : "critical"} label={l.valid ? t("Valid") : t("Not valid")} />],
              [t("Last checked"), day(l.last_validated)],
              [t("Latest version"), l.latest_version ?? t("None")],
            ]} />
          </Card>
          <Card title={t("Licensed modules")} sub={t("{n} modules", { n: whole(l.enabled_modules.length) })}>
            {l.enabled_modules.length === 0 ? <EmptyState heading={t("No modules are licensed")} body={t("Ask your account contact to add modules to the licence.")} /> : (
              <ul className="mx-links">
                {l.enabled_modules.map((m) => <li key={m}><Code code={m} description={moduleText(m)} /></li>)}
              </ul>
            )}
          </Card>
          <Card title={t("Features")}>
            <Facts items={[
              [t("Ask Meridian"), l.features.ask_meridian ? t("On") : t("Off")],
              [t("Export reports"), l.features.export_reports ? t("On") : t("Off")],
              [t("Run sync"), l.features.run_sync ? t("On") : t("Off")],
              [t("Field mapping self service"), l.features.field_mapping_self_service ? t("On") : t("Off")],
              [t("Most users"), whole(l.features.max_users)],
            ]} />
          </Card>
          {l.release_notes && <Card title={t("Release notes")}><p className="mx-muted">{l.release_notes}</p></Card>}
        </>
      )}
    </Frame>
  );
}
