"use client";

import { useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { formatDate } from "@/lib/format";
import { applyMatchCalibration, downloadConsolidationPack, type CalibrationField, type TuningPreview } from "@/lib/api/v2/mdm";
import { useV2Session } from "@/lib/v2/hooks";
import { mdmKeys, useConsolidationPack, useMatchCalibration } from "@/lib/v2/mdm-queries";
import { describeField } from "@/lib/v2/sap-fields";
import { int } from "@/lib/v2/score";
import { t } from "@/lib/v2/i18n";
import { Mono, Skeleton } from "../../parts";
import { ResultFrame, useOutcome } from "../../inspector/shared";

/** What each match comparator does to the two values before it scores them (api/services/merge_explain.py). */
export const COMPARATOR_LABEL: Record<string, string> = {
  get name_legal() { return t("Legal name, company forms, width and accents ignored"); },
  get address_tokens() { return t("Address words in any order"); },
  get tax_exact() { return t("Tax number, punctuation ignored"); },
  get phone_e164() { return t("Phone number in international form"); },
  get bank_exact() { return t("Bank account, punctuation ignored"); },
  get part_number() { return t("Part number, separators and leading zeros ignored"); },
  get desc_tokens() { return t("Description words, abbreviations expanded, sizes must agree"); },
  get code_exact() { return t("Same code"); },
  get email() { return t("E-mail address, case ignored"); },
  get national_id() { return t("National ID, spaces ignored"); },
  get date_exact() { return t("Date, day and month swapped scores 0.7"); },
  get person_name() { return t("Person name, order and accents ignored"); },
  get exact() { return t("Same value"); },
  get fuzzy() { return t("Similar text"); },
};

const PASS_KIND: Record<string, string> = {
  get key() { return t("Same identifier"); },
  get neighbour() { return t("Sorted name window"); },
  get blocked() { return t("Name within a group"); },
};

const PACK_ACTION: Record<string, string> = {
  get flag_for_deletion() { return t("Flag for deletion"); },
  get point_to_survivor() { return t("Point to the survivor"); },
  get cross_plant_status_block() { return t("Block with your cross-plant status"); },
  get posting_block() { return t("Block posting"); },
  get order_block() { return t("Block orders with your order block reason"); },
  get central_block() { return t("Block centrally"); },
  get map_to_survivor() { return t("Map to the survivor"); },
};

/** TABLE-FIELD in mono with its SAP description beside it. */
export function FieldName({ field }: { field: string }): ReactNode {
  const d = describeField(field);
  return (
    <>
      <Mono>{field.replace(".", "-")}</Mono>
      {d ? <span className="m2-meta"> {d}</span> : null}
    </>
  );
}

const pct = (x: number): string => `${Math.round(x * 100)}%`;

function MuBar({ m, u }: { m: number; u: number }) {
  return (
    <span className="m2-mu" role="img" aria-label={t("Agrees on {m} of true matches and {u} of non-matches", { m: pct(m), u: pct(u) })}>
      <span className="m2-mu-m" style={{ width: `${Math.round(m * 100)}%` }} />
      <span className="m2-mu-u" style={{ width: `${Math.round(u * 100)}%` }} />
    </span>
  );
}

function Preview({ p }: { p: TuningPreview }) {
  return (
    <p className="m2-prov">
      {t("With the recommended weights, {linked} of {pairs} pairs would newly link and {unlinked} would unlink; {merge} clusters would merge and {split} would split ({before} clusters become {after}).", {
        linked: int(p.pairs_newly_linked), pairs: int(p.pairs), unlinked: int(p.pairs_unlinked), merge: int(p.clusters_that_would_merge),
        split: int(p.clusters_that_would_split), before: int(p.clusters_before), after: int(p.clusters_after),
      })}
    </p>
  );
}

/** How the object's candidate pairs are found, and each rule's weight learned from steward decisions (Fellegi-Sunter). */
export function MatchProfile({ module }: { module: string }) {
  const qc = useQueryClient();
  const q = useMatchCalibration(module);
  const can = useV2Session().can("approve");
  const [reason, setReason] = useState("");
  const { outcome, pending, run } = useOutcome();
  if (q.isPending) return <Skeleton width="60%" height={14} />;
  if (q.isError) return null; // no profile for this object: the section has nothing to say
  const c = q.data;
  const ready = c.status === "ready";
  const changes = c.fields.filter((f: CalibrationField) => f.recommended_weight !== f.current_weight).length;
  return (
    <section aria-label={t("Match profile and calibration")} className="m2-sec">
      <div className="m2-sechead">
        <h2 className="m2-h2">{t("Match profile and calibration")}</h2>
        <span className="m2-sub">{t("{accepted} accepted and {rejected} rejected steward decisions", { accepted: int(c.accepted), rejected: int(c.rejected) })}</span>
      </div>
      <ul className="m2-flist" aria-label={t("How candidate pairs are found")}>
        {c.passes.map((p) => (
          <li key={p.name}>
            <span>{PASS_KIND[p.kind] ?? p.kind}</span>
            <span className="m2-meta">
              {p.fields.map((f, i) => (
                <span key={f}>
                  {i ? ", " : ""}
                  <FieldName field={f} />
                </span>
              ))}
            </span>
          </li>
        ))}
      </ul>
      <table className="m2-tbl m2-ftbl" aria-label={t("Rule weights learned from steward decisions")}>
        <thead>
          <tr>
            <th scope="col">{t("Field")}</th>
            <th scope="col">{t("Comparison")}</th>
            <th scope="col">{t("Agrees on matches and non-matches")}</th>
            <th scope="col" className="m2-num">{t("Evidence weight")}</th>
            <th scope="col" className="m2-num">{t("Weight now")}</th>
            <th scope="col" className="m2-num">{t("Recommended")}</th>
          </tr>
        </thead>
        <tbody>
          {c.fields.map((f) => (
            <tr key={f.field}>
              <th scope="row" className="m2-fcell"><FieldName field={f.field} /></th>
              <td>{COMPARATOR_LABEL[f.match_type] ?? f.match_type}</td>
              <td>
                <MuBar m={f.m} u={f.u} />
                <span className="m2-meta">{t("{m} and {u}", { m: pct(f.m), u: pct(f.u) })}</span>
              </td>
              <td className="m2-num">{f.agreement_weight.toFixed(2)}</td>
              <td className="m2-num">{int(f.current_weight)}</td>
              <td className="m2-num" data-change={f.recommended_weight !== f.current_weight ? "true" : undefined}>{int(f.recommended_weight)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="m2-prov">
        {t("The bars show how often a field agrees on pairs stewards accepted (dark) and rejected (light). A field that agrees on both separates nothing and earns little weight. Evidence weight is log2 of the two shares.")}
      </p>
      {ready ? (
        c.preview ? <Preview p={c.preview} /> : null
      ) : (
        <p className="m2-rp m2-meta">{t("Calibration needs {n} accepted and {n} rejected steward decisions. Decide more pairs above and the weights are learned from them.", { n: c.min_decisions })}</p>
      )}
      {can && (ready || c.missing_profile_rules.length > 0) ? (
        <div className="m2-adm-acts" aria-label={t("Apply the recommended weights")}>
          <input className="m2-inp m2-sm" value={reason} onChange={(e) => setReason(e.target.value)} aria-label={t("Reason for the change")} placeholder={t("Reason for the change")} />
          <button
            type="button"
            className="m2-btn m2-sm"
            disabled={!reason.trim() || pending !== null || (ready && changes === 0 && c.missing_profile_rules.length === 0)}
            onClick={() =>
              void run("apply", async () => {
                const r = await applyMatchCalibration({ domain: module, reason: reason.trim(), add_profile_rules: c.missing_profile_rules.length > 0 });
                setReason("");
                void qc.invalidateQueries({ queryKey: mdmKeys.root });
                return { tone: "ok", title: t("{n} {n, plural, one {weight} other {weights}} changed, {added} {added, plural, one {rule} other {rules}} added. The next match run uses them.", { n: r.changed.length, added: r.added.length }) };
              })
            }
          >
            {pending === "apply" ? t("Applying…") : t("Apply the recommended weights")}
          </button>
        </div>
      ) : null}
      {outcome ? <ResultFrame outcome={outcome} /> : null}
    </section>
  );
}

/** What to set in SAP for each merged-away record. Export only: Meridian does not write these. */
export function ConsolidationPackSection({ module }: { module: string }) {
  const q = useConsolidationPack(module);
  const { outcome, pending, run } = useOutcome();
  if (q.isPending) return <Skeleton width="60%" height={14} />;
  if (q.isError) return null; // no consolidation actions for this object
  const p = q.data;
  const download = (format: "csv" | "xlsx") =>
    void run(format, async () => {
      const name = await downloadConsolidationPack(module, format);
      return { tone: "ok", title: t("Saved {name}", { name }) };
    });
  return (
    <section aria-label={t("SAP consolidation pack")} className="m2-sec">
      <div className="m2-sechead">
        <h2 className="m2-h2">{t("SAP consolidation pack")}</h2>
        <span className="m2-sub">{t("{merged} merged-away records onto {survivors} survivors", { merged: int(p.merged), survivors: int(p.survivors) })}</span>
      </div>
      {p.actions.length ? (
        <ul className="m2-flist" aria-label={t("What the pack sets in SAP")}>
          {p.actions.map((a) => (
            <li key={`${a.table}-${a.field}`}>
              <FieldName field={`${a.table}-${a.field}`} />
              <span className="m2-meta">
                {PACK_ACTION[a.action] ?? a.action}
                {a.value === "{survivor}" ? t(", value is the survivor's key") : a.value ? t(", value {value}", { value: a.value }) : t(", value from your own configuration")}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      {p.rows.length === 0 ? (
        <p className="m2-rp m2-meta">{t("No record has been merged away yet. When a steward merges a pair, the record that does not survive is listed here with what to set in SAP.")}</p>
      ) : (
        <table className="m2-tbl m2-ftbl" aria-label={t("Merged-away records and their survivors")}>
          <thead>
            <tr>
              <th scope="col">{t("Merged-away record")}</th>
              <th scope="col">{t("Survivor")}</th>
              <th scope="col">{t("SAP field")}</th>
              <th scope="col">{t("New value")}</th>
              <th scope="col">{t("Merged")}</th>
            </tr>
          </thead>
          <tbody>
            {p.rows.slice(0, 12).map((r) => (
              <tr key={`${r.loser_key}-${r.field ?? "map"}`}>
                <td><Mono>{r.loser_key.replace(/=0+(?=\d)/, "=")}</Mono></td>
                <td><Mono>{r.survivor_key.replace(/=0+(?=\d)/, "=")}</Mono></td>
                <td>{r.table && r.field ? <FieldName field={`${r.table}-${r.field}`} /> : PACK_ACTION[r.action] ?? r.action}</td>
                <td>{r.value ? <Mono>{r.value.replace(/=0+(?=\d)/, "=")}</Mono> : <span className="m2-meta">{t("From your configuration")}</span>}</td>
                <td>{r.merged_at ? formatDate(r.merged_at, "date") : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="m2-adm-acts" aria-label={t("Download the consolidation pack")}>
        <button type="button" className="m2-btn m2-sm" disabled={pending !== null || p.rows.length === 0} onClick={() => download("xlsx")}>{t("Download Excel")}</button>
        <button type="button" className="m2-btn m2-sm" disabled={pending !== null || p.rows.length === 0} onClick={() => download("csv")}>{t("Download CSV")}</button>
      </div>
      <p className="m2-prov">
        {p.total_rows > Math.min(12, p.rows.length) ? t("Showing {shown} of {total} rows; the download holds every row. ", { shown: Math.min(12, p.rows.length), total: int(p.total_rows) }) : ""}
        {t("Meridian never writes these to SAP. A status whose value is your own configuration is named without a value.")}
      </p>
      {outcome ? <ResultFrame outcome={outcome} /> : null}
    </section>
  );
}
