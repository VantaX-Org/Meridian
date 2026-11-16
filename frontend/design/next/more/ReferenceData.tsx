"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  decideMapping, getRefList, getRefLists, getRefUsage, proposeMapping, suggestMapping,
  type MappingStatus, type RefCoverage, type RefList, type RefListSummary, type RefMapping, type RefSuggestion, type RefUsage,
} from "@/lib/api/v2/reference-data";
import { getSystemsExtended } from "@/lib/api/v2/runs";
import { useFixture } from "@/lib/api/v2/fixture";
import { formatDate } from "@/lib/format";
import { failureText } from "@/lib/v2/errors";
import { useUrlParam, useV2Session } from "@/lib/v2/hooks";
import { t } from "@/lib/v2/i18n";
import { moduleText } from "@/lib/v2/labels";
import { DASH, int, pct1 } from "@/lib/v2/score";
import { Button, Code, DataTable, EmptyState, ErrorState, Skeleton, Stepper } from "../kit";
import { AreaTrend, StackedBar, type Seg } from "../viz";
import { About, Banner, Panel } from "./cfg-parts";

/**
 * Reference data: the check tables Meridian already extracts (country, unit of measure, material group, payment terms,
 * the SuccessFactors picklist), each with its versions and the mapping of every source code to a target code. A mapping
 * takes effect only when a second person approves it. Aletheia may suggest a target; it sees code values and
 * descriptions only, and the server proves the suggestion before it is shown, with the checks it passed.
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

const CHECK_TEXT: Record<string, () => string> = {
  SOURCE_KNOWN: () => t("The source code is in the source list"),
  TARGET_EXISTS: () => t("The target code is in the target list"),
  CONFIDENCE_VALID: () => t("The confidence is between 0 and 1"),
};

function coverageSegs(c: RefCoverage): Seg[] {
  return [
    { id: "same", label: t("Same code on both sides"), value: c.same, tone: "chart3" },
    { id: "approved", label: t("Approved"), value: c.approved, tone: "good" },
    { id: "proposed", label: t("Waiting for approval"), value: c.proposed, tone: "chart2" },
    { id: "rejected", label: t("Rejected"), value: c.rejected, tone: "warn" },
    { id: "open", label: t("No target yet"), value: c.open, tone: "bad" },
  ];
}

/** The stacked bar with its parts written out, so the numbers are readable without hovering. */
function Bar({ segs, label }: { segs: Seg[]; label: string }) {
  return (
    <div className="nx-cell-stack">
      <StackedBar segs={segs} label={label} />
      <span className="nx-sub">{segs.map((s) => `${s.label}: ${int(s.value)}`).join(", ")}</span>
    </div>
  );
}

const refresh = (qc: ReturnType<typeof useQueryClient>, fixture: unknown, systemId: string, listId: string) => {
  void qc.invalidateQueries({ queryKey: ["ref-list", fixture, systemId, listId] });
  void qc.invalidateQueries({ queryKey: ["ref-lists", fixture, systemId] });
};

function Decision({ m, systemId, listId }: { m: RefMapping; systemId: string; listId: string }) {
  const qc = useQueryClient();
  const fixture = useFixture();
  const { can } = useV2Session();
  const send = useMutation({
    mutationFn: (decision: "approve" | "reject") => decideMapping(m.id, decision),
    onSuccess: () => refresh(qc, fixture, systemId, listId),
  });
  if (m.status !== "proposed" || !can("approve")) return null;
  return (
    <span className="nx-row">
      <Button size={32} variant="primary" disabled={send.isPending} onClick={() => send.mutate("approve")}>{t("Approve")}</Button>
      <Button size={32} disabled={send.isPending} onClick={() => send.mutate("reject")}>{t("Reject")}</Button>
      {send.isError ? <span role="alert" className="nx-note">{failureText(send.error)}</span> : null}
    </span>
  );
}

const codeOption = (c: { code: string; text?: string | null }) => (c.text ? `${c.code}: ${c.text}` : c.code);

function Propose({ list, systemId }: { list: RefList; systemId: string }) {
  const qc = useQueryClient();
  const fixture = useFixture();
  const { can } = useV2Session();
  const mapped = new Set(list.mappings.filter((m) => m.status !== "rejected").map((m) => m.source_code));
  const targets = new Set(list.target.map((c) => c.code));
  const open = list.source.filter((c) => !mapped.has(c.code) && !targets.has(c.code));
  const [source, setSource] = useState("");
  const [target, setTarget] = useState("");
  const [field, setField] = useState(list.target_fields[0] ?? "");
  const [hint, setHint] = useState<RefSuggestion | null | undefined>(undefined);
  const propose = useMutation({
    mutationFn: () => proposeMapping({ system_id: systemId, list_id: list.id, target_field: field, source_code: source, target_code: target }),
    onSuccess: () => { setSource(""); setTarget(""); setHint(undefined); refresh(qc, fixture, systemId, list.id); },
  });
  const suggest = useMutation({
    mutationFn: () => suggestMapping(systemId, list.id, source),
    onSuccess: (r) => { setHint(r.suggestion); if (r.suggestion) setTarget(r.suggestion.target_code); },
  });
  if (!can("analyse")) return null;
  return (
    <fieldset className="nx-form" data-testid="ref-propose">
      <legend>{t("Propose a mapping")}</legend>
      {open.length === 0 ? <p className="nx-note">{t("Every source code has a target or a mapping.")}</p> : (
        <>
          <div className="nx-row">
            <label className="nx-field">
              {t("Source code")}
              <select className="nx-input" value={source} onChange={(e) => { setSource(e.target.value); setHint(undefined); }} aria-label={t("Source code")}>
                <option value="">{t("Choose a source code")}</option>
                {open.map((c) => <option key={c.code} value={c.code}>{codeOption(c)}</option>)}
              </select>
            </label>
            {list.target_fields.length > 1 ? (
              <label className="nx-field">
                {t("Field")}
                <select className="nx-input" value={field} onChange={(e) => setField(e.target.value)} aria-label={t("Field")}>
                  {list.target_fields.map((f) => <option key={f} value={f}>{f}</option>)}
                </select>
              </label>
            ) : null}
            <label className="nx-field">
              {t("Target code")}
              <select className="nx-input" value={target} onChange={(e) => setTarget(e.target.value)} aria-label={t("Target code")}>
                <option value="">{t("Choose a target code")}</option>
                {list.target.map((c) => <option key={c.code} value={c.code}>{codeOption(c)}</option>)}
              </select>
            </label>
          </div>
          <div className="nx-row">
            {can("trigger_ai") ? <Button size={32} loading={suggest.isPending} disabled={!source} onClick={() => suggest.mutate()}>{t("Ask Aletheia")}</Button> : null}
            <Button size={32} variant="primary" loading={propose.isPending} disabled={!source || !target} onClick={() => propose.mutate()}>{t("Propose")}</Button>
          </div>
          {hint ? (
            <div className="nx-body" data-testid="ref-suggestion">
              <p><Code code={hint.target_code} text={hint.target_text ?? undefined} /> <span className="nx-sub">{t("Aletheia suggests this target. A second person must still approve it.")}</span></p>
              <p className="nx-sub">{hint.reasoning}</p>
              <ul>
                {hint.checks.map((c) => <li key={c.code}><Code code={c.code} text={CHECK_TEXT[c.code]?.()} /> <span className="nx-sub">{c.passed ? t("Passed") : t("Failed")}</span></li>)}
              </ul>
            </div>
          ) : null}
          {hint === null ? <p className="nx-note" data-testid="ref-no-suggestion">{t("Aletheia has no proved suggestion for this code.")}</p> : null}
          {propose.isError ? <p role="alert" className="nx-note">{failureText(propose.error)}</p> : null}
          {suggest.isError ? <p role="alert" className="nx-note">{failureText(suggest.error)}</p> : null}
        </>
      )}
    </fieldset>
  );
}

function usageSegs(u: RefUsage): Seg[] {
  const orphanRows = u.fields.reduce((n, f) => n + f.orphan_rows, 0);
  const unlisted = Math.max(0, u.filled - u.covered - orphanRows);
  return [
    { id: "covered", label: t("Valid code"), value: u.covered, tone: "good" },
    { id: "orphan", label: t("Not in the check table"), value: orphanRows, tone: "bad" },
    { id: "unlisted", label: t("Not listed in the profile"), value: unlisted, tone: "chart1" },
  ];
}

function Usage({ systemId, listId }: { systemId: string; listId: string }) {
  const fixture = useFixture();
  const q = useQuery({ queryKey: ["ref-usage", fixture, systemId, listId], queryFn: () => getRefUsage(systemId, listId), staleTime: 15_000 });
  const frame = (body: React.ReactNode) => <Panel title={t("Usage")} meta={t("Which codes the records hold, read from the field profiles of the latest analysis run.")} testId="ref-usage">{body}</Panel>;
  if (q.isPending) return frame(<Skeleton lines={4} label={t("Usage")} />);
  if (q.isError) return frame(<ErrorState sentence={t("The usage of this list could not be read.")} onRetry={() => void q.refetch()} />);
  const u = q.data;
  if (!u.version_id) return frame(<EmptyState heading={t("No analysis run has profiled the fields this list checks yet.")} />);
  const share = u.covered_share == null ? t("Not known") : u.covered_at_least ? t("at least {p}", { p: pct1(u.covered_share) }) : pct1(u.covered_share);
  const lower = (f: RefUsage["fields"][number], n: number) => (!f.profiled || f.masked ? DASH : f.truncated ? t("at least {n}", { n: int(n) }) : int(n));
  return frame(
    <div className="nx-body">
      <p data-testid="ref-usage-share">
        {t("Records with a valid code: {share}", { share })}{" "}
        <span className="nx-sub">{t("{used} of {codes} codes in use", { used: int(u.used), codes: int(u.codes) })}{u.run_at ? `, ${formatDate(u.run_at, "date")}` : ""}</span>
      </p>
      <Bar segs={usageSegs(u)} label={t("Records by code validity")} />
      {u.covered_at_least ? <p className="nx-note" data-testid="ref-usage-truncated">{t("A field holds more distinct values than its profile lists, so these counts are lower bounds and an unused code may still be used.")}</p> : null}
      <DataTable
        caption={t("Usage per field")}
        rows={u.fields}
        rowKey={(f) => f.field}
        rowLabel={(f) => f.field}
        columns={[
          { id: "field", label: t("Field"), cell: (f) => <span data-testid={`ref-usage-field-${f.field}`}><Code code={f.field} /></span> },
          { id: "filled", label: t("Filled records"), align: "end", cell: (f) => (f.profiled ? int(f.filled) : DASH) },
          { id: "covered", label: t("Valid code"), align: "end", cell: (f) => lower(f, f.covered) },
          { id: "orphan", label: t("Not in the check table"), align: "end", cell: (f) => lower(f, f.orphan_rows) },
          { id: "profile", label: t("Profile"), cell: (f) => `${!f.profiled ? t("Not profiled") : f.masked ? t("Values masked") : f.truncated ? t("Top values only") : t("All values")}${f.sampled ? `, ${t("sampled")}` : ""}` },
        ]}
      />
      <h3 className="nx-sub">{u.orphans_complete ? t("Values not in the check table") : t("Values not in the check table (at least these)")}</h3>
      <DataTable
        caption={t("Values used in records but missing from the check table")}
        rows={u.orphans}
        rowKey={(o) => o.value}
        rowLabel={(o) => o.value}
        empty={{ heading: u.orphans_complete ? t("Every value in the records is a code of the list.") : t("No listed value is missing from the check table.") }}
        columns={[
          { id: "value", label: t("Value"), cell: (o) => <span data-testid={`ref-orphan-${o.value}`}><Code code={o.value} text={t("Not in {table}", { table: u.table })} /></span> },
          { id: "count", label: t("Records"), align: "end", cell: (o) => int(o.count) },
          { id: "fields", label: t("Fields"), cell: (o) => o.fields.join(", ") },
        ]}
      />
      <h3 className="nx-sub">{u.unused_certain ? t("Codes never used") : t("Codes not seen in the profiled values")}</h3>
      {u.unused.length === 0 ? <p className="nx-sub">{t("Every code of the list is used.")}</p> : (
        <p data-testid="ref-unused">{t("{n, plural, one {# code} other {# codes}}", { n: u.unused.length })}: {u.unused.join(", ")}</p>
      )}
    </div>,
  );
}

function ListDetail({ systemId, listId, versionId, onVersion }: { systemId: string; listId: string; versionId: string; onVersion: (id: string) => void }) {
  const fixture = useFixture();
  const q = useQuery({ queryKey: ["ref-list", fixture, systemId, listId, versionId], queryFn: () => getRefList(systemId, listId, versionId || undefined), staleTime: 15_000 });
  if (q.isPending) return <Skeleton lines={6} label={t("Source codes")} />;
  if (q.isError) return <ErrorState sentence={t("The code list could not be read.")} onRetry={() => void q.refetch()} />;
  const l = q.data;
  const label = (v: { finished_at?: string | null; load_id: string }) => (v.finished_at ? formatDate(v.finished_at, "date") : v.load_id);
  const points = [...l.versions].reverse().map((v) => ({ label: label(v), value: v.codes }));
  const byTarget = new Map(l.target.map((c) => [c.code, c.text]));
  const mapOf = new Map(l.mappings.map((m) => [m.source_code, m]));
  return (
    <>
      <Panel title={t("Versions")} meta={t("Each completed load of the check table is a version. Open one to see its codes.")} testId="ref-versions">
        <div data-testid="ref-version-trend" className="nx-cell-stack">
          <strong>{t("Codes per version")}</strong>
          <span className="nx-sub">{t("How many codes the source list held at each load")}</span>
          <AreaTrend points={points.length < 2 ? [] : points} label={t("Codes per version")} height={140} empty={t("Two loads are needed to draw a trend.")} />
        </div>
        <ul className="nx-body">
          {l.versions.map((v) => (
            <li key={v.load_id} className="nx-row">
              <Button size={32} aria-pressed={v.load_id === l.version_id} onClick={() => onVersion(v.load_id)}>{label(v)}</Button>
              <span className="nx-sub">{v.origin}, {t("{n} codes", { n: int(v.codes) })}</span>
            </li>
          ))}
        </ul>
      </Panel>
      <Panel title={t("Source codes")} meta={t("Every code of the source list with the target it goes to.")} testId="ref-codes">
        <DataTable
          caption={t("Source codes and their targets")}
          rows={l.source}
          rowKey={(c) => c.code}
          rowLabel={(c) => c.code}
          empty={{ heading: t("No codes have been extracted for this list yet.") }}
          columns={[
            { id: "source", label: t("Source code"), cell: (c) => <span data-testid={`ref-code-${c.code}`}><Code code={c.code} text={c.text ?? undefined} /></span> },
            {
              id: "target",
              label: t("Target code"),
              cell: (c) => {
                const m = mapOf.get(c.code);
                if (m) return <Code code={m.target_code} text={m.target_text ?? undefined} />;
                return byTarget.has(c.code) ? <Code code={c.code} text={byTarget.get(c.code) ?? undefined} /> : t("None");
              },
            },
            {
              id: "result",
              label: t("Result"),
              cell: (c) => {
                const m = mapOf.get(c.code);
                return m ? STATUS_TEXT[m.status]() : byTarget.has(c.code) ? t("Same code on both sides") : t("No target yet");
              },
            },
          ]}
        />
      </Panel>
      <Panel title={t("Mappings")} meta={t("A mapping takes effect when a person other than the proposer approves it.")} testId="ref-mappings">
        <DataTable
          caption={t("Mappings and their approval")}
          rows={l.mappings}
          rowKey={(m) => m.id}
          rowLabel={(m) => m.source_code}
          empty={{ heading: t("No mapping has been proposed for this list.") }}
          columns={[
            { id: "source", label: t("Source code"), cell: (m) => <span data-testid={`ref-map-${m.source_code}`}><Code code={m.source_code} text={m.source_text ?? undefined} /></span> },
            { id: "target", label: t("Target code"), cell: (m) => <Code code={m.target_code} text={m.target_text ?? undefined} /> },
            { id: "field", label: t("Field"), cell: (m) => <Code code={m.target_field} /> },
            { id: "result", label: t("Result"), cell: (m) => STATUS_TEXT[m.status]() },
            { id: "decision", label: t("Decision"), cell: (m) => <Decision m={m} systemId={systemId} listId={listId} /> },
          ]}
        />
        <Propose list={l} systemId={systemId} />
      </Panel>
      <Usage systemId={systemId} listId={listId} />
    </>
  );
}

function Summary({ s, current, onPick }: { s: RefListSummary; current: boolean; onPick: () => void }) {
  return (
    <li className="nx-cell-stack" data-testid={`ref-list-${s.id}`}>
      <span className="nx-row">
        <Button size={32} aria-pressed={current} onClick={onPick}>{listText(s.id)}</Button>
        <span className="nx-sub">{moduleText(s.module)}, {s.table}, {t("{n} source codes, {m} target codes, {v} versions", { n: int(s.source_codes), m: int(s.target_codes), v: int(s.versions) })}</span>
      </span>
      <Bar segs={coverageSegs(s.coverage)} label={t("Mapping coverage of {list}", { list: listText(s.id) })} />
    </li>
  );
}

export function ReferenceData() {
  const fixture = useFixture();
  const sys = useQuery({ queryKey: ["ref-systems", fixture], queryFn: getSystemsExtended, staleTime: 60_000 });
  const [pickedSystem, setSystem] = useUrlParam<string>("system", "");
  const [pickedList, setList] = useUrlParam<string>("list", "");
  const [versionId, setVersion] = useUrlParam<string>("version", "");
  const systems = sys.data ?? [];
  const systemId = systems.some((s) => s.id === pickedSystem) ? pickedSystem : (systems[0]?.id ?? "");
  const lists = useQuery({ queryKey: ["ref-lists", fixture, systemId], queryFn: () => getRefLists(systemId), enabled: !!systemId, staleTime: 15_000 });
  const title = t("Reference data");
  if (sys.isPending || (!!systemId && lists.isPending)) return <Skeleton lines={8} label={title} />;
  if (sys.isError || lists.isError) return <ErrorState sentence={t("The reference data could not be read.")} onRetry={() => { void sys.refetch(); void lists.refetch(); }} />;
  if (!systemId || !lists.data) return <EmptyState heading={t("No system is connected yet.")} />;
  const all = lists.data.lists;
  const listId = all.some((l) => l.id === pickedList) ? pickedList : (all[0]?.id ?? "");
  const total = (k: keyof RefCoverage) => all.reduce((n, l) => n + l.coverage[k], 0);
  const steps = [t("Pick a code list"), t("Map every code to a target"), t("Get a second approval"), t("Use it in the migration")];
  const current = listId ? 1 : 0;
  return (
    <div className="nx-body">
      <Stepper label={title} steps={steps.map((label, i) => ({ id: String(i), label, state: i < current ? "done" : i === current ? "current" : "future" }))} />
      <Banner
        testId="reference-data"
        label={title}
        title={t("{n, plural, one {# source code has no target yet} other {# source codes have no target yet}}", { n: total("open") })}
        why={t("Lists come from the check tables Meridian extracts. A mapping reaches the migration only after a second person approves it. Lists with no extracted check table are not shown.")}
        meta={title}
        figs={[
          { label: t("Waiting for approval"), value: int(total("proposed")) },
          { label: t("Approved"), value: int(total("approved")) },
          { label: t("No target yet"), value: int(total("open")) },
        ]}
      >
        <label className="nx-field">
          {t("System")}
          <select className="nx-input" value={systemId} onChange={(e) => { setSystem(e.target.value); setList(""); setVersion(""); }} aria-label={t("System")}>
            {systems.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </label>
      </Banner>
      <Panel title={t("Code lists")} meta={t("Coverage of the source codes against {target}.", { target: lists.data.target_label })} testId="ref-lists">
        {all.length === 0 ? <EmptyState heading={t("This system has no code lists Meridian extracts.")} /> : (
          <ul className="nx-body">
            {all.map((s) => <Summary key={s.id} s={s} current={s.id === listId} onPick={() => { setList(s.id); setVersion(""); }} />)}
          </ul>
        )}
      </Panel>
      {listId ? <ListDetail systemId={systemId} listId={listId} versionId={versionId} onVersion={setVersion} /> : null}
      <About
        shows={t("Lists the code lists extracted from the source system and the target each code maps to.")}
        why={t("Lists come from the check tables Meridian extracts. A mapping reaches the migration only after a second person approves it. Lists with no extracted check table are not shown.")}
        next={{ href: "/migration", label: t("Open the migration analysis") }}
        means={[
          [t("Same code on both sides"), t("Codes that keep the same value in source and target.")],
          [t("Waiting for approval"), t("Mappings proposed and waiting for a second person.")],
          [t("No target yet"), t("Codes with no target chosen, which block the migration of records that use them.")],
        ]}
      />
    </div>
  );
}
