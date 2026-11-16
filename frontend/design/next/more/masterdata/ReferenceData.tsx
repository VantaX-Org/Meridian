"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  decideMapping, getRefList, getRefLists, getRefUsage, proposeMapping, suggestMapping,
  type MappingStatus, type RefCode, type RefCoverage, type RefList, type RefMapping, type RefOrphan, type RefSuggestion, type RefUsage, type RefUsageField,
} from "@/lib/api/v2/reference-data";
import { getSystemsExtended } from "@/lib/api/v2/runs";
import { useFixture } from "@/lib/api/v2/fixture";
import { formatDate } from "@/lib/format";
import { failureText } from "@/lib/v2/errors";
import { useUrlParam, useV2Session } from "@/lib/v2/hooks";
import { t } from "@/lib/v2/i18n";
import { moduleText } from "@/lib/v2/labels";
import { describeField, describeTable, sapField } from "@/lib/v2/sap-fields";
import { int, pct1 } from "@/lib/v2/score";
import { Button, Chip, Code, DataTable, EmptyState, ErrorState, PartBar, PointSpark, Skeleton, StatCard, type Column } from "../../kit";
import { ChartCard, compact } from "../ChartCard";
import { TableSave } from "./TableSave";
import { httpStatus, noRetry4xx, useGo } from "./util";

/**
 * Reference data, native: the check tables Meridian extracts (country, unit of measure, material group, payment terms,
 * the SuccessFactors picklist), each with its versions and the mapping of every source code to a target code. A mapping
 * takes effect only when a second person approves it. Aletheia may suggest a target from code values and descriptions
 * only; the server proves the suggestion before it is shown.
 */

const LIST_TEXT: Record<string, () => string> = {
  country: () => t("Countries"),
  payment_terms: () => t("Payment terms"),
  unit_of_measure: () => t("Units of measure"),
  material_group: () => t("Material groups"),
  picklist: () => t("SuccessFactors picklist values"),
};
const listText = (id: string): string => LIST_TEXT[id]?.() ?? id;

const STATUS_TEXT: Record<MappingStatus, () => string> = {
  proposed: () => t("Waiting for approval"),
  confirmed: () => t("Approved"),
  rejected: () => t("Rejected"),
};
const STATUS_TONE: Record<MappingStatus, "warn" | "good" | "bad"> = { proposed: "warn", confirmed: "good", rejected: "bad" };

const CHECK_TEXT: Record<string, () => string> = {
  SOURCE_KNOWN: () => t("The source code is in the source list"),
  TARGET_EXISTS: () => t("The target code is in the target list"),
  CONFIDENCE_VALID: () => t("The confidence is between 0 and 1"),
};

const coverageParts = (c: RefCoverage) => [
  { label: t("Same code on both sides"), value: c.same },
  { label: t("Approved"), value: c.approved },
  { label: t("Waiting for approval"), value: c.proposed },
  { label: t("Rejected"), value: c.rejected },
  { label: t("No target yet"), value: c.open },
];
const codeOption = (c: RefCode) => (c.text ? `${c.code}: ${c.text}` : c.code);
const fieldCode = (f: string) => <Code code={sapField(f)} text={describeField(f) ?? undefined} />;

/** Writes need the permission and a live session; a shared or view-as session is read-only. */
function useLive() {
  const session = useV2Session();
  return (p: string) => session.can(p) && !session.shared && !session.viewAs;
}

function Decision({ m, refresh }: { m: RefMapping; refresh: () => void }) {
  const can = useLive();
  const send = useMutation({ mutationFn: (d: "approve" | "reject") => decideMapping(m.id, d), onSuccess: refresh });
  if (m.status !== "proposed" || !can("approve")) return null;
  return (
    <span className="nx-row nx-wrap">
      <Button size={32} variant="primary" disabled={send.isPending} onClick={() => send.mutate("approve")} data-testid={`ref-approve-${m.source_code}`}>{t("Approve")}</Button>
      <Button size={32} disabled={send.isPending} onClick={() => send.mutate("reject")}>{t("Reject")}</Button>
      {send.isError ? <span role="alert" className="nx-sub">{failureText(send.error)}</span> : null}
    </span>
  );
}

function Propose({ list, systemId, refresh }: { list: RefList; systemId: string; refresh: () => void }) {
  const can = useLive();
  const mapped = new Set(list.mappings.filter((m) => m.status !== "rejected").map((m) => m.source_code));
  const targets = new Set(list.target.map((c) => c.code));
  const open = list.source.filter((c) => !mapped.has(c.code) && !targets.has(c.code));
  const [source, setSource] = useState("");
  const [target, setTarget] = useState("");
  const [field, setField] = useState(list.target_fields[0] ?? "");
  const [hint, setHint] = useState<RefSuggestion | null | undefined>(undefined);
  const propose = useMutation({
    mutationFn: () => proposeMapping({ system_id: systemId, list_id: list.id, target_field: field, source_code: source, target_code: target }),
    onSuccess: () => { setSource(""); setTarget(""); setHint(undefined); refresh(); },
  });
  const suggest = useMutation({
    mutationFn: () => suggestMapping(systemId, list.id, source),
    onSuccess: (r) => { setHint(r.suggestion); if (r.suggestion) setTarget(r.suggestion.target_code); },
  });
  if (!can("analyse")) return <p className="nx-sub" data-testid="ref-propose-needs">{t("Proposing a mapping needs the {permission} permission.", { permission: "analyse" })}</p>;
  return (
    <fieldset className="nx-fieldset" data-testid="ref-propose">
      <legend>{t("Propose a mapping")}</legend>
      {open.length === 0 ? <p className="nx-sub">{t("Every source code has a target or a mapping.")}</p> : (
        <>
          <div className="nx-row nx-wrap">
            <label className="nx-field">
              <span>{t("Source code")}</span>
              <select className="nx-input" value={source} onChange={(e) => { setSource(e.target.value); setHint(undefined); }} data-testid="ref-source">
                <option value="">{t("Choose a source code")}</option>
                {open.map((c) => <option key={c.code} value={c.code}>{codeOption(c)}</option>)}
              </select>
            </label>
            {list.target_fields.length > 1 ? (
              <label className="nx-field">
                <span>{t("Field")}</span>
                <select className="nx-input" value={field} onChange={(e) => setField(e.target.value)}>
                  {list.target_fields.map((f) => <option key={f} value={f}>{describeField(f) ? `${f}: ${describeField(f)}` : f}</option>)}
                </select>
              </label>
            ) : null}
            <label className="nx-field">
              <span>{t("Target code")}</span>
              <select className="nx-input" value={target} onChange={(e) => setTarget(e.target.value)} data-testid="ref-target">
                <option value="">{t("Choose a target code")}</option>
                {list.target.map((c) => <option key={c.code} value={c.code}>{codeOption(c)}</option>)}
              </select>
            </label>
          </div>
          <p className="nx-row nx-wrap">
            {can("trigger_ai") ? <Button size={32} disabled={!source || suggest.isPending} onClick={() => suggest.mutate()} data-testid="ref-ask">{t("Ask Aletheia")}</Button> : null}
            <Button size={32} variant="primary" disabled={!source || !target || propose.isPending} onClick={() => propose.mutate()} data-testid="ref-propose-send">{t("Propose")}</Button>
          </p>
          {hint ? (
            <div data-testid="ref-suggestion">
              <p><Code code={hint.target_code} text={hint.target_text ?? undefined} /> <span className="nx-sub">{t("Aletheia suggests this target. A second person must still approve it.")}</span></p>
              <p className="nx-sub">{hint.reasoning}</p>
              <ul>{hint.checks.map((c) => <li key={c.code}><Code code={c.code} text={CHECK_TEXT[c.code]?.()} /> <Chip tone={c.passed ? "good" : "bad"}>{c.passed ? t("Passed") : t("Failed")}</Chip></li>)}</ul>
            </div>
          ) : null}
          {hint === null ? <p className="nx-sub" data-testid="ref-no-suggestion">{t("Aletheia has no proved suggestion for this code.")}</p> : null}
          {propose.isError ? <p role="alert">{failureText(propose.error)}</p> : null}
          {suggest.isError ? <p role="alert">{failureText(suggest.error)}</p> : null}
        </>
      )}
    </fieldset>
  );
}

function Usage({ systemId, listId }: { systemId: string; listId: string }) {
  const fixture = useFixture();
  const q = useQuery({ queryKey: ["ref-usage", fixture, systemId, listId], queryFn: () => getRefUsage(systemId, listId), staleTime: 15_000, retry: noRetry4xx });
  const head = (
    <>
      <h3>{t("Usage")}</h3>
      <p className="nx-sub">{t("Which codes the records hold, read from the field profiles of the latest analysis run.")}</p>
    </>
  );
  if (q.isPending) return <section data-testid="ref-usage">{head}<Skeleton lines={4} label={t("Usage")} /></section>;
  if (q.isError) return <section data-testid="ref-usage">{head}<ErrorState sentence={t("The usage of this list could not be read.")} error={q.error} onRetry={() => void q.refetch()} /></section>;
  const u: RefUsage = q.data;
  if (!u.version_id) return <section data-testid="ref-usage">{head}<EmptyState heading={t("No analysis run has profiled the fields this list checks yet.")} /></section>;
  const share = u.covered_share == null ? t("Not known") : u.covered_at_least ? t("at least {p}", { p: pct1(u.covered_share) }) : pct1(u.covered_share);
  const orphanRows = u.fields.reduce((n, f) => n + f.orphan_rows, 0);
  const atLeast = (f: RefUsageField, n: number) => (!f.profiled || f.masked ? "-" : f.truncated ? t("at least {n}", { n: int(n) }) : int(n));
  const fieldCols: Column<RefUsageField>[] = [
    { id: "field", label: t("Field"), cell: (f) => <span data-testid={`ref-usage-field-${f.field}`}>{fieldCode(f.field)}</span> },
    { id: "filled", label: t("Filled records"), align: "end", cell: (f) => (f.profiled ? int(f.filled) : "-") },
    { id: "covered", label: t("Valid code"), align: "end", cell: (f) => atLeast(f, f.covered) },
    { id: "orphan", label: t("Not in the check table"), align: "end", cell: (f) => atLeast(f, f.orphan_rows) },
    { id: "profile", label: t("Profile"), cell: (f) => <span className="nx-sub">{!f.profiled ? t("Not profiled") : f.masked ? t("Values masked") : f.truncated ? t("Top values only") : t("All values")}{f.sampled ? `, ${t("sampled")}` : ""}</span> },
  ];
  const orphanCols: Column<RefOrphan>[] = [
    { id: "value", label: t("Value"), cell: (o) => <span data-testid={`ref-orphan-${o.value}`}><Code code={o.value} text={t("Not in {table}", { table: u.table })} /></span> },
    { id: "records", label: t("Records"), align: "end", compare: (a, b) => a.count - b.count, cell: (o) => int(o.count) },
    { id: "fields", label: t("Fields"), cell: (o) => <span className="nx-row nx-wrap">{o.fields.map((f) => <span key={f}>{fieldCode(f)}</span>)}</span> },
  ];
  return (
    <section aria-label={t("Usage")} data-testid="ref-usage">
      {head}
      <p data-testid="ref-usage-share">
        {t("Records with a valid code: {share}", { share })}{" "}
        <span className="nx-sub">{t("{used} of {codes} codes in use", { used: int(u.used), codes: int(u.codes) })}{u.run_at ? `, ${formatDate(u.run_at, "date")}` : ""}</span>
      </p>
      <PartBar
        segments={[
          { label: t("Valid code"), value: u.covered },
          { label: t("Not in the check table"), value: orphanRows },
          { label: t("Not listed in the profile"), value: Math.max(0, u.filled - u.covered - orphanRows) },
        ]}
        label={t("Records by code validity")} format={int}
      />
      {u.covered_at_least ? <p className="nx-sub" data-testid="ref-usage-truncated">{t("A field holds more distinct values than its profile lists, so these counts are lower bounds and an unused code may still be used.")}</p> : null}
      <TableSave title={t("Usage per field")}><DataTable rows={u.fields} columns={fieldCols} rowKey={(f) => f.field} rowLabel={(f) => f.field} caption={t("Usage per field")} /></TableSave>
      <h4>{u.orphans_complete ? t("Values not in the check table") : t("Values not in the check table (at least these)")}</h4>
      {u.orphans.length === 0 ? <EmptyState heading={u.orphans_complete ? t("Every value in the records is a code of the list.") : t("No listed value is missing from the check table.")} /> : (
        <TableSave title={t("Values used in records but missing from the check table")}>
          <DataTable rows={u.orphans} columns={orphanCols} rowKey={(o) => o.value} rowLabel={(o) => o.value} caption={t("Values used in records but missing from the check table")} />
        </TableSave>
      )}
      <h4>{u.unused_certain ? t("Codes never used") : t("Codes not seen in the profiled values")}</h4>
      {u.unused.length === 0 ? <p className="nx-sub">{t("Every code of the list is used.")}</p> : (
        <p data-testid="ref-unused">{t("{n, plural, one {# code} other {# codes}}", { n: u.unused.length })}: {u.unused.join(", ")}</p>
      )}
    </section>
  );
}

type CodeRow = RefCode & { m?: RefMapping; same: boolean; targetText?: string | null };

function ListDetail({ systemId, listId, versionId, onVersion }: { systemId: string; listId: string; versionId: string; onVersion: (id: string) => void }) {
  const fixture = useFixture();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["ref-list", fixture, systemId, listId, versionId], queryFn: () => getRefList(systemId, listId, versionId || undefined), staleTime: 15_000, retry: noRetry4xx });
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["ref-list", fixture, systemId, listId] });
    void qc.invalidateQueries({ queryKey: ["ref-lists", fixture, systemId] });
  };
  if (q.isPending) return <Skeleton lines={6} label={t("Source codes")} />;
  if (q.isError) return <ErrorState sentence={t("The code list could not be read.")} error={q.error} onRetry={() => void q.refetch()} />;
  const l = q.data;
  const vLabel = (v: RefList["versions"][number]) => (v.finished_at ? formatDate(v.finished_at, "date") : v.load_id);
  const points = [...l.versions].reverse().map((v) => ({ label: vLabel(v), value: v.codes }));
  const byTarget = new Map(l.target.map((c) => [c.code, c.text]));
  const mapOf = new Map(l.mappings.map((m) => [m.source_code, m]));
  const rows: CodeRow[] = l.source.map((c) => {
    const m = mapOf.get(c.code);
    return { ...c, m, same: !m && byTarget.has(c.code), targetText: byTarget.get(c.code) };
  });
  const codeCols: Column<CodeRow>[] = [
    { id: "source", label: t("Source code"), cell: (r) => <span data-testid={`ref-code-${r.code}`}><Code code={r.code} text={r.text ?? undefined} /></span> },
    { id: "target", label: t("Target code"), cell: (r) => (r.m ? <Code code={r.m.target_code} text={r.m.target_text ?? undefined} /> : r.same ? <Code code={r.code} text={r.targetText ?? undefined} /> : <span className="nx-sub">{t("None")}</span>) },
    { id: "result", label: t("Result"), cell: (r) => (r.m ? <Chip tone={STATUS_TONE[r.m.status]}>{STATUS_TEXT[r.m.status]()}</Chip> : r.same ? t("Same code on both sides") : <Chip tone="bad">{t("No target yet")}</Chip>) },
  ];
  const mapCols: Column<RefMapping>[] = [
    { id: "source", label: t("Source code"), cell: (m) => <span data-testid={`ref-map-${m.source_code}`}><Code code={m.source_code} text={m.source_text ?? undefined} /></span> },
    { id: "target", label: t("Target code"), cell: (m) => <Code code={m.target_code} text={m.target_text ?? undefined} /> },
    { id: "field", label: t("Field"), cell: (m) => fieldCode(m.target_field) },
    { id: "result", label: t("Result"), cell: (m) => <Chip tone={STATUS_TONE[m.status]}>{STATUS_TEXT[m.status]()}</Chip> },
    { id: "decision", label: t("Decision"), cell: (m) => <Decision m={m} refresh={refresh} /> },
  ];
  return (
    <>
      <section aria-label={t("Versions")} data-testid="ref-versions">
        <h3>{t("Versions")}</h3>
        <p className="nx-sub">{t("Each completed load of the check table is a version. Open one to see its codes.")}</p>
        <ChartCard
          title={t("Codes per version")} state={points.length < 2 ? "empty" : "ready"} testId="ref-version-trend"
          chart={<PointSpark points={points} label={t("Codes per version")} />}
          figure={int(points[points.length - 1]?.value ?? 0)} line={t("How many codes the source list held at each load")} emptyLine={t("Two loads are needed to draw a trend.")}
        />
        <p className="nx-row nx-wrap">
          {l.versions.map((v) => (
            <Button key={v.load_id} size={32} variant={v.load_id === l.version_id ? "primary" : "secondary"} aria-pressed={v.load_id === l.version_id} onClick={() => onVersion(v.load_id)} title={`${v.origin}, ${t("{n} codes", { n: int(v.codes) })}`}>
              {vLabel(v)}
            </Button>
          ))}
        </p>
      </section>
      <section aria-label={t("Source codes")} data-testid="ref-codes">
        <h3>{t("Source codes")}</h3>
        <p className="nx-sub">{t("Every code of the source list with the target it goes to.")}</p>
        {rows.length === 0 ? <EmptyState heading={t("No codes have been extracted for this list yet.")} /> : (
          <TableSave title={t("Source codes and their targets")}><DataTable rows={rows} columns={codeCols} rowKey={(r) => r.code} rowLabel={(r) => r.code} caption={t("Source codes and their targets")} /></TableSave>
        )}
      </section>
      <section aria-label={t("Mappings")} data-testid="ref-mappings">
        <h3>{t("Mappings")}</h3>
        <p className="nx-sub">{t("A mapping takes effect when a person other than the proposer approves it.")}</p>
        {l.mappings.length === 0 ? <EmptyState heading={t("No mapping has been proposed for this list.")} /> : (
          <TableSave title={t("Mappings and their approval")}><DataTable rows={l.mappings} columns={mapCols} rowKey={(m) => m.id} rowLabel={(m) => m.source_code} caption={t("Mappings and their approval")} /></TableSave>
        )}
        <Propose key={l.id} list={l} systemId={systemId} refresh={refresh} />
      </section>
      <Usage systemId={systemId} listId={listId} />
    </>
  );
}

export function ReferenceDataNative() {
  const fixture = useFixture();
  const go = useGo();
  const sys = useQuery({ queryKey: ["ref-systems", fixture], queryFn: getSystemsExtended, staleTime: 60_000, retry: noRetry4xx });
  const [pickedSystem, setSystem] = useUrlParam<string>("system", "");
  const [pickedList, setList] = useUrlParam<string>("list", "");
  const [versionId, setVersion] = useUrlParam<string>("version", "");
  const systems = sys.data ?? [];
  const systemId = systems.some((s) => s.id === pickedSystem) ? pickedSystem : (systems[0]?.id ?? "");
  const lists = useQuery({ queryKey: ["ref-lists", fixture, systemId], queryFn: () => getRefLists(systemId), enabled: !!systemId, staleTime: 15_000, retry: noRetry4xx });
  if (sys.isPending || (!!systemId && lists.isPending)) return <div className="nx-body"><Skeleton lines={6} label={t("Reference data")} /></div>;
  const err = sys.error ?? lists.error;
  if (err) {
    return (
      <div className="nx-body">
        {httpStatus(err) === 403 ? <EmptyState heading={t("Your role cannot read the reference data.")} /> : (
          <ErrorState sentence={t("The reference data could not be read.")} error={err} onRetry={() => { void sys.refetch(); void lists.refetch(); }} />
        )}
      </div>
    );
  }
  if (!systemId || !lists.data) return <div className="nx-body"><EmptyState heading={t("No system is connected yet.")} /></div>;
  const all = lists.data.lists;
  const listId = all.some((l) => l.id === pickedList) ? pickedList : (all[0]?.id ?? "");
  const total = (k: keyof RefCoverage) => all.reduce((n, l) => n + l.coverage[k], 0);
  type Sum = (typeof all)[number];
  const listCols: Column<Sum>[] = [
    { id: "list", label: t("Code list"), cell: (s) => (
      <span data-testid={`ref-list-${s.id}`}>
        <Button size={32} variant={s.id === listId ? "primary" : "quiet"} aria-pressed={s.id === listId} onClick={() => { setList(s.id); setVersion(""); }}>{listText(s.id)}</Button>
      </span>
    ) },
    { id: "object", label: t("Object"), cell: (s) => <Code code={s.module} text={moduleText(s.module)} /> },
    { id: "table", label: t("Check table"), cell: (s) => <Code code={s.table} text={describeTable(s.table) ?? undefined} /> },
    { id: "source", label: t("Source codes"), align: "end", cell: (s) => int(s.source_codes) },
    { id: "target", label: t("Target codes"), align: "end", cell: (s) => int(s.target_codes) },
    { id: "versions", label: t("Versions"), align: "end", cell: (s) => int(s.versions) },
    { id: "open", label: t("No target yet"), align: "end", compare: (a, b) => a.coverage.open - b.coverage.open, cell: (s) => int(s.coverage.open) },
    { id: "coverage", label: t("Coverage"), cell: (s) => <PartBar segments={coverageParts(s.coverage)} label={t("Mapping coverage of {list}", { list: listText(s.id) })} format={int} /> },
  ];
  return (
    <div className="nx-body" data-testid="reference-page">
      <section aria-label={t("Reference data")} data-testid="reference-data">
        <p className="nx-sub">{t("Pick a code list")}, {t("Map every code to a target")}, {t("Get a second approval")}, {t("Use it in the migration")}</p>
        <h2>{t("{n, plural, one {# source code has no target yet} other {# source codes have no target yet}}", { n: total("open") })}</h2>
        <p className="nx-sub">{t("Lists come from the check tables Meridian extracts. A mapping reaches the migration only after a second person approves it. Lists with no extracted check table are not shown.")}</p>
        <div className="nx-statgrid">
          <StatCard label={t("Waiting for approval")} value={total("proposed")} />
          <StatCard label={t("Approved")} value={total("approved")} />
          <StatCard label={t("No target yet")} value={total("open")} />
        </div>
        <div className="nx-row nx-wrap">
          <label className="nx-field">
            <span>{t("System")}</span>
            <select className="nx-input" value={systemId} onChange={(e) => { setSystem(e.target.value); setList(""); setVersion(""); }} data-testid="ref-system">
              {systems.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </label>
          <Button size={32} onClick={go("/migration")}>{t("Open the migration analysis")}</Button>
        </div>
      </section>
      <div className="nx-chartcards">
        <ChartCard
          title={t("Mapping coverage")} state={all.length ? "ready" : "empty"} testId="ref-coverage"
          chart={<PartBar segments={coverageParts({ same: total("same"), approved: total("approved"), proposed: total("proposed"), rejected: total("rejected"), open: total("open") })} label={t("Mapping coverage")} format={compact} />}
          figure={compact(total("open"))} line={t("Source codes by mapping result, every list")} emptyLine={t("This system has no code lists Meridian extracts.")}
        />
      </div>
      <section aria-label={t("Code lists")} data-testid="ref-lists">
        <h3>{t("Code lists")}</h3>
        <p className="nx-sub">{t("Coverage of the source codes against {target}.", { target: lists.data.target_label })}</p>
        {all.length === 0 ? <EmptyState heading={t("This system has no code lists Meridian extracts.")} /> : (
          <TableSave title={t("Code lists")}><DataTable rows={all} columns={listCols} rowKey={(s) => s.id} rowLabel={(s) => listText(s.id)} caption={t("Code lists")} /></TableSave>
        )}
      </section>
      {listId ? <ListDetail systemId={systemId} listId={listId} versionId={versionId} onVersion={setVersion} /> : null}
    </div>
  );
}
