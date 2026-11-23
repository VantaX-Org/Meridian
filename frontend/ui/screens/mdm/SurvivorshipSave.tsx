"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { previewSurvivorship, type SurvivorshipRuleInput } from "@/lib/api/v2/designer";
import { useFixture } from "@/lib/api/v2/fixture";
import { errorSentence } from "@/lib/api/v2/client";
import { t } from "@/lib/v2/i18n";
import { Button, Card, Confirm, DataTable, EmptyState, ErrorState, FieldChip, Sheet, Skeleton, Stepper, StatTile } from "@/ui/kit";
import { useCan } from "@/ui/screens/orphans/useCan";
import { domainLabel } from "./shared";

type Props = { open: boolean; domain: string; rules: SurvivorshipRuleInput[]; removed: number; onClose: () => void; busy: boolean; onSave: () => Promise<boolean> };

/** Preview what the candidate rules change in the golden records, then save them. Saving replaces the rules of the object and needs mdm.write. */
export function SurvivorshipSave({ open, domain, rules, removed, busy, onClose, onSave }: Props) {
  return (
    <Sheet open={open} onClose={onClose} label={t("Check survivorship rules")} closeLabel={t("Close")}>
      {open ? <Body domain={domain} rules={rules} removed={removed} busy={busy} onClose={onClose} onSave={onSave} /> : null}
    </Sheet>
  );
}

function Body({ domain, rules, removed, busy, onClose, onSave }: Omit<Props, "open">) {
  const fx = useFixture();
  const allowed = useCan()("mdm.write");
  const [ask, setAsk] = useState(false);
  const q = useQuery({ queryKey: ["v2", "mdm", "surv-preview", fx, domain, JSON.stringify(rules)], queryFn: () => previewSurvivorship(domain, rules), retry: false, staleTime: 0 });
  const p = q.data;
  const save = async () => {
    setAsk(false);
    if (await onSave()) onClose();
  };
  if (q.isLoading) return <Skeleton lines={6} label={t("Checking the rules against the golden records")} />;
  if (q.isError || !p) return <ErrorState heading={t("The rules could not be checked")} body={errorSentence(q.error, t("Try again."))} retryLabel={t("Try again")} onRetry={() => void q.refetch()} />;
  return (
    <div className="mx-col">
      <Stepper label={t("Rule steps")} current={1} steps={[{ id: "edit", label: t("Edit") }, { id: "preview", label: t("Preview") }, { id: "save", label: t("Save") }]} />
      <Card title={t("What would change")} sub={t("{a} of {b} golden records checked for {obj}", { a: p.clusters_scanned.toLocaleString(), b: p.clusters_total.toLocaleString(), obj: domainLabel(domain) })}>
        <dl className="mx-rules-row">
          <StatTile label={t("Records that change")} value={p.records_changed.toLocaleString()} />
          <StatTile label={t("Values that change")} value={p.values_changed.toLocaleString()} />
          <StatTile label={t("New values that fail the dictionary")} value={p.invalid_values.toLocaleString()} />
        </dl>
        {p.capped ? <p className="mx-muted">{t("Only the first {n} records were checked.", { n: p.cap.toLocaleString() })}</p> : null}
      </Card>
      {p.attributes.length ? (
        <Card title={t("Fields that change")}>
          <DataTable label={t("Fields that change")} rows={p.attributes} rowKey={(a) => a.field} columns={[
            { key: "f", label: t("Field"), render: (a) => <FieldChip code={a.field} description={a.text} /> },
            { key: "c", label: t("Values that change"), align: "end", render: (a) => a.changed.toLocaleString() },
            { key: "i", label: t("Fail the dictionary"), align: "end", render: (a) => (a.check_status === "checked" ? a.invalid.toLocaleString() : t("Not checked")) },
          ]} />
        </Card>
      ) : <EmptyState heading={t("No golden value changes")} body={t("These rules pick the same winners as the rules in place.")} />}
      {p.samples.length ? (
        <Card title={t("Examples")}>
          <DataTable label={t("Examples")} rows={p.samples} rowKey={(s) => `${s.golden_id ?? s.key ?? ""}|${s.field}`} columns={[
            { key: "f", label: t("Field"), render: (s) => <FieldChip code={s.field} /> },
            { key: "b", label: t("Before"), render: (s) => s.before },
            { key: "a", label: t("After"), render: (s) => s.after },
            { key: "w", label: t("Winner"), render: (s) => s.winner_system ?? "" },
          ]} />
        </Card>
      ) : null}
      {allowed ? null : <p className="mx-muted">{t("You need the master data write permission to save rules.")}</p>}
      <div className="mx-rules-row">
        <Button variant="ghost" onClick={onClose}>{t("Back to editing")}</Button>
        <Button variant="primary" disabled={!allowed || busy} title={allowed ? undefined : t("You need the master data write permission to save rules.")} onClick={() => setAsk(true)}>{t("Save rules")}</Button>
      </div>
      <Confirm open={ask} title={t("Save these rules?")} confirmLabel={t("Replace the rules")} cancelLabel={t("Cancel")} onConfirm={() => void save()} onCancel={() => setAsk(false)}>
        {t("The {n} rules for {obj} replace the rules in place. {r} rules left out are deleted. {v} golden values change on the next merge.", { n: rules.length, obj: domainLabel(domain), r: removed, v: p.values_changed.toLocaleString() })}
      </Confirm>
    </div>
  );
}
