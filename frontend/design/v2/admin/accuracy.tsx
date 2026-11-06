"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { draftTunedVersion, uploadKnownIssues, type Scorecard } from "@/lib/api/v2/pilot";
import { refreshAdmin, useRuleAccuracy, useRuleTuning, useScorecard } from "@/lib/v2/admin-queries";
import { useSystemsExtended } from "@/lib/v2/runs-queries";
import { int, pct1 } from "@/lib/v2/score";
import { t } from "@/lib/v2/i18n";
import { labelText, moduleText } from "@/lib/v2/labels";
import { describeField } from "@/lib/v2/sap-fields";
import { Coded, Dash, EmptyFrame, V2Link } from "../parts";
import { ResultFrame, useOutcome } from "../inspector/shared";
import { AdminPage, Block, Fld, Kv, Loaded, NeedsPermission, Note, StatusWord, useCan } from "./kit";

function Verdicts({ card }: { card: Scorecard }) {
  const p = card.precision;
  return (
    <Block title={t("Rule accuracy")} hint={t("Of the findings reviewers have judged, the share that were real. Rules with fewer than {min} judged findings are not rated.", { min: p.min_reviewed_per_rule })}>
      <Kv
        rows={[
          [t("Findings reviewed"), int(p.reviewed)],
          [t("Marked as false positive"), int(p.false_positives)],
          [t("Accuracy"), p.precision == null ? <Dash /> : pct1(p.precision)],
          [t("Target"), pct1(p.target)],
        ]}
      />
      <div className="m2-frame" tabIndex={0}>
        <table className="m2-tbl" aria-label={t("Accuracy by rule")}>
          <thead>
            <tr>
              <th scope="col">{t("Rule")}</th>
              <th scope="col">{t("Object")}</th>
              <th scope="col">{t("Severity")}</th>
              <th scope="col" className="m2-r">{t("Flagged")}</th>
              <th scope="col" className="m2-r">{t("Open")}</th>
              <th scope="col" className="m2-r">{t("Reviewed")}</th>
              <th scope="col" className="m2-r">{t("Accuracy")}</th>
              <th scope="col">{t("Verdict")}</th>
            </tr>
          </thead>
          <tbody>
            {card.rules.map((r) => (
              <tr key={r.check_id}>
                <th scope="row"><Coded code={r.check_id} text={r.message} /></th>
                <td>{moduleText(r.module)}</td>
                <td>{labelText(r.severity)}</td>
                <td className="m2-r">{int(r.flagged)}</td>
                <td className="m2-r">{int(r.open)}</td>
                <td className="m2-r">{int(r.reviewed)}</td>
                <td className="m2-r">{r.precision == null ? <Dash /> : pct1(r.precision)}</td>
                <td>
                  {r.needs_tuning ? <StatusWord tone="no-go">{t("Needs tuning")}</StatusWord> : r.rated ? <StatusWord tone="go">{t("On target")}</StatusWord> : <StatusWord tone="neutral">{t("Not enough reviews")}</StatusWord>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Block>
  );
}

function Recall({ card }: { card: Scorecard }) {
  const r = card.recall;
  return (
    <Block title={t("Known bad records caught")} hint={t("Of the records you told us were wrong, the share the rules flagged.")}>
      {r.known === 0 ? (
        <EmptyFrame>{t("No known bad records yet. Upload a list below to see how many the rules catch.")}</EmptyFrame>
      ) : (
        <>
          <Kv rows={[[t("Known bad records"), int(r.known)], [t("Caught by a rule"), int(r.caught)], [t("Caught share"), r.recall == null ? <Dash /> : pct1(r.recall)]]} />
          {r.objects_not_analysed.length ? <Note tone="warn">{t("Not analysed yet, so not counted as caught: {objects}.", { objects: r.objects_not_analysed.map(moduleText).join(", ") })}</Note> : null}
          {r.missed.length ? (
            <div className="m2-frame" tabIndex={0}>
              <table className="m2-tbl" aria-label={t("Records no rule flagged")}>
                <thead>
                  <tr>
                    <th scope="col">{t("Object")}</th>
                    <th scope="col">{t("Record")}</th>
                    <th scope="col">{t("Note")}</th>
                  </tr>
                </thead>
                <tbody>
                  {r.missed.map((m) => (
                    <tr key={`${m.module}|${m.record_ref}`}>
                      <td>{moduleText(m.module)}</td>
                      <th scope="row"><Coded code={m.record_ref} /></th>
                      <td>{m.note || <Dash />}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {r.missed_total > r.missed.length ? <p className="m2-prov">{t("Showing {shown} of {total} records no rule flagged.", { shown: int(r.missed.length), total: int(r.missed_total) })}</p> : null}
            </div>
          ) : null}
        </>
      )}
    </Block>
  );
}

/** The shipped benchmark: each rule run on synthetic records with injected defects, per object. */
function TestProven() {
  const q = useRuleAccuracy();
  return (
    <Loaded q={q} what={t("The synthetic benchmark")} rows={2}>
      {(a) => {
        const all = a.modules.reduce((n, m) => n + m.rules, 0);
        const done = a.modules.reduce((n, m) => n + m.benchmarked, 0);
        const exact = a.modules.reduce((n, m) => n + m.perfect, 0);
        return (
          <Block title={t("Test-proven on synthetic data")} hint={t("Each rule runs on {records} synthetic records with defects injected from the rule's own definition. A rule is exact when precision and recall are both 100%. Rules that need live configuration or a second dataset are not benchmarked.", { records: int(a.records_per_rule) })}>
            <Kv rows={[[t("Rules benchmarked"), t("{done} of {all}", { done: int(done), all: int(all) })], [t("Exact"), t("{exact} of {done}", { exact: int(exact), done: int(done) })]]} />
            <div className="m2-frame" tabIndex={0}>
              <table className="m2-tbl" aria-label={t("Benchmark coverage by object")}>
                <thead>
                  <tr>
                    <th scope="col">{t("Object")}</th>
                    <th scope="col" className="m2-r">{t("Rules")}</th>
                    <th scope="col" className="m2-r">{t("Benchmarked")}</th>
                    <th scope="col" className="m2-r">{t("Coverage")}</th>
                    <th scope="col" className="m2-r">{t("Exact")}</th>
                  </tr>
                </thead>
                <tbody>
                  {a.modules.map((m) => (
                    <tr key={m.module}>
                      <th scope="row"><Coded code={m.module} text={moduleText(m.module)} /></th>
                      <td className="m2-r">{int(m.rules)}</td>
                      <td className="m2-r">{int(m.benchmarked)}</td>
                      <td className="m2-r">{m.rules ? pct1(m.benchmarked / m.rules) : <Dash />}</td>
                      <td className="m2-r">{int(m.perfect)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Block>
        );
      }}
    </Loaded>
  );
}

/**
 * Self-tuning proposals (GET /rule-tuning): for each rule below target, the context values its false positives
 * concentrate on (record key parts such as the plant, or a stored classification code such as the material type), each
 * named by its SAP field description; or a severity step down. No code-to-text lookup exists in the frontend, so the
 * value shows as its code. Drafting creates a rule version; a person submits and approves it on the rule.
 */
function Tuning() {
  const can = useCan();
  const qc = useQueryClient();
  const tuning = useRuleTuning();
  const { outcome, pending, run } = useOutcome();
  return (
    <Block title={t("Self-tuning proposals")} hint={t("Rules below target accuracy, tuned from the false positives reviewers marked. A proposal becomes a draft version; nothing runs until a person approves it on the rule.")}>
      <Loaded q={tuning} what={t("The tuning proposals")} rows={2}>
        {(d) =>
          d.proposals.length === 0 ? (
            <EmptyFrame>{t("No rule needs tuning, or no pattern in the verdicts explains its false positives.")}</EmptyFrame>
          ) : (
            <>
              {outcome ? <ResultFrame outcome={outcome} /> : null}
              {d.proposals.map((p) => (
                <section key={p.rule_id} className="m2-sec" aria-label={p.rule_id}>
                  <h3 className="m2-h3"><Coded code={p.rule_id} text={p.message} /></h3>
                  <Kv
                    rows={[
                      [t("Object"), moduleText(p.module)],
                      [
                        t("Change"),
                        p.kind === "severity" ? (
                          t("Severity from {from} to {to}", { from: labelText(p.severity_from), to: labelText(p.severity_to) })
                        ) : (
                          <>
                            {p.exclusions.map((e) => (
                              <span key={`${e.column}=${e.value}`}>
                                {t("Exclude")} <Coded code={`${e.column}=${e.value}`} text={describeField(e.column) ?? (e.field === "WERKS" ? t("Plant") : null)} />{" "}
                              </span>
                            ))}
                          </>
                        ),
                      ],
                      [t("Accuracy"), t("{before} to {after}", { before: pct1(p.precision_before), after: pct1(p.precision_after) })],
                      [t("False positives removed"), int(p.fp_removed)],
                      [t("Real issues lost"), int(p.real_lost)],
                      [t("Findings reviewed"), int(p.reviewed)],
                      [
                        t("Verdict"),
                        p.pending ? (
                          <StatusWord tone="at-risk">{t("Version {version} is {state}", { version: p.pending.version, state: labelText(p.pending.state) })}</StatusWord>
                        ) : (
                          <StatusWord tone="no-go">{t("Needs tuning")}</StatusWord>
                        ),
                      ],
                    ]}
                  />
                  <Note>{p.rationale}</Note>
                  <pre className="m2-code" tabIndex={0} aria-label={t("Changes to {rule}", { rule: p.rule_id })}>{p.diff}</pre>
                  <div className="m2-adm-acts">
                    {can("manage_rules") ? (
                      <button
                        type="button"
                        className="m2-btn"
                        disabled={p.pending !== null || pending !== null}
                        onClick={() =>
                          void run(p.rule_id, async () => {
                            const v = await draftTunedVersion(p.rule_id);
                            await refreshAdmin(qc, "tuning");
                            return { tone: "ok", title: t("Tuned version drafted"), detail: t("Version {version} of {rule} is a draft. Submit and approve it on the rule.", { version: v.version, rule: p.rule_id }) };
                          })
                        }
                      >
                        {pending === p.rule_id ? t("Drafting…") : t("Draft tuned version")}
                      </button>
                    ) : null}
                    <V2Link href={`/r/${encodeURIComponent(p.rule_id)}?tab=definition`}>{t("Review the rule's versions")}</V2Link>
                  </div>
                </section>
              ))}
            </>
          )
        }
      </Loaded>
      {can("manage_rules") ? null : <NeedsPermission what={t("Drafting a tuned version")} permission="manage_rules" />}
    </Block>
  );
}

/** Admin › Rule accuracy: the pilot scorecard of one system, and the upload of its known bad records. */
export function RuleAccuracySection() {
  const can = useCan();
  const qc = useQueryClient();
  const systems = useSystemsExtended();
  const [picked, setPicked] = useState("");
  const id = picked || systems.data?.[0]?.id || "";
  const card = useScorecard(id);
  const [csv, setCsv] = useState("");
  const { outcome, pending, run } = useOutcome();
  return (
    <AdminPage title={t("Rule accuracy")} lead={t("How often each rule is right, from reviewer verdicts, and how many known bad records the rules caught.")}>
      <TestProven />
      <div className="m2-fbar">
        <Fld label={t("System")}>
          <select value={id} onChange={(e) => setPicked(e.target.value)}>
            {(systems.data ?? []).map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </Fld>
      </div>
      {systems.isSuccess && (systems.data ?? []).length === 0 ? (
        <EmptyFrame>{t("Rule accuracy belongs to a system. Connect a system first, from the landscape.")}</EmptyFrame>
      ) : (
        <>
          <Loaded q={card} what={t("The accuracy scorecard")} rows={3}>
            {(c) => (
              <>
                <Verdicts card={c} />
                <Recall card={c} />
              </>
            )}
          </Loaded>
          <Tuning />
          {can("manage_systems") ? (
            <Block title={t("Upload known bad records")} hint={t("A CSV with the columns object, record and an optional note. The record is the key parts joined with a vertical bar. An upload replaces the system's current list.")}>
              <div className="m2-fgrid">
                <Fld label={t("File")}>
                  <input type="file" accept=".csv,text/csv,text/plain" onChange={(e) => void e.target.files?.[0]?.text().then(setCsv)} />
                </Fld>
                <Fld label="CSV" wide hint={csv ? t("{filterCount} lines ready", { filterCount: csv.split(/\r?\n/).filter(Boolean).length }) : t("Choose a file, or paste the lines here.")}>
                  <textarea rows={4} value={csv} onChange={(e) => setCsv(e.target.value)} spellCheck={false} />
                </Fld>
              </div>
              {outcome ? <ResultFrame outcome={outcome} /> : null}
              <div className="m2-adm-acts">
                <button
                  type="button"
                  className="m2-btn m2-next"
                  disabled={!csv.trim() || !id || pending !== null}
                  onClick={() =>
                    void run("upload", async () => {
                      const r = await uploadKnownIssues(id, csv);
                      await refreshAdmin(qc, "scorecard");
                      setCsv("");
                      return { tone: r.rejected ? "info" : "ok", title: t("Known bad records loaded"), detail: t("{records} records kept, {rejected} rejected.", { records: int(r.records), rejected: int(r.rejected) }) };
                    })
                  }
                >
                  {pending === "upload" ? t("Uploading…") : t("Upload the list")}
                </button>
              </div>
            </Block>
          ) : (
            <NeedsPermission what={t("Uploading known bad records")} permission="manage_systems" />
          )}
        </>
      )}
    </AdminPage>
  );
}
