"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useFixture } from "@/lib/api/v2/fixture";
import { getApprovalSetting, getSurvivorship as getPicks, getSurvivorshipAccuracy, postSurvivorshipBulkApprove, postSurvivorshipDecision, putApprovalSetting, type SurvivorshipPick } from "@/lib/api/v2/aletheia-survivorship";
import { putSurvivorshipRulesV2 } from "@/lib/api/v2/mdm-extra";
import { describeField } from "@/lib/v2/sap-fields";
import { t, useInterfaceLang } from "@/lib/v2/i18n";
import { useSurvivorship } from "@/lib/v2/mdm-queries";
import { moveBy, needsSources, RULE_TYPES, toInput, typeLabel, validateRules, type DraftRule } from "@/lib/v2/survivorship";
import { Button, Card, Confirm, DataTable, EmptyState, ErrorState, Field, FieldChip, Input, PageHeader, Select, SeverityPill, Skeleton, StatTile, Tabs, Toggle, useAletheia, useAletheiaScope } from "@/ui/kit";
import { DEFAULT_DOMAIN, DomainSelect, pct, useAct, useHref } from "./shared";

type Tab = "rules" | "decisions";
const pickId = (p: { domain: string; sap_object_key: string; field: string }) => `${p.domain}|${p.sap_object_key}|${p.field}`;
const msg = (m: string) =>
  m === "Enter the field" ? t("Enter the field") : m === "Another rule already covers this field" ? t("Another rule already covers this field")
    : m === "Choose at least one system" ? t("Choose at least one system") : t("Enter a whole number from 0 to 100");

let keySeq = 0;
const nextKey = () => ++keySeq;

export function Survivorship() {
  useInterfaceLang();
  const href = useHref();
  const fx = useFixture();
  const chat = useAletheia();
  const { act, busy } = useAct();
  const [domain, setDomain] = useState(DEFAULT_DOMAIN);
  const [tab, setTab] = useState<Tab>("rules");
  const [edit, setEdit] = useState<{ d: string; list: DraftRule[] } | null>(null);
  const [tried, setTried] = useState(false);
  const [sel, setSel] = useState<SurvivorshipPick | null>(null);
  const [mode, setMode] = useState<null | "override" | "reject">(null);
  const [src, setSrc] = useState("");
  const [note, setNote] = useState("");
  const rules = useSurvivorship(domain);
  const picks = useQuery({ queryKey: ["v2", "mdm", "surv-picks", fx], queryFn: getPicks, staleTime: 30_000, retry: false });
  const acc = useQuery({ queryKey: ["v2", "mdm", "surv-accuracy", fx], queryFn: getSurvivorshipAccuracy, staleTime: 30_000, retry: false });
  const appr = useQuery({ queryKey: ["v2", "mdm", "surv-approval", fx], queryFn: getApprovalSetting, staleTime: 30_000, retry: false });

  const seeded = useMemo<DraftRule[] | null>(() => rules.data ? rules.data.map((r, i) => ({ key: r.id || `n${i}`, field: r.field, rule_type: r.rule_type, trusted_sources: r.trusted_sources ?? [], weight: String(r.weight), active: r.active, ai_inferred: r.ai_inferred })) : null, [rules.data]);
  const draft = edit && edit.d === domain ? edit.list : seeded;
  const setDraft = (l: DraftRule[]) => setEdit({ d: domain, list: l });
  const list = draft ?? [];
  const errs = validateRules(list);
  const bad = Object.keys(errs).length > 0;
  const patch = (key: string, p: Partial<DraftRule>) => setDraft(list.map((r) => (r.key === key ? { ...r, ...p } : r)));
  const mine = (picks.data?.picks ?? []).filter((p) => p.domain === domain);
  const waiting = mine.filter((p) => p.state === "pending");

  useAletheiaScope({
    key: `mdm-survivorship/${domain}`,
    label: t("Asking about survivorship"),
    suggestions: [t("Which source wins most fields?"), t("Which picks need a steward?")],
    answer: () => ({
      text: t("{n} rules decide the winning value. {p} Aletheia picks wait for a steward.", { n: list.length, p: waiting.length }),
      evidence: waiting.slice(0, 3).map((p) => `${p.field}: ${p.recommended_source}`),
    }),
  });

  const decide = async () => {
    const p = sel;
    const m = mode;
    if (!p || !m) return;
    setMode(null);
    setSel(null);
    await act(
      () => postSurvivorshipDecision({ domain: p.domain, sap_object_key: p.sap_object_key, field: p.field, decision: m, source_system: m === "override" ? src : undefined, note: m === "reject" ? note.trim() : undefined, reason_code: m === "override" ? "wrong_source" : undefined }),
      m === "override" ? t("Pick overridden") : t("Pick rejected"),
    );
    setNote("");
    setSrc("");
  };

  return (
    <>
      <PageHeader
        title={t("Survivorship")}
        context={t("{n} rules", { n: list.length })}
        actions={<>
          <Button variant="ghost" href={href("/n/mdm/golden")}>{t("Golden records")}</Button>
          <Button variant="ghost" tone="aletheia" onClick={() => chat.setOpen(true)}>{t("Ask Aletheia")}</Button>
        </>}
      />
      <div className="mx-col">
        <DomainSelect value={domain} onChange={setDomain} />
        <Tabs
          idBase="mdm-surv"
          label={t("Survivorship sections")}
          value={tab}
          onChange={(v) => setTab(v as Tab)}
          items={[{ id: "rules", label: t("Rules"), badge: String(list.length) }, { id: "decisions", label: t("Aletheia decisions"), badge: String(waiting.length) }]}
        />
        {tab === "rules" && (
          rules.isLoading || draft === null ? (rules.isError ? <ErrorState heading={t("Survivorship rules could not be loaded")} /> : <Skeleton lines={6} label={t("Loading survivorship rules")} />) : (
            <Card
              title={t("Rules that pick the winning value")}
              sub={t("Rules run top to bottom. The first rule with a value wins for its field.")}
              action={<span className="mx-links">
                <Button variant="ghost" onClick={() => setDraft([...list, { key: `n${nextKey()}`, field: "", rule_type: "most_recent", trusted_sources: [], weight: "50", active: true }])}>{t("Add rule")}</Button>
                <Button variant="primary" disabled={busy} onClick={() => { setTried(true); if (!bad) void act(() => putSurvivorshipRulesV2(domain, toInput(list)), t("Rules saved")); }}>{t("Save rules")}</Button>
              </span>}
            >
              {list.length === 0 ? <EmptyState heading={t("No survivorship rules")} body={t("Without a rule the most recent value wins.")} /> : (
                <ol className="mx-col">
                  {list.map((r, i) => (
                    <li key={r.key} className="mx-links">
                      <Field label={t("Field")} error={tried && errs[r.key]?.field ? msg(errs[r.key].field!) : undefined} hint={describeField(r.field) ?? undefined}>
                        <Input value={r.field} onChange={(e) => patch(r.key, { field: e.target.value })} />
                      </Field>
                      <Field label={t("Rule")} hint={RULE_TYPES.find((x) => x.value === r.rule_type)?.help}>
                        <Select value={r.rule_type} onChange={(e) => patch(r.key, { rule_type: e.target.value as DraftRule["rule_type"] })} options={RULE_TYPES.map((x) => ({ value: x.value, label: x.label }))} />
                      </Field>
                      {needsSources(r.rule_type) && (
                        <Field label={t("Systems in order")} hint={t("Separate systems with a comma.")} error={tried && errs[r.key]?.sources ? msg(errs[r.key].sources!) : undefined}>
                          <Input value={r.trusted_sources.join(", ")} onChange={(e) => patch(r.key, { trusted_sources: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })} />
                        </Field>
                      )}
                      <Field label={t("Weight")} error={tried && errs[r.key]?.weight ? msg(errs[r.key].weight!) : undefined}>
                        <Input value={r.weight} onChange={(e) => patch(r.key, { weight: e.target.value })} inputMode="numeric" />
                      </Field>
                      <Toggle label={t("Active")} checked={r.active} onChange={(v) => patch(r.key, { active: v })} />
                      {r.ai_inferred ? <SeverityPill sev="info" label={t("Inferred by Aletheia")} /> : null}
                      <Button variant="ghost" disabled={i === 0} onClick={() => setDraft(moveBy(list, i, -1))}>{t("Move up")}</Button>
                      <Button variant="ghost" disabled={i === list.length - 1} onClick={() => setDraft(moveBy(list, i, 1))}>{t("Move down")}</Button>
                      <Button variant="ghost" onClick={() => setDraft(list.filter((x) => x.key !== r.key))}>{t("Remove")}</Button>
                    </li>
                  ))}
                </ol>
              )}
              <p className="mx-muted">{list.map((r) => typeLabel(r.rule_type)).filter((v, i, a) => a.indexOf(v) === i).join(", ")}</p>
            </Card>
          )
        )}
        {tab === "decisions" && (
          <>
            <dl className="mx-tiles">
              <StatTile label={t("Waiting for a steward")} value={String(picks.data?.counts.proposed ?? 0)} />
              <StatTile label={t("Approved")} value={String(picks.data?.counts.approved ?? 0)} />
              <StatTile label={t("Rejected")} value={String(picks.data?.counts.rejected ?? 0)} />
              <StatTile label={t("Acceptance rate")} value={acc.data?.acceptance_rate == null ? t("n/a") : pct(acc.data.acceptance_rate)} />
            </dl>
            <Card title={t("Approval setting")} sub={t("When on, a proved Aletheia pick waits for a steward before it is applied.")}>
              <Toggle label={t("A steward approves every pick")} checked={appr.data?.required ?? true} onChange={(v) => act(() => putApprovalSetting({ required: v }), t("Setting saved"))} />
            </Card>
            <Card
              title={t("Picks by Aletheia")}
              sub={t("Aletheia sees only the shape of each value. A pick shows only when the server proved it.")}
              action={<Button variant="secondary" disabled={busy || waiting.length === 0} onClick={() => act(() => postSurvivorshipBulkApprove(waiting.map((p) => ({ domain: p.domain, sap_object_key: p.sap_object_key, field: p.field }))), (r) => t("{n} picks approved", { n: r.approved }))}>{t("Approve all waiting")}</Button>}
            >
              {picks.isLoading ? <Skeleton lines={5} label={t("Loading Aletheia picks")} /> : picks.isError ? <ErrorState heading={t("Aletheia picks could not be loaded")} /> : mine.length === 0 ? (
                <EmptyState heading={t("No picks for this object")} body={t("Aletheia proposes winners when records merge.")} />
              ) : (
                <DataTable<SurvivorshipPick>
                  label={t("Picks by Aletheia")}
                  rows={mine}
                  rowKey={pickId}
                  columns={[
                    { key: "k", label: t("Record"), render: (p) => <FieldChip code={p.sap_object_key} /> },
                    { key: "f", label: t("Field"), render: (p) => <FieldChip code={p.field} description={p.field_text ?? describeField(p.field) ?? undefined} /> },
                    { key: "s", label: t("Chosen source"), render: (p) => p.decided_source ?? p.recommended_source },
                    { key: "c", label: t("Confidence"), align: "end", render: (p) => (p.confidence == null ? t("n/a") : pct(p.confidence)) },
                    { key: "v", label: t("Checks"), render: (p) => <SeverityPill sev={p.verified ? "low" : "high"} label={p.verified ? t("Proved") : t("Not proved")} /> },
                    { key: "st", label: t("State"), render: (p) => (p.state === "pending" ? t("Waiting") : p.state === "accepted" ? t("Accepted") : p.state === "overridden" ? t("Overridden") : t("Rejected")) },
                    {
                      key: "x", label: t("Decision"), render: (p) => p.state !== "pending" ? "" : (
                        <span className="mx-links">
                          <Button variant="primary" disabled={busy} onClick={() => act(() => postSurvivorshipDecision({ domain: p.domain, sap_object_key: p.sap_object_key, field: p.field, decision: "accept" }), t("Pick accepted"))}>{t("Accept")}</Button>
                          <Button variant="ghost" disabled={busy} onClick={() => { setSel(p); setSrc(p.candidates.find((c) => !c.picked)?.source_system ?? ""); setMode("override"); }}>{t("Override")}</Button>
                          <Button variant="ghost" disabled={busy} onClick={() => { setSel(p); setMode("reject"); }}>{t("Reject")}</Button>
                        </span>
                      ),
                    },
                  ]}
                />
              )}
            </Card>
            {(acc.data?.by_field ?? []).length > 0 && (
              <Card title={t("Accuracy by field")}>
                <DataTable
                  label={t("Accuracy by field")}
                  rows={(acc.data?.by_field ?? []).filter((x) => x.domain === domain)}
                  rowKey={(x) => `${x.domain}|${x.field}`}
                  columns={[
                    { key: "f", label: t("Field"), render: (x) => <FieldChip code={x.field} description={x.field_text ?? describeField(x.field) ?? undefined} /> },
                    { key: "a", label: t("Accepted"), align: "end", render: (x) => x.accepted },
                    { key: "o", label: t("Overridden"), align: "end", render: (x) => x.overridden },
                    { key: "r", label: t("Acceptance rate"), align: "end", render: (x) => (x.acceptance_rate == null ? t("n/a") : pct(x.acceptance_rate)) },
                  ]}
                />
              </Card>
            )}
          </>
        )}
      </div>
      <Confirm
        open={mode !== null}
        title={mode === "override" ? t("Override this pick?") : t("Reject this pick?")}
        confirmLabel={mode === "override" ? t("Override") : t("Reject")}
        cancelLabel={t("Cancel")}
        onConfirm={decide}
        onCancel={() => { setMode(null); setSel(null); }}
      >
        {mode === "override" ? (
          <Field label={t("Source system that wins")}>
            <Select value={src} onChange={(e) => setSrc(e.target.value)} options={(sel?.candidates ?? []).map((c) => ({ value: c.source_system, label: c.source_system }))} />
          </Field>
        ) : (
          <Field label={t("Reason")} hint={t("A reason is required.")}><Input value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        )}
      </Confirm>
    </>
  );
}
