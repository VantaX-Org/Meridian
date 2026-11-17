"use client";

import { useState } from "react";
import { postDecide } from "@/lib/api/v2/work";
import { formatModuleName } from "@/lib/format";
import { useWorkRecord } from "@/lib/v2/work-queries";
import { STATUS_LABEL } from "@/lib/v2/work";
import { t } from "@/lib/v2/i18n";
import { Button, DetailPanel, useSheet, EmptyState, ErrorState, FieldChip, Field, Input, Skeleton, StatTile } from "@/ui/kit";
import { Comments } from "./Comments";
import { sevLabel, sevOf, fieldText, day, useDo } from "./shared";
import { UndoBar } from "./UndoBar";

/** One record's decide panel: Overview, Fix and Why. Used beside the list and inside the record sheet. */
export function RecordDetail({ module, recordKey, version }: { module: string; recordKey: string; version?: string }) {
  const [tab, setTab] = useState("overview");
  const [undo, setUndo] = useState<{ id: string; msg: string } | null>(null);
  const [val, setVal] = useState<Record<string, string>>({});
  const run = useDo();
  const sheets = useSheet();
  const rec = useWorkRecord(module, recordKey, version);
  if (rec.isLoading) return <Skeleton lines={5} label={t("Loading the record")} />;
  if (rec.isError || !rec.data) return <ErrorState heading={t("The record could not be loaded")} />;
  const d = rec.data;
  const top = d.issues[0];
  const decide = async (check: string, action: "accept" | "edit" | "not_an_issue", value?: string) => {
    const r = await run(() => postDecide([{ module, record_key: recordKey, check_id: check, action, value }], version), () => t("Your decision is saved."));
    if (r?.action_id) setUndo({ id: r.action_id, msg: t("Your decision is saved.") });
  };
  return (
    <>
      <DetailPanel idBase="mx-work" label={t("Record detail")} tabsLabel={t("Record detail views")}
        header={<>
          <span className="mx-sev" data-sev={sevOf(top?.severity ?? "info")}><i className="mx-dot" aria-hidden="true" />{sevLabel(top?.severity ?? "info")}</span>
          <h2 className="mx-card-t"><code className="mx-code">{recordKey}</code> {d.name}</h2>
        </>}
        tabs={[{ id: "overview", label: t("Overview") }, { id: "fix", label: t("Fix"), badge: String(d.issues.length) }, { id: "why", label: t("Why") }]}
        value={tab} onChange={setTab}>
        {tab === "overview" ? (
          <>
            <dl className="mx-tiles">
              <StatTile label={t("Status")} value={STATUS_LABEL[d.status] ?? d.status} />
              <StatTile label={t("Open issues")} value={d.issues.length} />
              <StatTile label={t("Owner")} value={d.assignee_email ?? t("Not assigned")} />
            </dl>
            <p className="mx-cap">{t("Object")} <FieldChip code={module} description={formatModuleName(module)} /></p>
            {d.events.length ? (
              <ul className="mx-list" aria-label={t("History")}>
                {d.events.map((e, i) => <li key={i}>{day(e.created_at)} {e.user_label ?? ""} {e.action}{e.to_value ? ` ${e.to_value}` : ""}</li>)}
              </ul>
            ) : null}
            <Button onClick={() => sheets.open("decisions", { module, recordKey })}>{t("Decisions")}</Button>
            <Comments kind="record" id={`${module}|${recordKey}`} />
          </>
        ) : tab === "fix" ? (
          !d.issues.length ? <EmptyState heading={t("Nothing to fix here")} /> : (
            <ul className="mx-list" aria-label={t("Issues")}>
              {d.issues.map((i) => (
                <li key={i.check_id} className="mx-section">
                  <p><FieldChip code={i.field ?? ""} description={fieldText(i.field ?? undefined, d.field_descriptions?.[i.field ?? ""])} /> {i.message}</p>
                  <p className="mx-muted">{t("Now")}: {i.current_value ?? t("empty")} {i.suggestion ? `${t("Proposed")}: ${i.suggestion}` : ""}</p>
                  <div className="mx-links">
                    {i.suggestion ? <Button variant="primary" disabled={!d.can.fix} onClick={() => void decide(i.check_id, "accept")}>{t("Accept the proposed value")}</Button> : null}
                    <Button disabled={!d.can.fix} onClick={() => void decide(i.check_id, "not_an_issue")}>{t("Not an issue")}</Button>
                  </div>
                  <Field label={t("Set another value")}>
                    <Input value={val[i.check_id] ?? ""} onChange={(e) => setVal({ ...val, [i.check_id]: e.target.value })} />
                  </Field>
                  <Button disabled={!d.can.fix || !(val[i.check_id] ?? "").trim()} onClick={() => void decide(i.check_id, "edit", val[i.check_id])}>{t("Save value")}</Button>
                </li>
              ))}
            </ul>
          )
        ) : (
          <ul className="mx-list" aria-label={t("Why it matters")}>
            {d.issues.map((i) => (
              <li key={i.check_id} className="mx-section">
                <p><FieldChip code={i.field ?? ""} description={fieldText(i.field ?? undefined, d.field_descriptions?.[i.field ?? ""])} /></p>
                <p>{i.why_it_matters}</p>
                {i.sap_impact ? <p className="mx-muted">{i.sap_impact}</p> : null}
                {i.instruction ? <p className="mx-muted">{i.instruction}</p> : null}
              </li>
            ))}
            {!d.issues.length ? <EmptyState heading={t("No open issue on this record")} /> : null}
          </ul>
        )}
      </DetailPanel>
      <UndoBar message={undo?.msg ?? ""} actionId={undo?.id ?? null} onDone={() => setUndo(null)} />
    </>
  );
}
