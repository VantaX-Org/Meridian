"use client";

import { getBreakEvidence, type LearnedBreak } from "@/lib/api/v2/learned-monitors";
import { t } from "@/lib/v2/i18n";
import { Card, FieldChip, Sheet, StatTile } from "@/ui/kit";
import { Gate, Tbl, day, n1, useQ } from "./shared";

/** Why a learned break is a break: the baseline runs, their spread, the z score and the field's dictionary entry. */
export function BreakEvidenceSheet({ item, onClose }: { item: LearnedBreak | null; onClose: () => void }) {
  return (
    <Sheet open={!!item} onClose={onClose} label={t("Break evidence")} closeLabel={t("Close")}>
      {item ? <Body key={item.id} id={item.id} /> : null}
    </Sheet>
  );
}

function Body({ id }: { id: string }) {
  const q = useQ("break-evidence", () => getBreakEvidence(id), [id]);
  const e = q.data;
  return (
    <Gate q={q} empty={!e} emptyHeading={t("No evidence for this break")} emptyBody={t("The baseline runs could not be read.")}>
      {e ? (
        <div className="b8-stack">
          <Card title={t("Spread of the baseline")} sub={e.basis === "runs" ? t("From the values of the baseline runs.") : t("The runs could not be read, so the stored band gives the spread and the score is a lower bound.")}>
            <dl className="b8-seg">
              <StatTile label={t("Seen")} value={n1(e.observed)} />
              <StatTile label={t("Median")} value={n1(e.median)} />
              <StatTile label={t("Scaled spread")} value={n1(e.scaled_mad)} />
              <StatTile label={t("Score")} value={n1(e.z)} note={t("A break starts at {z}", { z: n1(e.z_threshold) })} />
            </dl>
            {e.floored ? <p>{t("The minimum spread widened the band beyond what the runs alone give.")}</p> : null}
          </Card>
          {e.runs.length ? (
            <Card title={t("Baseline runs")}>
              <Tbl label={t("Baseline runs")} rows={e.runs} rowKey={(r) => r.run_id} cols={[
                { key: "r", label: t("Run"), render: (r) => (r.run_number == null ? r.run_id : `#${r.run_number}`) },
                { key: "d", label: t("Date"), render: (r) => day(r.run_at) },
                { key: "v", label: t("Value"), end: true, render: (r) => n1(r.value) },
              ]} />
            </Card>
          ) : null}
          {e.field ? (
            <Card title={t("Field in the dictionary")}>
              <p><FieldChip code={`${e.field.table}.${e.field.field}`} description={e.field.description ?? e.field.table_text ?? ""} /></p>
              {e.field.check_table ? <p>{t("Checked against {table}", { table: e.field.check_table })}</p> : null}
            </Card>
          ) : null}
          {e.values && (e.values.appeared.length || e.values.vanished.length) ? (
            <Card title={t("Values that moved")} sub={t("Against {n} baseline runs", { n: e.values.baseline_runs })}>
              <Tbl label={t("Values that moved")} rows={[...e.values.appeared.map((v) => ({ ...v, w: "in" })), ...e.values.vanished.map((v) => ({ ...v, w: "out" }))]} rowKey={(v) => `${v.w}-${v.value}`} cols={[
                { key: "c", label: t("Code"), render: (v) => <FieldChip code={v.value} description={v.text ?? ""} /> },
                { key: "w", label: t("Change"), render: (v) => (v.w === "in" ? t("Appeared") : t("Left the top values")) },
                { key: "k", label: t("In the check table"), render: (v) => (v.in_check_table == null ? t("n/a") : v.in_check_table ? t("Yes") : t("No")) },
              ]} />
            </Card>
          ) : null}
        </div>
      ) : null}
    </Gate>
  );
}
