"use client";

import { useState } from "react";
import { updateRetention } from "@/lib/api/retention";
import { formatInt } from "@/lib/format";
import { useRetention, usePurgeLog } from "@/lib/v2/admin-queries";
import { t } from "@/lib/v2/i18n";
import { Button, Card, Code, DataTable, Field, Input, Toggle } from "@/ui/kit";
import { Row, Sec, useAct, when } from "./shared";

const days = (v: string): number | null => (v.trim() === "" ? null : Math.max(1, Number(v) || 1));

export function Data() {
  const ret = useRetention();
  const log = usePurgeLog();
  const { run, busy } = useAct("settings");
  const [d, setD] = useState<{ v?: string; r?: string; a?: string; base?: boolean; keep?: string }>({});
  const p = ret.data?.policy;
  const e = ret.data?.enforcement;
  const val = (k: "v" | "r" | "a", n: number | null | undefined) => d[k] ?? (n == null ? "" : String(n));
  const save = () => p && run(() => updateRetention({
    versions_days: days(val("v", p.versions_days)), reports_days: days(val("r", p.reports_days)), audit_days: days(val("a", p.audit_days)),
    keep_baseline: d.base ?? p.keep_baseline, keep_latest_per_system: Number(d.keep ?? p.keep_latest_per_system),
  }), t("Retention saved."));
  const entries = log.data ?? [];
  return (
    <Sec title={t("Data retention")} scope="data" q={[ret, log]} context={t("How long runs, reports and audit entries are kept.")}
      facts={[e ? (e.enforced ? t("Retention deletes for real each night.") : t("Retention is in dry run, nothing is deleted yet.")) : ""]}>
      <Card title={t("Retention policy")} sub={e?.enforced ? t("Enforced nightly") : t("Dry run only")}>
        <Row>
          <Field label={t("Keep runs, days")} hint={t("Empty keeps them for ever")}><Input inputMode="numeric" value={val("v", p?.versions_days)} onChange={(x) => setD({ ...d, v: x.target.value })} /></Field>
          <Field label={t("Keep reports, days")}><Input inputMode="numeric" value={val("r", p?.reports_days)} onChange={(x) => setD({ ...d, r: x.target.value })} /></Field>
          <Field label={t("Keep audit, days")}><Input inputMode="numeric" value={val("a", p?.audit_days)} onChange={(x) => setD({ ...d, a: x.target.value })} /></Field>
          <Field label={t("Latest runs kept per system")}><Input inputMode="numeric" value={d.keep ?? String(p?.keep_latest_per_system ?? 1)} onChange={(x) => setD({ ...d, keep: x.target.value })} /></Field>
          <Toggle label={t("Always keep the baseline run")} checked={d.base ?? p?.keep_baseline ?? true} onChange={(v) => setD({ ...d, base: v })} />
          <Button variant="primary" disabled={busy} onClick={save}>{t("Save policy")}</Button>
        </Row>
      </Card>
      <Card title={t("Purge log")} sub={t("{n} recent purges", { n: entries.length })}>
        {entries.length === 0 ? <p className="mx-muted">{t("Nothing has been purged.")}</p> : (
          <DataTable label={t("Purge log")} rows={entries} rowKey={(r) => r.id} height={300}
            columns={[
              { key: "at", label: t("When"), render: (r) => when(r.created_at), sort: (r) => r.created_at },
              { key: "kind", label: t("Kind"), render: (r) => <Code code={r.kind} description={r.dry_run ? t("Dry run") : t("Deleted")} /> },
              { key: "who", label: t("By"), render: (r) => r.actor_email ?? t("Nightly task") },
              { key: "bytes", label: t("Bytes freed"), align: "end", render: (r) => formatInt(r.bytes_freed) },
              { key: "blocked", label: t("Blocked"), render: (r) => r.blocked_reason ?? "" },
            ]} />
        )}
      </Card>
    </Sec>
  );
}
