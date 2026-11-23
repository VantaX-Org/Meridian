"use client";

/**
 * The top of Administration: systems, licence, schedule, people and the audit trail on one board. Every figure is read
 * from an existing hook; what no endpoint supplies is left out (see the change report).
 */
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useFixture, withFixture } from "@/lib/api/v2/fixture";
import { testSystemConnection } from "@/lib/api/v2/runs";
import { useAudit, useLicence, useRunSchedules, useUpdateStatus, useUsers } from "@/lib/v2/admin-queries";
import { runKeys, useSystemExtractions, useSystemsExtended } from "@/lib/v2/runs-queries";
import { t, useInterfaceLang } from "@/lib/v2/i18n";
import { labelText, moduleText, roleText } from "@/lib/v2/labels";
import { Button, Card, DataTable, EmptyState, Skeleton, StatTile, useSheet, useToast } from "@/ui/kit";
import { Health, envLabel, errMsg, typeLabel, when } from "../systems/shared";
import { day, useCan } from "./common";
import type { SAPSystemExtended } from "@/types/api";
import "./adminboard.css";

function SystemCard({ s }: { s: SAPSystemExtended }) {
  const fx = useFixture();
  const qc = useQueryClient();
  const toast = useToast();
  const can = useCan();
  const [busy, setBusy] = useState(false);
  const ex = useSystemExtractions(s.id);
  const last = ex.data?.versions?.[0];
  const records = last ? Object.values(last.records).reduce((a, b) => a + b, 0) : null;
  const test = async () => {
    setBusy(true);
    try {
      const r = await testSystemConnection(s.id);
      toast(r.connected ? t("{name} answered.", { name: s.name }) : t("{name} did not answer: {why}", { name: s.name, why: r.message }), r.connected ? "good" : "bad");
      await qc.invalidateQueries({ queryKey: runKeys.systems(fx) });
    } catch (e) { toast(errMsg(e), "bad"); } finally { setBusy(false); }
  };
  const manage = can("manage_systems");
  return (
    <li className="ab-sys" data-testid="admin-system">
      <div className="ab-sys-head"><strong>{s.name}</strong><Health value={s.health_status} /></div>
      <p className="mx-muted">{typeLabel(s.system_type)}, {envLabel(s.environment)}</p>
      <dl className="ab-facts">
        <div><dt>{t("Release")}</dt><dd>{s.sap_release ?? t("Unknown")}</dd></div>
        <div><dt>{t("Client")}</dt><dd>{s.client ?? t("None")}</dd></div>
        <div><dt>{t("Last extract")}</dt><dd>{last ? when(last.run_at) : t("Never")}</dd></div>
        <div><dt>{t("Records")}</dt><dd>{records === null ? t("None") : records.toLocaleString()}</dd></div>
      </dl>
      <div className="ab-actions">
        <Button variant="secondary" disabled={busy || !manage} onClick={() => void test()}>{busy ? t("Testing") : t("Test connection")}</Button>
        <Button variant="ghost" href={withFixture(`/s/${s.id}`, fx)}>{t("Edit")}</Button>
        <Button variant="ghost" href={withFixture(`/s/${s.id}`, fx)}>{t("Extract now")}</Button>
      </div>
    </li>
  );
}

export function AdminBoard() {
  useInterfaceLang();
  const fx = useFixture();
  const href = (p: string) => withFixture(p, fx);
  const sheet = useSheet();
  const systems = useSystemsExtended();
  const licence = useLicence();
  const schedules = useRunSchedules();
  const update = useUpdateStatus();
  const users = useUsers({});
  const audit = useAudit({ limit: 5 });
  const list = systems.data ?? [];
  const lic = licence.data;
  const people = users.data?.users ?? [];
  const byRole = Object.entries(people.reduce<Record<string, number>>((m, u) => ({ ...m, [u.role]: (m[u.role] ?? 0) + 1 }), {}));
  const next = (schedules.data?.schedules ?? []).filter((x) => x.active && x.next_run_at).map((x) => x.next_run_at as string).sort()[0];
  return (
    <section className="ab-board" data-testid="admin-board" aria-label={t("Administration board")}>
      <Card title={t("Systems")} sub={t("{n, plural, one {# system} other {# systems}}", { n: list.length })}
        action={<Button variant="primary" href={href("/s/new")}>{t("Add a system")}</Button>}>
        {systems.isLoading ? <Skeleton lines={3} label={t("Loading the systems")} /> : list.length === 0 ? <EmptyState heading={t("No system is connected yet")} body={t("Connect a system to start analysing it.")} /> : (
          <ul className="ab-systems">{list.map((s) => <SystemCard key={s.id} s={s} />)}</ul>
        )}
      </Card>
      <div className="ab-grid">
        <Card title={t("Licence")} action={<Button variant="secondary" onClick={() => sheet.open("licence")}>{t("Upload licence file")}</Button>}>
          {licence.isLoading ? <Skeleton lines={3} label={t("Loading the licence")} /> : !lic ? <EmptyState heading={t("No licence data")} body={t("Reload the page. If this stays empty, ask your account contact.")} /> : (
            <>
              <dl className="ab-tiles">
                <StatTile label={t("Days left")} value={lic.days_remaining ?? t("None")} note={lic.expiry_date ? t("Ends {date}", { date: day(lic.expiry_date) }) : undefined} />
                <StatTile label={t("Seats used")} value={lic.seats_used ?? 0} note={lic.seats ? t("of {n}", { n: lic.seats }) : undefined} />
              </dl>
              <p className="ab-sub">{t("Licensed objects")}</p>
              <ul className="ab-chips">{lic.enabled_modules.map((m) => <li key={m}>{moduleText(m)}</li>)}</ul>
            </>
          )}
        </Card>
        <Card title={t("Schedule and version")}>
          <dl className="ab-tiles">
            <StatTile label={t("Next run")} value={next ? day(next) : t("None")} />
            <StatTile label={t("Version")} value={update.data?.current_version ?? t("Unknown")} note={update.data?.update_available ? t("{v} is available", { v: update.data.latest_version }) : undefined} />
          </dl>
          <div className="ab-actions">
            <Button variant="secondary" href={href("/admin/schedules")}>{t("Change schedule")}</Button>
            <Button variant="secondary" onClick={() => sheet.open("update")}>{t("Update now")}</Button>
          </div>
        </Card>
        <Card title={t("People and roles")}>
          <dl className="ab-tiles"><StatTile label={t("People")} value={people.length} /><StatTile label={t("Roles in use")} value={byRole.length} /></dl>
          <ul className="ab-chips">{byRole.map(([r, n]) => <li key={r}>{roleText(r)}: {n}</li>)}</ul>
          <div className="ab-actions">
            <Button variant="primary" href={href("/admin/users")}>{t("Invite a person")}</Button>
            <Button variant="secondary" href={href("/admin/roles")}>{t("Edit roles")}</Button>
          </div>
        </Card>
      </div>
      <Card title={t("Audit trail")} action={<Button variant="ghost" href={href("/admin/audit")}>{t("Open the audit trail")}</Button>}>
        {audit.isLoading ? <Skeleton lines={3} label={t("Loading the audit trail")} /> : (audit.data?.entries.length ?? 0) === 0 ? <EmptyState heading={t("No audit entries")} body={t("Entries appear here after people make changes.")} /> : (
          <DataTable
            label={t("Audit trail")}
            rows={audit.data?.entries ?? []}
            rowKey={(r) => r.id}
            columns={[
              { key: "w", label: t("When"), render: (r) => day(r.created_at) },
              { key: "a", label: t("Who"), render: (r) => r.actor_email ?? t("System") },
              { key: "x", label: t("Action"), render: (r) => labelText(r.action) },
            ]}
          />
        )}
      </Card>
    </section>
  );
}
