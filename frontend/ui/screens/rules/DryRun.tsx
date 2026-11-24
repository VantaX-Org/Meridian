"use client";

import { useCrumbs, Flow, RULE_STEPS } from "@/ui/screens/flow";
import "./rules.css";
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "next/navigation";
import { useFixture, withFixture } from "@/lib/api/v2/fixture";
import { t, useInterfaceLang } from "@/lib/v2/i18n";
import { runImpactDryRun, type ImpactResult } from "@/lib/api/v2/rule-impact";
import { createDraft, dryRunDraftBody, generateDraft, publishDraftById } from "@/lib/api/v2/rulelib";
import { BarList, Button, Card, Field, Input, PageHeader, Select, StatTile, Textarea, YamlView, useAletheia, useAletheiaScope, useToast } from "@/ui/kit";
import { compactCount, pct, SEVERITIES, sevLabel } from "./format";

const NO_CHANGE = "keep";

/** Journey J5 steps three and four: write a rule, see what it would do, then save and publish it. */
export function DryRun() {
  const crumbs = useCrumbs();
  useInterfaceLang();
  const fx = useFixture();
  const chat = useAletheia();
  const toast = useToast();
  const qc = useQueryClient();
  const sp = useSearchParams();
  const [module, setModule] = useState(sp.get("module") ?? "material_master");
  const [ruleId, setRuleId] = useState(sp.get("rule") ?? "");
  const [severity, setSeverity] = useState(NO_CHANGE);
  const [description, setDescription] = useState("");
  const [yaml, setYaml] = useState("");
  const [saved, setSaved] = useState<string | null>(null);
  const fail = (e: unknown) => toast(e instanceof Error ? e.message : t("The change did not go through"), "bad");

  const impact = useMutation({
    mutationFn: () => runImpactDryRun({ module, rule_id: ruleId.trim(), ...(severity !== NO_CHANGE ? { rule: { severity } } : {}) }),
    onError: fail,
  });
  const gen = useMutation({
    mutationFn: () => generateDraft({ module, description }),
    onSuccess: (g) => { setYaml(g.rule_yaml); if (!g.valid) toast(g.errors.join(", ") || t("The draft has errors"), "bad"); },
    onError: fail,
  });
  const dry = useMutation({ mutationFn: () => dryRunDraftBody({ module, rule_yaml: yaml }), onError: fail });
  const save = useMutation({
    mutationFn: () => createDraft({ module, rule_yaml: yaml }),
    onSuccess: (d) => { setSaved(d.id); void qc.invalidateQueries(); toast(t("Draft saved"), "good"); },
    onError: fail,
  });
  const publish = useMutation({
    mutationFn: () => publishDraftById(saved ?? ""),
    onSuccess: () => { void qc.invalidateQueries(); toast(t("Draft published"), "good"); },
    onError: fail,
  });

  const r: ImpactResult | undefined = impact.data;
  const d = dry.data;

  useAletheiaScope({
    key: "rules/dry-run",
    label: t("Asking about a rule change"),
    suggestions: [t("What would this change break?")],
    answer: () => ({
      text: r && r.evaluated ? t("{n} records would fail, a failure rate of {p}.", { n: compactCount(r.records_failing ?? 0), p: pct(r.failure_rate) }) : t("Run the impact check first, then ask again."),
      evidence: r?.delta ? [t("{n} newly failing", { n: compactCount(r.delta.newly_failing) }), t("{n} newly passing", { n: compactCount(r.delta.newly_passing) })] : [],
      actions: [],
    }),
  });

  return (
    <>
      <PageHeader crumbs={crumbs("rules",t("Try a rule change"))} stepper={<Flow label={t("Rule change")} at={2} steps={RULE_STEPS()} />}
        title={t("Try a rule change")}
        context={t("See what a rule would do to your records before it goes live.")}
        actions={<>
          <Button variant="secondary" href={withFixture("/rules?view=drafts", fx)}>{t("Back to drafts")}</Button>
          <Button variant="secondary" href={withFixture("/rules/promotion", fx)}>{t("Go to promotion")}</Button>
          <Button variant="ghost" tone="aletheia" onClick={() => chat.setOpen(true)}>{t("Ask Aletheia")}</Button>
        </>}
      />
      <div className="mx-split">
        <div className="mx-col">
          <Card title={t("Impact of a change")} sub={t("Runs the rule over the latest data and compares it with now.")}>
            <div className="mx-rules-form">
              <Field label={t("Object")}><Input value={module} onChange={(e) => setModule(e.target.value)} /></Field>
              <Field label={t("Rule to change")} hint={t("The rule id, such as MM142. To test a new rule, draft it beside this and try it on the data.")}><Input value={ruleId} onChange={(e) => setRuleId(e.target.value)} /></Field>
              <Field label={t("Severity")}>
                <Select value={severity} onChange={(e) => setSeverity(e.target.value)} options={[{ value: NO_CHANGE, label: t("Keep as is") }, ...SEVERITIES.map((s) => ({ value: s, label: sevLabel(s) }))]} />
              </Field>
              <div className="mx-rules-row"><Button variant="primary" disabled={!module.trim() || !ruleId.trim() || impact.isPending} onClick={() => impact.mutate()}>{t("Check the impact")}</Button></div>
            </div>
            {r ? (
              r.evaluated ? (
                <div className="mx-col">
                  <dl className="mx-tiles">
                    <StatTile label={t("Records failing")} value={compactCount(r.records_failing ?? 0)} note={t("of {n} checked", { n: compactCount(r.records_evaluated ?? 0) })} />
                    <StatTile label={t("Failure rate")} value={pct(r.failure_rate)} />
                    {r.dqs && r.dqs.before != null && r.dqs.after != null ? <StatTile label={t("Quality score")} value={`${Math.round(r.dqs.before)} / ${Math.round(r.dqs.after)}`} note={t("before and after")} /> : null}
                    {r.delta ? <StatTile label={t("Newly failing")} value={compactCount(r.delta.newly_failing)} note={t("{n} newly passing", { n: compactCount(r.delta.newly_passing) })} /> : null}
                  </dl>
                  {r.failing_shapes?.length ? <BarList label={t("What the failures look like")} items={r.failing_shapes.map((s) => ({ id: s.shape, label: s.shape, value: s.count }))} /> : null}
                  <p className="mx-muted">{r.row_cap.note}</p>
                </div>
              ) : <p className="mx-muted">{r.reason ?? t("The rule could not be evaluated.")}</p>
            ) : null}
          </Card>
        </div>
        <div className="mx-col">
          <Card title={t("Write a new rule")} sub={t("Describe it in words, then check and save the draft.")}>
            <div className="mx-rules-form">
              <Field label={t("What should the rule check?")}><Input value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
              <div className="mx-rules-row"><Button variant="secondary" disabled={!description.trim() || gen.isPending} onClick={() => gen.mutate()}>{t("Draft the rule")}</Button></div>
              <Field label={t("Rule definition")}>
                <Textarea mono value={yaml} onChange={(e) => setYaml(e.target.value)} rows={8} spellCheck={false} aria-label={t("Rule definition")} />
              </Field>
              <div className="mx-rules-row">
                <Button variant="secondary" disabled={!yaml.trim() || dry.isPending} onClick={() => dry.mutate()}>{t("Try it on the data")}</Button>
                <Button variant="secondary" disabled={!yaml.trim() || save.isPending} onClick={() => save.mutate()}>{t("Save as draft")}</Button>
                <Button variant="primary" disabled={!saved || publish.isPending} onClick={() => publish.mutate()}>{t("Publish")}</Button>
              </div>
            </div>
            {yaml ? <YamlView label={t("Rule definition")} text={yaml} /> : null}
            {d ? (
              d.evaluated ? (
                <dl className="mx-tiles">
                  <StatTile label={t("Records failing")} value={compactCount(d.hits)} note={t("of {n} checked", { n: compactCount(d.population) })} />
                  <StatTile label={t("Pass rate")} value={pct(d.pass_rate)} />
                </dl>
              ) : <p className="mx-muted">{d.reason}</p>
            ) : null}
          </Card>
        </div>
      </div>
    </>
  );
}
