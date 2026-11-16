"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { approveProposedRule, BANDS, createMatchRule, deleteMatchRule, listMatchRules, listProposedRules, MATCH_TYPES, PROPOSED_KEY, rejectProposedRule, simulateMatchRules, updateMatchRule, type MatchRule, type MatchRuleInput, type MatchSimulation, type MatchType, type ProposedRule } from "@/lib/api/v2/match-rules";
import { useFixture } from "@/lib/api/v2/fixture";
import { t } from "@/lib/v2/i18n";
import { labelText, moduleText } from "@/lib/v2/labels";
import { int } from "@/lib/v2/score";
import { Button, Chip, Code, Confirm, DataTable, EmptyState, PartBar, SidePanel } from "../kit";
import { DataBlock, DataLoaded, DataPage, Field, NeedsPermission, Toggle, useAct, useCan } from "./data-parts";

/**
 * Admin › Match rules: per object, the fields compared to decide whether two records are the same, how each is
 * compared, its weight in the score and the similarity it needs. A simulation scores the latest pending pairs with
 * the active rules and shows how many would merge by themselves, go to a steward or be dismissed, writing nothing.
 */

const TYPE: Record<MatchType, () => string> = {
  exact: () => t("Exactly equal"),
  fuzzy: () => t("Similar spelling"),
  phonetic: () => t("Sounds alike"),
  numeric_range: () => t("Close in value"),
  semantic: () => t("Same meaning"),
};
const typeText = (m: string): string => TYPE[m as MatchType]?.() ?? labelText(m);

const KEY = ["match-rules"];

function RuleForm({ rule, domains, onClose }: { rule: MatchRule | null; domains: string[]; onClose: () => void }) {
  const qc = useQueryClient();
  const [domain, setDomain] = useState(rule?.domain ?? domains[0] ?? "");
  const [field, setField] = useState(rule?.field ?? "");
  const [type, setType] = useState<MatchType>(rule?.match_type ?? "exact");
  const [weight, setWeight] = useState(String(rule?.weight ?? 50));
  const [threshold, setThreshold] = useState(String(Math.round((rule?.threshold ?? 0.8) * 100)));
  const [active, setActive] = useState(rule?.active ?? true);
  const { pending, act } = useAct();
  const w = Number(weight);
  const th = Number(threshold);
  const badDomain = !/^[a-z][a-z0-9_]*$/.test(domain.trim());
  const badField = !field.trim();
  const badW = !Number.isInteger(w) || w < 0 || w > 100;
  const badTh = !(th >= 0 && th <= 100) || threshold.trim() === "";
  const body: MatchRuleInput = { domain: domain.trim(), field: field.trim().toUpperCase(), match_type: type, weight: w, threshold: th / 100, active };
  return (
    <SidePanel
      open
      onClose={onClose}
      title={rule ? t("Change match rule") : t("Add a match rule")}
      footer={
        <>
          <Button disabled={pending !== null} onClick={onClose}>
            {t("Cancel")}
          </Button>
          <Button
            variant="primary"
            disabled={badDomain || badField || badW || badTh || pending !== null}
            loading={pending === "save"}
            loadingLabel={t("Saving…")}
            data-testid="mr-save"
            onClick={() =>
              void act("save", async () => {
                if (rule) await updateMatchRule(rule.id, body);
                else await createMatchRule(body);
                await qc.invalidateQueries({ queryKey: KEY });
                onClose();
                return rule ? t("Match rule changed") : t("Match rule added");
              })
            }
          >
            {rule ? t("Save rule") : t("Add rule")}
          </Button>
        </>
      }
    >
      <p className="nx-sub">{t("The rule compares one field of two records of the same object.")}</p>
      <div className="nx-data-form">
        <Field label={t("Object")} hint={t("The object id, for example business_partner.")} error={domain && badDomain ? t("Lower case letters, digits and underscores.") : null}>
          <input className="nx-input" value={domain} list="nx-mr-domains" onChange={(e) => setDomain(e.target.value)} data-testid="mr-domain" />
          <datalist id="nx-mr-domains">
            {domains.map((d) => (
              <option key={d} value={d}>
                {moduleText(d)}
              </option>
            ))}
          </datalist>
        </Field>
        <Field label={t("Field")} hint={t("The SAP field name, for example NAME_ORG1.")}>
          <input className="nx-input" value={field} onChange={(e) => setField(e.target.value)} data-testid="mr-field" />
        </Field>
        <Field label={t("Compared by")}>
          <select className="nx-input" value={type} onChange={(e) => setType(e.target.value as MatchType)}>
            {MATCH_TYPES.map((m) => (
              <option key={m} value={m}>
                {TYPE[m]()}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t("Weight")} hint={t("Its share of the match score, from 0 to 100.")} error={badW ? t("A whole number from 0 to 100.") : null}>
          <input className="nx-input" type="number" min={0} max={100} value={weight} onChange={(e) => setWeight(e.target.value)} />
        </Field>
        <Field label={t("Similarity needed (%)")} hint={t("How alike the two values must be for the field to count as a match.")} error={badTh ? t("From 0 to 100.") : null}>
          <input className="nx-input" type="number" min={0} max={100} value={threshold} onChange={(e) => setThreshold(e.target.value)} />
        </Field>
        <Toggle checked={active} onChange={setActive} label={t("Active")} hint={t("Only active rules score pairs.")} />
      </div>
    </SidePanel>
  );
}

function Simulate({ domain }: { domain: string }) {
  const [res, setRes] = useState<MatchSimulation | null>(null);
  const { pending, act } = useAct();
  return (
    <>
      {res ? (
        res.total_pairs === 0 ? (
          <EmptyState heading={t("No pending pair to score for {object}, or no active rule.", { object: moduleText(domain) })} />
        ) : (
          <div data-testid="mr-sim">
            <p className="nx-sub">{t("The latest {n} pending pairs scored with the active rules. Nothing was written.", { n: int(res.total_pairs) })}</p>
            <PartBar
              label={t("Where the pairs would go")}
              format={int}
              segments={[
                { label: t("Merged by itself (score {n} or more)", { n: BANDS.autoMerge * 100 }), value: res.auto_merge_count },
                { label: t("Sent to a steward"), value: res.queue_count },
                { label: t("Dismissed by itself (score below {n})", { n: BANDS.reviewFloor * 100 }), value: res.auto_dismiss_count },
              ]}
            />
          </div>
        )
      ) : null}
      <div className="nx-data-actions">
        <Button
          disabled={pending !== null}
          loading={pending === "sim"}
          loadingLabel={t("Scoring…")}
          data-testid={`mr-simulate-${domain}`}
          onClick={() =>
            void act("sim", async () => {
              setRes(await simulateMatchRules(domain));
              return t("Simulated");
            })
          }
        >
          {t("Simulate on pending pairs")}
        </Button>
      </div>
    </>
  );
}

function DomainBlock({ domain, rules, onEdit, onDelete }: { domain: string; rules: MatchRule[]; onEdit: (r: MatchRule) => void; onDelete: (r: MatchRule) => void }) {
  const live = rules.filter((r) => r.active);
  const total = live.reduce((s, r) => s + r.weight, 0);
  return (
    <DataBlock title={moduleText(domain)} hint={t("{n} active {n, plural, one {rule} other {rules}}, weights adding to {w}.", { n: live.length, w: int(total) })} testid={`mr-domain-${domain}`}>
      <DataTable<MatchRule>
        caption={t("Match rules for {object}", { object: moduleText(domain) })}
        rows={rules}
        rowKey={(r) => r.id}
        rowLabel={(r) => r.field}
        columns={[
          { id: "field", label: t("Field"), cell: (r) => <Code code={r.field} text={labelText(r.field)} />, compare: (a, b) => a.field.localeCompare(b.field) },
          { id: "type", label: t("Compared by"), cell: (r) => typeText(r.match_type) },
          { id: "weight", label: t("Weight"), align: "end", cell: (r) => int(r.weight), compare: (a, b) => a.weight - b.weight },
          { id: "share", label: t("Share of score"), align: "end", cell: (r) => (r.active && total > 0 ? `${Math.round((r.weight / total) * 100)}%` : "—") },
          { id: "threshold", label: t("Similarity needed"), align: "end", cell: (r) => `${Math.round(r.threshold * 100)}%` },
          { id: "state", label: t("State"), cell: (r) => <Chip tone={r.active ? "good" : "neutral"}>{r.active ? t("Active") : t("Off")}</Chip> },
          {
            id: "actions",
            label: t("Actions"),
            cell: (r) => (
              <div className="nx-data-actions">
                <Button size={32} onClick={() => onEdit(r)} data-testid={`mr-edit-${r.id}`}>
                  {t("Change")}
                </Button>
                <Button size={32} onClick={() => onDelete(r)} data-testid={`mr-remove-${r.id}`}>
                  {t("Remove")}
                </Button>
              </div>
            ),
          },
        ]}
      />
      <Simulate domain={domain} />
    </DataBlock>
  );
}

function RejectForm({ p, onClose }: { p: ProposedRule; onClose: () => void }) {
  const qc = useQueryClient();
  const [reason, setReason] = useState("");
  const { pending, act } = useAct();
  return (
    <SidePanel
      open
      onClose={onClose}
      title={t("Reject this proposal?")}
      footer={
        <>
          <Button disabled={pending !== null} onClick={onClose}>
            {t("Cancel")}
          </Button>
          <Button
            variant="danger"
            disabled={pending !== null}
            loading={pending === "rej"}
            loadingLabel={t("Rejecting…")}
            data-testid="mr-reject-confirm"
            onClick={() =>
              void act("rej", async () => {
                await rejectProposedRule(p.id, reason.trim());
                await qc.invalidateQueries({ queryKey: PROPOSED_KEY });
                onClose();
                return t("Proposal rejected");
              })
            }
          >
            {t("Reject")}
          </Button>
        </>
      }
    >
      <p className="nx-sub">{t("{field} on {object} is not added to the match rules. The reason goes to the audit log.", { field: p.proposed_rule.field ?? "—", object: moduleText(p.domain) })}</p>
      <Field label={t("Reason (optional)")} wide>
        <textarea className="nx-input" rows={3} maxLength={2000} value={reason} onChange={(e) => setReason(e.target.value)} />
      </Field>
    </SidePanel>
  );
}

function ProposedBlock() {
  const fixture = useFixture();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: [...PROPOSED_KEY, fixture], queryFn: listProposedRules });
  const [rejecting, setRejecting] = useState<ProposedRule | null>(null);
  const { pending, act } = useAct();
  return (
    <DataBlock title={t("Proposed by Aletheia")} hint={t("Rules drawn from the pairs stewards corrected. Approving one adds it to the match rules as active.")} testid="mr-proposed">
      <DataLoaded q={q} what={t("The proposed rules")}>
        {(d) => (
          <DataTable<ProposedRule>
            caption={t("Proposed match rules")}
            rows={d.rules}
            rowKey={(p) => p.id}
            rowLabel={(p) => p.proposed_rule.field ?? p.id}
            empty={{ heading: t("No proposal waiting. Aletheia proposes a rule once stewards correct ten or more pairs of an object in a week.") }}
            columns={[
              { id: "object", label: t("Object"), cell: (p) => moduleText(p.domain) },
              { id: "field", label: t("Field"), cell: (p) => (p.proposed_rule.field ? <Code code={p.proposed_rule.field} text={labelText(p.proposed_rule.field)} /> : "—") },
              { id: "type", label: t("Compared by"), cell: (p) => (p.proposed_rule.match_type ? typeText(p.proposed_rule.match_type) : "—") },
              { id: "weight", label: t("Weight"), align: "end", cell: (p) => (p.proposed_rule.weight != null ? int(p.proposed_rule.weight) : "—") },
              { id: "threshold", label: t("Similarity needed"), align: "end", cell: (p) => (p.proposed_rule.threshold != null ? `${Math.round(p.proposed_rule.threshold * 100)}%` : "—") },
              { id: "why", label: t("Why"), cell: (p) => p.rationale || "—" },
              { id: "count", label: t("Corrections behind it"), align: "end", cell: (p) => int(p.supporting_correction_count), compare: (a, b) => a.supporting_correction_count - b.supporting_correction_count },
              { id: "created", label: t("Proposed"), cell: (p) => p.created_at.slice(0, 10) },
              {
                id: "actions",
                label: t("Actions"),
                cell: (p) => (
                  <div className="nx-data-actions">
                    <Button
                      size={32}
                      variant="primary"
                      disabled={pending !== null}
                      loading={pending === `ok-${p.id}`}
                      loadingLabel={t("Approving…")}
                      data-testid={`mr-approve-${p.id}`}
                      onClick={() =>
                        void act(`ok-${p.id}`, async () => {
                          try {
                            await approveProposedRule(p.id);
                          } finally {
                            await qc.invalidateQueries({ queryKey: PROPOSED_KEY });
                          }
                          await qc.invalidateQueries({ queryKey: KEY });
                          return t("Proposal approved and added to the match rules");
                        })
                      }
                    >
                      {t("Approve")}
                    </Button>
                    <Button size={32} disabled={pending !== null} onClick={() => setRejecting(p)}>
                      {t("Reject")}
                    </Button>
                  </div>
                ),
              },
            ]}
          />
        )}
      </DataLoaded>
      {rejecting ? <RejectForm p={rejecting} onClose={() => setRejecting(null)} /> : null}
    </DataBlock>
  );
}

/** Admin › Match rules. */
export function MatchRulesSection() {
  const can = useCan();
  const allowed = can("manage_rules");
  const fixture = useFixture();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: [...KEY, fixture], queryFn: listMatchRules, enabled: allowed });
  const [editing, setEditing] = useState<MatchRule | "new" | null>(null);
  const [removing, setRemoving] = useState<MatchRule | null>(null);
  const { act } = useAct();
  if (!allowed) return <NeedsPermission what={t("Managing match rules")} permission="manage_rules" />;
  const rules = q.data?.rules ?? [];
  const domains = [...new Set(rules.map((r) => r.domain))];
  const add = (
    <Button variant="primary" onClick={() => setEditing("new")} data-testid="mr-add">
      {t("Add a match rule")}
    </Button>
  );
  return (
    <DataPage
      lead={t("How two records of the same object are scored as one. A pair scoring {hi} or more is merged by itself, below {lo} it is dismissed, and anything between goes to a steward. A steward's do-not-match or always-match decision on a pair overrides the score.", { hi: BANDS.autoMerge * 100, lo: BANDS.reviewFloor * 100 })}
      actions={add}
    >
      <DataLoaded q={q} what={t("The match rules")}>
        {() =>
          rules.length === 0 ? (
            <EmptyState heading={t("No match rule yet. Add one per object for each field that identifies a record.")} />
          ) : (
            <>
              {domains.map((d) => (
                <DomainBlock key={d} domain={d} rules={rules.filter((r) => r.domain === d)} onEdit={setEditing} onDelete={setRemoving} />
              ))}
            </>
          )
        }
      </DataLoaded>
      {can("review_ai_rules") ? <ProposedBlock /> : null}
      {editing ? <RuleForm rule={editing === "new" ? null : editing} domains={domains} onClose={() => setEditing(null)} /> : null}
      <Confirm
        open={removing !== null}
        title={t("Remove this match rule?")}
        consequence={removing ? t("{field} on {object} stops counting towards the match score from the next scoring.", { field: removing.field, object: moduleText(removing.domain) }) : ""}
        confirmLabel={t("Remove")}
        danger
        onCancel={() => setRemoving(null)}
        onConfirm={() => {
          const r = removing;
          if (!r) return;
          void act("del", async () => {
            await deleteMatchRule(r.id);
            await qc.invalidateQueries({ queryKey: KEY });
            setRemoving(null);
            return t("Match rule removed");
          });
        }}
      />
    </DataPage>
  );
}
