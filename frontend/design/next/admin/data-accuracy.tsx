"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { draftTunedVersion, uploadKnownIssues, type AccuracyModule, type MissedRecord, type Scorecard, type ScorecardRule, type TuningProposal } from "@/lib/api/v2/pilot";
import { refreshAdmin, useRuleAccuracy, useRuleTuning, useScorecard } from "@/lib/v2/admin-queries";
import { useSystemsExtended } from "@/lib/v2/runs-queries";
import { describeField } from "@/lib/v2/sap-fields";
import { int, pct1 } from "@/lib/v2/score";
import { t } from "@/lib/v2/i18n";
import { labelText, moduleText } from "@/lib/v2/labels";
import { V2Link } from "@/design/v2/parts";
import { Button, Chip, Code, DataTable, DropZone, EmptyState, useToast } from "../kit";
import { DataBlock, DataLoaded, DataPage, Dash, Field, NeedsPermission, Notes, TONE, useAct, useCan } from "./data-parts";

const pctOrDash = (v: number | null) => (v == null ? <Dash /> : pct1(v));

function Verdicts({ card }: { card: Scorecard }) {
  const p = card.precision;
  return (
    <DataBlock title={t("Rule accuracy")} hint={t("Of the findings reviewers have judged, the share that were real. Rules with fewer than {min} judged findings are not rated.", { min: p.min_reviewed_per_rule })} testid="accuracy-verdicts">
      <Notes
        rows={[
          [t("Findings reviewed"), int(p.reviewed)],
          [t("Marked as false positive"), int(p.false_positives)],
          [t("Accuracy"), pctOrDash(p.precision)],
          [t("Target"), pct1(p.target)],
        ]}
      />
      <DataTable<ScorecardRule>
        caption={t("Accuracy by rule")}
        rows={card.rules}
        rowKey={(r) => r.check_id}
        rowLabel={(r) => r.check_id}
        columns={[
          { id: "rule", label: t("Rule"), cell: (r) => <Code code={r.check_id} text={r.message} /> },
          { id: "object", label: t("Object"), cell: (r) => moduleText(r.module) },
          { id: "severity", label: t("Severity"), cell: (r) => labelText(r.severity) },
          { id: "flagged", label: t("Flagged"), align: "end", cell: (r) => int(r.flagged), compare: (a, b) => a.flagged - b.flagged },
          { id: "open", label: t("Open"), align: "end", cell: (r) => int(r.open) },
          { id: "reviewed", label: t("Reviewed"), align: "end", cell: (r) => int(r.reviewed), compare: (a, b) => a.reviewed - b.reviewed },
          { id: "accuracy", label: t("Accuracy"), align: "end", cell: (r) => pctOrDash(r.precision), compare: (a, b) => (a.precision ?? -1) - (b.precision ?? -1) },
          {
            id: "verdict",
            label: t("Verdict"),
            cell: (r) => (r.needs_tuning ? <Chip tone={TONE["no-go"]}>{t("Needs tuning")}</Chip> : r.rated ? <Chip tone={TONE.go}>{t("On target")}</Chip> : <Chip tone={TONE.neutral}>{t("Not enough reviews")}</Chip>),
          },
        ]}
      />
    </DataBlock>
  );
}

function Recall({ card }: { card: Scorecard }) {
  const r = card.recall;
  return (
    <DataBlock title={t("Known bad records caught")} hint={t("Of the records you told us were wrong, the share the rules flagged.")} testid="accuracy-recall">
      {r.known === 0 ? (
        <EmptyState heading={t("No known bad records yet. Upload a list below to see how many the rules catch.")} />
      ) : (
        <>
          <Notes
            rows={[
              [t("Known bad records"), int(r.known)],
              [t("Caught by a rule"), int(r.caught)],
              [t("Caught share"), pctOrDash(r.recall)],
            ]}
          />
          {r.objects_not_analysed.length ? <p className="nx-note">{t("Not analysed yet, so not counted as caught: {objects}.", { objects: r.objects_not_analysed.map(moduleText).join(", ") })}</p> : null}
          {r.missed.length ? (
            <DataTable<MissedRecord>
              caption={t("Records no rule flagged")}
              rows={r.missed}
              rowKey={(m) => `${m.module}:${m.record_ref}`}
              rowLabel={(m) => m.record_ref}
              columns={[
                { id: "object", label: t("Object"), cell: (m) => moduleText(m.module) },
                { id: "record", label: t("Record"), cell: (m) => <Code code={m.record_ref} /> },
                { id: "note", label: t("Note"), cell: (m) => m.note ?? <Dash /> },
              ]}
            />
          ) : null}
          {r.missed_total > r.missed.length ? <p className="nx-sub">{t("Showing {shown} of {total} records no rule flagged.", { shown: int(r.missed.length), total: int(r.missed_total) })}</p> : null}
        </>
      )}
    </DataBlock>
  );
}

function TestProven() {
  const q = useRuleAccuracy();
  return (
    <DataLoaded q={q} what={t("The synthetic benchmark")} rows={2}>
      {(a) => {
        const all = a.modules.reduce((s, m) => s + m.rules, 0);
        const done = a.modules.reduce((s, m) => s + m.benchmarked, 0);
        const exact = a.modules.reduce((s, m) => s + m.perfect, 0);
        return (
          <DataBlock
            title={t("Test-proven on synthetic data")}
            hint={t("Each rule runs on {records} synthetic records with defects injected from the rule's own definition. A rule is exact when precision and recall are both 100%. Rules that need live configuration or a second dataset are not benchmarked.", { records: int(a.records_per_rule) })}
            testid="accuracy-benchmark"
          >
            <Notes
              rows={[
                [t("Rules benchmarked"), t("{done} of {all}", { done: int(done), all: int(all) })],
                [t("Exact"), t("{exact} of {done}", { exact: int(exact), done: int(done) })],
              ]}
            />
            <DataTable<AccuracyModule>
              caption={t("Benchmark coverage by object")}
              rows={a.modules}
              rowKey={(m) => m.module}
              rowLabel={(m) => moduleText(m.module)}
              columns={[
                { id: "object", label: t("Object"), cell: (m) => <Code code={m.module} text={moduleText(m.module)} /> },
                { id: "rules", label: t("Rules"), align: "end", cell: (m) => int(m.rules), compare: (x, y) => x.rules - y.rules },
                { id: "benchmarked", label: t("Benchmarked"), align: "end", cell: (m) => int(m.benchmarked) },
                { id: "coverage", label: t("Coverage"), align: "end", cell: (m) => (m.rules ? pct1(m.benchmarked / m.rules) : <Dash />) },
                { id: "exact", label: t("Exact"), align: "end", cell: (m) => int(m.perfect) },
              ]}
            />
          </DataBlock>
        );
      }}
    </DataLoaded>
  );
}

function Change({ p }: { p: TuningProposal }) {
  if (p.kind === "severity") return <>{t("Severity from {from} to {to}", { from: labelText(p.severity_from ?? ""), to: labelText(p.severity_to ?? "") })}</>;
  return (
    <ul className="nx-data-list">
      {p.exclusions.map((e) => (
        <li key={`${e.column}=${e.value}`}>
          {t("Exclude")} <Code code={`${e.column}=${e.value}`} text={describeField(e.column) ?? (e.field === "WERKS" ? t("Plant") : undefined)} />
        </li>
      ))}
    </ul>
  );
}

function Proposal({ p, write, busy, onDraft, drafting }: { p: TuningProposal; write: boolean; busy: boolean; drafting: boolean; onDraft: () => void }) {
  return (
    <section className="nx-data-block" aria-label={p.rule_id} data-testid={`tuning-${p.rule_id}`}>
      <h3 className="nx-data-h2">
        <Code code={p.rule_id} text={p.message} />
      </h3>
      <Notes
        rows={[
          [t("Object"), moduleText(p.module)],
          [t("Change"), <Change key="c" p={p} />],
          [t("Accuracy"), t("{before} to {after}", { before: pct1(p.precision_before), after: pct1(p.precision_after) })],
          [t("False positives removed"), int(p.fp_removed)],
          [t("Real issues lost"), int(p.real_lost)],
          [t("Findings reviewed"), int(p.reviewed)],
          [t("Verdict"), p.pending ? <Chip tone={TONE["at-risk"]}>{t("Version {version} is {state}", { version: p.pending.version, state: labelText(p.pending.state) })}</Chip> : <Chip tone={TONE["no-go"]}>{t("Needs tuning")}</Chip>],
        ]}
      />
      <p className="nx-note">{p.rationale}</p>
      <pre className="nx-data-pre" aria-label={t("Changes to {rule}", { rule: p.rule_id })}>
        {p.diff}
      </pre>
      <div className="nx-data-actions">
        {write ? (
          <Button disabled={p.pending !== null || busy} loading={drafting} loadingLabel={t("Drafting…")} onClick={onDraft} data-testid={`tuning-draft-${p.rule_id}`}>
            {t("Draft tuned version")}
          </Button>
        ) : null}
        <V2Link href={`/r/${encodeURIComponent(p.rule_id)}?tab=definition`}>{t("Review the rule's versions")}</V2Link>
      </div>
      {write ? null : <NeedsPermission what={t("Drafting a tuned version")} permission="manage_rules" />}
    </section>
  );
}

function Tuning() {
  const can = useCan();
  const qc = useQueryClient();
  const q = useRuleTuning();
  const { pending, act } = useAct();
  return (
    <DataBlock title={t("Self-tuning proposals")} hint={t("Rules below target accuracy, tuned from the false positives reviewers marked. A proposal becomes a draft version; nothing runs until a person approves it on the rule.")} testid="accuracy-tuning">
      <DataLoaded q={q} what={t("The tuning proposals")} rows={2}>
        {(d) =>
          d.proposals.length === 0 ? (
            <EmptyState heading={t("No rule needs tuning, or no pattern in the verdicts explains its false positives.")} />
          ) : (
            d.proposals.map((p) => (
              <Proposal
                key={p.rule_id}
                p={p}
                write={can("manage_rules")}
                busy={pending !== null}
                drafting={pending === p.rule_id}
                onDraft={() =>
                  void act(p.rule_id, async () => {
                    const v = await draftTunedVersion(p.rule_id);
                    await refreshAdmin(qc, "tuning");
                    return `${t("Tuned version drafted")}. ${t("Version {version} of {rule} is a draft. Submit and approve it on the rule.", { version: v.version, rule: p.rule_id })}`;
                  })
                }
              />
            ))
          )
        }
      </DataLoaded>
    </DataBlock>
  );
}

function KnownUpload({ id }: { id: string }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [csv, setCsv] = useState("");
  const { pending, act } = useAct();
  return (
    <DataBlock title={t("Upload known bad records")} hint={t("A CSV with the columns object, record and an optional note. The record is the key parts joined with a vertical bar. An upload replaces the system's current list.")} testid="accuracy-upload">
      <div className="nx-data-form">
        <div className="nx-data-wide">
          <DropZone label={t("File")} accept=".csv,text/csv,text/plain" hint={t("Choose a file, or paste the lines here.")} onFiles={(files) => void files[0]?.text().then(setCsv)} />
        </div>
        {/* i18n-ignore: CSV is the file format name, as v2 shows it */}
        <Field label="CSV" wide hint={csv ? t("{filterCount} lines ready", { filterCount: csv.split(/\r?\n/).filter(Boolean).length }) : t("Choose a file, or paste the lines here.")}>
          <textarea className="nx-input" rows={4} value={csv} onChange={(e) => setCsv(e.target.value)} spellCheck={false} data-testid="known-csv" />
        </Field>
      </div>
      <div className="nx-data-actions">
        <Button
          variant="primary"
          disabled={!csv.trim() || !id || pending !== null}
          loading={pending === "upload"}
          loadingLabel={t("Uploading…")}
          data-testid="known-upload"
          onClick={() =>
            void act("upload", async () => {
              const r = await uploadKnownIssues(id, csv);
              await refreshAdmin(qc, "scorecard");
              setCsv("");
              const text = `${t("Known bad records loaded")}. ${t("{records} records kept, {rejected} rejected.", { records: int(r.records), rejected: int(r.rejected) })}`;
              if (!r.rejected) return text;
              toast({ text, tone: "neutral" });
            })
          }
        >
          {t("Upload the list")}
        </Button>
      </div>
    </DataBlock>
  );
}

/** Admin › Rule accuracy: reviewer-verdict precision, known-bad-record recall, the synthetic benchmark and self-tuning proposals. */
export function RuleAccuracySection() {
  const can = useCan();
  const systems = useSystemsExtended();
  const [picked, setPicked] = useState("");
  const id = picked || systems.data?.[0]?.id || "";
  const card = useScorecard(id);
  return (
    <DataPage lead={t("How often each rule is right, from reviewer verdicts, and how many known bad records the rules caught.")}>
      <TestProven />
      <div className="nx-data-form">
        <Field label={t("System")}>
          <select className="nx-input" value={id} onChange={(e) => setPicked(e.target.value)} data-testid="accuracy-system">
            {(systems.data ?? []).map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </Field>
      </div>
      {systems.isSuccess && (systems.data ?? []).length === 0 ? (
        <EmptyState heading={t("Rule accuracy belongs to a system. Connect a system first, from the landscape.")} />
      ) : (
        <>
          <DataLoaded q={card} what={t("The accuracy scorecard")} rows={3}>
            {(c) => (
              <>
                <Verdicts card={c} />
                <Recall card={c} />
              </>
            )}
          </DataLoaded>
          <Tuning />
          {can("manage_systems") ? <KnownUpload id={id} /> : <NeedsPermission what={t("Uploading known bad records")} permission="manage_systems" />}
        </>
      )}
    </DataPage>
  );
}
