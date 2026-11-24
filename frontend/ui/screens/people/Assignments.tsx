"use client";

import { useCrumbs } from "@/ui/screens/flow";
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { applyTemplate, getStewardAssignments, getTemplate, getTemplateGaps, putTemplate, type ApplyPlan, type ApplyRow, type Gap, type SliceKind, type StewardAssignment, type TemplateObject, type TemplateOut } from "@/lib/api/v2/roles";
import { getAssignable, type AssignableUser } from "@/lib/api/v2/triage";
import { t } from "@/lib/v2/i18n";
import { moduleText } from "@/lib/v2/labels";
import { Button, Card, DataTable, EmptyState, Field, FieldChip, PageHeader, Select, Sheet, StatTile, useAletheia, useAletheiaScope, useToast } from "@/ui/kit";
import { errorSentence } from "@/lib/api/v2/client";
import { personLabel } from "@/ui/screens/work/shared";
import { Gate, refreshV2, useQ } from "./common";

const slice = (k: string | null | undefined, v: string | null | undefined, text?: string | null) =>
  k && k !== "none" && v ? <FieldChip code={v} description={text ?? k.replace(/_/g, " ")} /> : <span className="mx-muted">{t("Whole object")}</span>;

function Plan({ plan, label }: { plan: ApplyPlan; label: string }) {
  const rows: (ApplyRow & { kind: string })[] = [...plan.owners.map((r) => ({ ...r, kind: t("Owner") })), ...plan.stewards.map((r) => ({ ...r, kind: t("Steward") }))].filter((r) => r.change !== "same");
  if (!rows.length) return <EmptyState heading={t("The template names no people yet.")} body={t("Pick an owner and stewards for each object.")} />;
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

export const OWNER_ROLES: readonly string[] = ["data_owner", "admin", "platform_admin"];
export const STEWARD_ROLES: readonly string[] = ["data_steward", "steward"];

/** Who owns one object and who stewards it, as a whole or per slice value. Saves the template; Apply writes it to the live assignments. */
function Picker({ module, focus, tpl, people, onClose }: { module: string; focus: string | null; tpl: TemplateOut; people: AssignableUser[]; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const cur: TemplateObject = tpl.template.objects[module] ?? { owner_role: "data_owner", slice: "none", stewards: "data_steward" };
  const [owner, setOwner] = useState(cur.owner_user_id ?? "");
  const [steward, setSteward] = useState(cur.steward_user_id ?? "");
  const [per, setPer] = useState<Record<string, string>>(cur.slice_stewards ?? {});
  const kind: SliceKind = cur.slice;
  const vals = kind === "none" ? [] : [...new Set([...(tpl.active_slices[kind] ?? []), ...Object.keys(per), ...(focus && focus !== "*" ? [focus] : [])])].sort();
  const owners = people.filter((p) => OWNER_ROLES.includes(p.role));
  const stewards = people.filter((p) => STEWARD_ROLES.includes(p.role));
  const opts = (list: AssignableUser[], none: string) => [{ value: "", label: none }, ...list.map((p) => ({ value: p.id, label: personLabel(p, list) }))];
  const save = useMutation({
    mutationFn: () => {
      const slice_stewards = Object.fromEntries(Object.entries(per).filter(([, v]) => v));
      const next: TemplateObject = { ...cur, owner_user_id: owner || null, steward_user_id: steward || null, slice_stewards };
      return putTemplate({ ...tpl.template, objects: { ...tpl.template.objects, [module]: next } });
    },
    onSuccess: () => { toast(t("Saved. Preview the template to apply it."), "good"); void refreshV2(qc); onClose(); },
    onError: (e) => toast(errorSentence(e, t("That did not work. Try again.")), "bad"),
  });
  const name = tpl.labels[module] ?? moduleText(module);
  return (
    <div className="mx-col">
      <h2>{t("Assign people to {name}", { name })}</h2>
      <Field label={t("Owner")} hint={owners.length ? undefined : t("No one has the data owner or admin role yet.")}>
        <Select aria-label={t("Owner")} value={owner} onChange={(e) => setOwner(e.target.value)} options={opts(owners, t("Nobody"))} />
      </Field>
      <Field label={kind === "none" ? t("Steward") : t("Steward for every other slice")} hint={stewards.length ? undefined : t("No one has the data steward role yet.")}>
        <Select aria-label={kind === "none" ? t("Steward") : t("Steward for every other slice")} value={steward} onChange={(e) => setSteward(e.target.value)} options={opts(stewards, t("Nobody"))} />
      </Field>
      {vals.map((v) => (
        <Field key={v} label={t("Steward for {slice} {value}", { slice: kind.replace(/_/g, " "), value: v })}>
          <Select aria-label={t("Steward for {slice} {value}", { slice: kind.replace(/_/g, " "), value: v })} value={per[v] ?? ""} onChange={(e) => setPer({ ...per, [v]: e.target.value })} options={opts(stewards, t("Same as every other slice"))} />
        </Field>
      ))}
      <div className="mx-links">
        <Button variant="primary" disabled={save.isPending} onClick={() => save.mutate()}>{t("Save to the template")}</Button>
        <Button variant="ghost" onClick={onClose}>{t("Cancel")}</Button>
      </div>
    </div>
  );
}

export function Assignments() {
  const crumbs = useCrumbs();
  const qc = useQueryClient();
  const toast = useToast();
  const chat = useAletheia();
  const gaps = useQ(["gaps"], () => getTemplateGaps());
  const asg = useQ(["steward-assignments"], () => getStewardAssignments());
  const tpl = useQ(["assignment-template"], () => getTemplate());
  const people = useQ(["assignable"], () => getAssignable());
  const [plan, setPlan] = useState<ApplyPlan | null>(null);
  const [pick, setPick] = useState<{ module: string; focus: string | null } | null>(null);
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
      <PageHeader crumbs={crumbs("people",t("Assignments"))} title={t("Assignments")} context={t("Who owns and stewards each object")} actions={<>
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
                { key: "a", label: t("Assign"), render: (r) => <Button variant="secondary" disabled={!tpl.data} onClick={() => setPick({ module: r.module, focus: r.slice_value })}>{t("Assign")}</Button> },
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
                  { key: "who", label: t("People"), render: (r) => {
                    const folk = people.data ?? [];
                    const nm = (id?: string | null) => { const p = folk.find((x) => x.id === id); return p ? personLabel(p, folk) : id ?? ""; };
                    const named = [r.owner_user_id, r.steward_user_id, ...Object.values(r.slice_stewards ?? {})].filter(Boolean);
                    return named.length ? t("Owner {owner}, steward {steward}", { owner: nm(r.owner_user_id) || t("Nobody"), steward: nm(r.steward_user_id) || t("Nobody") }) : <span className="mx-muted">{t("Nobody named")}</span>;
                  } },
                  { key: "a", label: t("Assign"), render: (r) => <Button variant="secondary" onClick={() => setPick({ module: r.module, focus: null })}>{t("Assign")}</Button> },
                ]} />
              );
            }}
          </Gate>
        </Card>
      </div>
      <Sheet open={!!pick && !!tpl.data} onClose={() => setPick(null)} label={t("Assign people")} closeLabel={t("Close")}>
        {pick && tpl.data ? <Picker key={pick.module} module={pick.module} focus={pick.focus} tpl={tpl.data} people={people.data ?? []} onClose={() => setPick(null)} /> : null}
      </Sheet>
    </>
  );
}
