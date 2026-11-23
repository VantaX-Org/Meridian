"use client";

import { useQuery } from "@tanstack/react-query";
import { useLicence, useUpdateStatus } from "@/lib/v2/admin-queries";
import { loadHelp, videoUrl } from "@/lib/v2/help";
import { t } from "@/lib/v2/i18n";
import type { SheetDef } from "@/ui/kit";
import { Card, Code, DataTable, ErrorState, Skeleton, StatTile } from "@/ui/kit";
import { PrefsForm } from "../PrefsForm";
import { Stack, day } from "../ops/shared";

function LicenceSheet() {
  const q = useLicence();
  const l = q.data;
  if (!l) return <Skeleton lines={4} label={t("Loading licence")} />;
  return (
    <Stack>
      <dl className="mx-tiles">
        <StatTile label={t("Status")} value={l.status} note={l.company_name} />
        <StatTile label={t("Tier")} value={l.tier ?? ""} />
        <StatTile label={t("Seats")} value={`${l.seats_used ?? 0} / ${l.seats ?? "-"}`} />
        <StatTile label={t("Expires")} value={day(l.expiry_date)} note={l.days_remaining !== undefined ? t("{n} days left", { n: l.days_remaining }) : undefined} />
      </dl>
      <Card title={t("Licensed modules")}>
        <DataTable label={t("Licensed modules")} rows={l.enabled_modules.map((m) => ({ m }))} rowKey={(r) => r.m} height={240}
          columns={[{ key: "m", label: t("Module"), render: (r) => <Code code={r.m} /> }]} />
      </Card>
    </Stack>
  );
}

/** Display only. Meridian never starts an update from the UI: the server operator runs it. */
function UpdateSheet() {
  const q = useUpdateStatus();
  const u = q.data;
  if (!u) return <Skeleton lines={4} label={t("Loading version")} />;
  return (
    <Stack>
      <dl className="mx-tiles">
        <StatTile label={t("Installed")} value={u.current_version} />
        <StatTile label={t("Newest")} value={u.latest_version} note={u.update_available ? t("An update is available") : t("Up to date")} />
      </dl>
      {u.release_notes ? <Card title={t("Release notes")}><p className="mx-muted">{u.release_notes}</p></Card> : null}
      <p className="mx-muted">{t("Updates are run by your Meridian operator, not from this screen.")}</p>
    </Stack>
  );
}

function HelpSheet() {
  const q = useQuery({ queryKey: ["help-index"], queryFn: loadHelp, retry: false });
  if (q.isError) return <ErrorState heading={t("Help could not be loaded")} retryLabel={t("Try again")} onRetry={() => void q.refetch()} />;
  const h = q.data;
  if (!h) return <Skeleton lines={6} label={t("Loading help")} />;
  return (
    <Stack>
      {h.chapters.slice(0, 12).map((c) => (
        <Card key={c.id} title={c.title} sub={c.summary}>
          {c.video ? <video controls preload="none" poster={videoUrl(c.video, "jpg")} src={videoUrl(c.video, "mp4")} /> : null}
          {c.sections.slice(0, 3).map((s) => <p key={s.heading}><strong>{s.heading}</strong> {s.text}</p>)}
        </Card>
      ))}
    </Stack>
  );
}

const REPORTS: SheetDef = {
  get label() { return t("Report guide"); },
  render: () => (
    <Stack>
      <p>{t("Build makes a file now and saves it under built files. A schedule builds the same report on a set day and sends it to people or channels. Export writes one dataset with the columns you choose.")}</p>
    </Stack>
  ),
};

export const ADMIN_SHEETS: Record<string, SheetDef> = {
  licence: { get label() { return t("Licence"); }, render: () => <LicenceSheet /> },
  notify: { get label() { return t("Notification settings"); }, render: () => <PrefsForm /> },
  update: { get label() { return t("Version"); }, render: () => <UpdateSheet /> },
  report: REPORTS,
  preferences: { get label() { return t("Preferences"); }, render: () => <PrefsForm /> },
  help: { get label() { return t("Help"); }, render: () => <HelpSheet /> },
};
