"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { applyTemplate, getStewardAssignments, getTemplate, getTemplateGaps, type ApplyPlan, type ApplyRow, type Gap, type StewardAssignment } from "@/lib/api/v2/roles";
import { t } from "@/lib/v2/i18n";
import { moduleText } from "@/lib/v2/labels";
import { Button, Card, DataTable, EmptyState, FieldChip, PageHeader, StatTile, useAletheia, useAletheiaScope, useToast } from "@/ui/kit";
import { Gate, refreshV2, useQ } from "./common";

const slice = (k: string | null | undefined, v: string | null | undefined, text?: string | null) =>
  k && k !== "none" && v ? <FieldChip code={v} description={text ?? k.replace(/_/g, " ")} /> : <span className="mx-muted">{t("Whole object")}</span>;

function Plan({ plan, label }: { plan: ApplyPlan; label: string }) {
  const rows: (ApplyRow & { kind: string })[] = [...plan.owners.map((r) => ({ ...r, kind: t("Owner") })), ...plan.stewards.map((r) => ({ ...r, kind: t("Steward") }))].filter((r) => r.change !== "same");
  if (!rows.length) return <EmptyState heading={t("Nothing to change")} body={t("Every assignment already matches the template.")} />;
  return (
    <DataTable label={label} rows={rows} rowKey={(r) => `${r.kind}-${r.module}-${r.slice_value ?? ""}`} height={240} columns={[
      { key: "m", label: t("Object"), render: (r) => <FieldChip code={r.module} description={moduleText(r.module)} /> },
      { key: "k", label: t("Role"), render: (r) => r.kind },
      { key: "s", label: t("Slice"), render: (r) => slice(r.slice_kind, r.slice_value) },
      { key: "b", label: t("Now"), render: (r) => r.before ?? t("Nobody") },
      { key: "a", label: t("After"), render: (r) => r.after },
      { key: "c", label: t("Change"), render: (r) => (r.change === "add" ? t("Add") : t("Change")) },
    ]} />
  );
}

export function Assignments() {
  const qc = useQueryClient();
  const toast = useToast();
  const chat = useAletheia();
  const gaps = useQ(["gaps"], () => getTemplateGaps());
  const asg = useQ(["steward-assignments"], () => getStewardAssignments());
  const tpl = useQ(["assignment-template"], () => getTemplate());
  const [plan, setPlan] = useState<ApplyPlan | null>(null);
  const preview = useMutation({ mutationFn: () => applyTemplate(true), onSuccess: setPlan });
  const apply = useMutation({
    mutationFn: () => applyTemplate(false),
    onSuccess: (r) => { toast(t("Template applied: {n} changes", { n: r.totals.add + r.totals.change }), "good"); setPlan(null); void refreshV2(qc); },
  });
  const open = gaps.data?.gaps.length ?? 0;
  useAletheiaScope({
    key: "assignments",
    label: t("Assignments"),
    suggestions: [t("Which objects have no owner?")],
    answer: () => {
      const g = gaps.data?.gaps ?? [];
      return { text: g.length ? g.slice(0, 5).map((x) => x.sentence).join(" ") : t("Every object has an owner and a steward.") };
    },
  });
  const changes = plan ? plan.totals.add + plan.totals.change : 0;
  return (
    <>
      <PageHeader title={t("Assignments")} context={t("Who owns and stewards each object")} actions={<>
        <Button variant="secondary" disabled={preview.isPending} onClick={() => preview.mutate()}>{t("Preview the template")}</Button>
        <Button variant="ghost" tone="aletheia" onClick={() => chat.setOpen(true)}>{t("Ask Aletheia")}</Button>
      </>} />
      <div className="mx-col">
        {plan ? (
          <Card title={t("Template preview")} sub={t("{n} changes would be made", { n: changes })}
            action={<Button variant="primary" disabled={!changes || apply.isPending} onClick={() => apply.mutate()}>{t("Apply the template")}</Button>}>
            <Plan plan={plan} label={t("Template preview")} />
          </Card>
        ) : null}
        <dl className="mx-tiles">
          <StatTile label={t("Objects checked")} value={gaps.data?.objects ?? 0} />
          <StatTile label={t("Open gaps")} value={open} />
          <StatTile label={t("Steward assignments")} value={asg.data?.assignments.length ?? 0} />
        </dl>
        <Card title={t("Gaps")} sub={t("Objects with no owner or no steward")}>
          <Gate q={gaps} label={t("Loading gaps")}>
            {(g) => g.gaps.length === 0 ? <EmptyState heading={t("No gaps")} body={t("Every object has an owner and a steward.")} /> : (
              <DataTable<Gap> label={t("Gaps")} rows={g.gaps} rowKey={(r) => `${r.module}-${r.gap}-${r.slice_value ?? ""}`} height={260} columns={[
                { key: "m", label: t("Object"), render: (r) => <FieldChip code={r.module} description={r.label} /> },
                { key: "g", label: t("Missing"), render: (r) => (r.gap === "no_owner" ? t("Owner") : t("Steward")) },
                { key: "s", label: t("Slice"), render: (r) => slice(r.slice_kind, r.slice_value) },
                { key: "t", label: t("What to do"), render: (r) => r.sentence },
              ]} />
            )}
          </Gate>
        </Card>
        <Card title={t("Steward assignments")}>
          <Gate q={asg} label={t("Loading assignments")}>
            {(a) => a.assignments.length === 0 ? <EmptyState heading={t("No steward assignments")} body={t("Preview the template to see what it would assign.")} /> : (
              <DataTable<StewardAssignment> label={t("Steward assignments")} rows={a.assignments} rowKey={(r) => `${r.module}-${r.slice_kind}-${r.slice_value}`} height={300} columns={[
                { key: "m", label: t("Object"), sort: (r) => r.module, render: (r) => <FieldChip code={r.module} description={moduleText(r.module)} /> },
                { key: "s", label: t("Slice"), render: (r) => slice(r.slice_kind, r.slice_value, r.slice_text) },
                { key: "n", label: t("Steward"), render: (r) => r.steward_name ?? t("Nobody") },
                { key: "src", label: t("Source"), render: (r) => (r.source === "template" ? t("Template") : t("Set by hand")) },
              ]} />
            )}
          </Gate>
        </Card>
        <Card title={t("The template")} sub={t("The standing rule for who owns and stewards each object")}>
          <Gate q={tpl} label={t("Loading the template")}>
            {(o) => {
              const rows = Object.entries(o.template.objects).map(([module, v]) => ({ module, ...v }));
              return rows.length === 0 ? <EmptyState heading={t("No template saved")} body={t("Save an assignment as a template to reuse it.")} /> : (
                <DataTable label={t("The template")} rows={rows} rowKey={(r) => r.module} height={300} columns={[
                  { key: "m", label: t("Object"), render: (r) => <FieldChip code={r.module} description={o.labels[r.module]} /> },
                  { key: "o", label: t("Owner role"), render: (r) => r.owner_role },
                  { key: "s", label: t("Slice"), render: (r) => (r.slice === "none" ? t("Whole object") : r.slice.replace(/_/g, " ")) },
                  { key: "st", label: t("Stewards"), render: (r) => r.stewards },
                ]} />
              );
            }}
          </Gate>
        </Card>
      </div>
    </>
  );
}
