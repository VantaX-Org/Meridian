"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { approveProposedRule, BANDS, createMatchRule, deleteMatchRule, listMatchRules, listProposedRules, MATCH_TYPES, PROPOSED_KEY, rejectProposedRule, simulateMatchRules, updateMatchRule, type MatchRule, type MatchRuleInput, type MatchSimulation, type MatchType, type ProposedRule } from "@/lib/api/v2/match-rules";
import { useFixture } from "@/lib/api/v2/fixture";
import { apiErrorMessage } from "@/lib/error";
import { t } from "@/lib/v2/i18n";
import { labelText, moduleText } from "@/lib/v2/labels";
import { int } from "@/lib/v2/score";
import { ResultFrame, useOutcome } from "../inspector/shared";
import { EmptyFrame, Mono } from "../parts";
import { CcHBars } from "../screens/cc-parts";
import { AdminPage, Block, Confirm, Dialog, Fld, Loaded, NeedsPermission, StatusWord, Sw, useCan, useDone } from "./kit";

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

const KEY = ["match-rules"];

function RuleForm({ rule, domains, onClose }: { rule: MatchRule | null; domains: string[]; onClose: () => void }) {
  const qc = useQueryClient();
  const done = useDone();
  const [domain, setDomain] = useState(rule?.domain ?? domains[0] ?? "");
  const [field, setField] = useState(rule?.field ?? "");
  const [type, setType] = useState<MatchType>(rule?.match_type ?? "exact");
  const [weight, setWeight] = useState(String(rule?.weight ?? 50));
  const [threshold, setThreshold] = useState(String(Math.round((rule?.threshold ?? 0.8) * 100)));
  const [active, setActive] = useState(rule?.active ?? true);
  const { outcome, pending, run } = useOutcome();
  const w = Number(weight);
  const th = Number(threshold);
  const badDomain = !/^[a-z][a-z0-9_]*$/.test(domain.trim());
  const badField = !field.trim();
  const badW = !Number.isInteger(w) || w < 0 || w > 100;
  const badTh = !(th >= 0 && th <= 100) || threshold.trim() === "";
  const body: MatchRuleInput = { domain: domain.trim(), field: field.trim().toUpperCase(), match_type: type, weight: w, threshold: th / 100, active };
  return (
    <Dialog title={rule ? t("Change match rule") : t("Add a match rule")} description={t("The rule compares one field of two records of the same object.")} onClose={onClose}>
      <div className="m2-fgrid">
        <Fld label={t("Object")} hint={t("The object id, for example business_partner.")} error={domain && badDomain ? t("Lower case letters, digits and underscores.") : null} mono>
          <input value={domain} list="m2-mr-domains" onChange={(e) => setDomain(e.target.value)} />
        </Fld>
        <datalist id="m2-mr-domains">{domains.map((d) => <option key={d} value={d}>{moduleText(d)}</option>)}</datalist>
        <Fld label={t("Field")} hint={t("The SAP field name, for example NAME_ORG1.")} mono>
          <input value={field} onChange={(e) => setField(e.target.value)} />
        </Fld>
        <Fld label={t("Compared by")}>
          <select value={type} onChange={(e) => setType(e.target.value as MatchType)}>
            {MATCH_TYPES.map((m) => <option key={m} value={m}>{TYPE[m]()}</option>)}
          </select>
        </Fld>
        <Fld label={t("Weight")} hint={t("Its share of the match score, from 0 to 100.")} error={badW ? t("A whole number from 0 to 100.") : null}>
          <input type="number" min={0} max={100} value={weight} onChange={(e) => setWeight(e.target.value)} />
        </Fld>
        <Fld label={t("Similarity needed (%)")} hint={t("How alike the two values must be for the field to count as a match.")} error={badTh ? t("From 0 to 100.") : null}>
          <input type="number" min={0} max={100} value={threshold} onChange={(e) => setThreshold(e.target.value)} />
        </Fld>
        <Sw checked={active} onChange={setActive} label={t("Active")} hint={t("Only active rules score pairs.")} />
      </div>
      {outcome ? <ResultFrame outcome={outcome} /> : null}
      <div className="m2-adm-acts">
        <button type="button" className="m2-btn" onClick={onClose}>{t("Cancel")}</button>
        <button
          type="button"
          className="m2-btn m2-strong"
          disabled={badDomain || badField || badW || badTh || pending !== null}
          onClick={() =>
            void run("save", async () => {
              try {
                if (rule) await updateMatchRule(rule.id, body);
                else await createMatchRule(body);
              } catch (e) {
                return { tone: "fail", title: t("The rule was not saved"), detail: apiErrorMessage(e) };
              }
              await qc.invalidateQueries({ queryKey: KEY });
              done(rule ? t("Match rule changed") : t("Match rule added"));
              onClose();
              return { tone: "ok", title: t("Saved") };
            })
          }
        >
          {pending === "save" ? t("Saving…") : rule ? t("Save rule") : t("Add rule")}
        </button>
      </div>
    </Dialog>
  );
}

function Simulate({ domain }: { domain: string }) {
  const [res, setRes] = useState<MatchSimulation | null>(null);
  const { outcome, pending, run } = useOutcome();
  const rows = res
    ? [
        { key: "merge", label: t("Merged by itself (score {n} or more)", { n: BANDS.autoMerge * 100 }), value: res.auto_merge_count, text: int(res.auto_merge_count), tone: "pass" as const },
        { key: "queue", label: t("Sent to a steward"), value: res.queue_count, text: int(res.queue_count), tone: "warn" as const },
        { key: "dismiss", label: t("Dismissed by itself (score below {n})", { n: BANDS.reviewFloor * 100 }), value: res.auto_dismiss_count, text: int(res.auto_dismiss_count), tone: "data" as const },
      ]
    : [];
  return (
    <>
      {res ? (
        res.total_pairs === 0 ? (
          <EmptyFrame>{t("No pending pair to score for {object}, or no active rule.", { object: moduleText(domain) })}</EmptyFrame>
        ) : (
          <>
            <p className="m2-prov">{t("The latest {n} pending pairs scored with the active rules. Nothing was written.", { n: int(res.total_pairs) })}</p>
            <CcHBars label={t("Where the pairs would go")} rows={rows} testId="mr-sim" />
          </>
        )
      ) : null}
      {outcome ? <ResultFrame outcome={outcome} /> : null}
      <div className="m2-adm-acts">
        <button
          type="button"
          className="m2-btn"
          disabled={pending !== null}
          onClick={() =>
            void run("sim", async () => {
              try {
                setRes(await simulateMatchRules(domain));
                return { tone: "info", title: t("Simulated") };
              } catch (e) {
                return { tone: "fail", title: t("The simulation did not run"), detail: apiErrorMessage(e) };
              }
            })
          }
        >
          {pending === "sim" ? t("Scoring…") : t("Simulate on pending pairs")}
        </button>
      </div>
    </>
  );
}

function DomainBlock({ domain, rules, onEdit, onDelete }: { domain: string; rules: MatchRule[]; onEdit: (r: MatchRule) => void; onDelete: (r: MatchRule) => void }) {
  const live = rules.filter((r) => r.active);
  const total = live.reduce((s, r) => s + r.weight, 0);
  return (
    <Block title={moduleText(domain)} hint={t("{n} active {n, plural, one {rule} other {rules}}, weights adding to {w}.", { n: live.length, w: int(total) })}>
      <div className="m2-frame" tabIndex={0}>
        <table className="m2-tbl" aria-label={t("Match rules for {object}", { object: moduleText(domain) })}>
          <thead>
            <tr>
              <th scope="col">{t("Field")}</th>
              <th scope="col">{t("Compared by")}</th>
              <th scope="col" className="m2-r">{t("Weight")}</th>
              <th scope="col" className="m2-r">{t("Share of score")}</th>
              <th scope="col" className="m2-r">{t("Similarity needed")}</th>
              <th scope="col">{t("State")}</th>
              <th scope="col"><span className="m2-sr">{t("Actions")}</span></th>
            </tr>
          </thead>
          <tbody>
            {rules.map((r) => (
              <tr key={r.id}>
                <th scope="row"><Mono>{r.field}</Mono> {labelText(r.field)}</th>
                <td>{TYPE[r.match_type]?.() ?? labelText(r.match_type)}</td>
                <td className="m2-r">{int(r.weight)}</td>
                <td className="m2-r">{r.active && total > 0 ? `${Math.round((r.weight / total) * 100)}%` : "—"}</td>
                <td className="m2-r">{`${Math.round(r.threshold * 100)}%`}</td>
                <td><StatusWord tone={r.active ? "go" : "neutral"}>{r.active ? t("Active") : t("Off")}</StatusWord></td>
                <td>
                  <button type="button" className="m2-btn" onClick={() => onEdit(r)}>{t("Change")}</button>{" "}
                  <button type="button" className="m2-btn" onClick={() => onDelete(r)}>{t("Remove")}</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Simulate domain={domain} />
    </Block>
  );
}

function RejectForm({ p, onClose }: { p: ProposedRule; onClose: () => void }) {
  const qc = useQueryClient();
  const done = useDone();
  const [reason, setReason] = useState("");
  const { outcome, pending, run } = useOutcome();
  return (
    <Dialog title={t("Reject this proposal?")} description={t("{field} on {object} is not added to the match rules. The reason goes to the audit log.", { field: p.proposed_rule.field ?? "—", object: moduleText(p.domain) })} onClose={onClose}>
      <Fld label={t("Reason (optional)")} wide>
        <textarea rows={3} maxLength={2000} value={reason} onChange={(e) => setReason(e.target.value)} />
      </Fld>
      {outcome ? <ResultFrame outcome={outcome} /> : null}
      <div className="m2-adm-acts">
        <button type="button" className="m2-btn" onClick={onClose}>{t("Cancel")}</button>
        <button
          type="button"
          className="m2-btn m2-strong"
          disabled={pending !== null}
          onClick={() =>
            void run("rej", async () => {
              try {
                await rejectProposedRule(p.id, reason.trim());
              } catch (e) {
                return { tone: "fail", title: t("The proposal was not rejected"), detail: apiErrorMessage(e) };
              }
              await qc.invalidateQueries({ queryKey: PROPOSED_KEY });
              done(t("Proposal rejected"));
              onClose();
              return { tone: "ok", title: t("Rejected") };
            })
          }
        >
          {pending === "rej" ? t("Rejecting…") : t("Reject")}
        </button>
      </div>
    </Dialog>
  );
}

function ProposedBlock() {
  const fixture = useFixture();
  const qc = useQueryClient();
  const done = useDone();
  const q = useQuery({ queryKey: [...PROPOSED_KEY, fixture], queryFn: listProposedRules });
  const [rejecting, setRejecting] = useState<ProposedRule | null>(null);
  const { pending, run } = useOutcome();
  const rows = q.data?.rules ?? [];
  return (
    <Block title={t("Proposed by Aletheia")} hint={t("Rules drawn from the pairs stewards corrected. Approving one adds it to the match rules as active.")}>
      <Loaded q={q} what={t("The proposed rules")}>
        {() =>
          rows.length === 0 ? (
            <EmptyFrame>{t("No proposal waiting. Aletheia proposes a rule once stewards correct ten or more pairs of an object in a week.")}</EmptyFrame>
          ) : (
            <div className="m2-frame" tabIndex={0}>
              <table className="m2-tbl" aria-label={t("Proposed match rules")}>
                <thead>
                  <tr>
                    <th scope="col">{t("Object")}</th>
                    <th scope="col">{t("Field")}</th>
                    <th scope="col">{t("Compared by")}</th>
                    <th scope="col" className="m2-r">{t("Weight")}</th>
                    <th scope="col" className="m2-r">{t("Similarity needed")}</th>
                    <th scope="col">{t("Why")}</th>
                    <th scope="col" className="m2-r">{t("Corrections behind it")}</th>
                    <th scope="col">{t("Proposed")}</th>
                    <th scope="col"><span className="m2-sr">{t("Actions")}</span></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((p) => {
                    const r = p.proposed_rule;
                    return (
                      <tr key={p.id}>
                        <td>{moduleText(p.domain)}</td>
                        <th scope="row">{r.field ? <><Mono>{r.field}</Mono> {labelText(r.field)}</> : "—"}</th>
                        <td>{r.match_type ? TYPE[r.match_type]?.() ?? labelText(r.match_type) : "—"}</td>
                        <td className="m2-r">{r.weight != null ? int(r.weight) : "—"}</td>
                        <td className="m2-r">{r.threshold != null ? `${Math.round(r.threshold * 100)}%` : "—"}</td>
                        <td>{p.rationale || "—"}</td>
                        <td className="m2-r">{int(p.supporting_correction_count)}</td>
                        <td>{p.created_at.slice(0, 10)}</td>
                        <td>
                          <button
                            type="button"
                            className="m2-btn m2-strong"
                            disabled={pending !== null}
                            onClick={() =>
                              void run(`ok-${p.id}`, async () => {
                                try {
                                  await approveProposedRule(p.id);
                                } catch (e) {
                                  done(t("The proposal was not approved. {detail}", { detail: apiErrorMessage(e) }));
                                  await qc.invalidateQueries({ queryKey: PROPOSED_KEY });
                                  return { tone: "fail", title: t("Not approved") };
                                }
                                await Promise.all([qc.invalidateQueries({ queryKey: PROPOSED_KEY }), qc.invalidateQueries({ queryKey: KEY })]);
                                done(t("Proposal approved and added to the match rules"));
                                return { tone: "ok", title: t("Approved") };
                              })
                            }
                          >
                            {pending === `ok-${p.id}` ? t("Approving…") : t("Approve")}
                          </button>{" "}
                          <button type="button" className="m2-btn" disabled={pending !== null} onClick={() => setRejecting(p)}>{t("Reject")}</button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )
        }
      </Loaded>
      {rejecting ? <RejectForm p={rejecting} onClose={() => setRejecting(null)} /> : null}
    </Block>
  );
}

export function MatchRulesSection() {
  const can = useCan();
  const allowed = can("manage_rules");
  const fixture = useFixture();
  const qc = useQueryClient();
  const done = useDone();
  const q = useQuery({ queryKey: [...KEY, fixture], queryFn: listMatchRules, enabled: allowed });
  const [editing, setEditing] = useState<MatchRule | "new" | null>(null);
  const [removing, setRemoving] = useState<MatchRule | null>(null);
  const { pending, run } = useOutcome();
  if (!allowed) {
    return (
      <AdminPage title={t("Match rules")}>
        <NeedsPermission what={t("Managing match rules")} permission="manage_rules" />
      </AdminPage>
    );
  }
  const rules = q.data?.rules ?? [];
  const domains = [...new Set(rules.map((r) => r.domain))];
  return (
    <AdminPage
      title={t("Match rules")}
      lead={t("How two records of the same object are scored as one. A pair scoring {hi} or more is merged by itself, below {lo} it is dismissed, and anything between goes to a steward. A steward's do-not-match or always-match decision on a pair overrides the score.", { hi: BANDS.autoMerge * 100, lo: BANDS.reviewFloor * 100 })}
      actions={<button type="button" className="m2-btn m2-next" onClick={() => setEditing("new")}>{t("Add a match rule")}</button>}
    >
      <Loaded q={q} what={t("The match rules")}>
        {() =>
          rules.length === 0 ? (
            <EmptyFrame action={<button type="button" className="m2-btn" onClick={() => setEditing("new")}>{t("Add a match rule")}</button>}>
              {t("No match rule yet. Add one per object for each field that identifies a record.")}
            </EmptyFrame>
          ) : (
            <>
              {domains.map((d) => (
                <DomainBlock key={d} domain={d} rules={rules.filter((r) => r.domain === d)} onEdit={setEditing} onDelete={setRemoving} />
              ))}
            </>
          )
        }
      </Loaded>
      {can("review_ai_rules") ? <ProposedBlock /> : null}
      {editing ? <RuleForm rule={editing === "new" ? null : editing} domains={domains} onClose={() => setEditing(null)} /> : null}
      {removing ? (
        <Confirm
          title={t("Remove this match rule?")}
          body={t("{field} on {object} stops counting towards the match score from the next scoring.", { field: removing.field, object: moduleText(removing.domain) })}
          confirm={t("Remove")}
          danger
          pending={pending !== null}
          onCancel={() => setRemoving(null)}
          onConfirm={() =>
            void run("del", async () => {
              try {
                await deleteMatchRule(removing.id);
              } catch (e) {
                done(t("The rule was not removed. {detail}", { detail: apiErrorMessage(e) }));
                return { tone: "fail", title: t("Not removed") };
              }
              await qc.invalidateQueries({ queryKey: KEY });
              done(t("Match rule removed"));
              setRemoving(null);
              return { tone: "ok", title: t("Removed") };
            })
          }
        />
      ) : null}
    </AdminPage>
  );
}
