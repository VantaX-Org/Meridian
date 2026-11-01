"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { uploadKnownIssues, type Scorecard } from "@/lib/api/v2/pilot";
import { refreshAdmin, useScorecard } from "@/lib/v2/admin-queries";
import { useSystemsExtended } from "@/lib/v2/runs-queries";
import { int, pct1 } from "@/lib/v2/score";
import { t } from "@/lib/v2/i18n";
import { labelText, moduleText } from "@/lib/v2/labels";
import { Coded, Dash, EmptyFrame } from "../parts";
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
                  className="m2-btn"
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
