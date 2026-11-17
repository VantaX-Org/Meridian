"use client";

import { useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useFixture, withFixture } from "@/lib/api/v2/fixture";
import type { WorkRow } from "@/lib/api/v2/types";
import { exportFixSheet, importFixSheet, postAcceptAll, postSetValue, type WorkGroup } from "@/lib/api/v2/work";
import { formatModuleName } from "@/lib/format";
import { t, useInterfaceLang } from "@/lib/v2/i18n";
import { CHIPS, chipDef, exportQueryOf, filtersOf, readState, viewFilters, type ChipId } from "@/lib/v2/work";
import { useWorkGroups, useWorkRows, useWorkSummary, useWorkViews } from "@/lib/v2/work-queries";
import {
  Button, Card, Chip, DataTable, EmptyState, ErrorState, Field, Input, MasterList, PageHeader, Select, Sheet, Skeleton, Toggle, useAletheia, useAletheiaScope,
  useSheet, useStacked, type MasterRow,
} from "@/ui/kit";
import { CleaningQueue } from "./CleaningQueue";
import { ObjChip } from "./ObjChip";
import { RecordDetail } from "./RecordDetail";
import { fieldText, sevLabel, sevOf, useDo } from "./shared";

const rowId = (r: WorkRow) => `${r.module}|${r.record_key}`;
const groupRow = (g: WorkGroup): MasterRow => ({
  id: g.check_id, severity: sevOf(g.severity), severityLabel: sevLabel(g.severity), code: g.check_id, text: g.message ?? "",
  field: g.field ? { code: g.field, description: fieldText(g.field) } : undefined,
  countLabel: t("{n} records", { n: g.records }), ratio: g.population ? Math.min(1, g.records / g.population) : 0,
});

/** The ledger of work: rules on the left, their records on the right, and a decide panel for one record. */
export function Work() {
  useInterfaceLang();
  const fx = useFixture();
  const params = useSearchParams();
  const initial = readState(new URLSearchParams(params.toString()));
  const [state, setState] = useState(initial);
  const [tab, setTab] = useState(initial.chip === "proposed" ? "cleaning" : "records");
  const [check, setCheck] = useState<string | null>(null);
  const [pick, setPick] = useState<WorkRow | null>(null);
  const [sheet, setSheet] = useState(false);
  const [setTo, setSetTo] = useState("");
  const [onlyBlank, setOnlyBlank] = useState(true);
  const file = useRef<HTMLInputElement>(null);
  const stacked = useStacked();
  const chat = useAletheia();
  const sheets = useSheet();
  const run = useDo();
  const summary = useWorkSummary();
  const groups = useWorkGroups({ module: state.module ?? undefined, severity: state.severity ?? undefined }, tab === "records");
  const rows = useWorkRows({ ...filtersOf(state), check_id: check ?? undefined }, state.sort, tab === "records");
  const views = useWorkViews();
  const list = (rows.data?.pages ?? []).flatMap((p) => p.items);
  const gl = groups.data?.groups ?? [];
  const sel = gl.find((g) => g.check_id === check) ?? null;

  useAletheiaScope({
    key: "work", label: t("Asking about your work"),
    suggestions: [t("What should I fix first?")],
    answer: () => ({
      text: t("{n} rules have records waiting. Start with {rule}.", { n: gl.length, rule: gl[0]?.check_id ?? "" }),
      evidence: gl.slice(0, 3).map((g) => `${g.check_id}: ${g.records}`),
      actions: [],
    }),
  });

  const open = (r: WorkRow) => { setPick(r); if (stacked) setSheet(true); };
  const chip = (id: ChipId) => { setState({ ...state, chip: id }); setPick(null); if (id === "proposed") setTab("cleaning"); };
  const exp = () => void run(() => exportFixSheet(exportQueryOf(state)), (r) => t("Saved {file}.", { file: r.filename }));
  const imp = async (f: File) => void (await run(() => importFixSheet(f), (r) => t("{n} rows updated, {s} skipped.", { n: r.updated, s: r.skipped.length })));
  const saveView = () => { const name = window.prompt(t("Name this view")); if (name) void run(() => views.save({ route: "work", name, filters: viewFilters(state), columns: [], density: state.density }), () => t("View saved.")); };
  const vs = views.data?.views ?? [];

  const toolbar = (
    <div className="mx-links">
      <Button onClick={exp}>{t("Export workbook")}</Button>
      <Button onClick={() => file.current?.click()}>{t("Import workbook")}</Button>
      <input ref={file} type="file" accept=".xlsx,.csv" hidden aria-label={t("Import workbook")} onChange={(e) => { const f = e.target.files?.[0]; if (f) void imp(f); e.target.value = ""; }} />
      <Button onClick={() => sheets.open("whatif", { module: state.module })}>{t("What if")}</Button>
      <Button onClick={saveView}>{t("Save this view")}</Button>
      {vs.length ? (
        <Select aria-label={t("Saved views")} value="" options={[{ value: "", label: t("Saved views") }, ...vs.map((v) => ({ value: v.id, label: v.name }))]}
          onChange={(e) => { const v = vs.find((x) => x.id === e.target.value); if (v) setState(readState(new URLSearchParams(), v)); }} />
      ) : null}
    </div>
  );

  const records = (
    <div className="mx-split">
      <div className="mx-col">
        <Card title={t("Rules with work")} sub={t("Pick a rule to list its records.")}>
          {groups.isLoading ? <Skeleton lines={4} label={t("Loading the rules")} /> : groups.isError ? <ErrorState heading={t("The rules could not be loaded")} onRetry={() => void groups.refetch()} retryLabel={t("Try again")} /> : !gl.length ? <EmptyState heading={t("No rule has work in this view")} /> : (
            <MasterList label={t("Rules with work")} rows={gl.map(groupRow)} selectedId={check} onSelect={(id) => { setCheck(id === check ? null : id); setPick(null); }} />
          )}
        </Card>
        {sel ? (
          <Card title={t("Fix every record of this rule")} sub={sel.message ?? undefined}>
            <div className="mx-links">
              <Button variant="primary" onClick={() => void run(() => postAcceptAll(sel.check_id), (r) => t("{n} fixes accepted.", { n: r.accepted ?? r.updated ?? 0 }))}>{t("Accept every proposed value")}</Button>
            </div>
            <Field label={t("Or set one value for all")}><Input value={setTo} onChange={(e) => setSetTo(e.target.value)} /></Field>
            <Toggle label={t("Only where the field is empty")} checked={onlyBlank} onChange={setOnlyBlank} />
            <Button disabled={!setTo.trim()} onClick={() => void run(() => postSetValue(sel.check_id, setTo, onlyBlank), (r) => t("{n} values set.", { n: r.updated ?? 0 }))}>{t("Set the value")}</Button>
          </Card>
        ) : null}
      </div>
      <div className="mx-col">
        <Card title={t("Records")} sub={sel ? sel.check_id : t("All rules")}>
          {rows.isLoading ? <Skeleton lines={5} label={t("Loading the records")} /> : !list.length ? <EmptyState heading={t("No record matches")} /> : (
            <>
              <DataTable label={t("Records")} rows={list} rowKey={rowId} selected={pick ? rowId(pick) : null} onSelect={open}
                columns={[
                  { key: "k", label: t("Record"), render: (r) => `${formatModuleName(r.module)} ${r.record_key} ${r.name ?? ""}`, sort: (r) => r.record_key },
                  { key: "s", label: t("Severity"), render: (r) => sevLabel(r.severity), sort: (r) => r.severity },
                  { key: "m", label: t("Why"), render: (r) => r.top_message ?? "" },
                  { key: "n", label: t("Issues"), render: (r) => r.issues, sort: (r) => r.issues, align: "end" },
                ]} />
              {rows.hasNextPage ? <Button onClick={() => void rows.fetchNextPage()}>{t("Load more")}</Button> : null}
            </>
          )}
        </Card>
        {!stacked && pick ? <RecordDetail module={pick.module} recordKey={pick.record_key} version={pick.version_id} /> : null}
      </div>
      <Sheet open={stacked && sheet && !!pick} onClose={() => setSheet(false)} label={t("Record detail")} closeLabel={t("Close")}>
        {pick ? <RecordDetail module={pick.module} recordKey={pick.record_key} version={pick.version_id} /> : null}
      </Sheet>
    </div>
  );

  return (
    <>
      <PageHeader title={t("Work")} context={state.module ? <ObjChip code={state.module} /> : t("Everything waiting for a decision")}
        actions={<><Button variant="primary" href={withFixture("/approvals", fx)}>{t("Approvals")}</Button><Button variant="ghost" tone="aletheia" onClick={() => chat.setOpen(true)}>{t("Ask Aletheia")}</Button></>} />
      <div className="mx-chips" role="group" aria-label={t("Work status")}>
        {CHIPS.map((c) => <Chip key={c.id} selected={state.chip === c.id} count={c.count(summary.data) ?? undefined} onClick={() => chip(c.id)}>{c.label}</Chip>)}
      </div>
      {toolbar}
      <div className="mx-chips" role="group" aria-label={t("Work views")}>
        <Chip selected={tab === "records"} onClick={() => setTab("records")}>{t("Records")}</Chip>
        <Chip selected={tab === "cleaning"} onClick={() => setTab("cleaning")}>{t("Cleaning queue")}</Chip>
      </div>
      {tab === "cleaning" ? <CleaningQueue /> : records}
      <p className="mx-muted">{state.chip ? chipDef(state.chip).label : ""}</p>
    </>
  );
}
