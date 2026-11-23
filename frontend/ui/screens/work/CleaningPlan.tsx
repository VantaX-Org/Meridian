"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useFixture } from "@/lib/api/v2/fixture";
import { getCleaningPlan, type CleaningItem } from "@/lib/api/v2/aletheia-engine";
import { draftFix, getFixCoverage, type FixDraft } from "@/lib/api/v2/fix-drafts";
import { t } from "@/lib/v2/i18n";
import { Button, Card, DataTable, EmptyState, ErrorState, Field, FieldChip, Select, Sheet, Skeleton, StatTile } from "@/ui/kit";
import { useCan } from "@/ui/screens/orphans/useCan";
import { ObjChip } from "./ObjChip";
import { sevLabel, useDo } from "./shared";

const n0 = (n: number) => n.toLocaleString();
/** A rule that already carries an automatic fix cannot be drafted again; the backend answers 409. */
const hasFix = (i: CleaningItem) => i.suggestion?.source === "rule_auto_fix";
const kindText = (k: string) => k === "auto" ? t("Fix ready") : k === "fill" ? t("Fill in") : k === "pick" ? t("Pick a value") : t("Review");

/** Why each failing rule of one object fails, the batches of fixes, and a drafted fix for rules that have none. */
export function CleaningPlan() {
  const fx = useFixture();
  const run = useDo();
  const can = useCan()("manage_rules");
  const cov = useQuery({ queryKey: ["v2", "cleaning", fx, "plan-modules"], queryFn: getFixCoverage, retry: false });
  const [pick, setPick] = useState("");
  const [draft, setDraft] = useState<FixDraft | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const mdl = pick || cov.data?.modules[0]?.module || "";
  const plan = useQuery({ queryKey: ["v2", "cleaning", fx, "plan", mdl], queryFn: () => getCleaningPlan(mdl), enabled: !!mdl, retry: false });

  if (cov.isLoading) return <Skeleton lines={5} label={t("Loading the cleaning plan")} />;
  if (cov.isError) return <ErrorState heading={t("The cleaning plan could not be loaded")} retryLabel={t("Try again")} onRetry={() => void cov.refetch()} />;
  if (!cov.data?.modules.length) return <EmptyState heading={t("No objects to plan")} body={t("Run an analysis first.")} />;

  const drafted = async (i: CleaningItem) => {
    setBusy(i.rule);
    const d = await run(() => draftFix(mdl, i.rule), () => t("Fix drafted. It waits for a steward."));
    setBusy(null);
    if (d) setDraft(d);
  };
  const p = plan.data;
  return (
    <div className="mx-col">
      <Field label={t("Object")}>
        <Select value={mdl} onChange={(e) => setPick(e.target.value)} options={cov.data.modules.map((m) => ({ value: m.module, label: m.module }))} />
      </Field>
      {plan.isLoading ? <Skeleton lines={5} label={t("Loading the cleaning plan")} /> : null}
      {plan.isError || (!plan.isLoading && !p) ? <ErrorState heading={t("There is no plan for this object")} body={t("It needs at least one finished run.")} retryLabel={t("Try again")} onRetry={() => void plan.refetch()} /> : null}
      {p ? (
        <>
          <p className="mx-muted">{p.changes.available ? p.changes.narrative : t("There is no earlier run to compare with.")}</p>
          <dl className="mx-tiles">
            <StatTile label={t("Failing rules")} value={n0(p.items.length)} />
            <StatTile label={t("Fix batches")} value={n0(p.batches.length)} />
            <StatTile label={t("Records failing")} value={n0(p.items.reduce((s, i) => s + i.affected, 0))} />
          </dl>
          {p.items.length === 0 ? <EmptyState heading={t("Nothing fails in this run")} body={t("No cleaning is needed for this object.")} /> : (
            <DataTable label={t("Why each rule fails")} rows={p.items} rowKey={(i) => i.rule} height={320} columns={[
              { key: "rule", label: t("Rule"), render: (i) => <FieldChip code={i.rule} description={i.message} /> },
              { key: "field", label: t("Field"), render: (i) => <FieldChip code={i.field} description={i.field_label} /> },
              { key: "sev", label: t("Severity"), render: (i) => sevLabel(i.severity) },
              { key: "affected", label: t("Records"), align: "end", sort: (i) => i.affected, render: (i) => `${n0(i.affected)} / ${n0(i.total)}` },
              { key: "kind", label: t("Next step"), render: (i) => kindText(i.kind) },
              { key: "act", label: t("Draft"), render: (i) => hasFix(i) ? t("Has a fix") : (
                <Button variant="ghost" disabled={!can || busy !== null} title={can ? undefined : t("You need the manage rules permission to draft a fix.")} onClick={() => void drafted(i)}>
                  {busy === i.rule ? t("Drafting") : t("Draft a fix")}
                </Button>
              ) },
            ]} />
          )}
          {can ? null : <p className="mx-muted">{t("You need the manage rules permission to draft a fix.")}</p>}
          {p.batches.length ? (
            <Card title={t("Fix batches")} sub={t("Rules that share a field are fixed in one go.")}>
              <ol className="mx-col">
                {p.batches.map((b) => (
                  <li key={b.id}><FieldChip code={b.field} description={b.field_label} /> {kindText(b.kind)}, {t("{n} records", { n: n0(b.affected) })}. {b.instruction}</li>
                ))}
              </ol>
            </Card>
          ) : null}
        </>
      ) : null}
      <Sheet open={!!draft} onClose={() => setDraft(null)} label={t("Drafted fix")} closeLabel={t("Close")}>
        {draft ? (
          <div className="mx-col">
            <p><ObjChip code={draft.module ?? mdl} /> <FieldChip code={draft.field} description={draft.field_text ?? undefined} /></p>
            <dl className="mx-tiles">
              <StatTile label={t("Failing now")} value={n0(draft.shape.total_failing)} />
              <StatTile label={t("Fixed by the draft")} value={n0(draft.verification?.fixed ?? 0)} />
              <StatTile label={t("Still failing")} value={n0(draft.verification?.still_failing ?? 0)} />
              <StatTile label={t("Passing values it would break")} value={n0(draft.verification?.broken ?? 0)} />
            </dl>
            <p>{t("Steps: {steps}", { steps: draft.steps.map((s) => String(s.op ?? "")).join(", ") })}</p>
            <p className="mx-muted">{t("The draft changes nothing. A steward approves it under Rules, Fix drafts.")}</p>
          </div>
        ) : null}
      </Sheet>
    </div>
  );
}
