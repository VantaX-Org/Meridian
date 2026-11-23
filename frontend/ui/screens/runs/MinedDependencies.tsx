"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { acceptMinedRule, type Dependency, type Severity } from "@/lib/api/v2/profile";
import { errorSentence } from "@/lib/api/v2/client";
import { t } from "@/lib/v2/i18n";
import { Button, Card, Confirm, DataTable, EmptyState, FieldChip, Select, useToast, type Column } from "@/ui/kit";
import { useCan } from "@/ui/screens/orphans/useCan";

const SEVS: Severity[] = ["critical", "high", "medium", "low"];
const sevName = (s: Severity) => (s === "critical" ? t("Critical") : s === "high" ? t("High") : s === "medium" ? t("Medium") : t("Low"));

/** Dependencies mined from the profile. Turning one into a rule needs manage_rules, and a confirm names the rule first. */
export function MinedDependencies({ object, deps, onDone }: { object: string; deps: Dependency[]; onDone: () => void }) {
  const toast = useToast();
  const qc = useQueryClient();
  const allowed = useCan()("manage_rules");
  const [sev, setSev] = useState<Severity>("medium");
  const [ask, setAsk] = useState<Dependency | null>(null);
  const go = async () => {
    if (!ask) return;
    try {
      await acceptMinedRule({ module: object, determinant: ask.determinant, dependent: ask.dependent, severity: sev });
      toast(t("Rule created"), "good");
      void qc.invalidateQueries();
      onDone();
    } catch (e) { toast(errorSentence(e, t("The change did not go through")), "bad"); }
    setAsk(null);
  };
  const cols: Column<Dependency>[] = [
    { key: "det", label: t("When this is the same"), render: (d) => <FieldChip code={d.determinant} /> },
    { key: "dep", label: t("This is too"), render: (d) => <FieldChip code={d.dependent} /> },
    { key: "sup", label: t("Rows that follow it"), align: "end", render: (d) => `${Math.round(d.support * 100)}%` },
    { key: "vio", label: t("Rows breaking it"), align: "end", render: (d) => d.violations.toLocaleString() },
    { key: "act", label: t("Action"), render: (d) => (d.accepted ? t("Already a rule") : (
      <Button variant="secondary" disabled={!allowed} title={allowed ? undefined : t("You need the manage rules permission to create rules.")} onClick={() => setAsk(d)}>{t("Make it a rule")}</Button>
    )) },
  ];
  return (
    <Card title={t("Dependencies found")} sub={t("Fields whose value another field decides.")}>
      {!allowed ? <p className="mx-muted">{t("You need the manage rules permission to create rules.")}</p> : null}
      <Select aria-label={t("Severity of a new rule")} value={sev} onChange={(e) => setSev(e.target.value as Severity)} options={SEVS.map((s) => ({ value: s, label: sevName(s) }))} />
      {deps.length ? <DataTable columns={cols} rows={deps} rowKey={(d) => `${d.determinant}>${d.dependent}`} label={t("Dependencies found")} height={240} />
        : <EmptyState heading={t("No dependencies found")} body={t("The profile found no field that decides another.")} />}
      <Confirm open={!!ask} title={t("Make this a rule?")} confirmLabel={t("Create the rule")} cancelLabel={t("Cancel")} onConfirm={() => void go()} onCancel={() => setAsk(null)}>
        {ask ? t("{dep} must match what {det} decides on the other records of {obj}. It runs on every later analysis at {sev} severity. 1 rule is created and {n} rows now break it.", { dep: ask.dependent, det: ask.determinant, obj: object, sev: sevName(sev), n: ask.violations.toLocaleString() }) : null}
      </Confirm>
    </Card>
  );
}
