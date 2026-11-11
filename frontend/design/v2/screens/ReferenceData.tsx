"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  decideMapping, getRefList, getRefLists, proposeMapping, suggestMapping,
  type MappingStatus, type RefCoverage, type RefList, type RefListSummary, type RefMapping, type RefSuggestion,
} from "@/lib/api/v2/reference-data";
import { getSystemsExtended } from "@/lib/api/v2/runs";
import { useFixture } from "@/lib/api/v2/fixture";
import { formatDate } from "@/lib/format";
import { failureText } from "@/lib/v2/errors";
import { useUrlParam, useV2Session } from "@/lib/v2/hooks";
import { t } from "@/lib/v2/i18n";
import { moduleText } from "@/lib/v2/labels";
import { int } from "@/lib/v2/score";
import { ChartFrame, ChartTable, StackedBar, TrendChart, type StackPart } from "../charts";
import { NeedsPermission } from "../admin/kit";
import { Coded, EmptyFrame, ErrorFrame, Skeleton } from "../parts";
import { Guide } from "./Guide";
import { CcBanner, CcPage } from "./cc-parts";
import { Panel } from "./Mining";
import { ScrollFrame } from "./object/ScrollFrame";

/**
 * Reference data: the check tables Meridian already extracts (country, unit of measure, material group, payment terms,
 * the SuccessFactors picklist), each with its versions and the mapping of every source code to a target code. A mapping
 * takes effect only when a second person approves it. Aletheia may suggest a target; it sees code values and
 * descriptions only, and the server proves the suggestion before it is shown.
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

function coverageParts(c: RefCoverage): StackPart[] {
  return [
    { key: "same", label: t("Same code on both sides"), value: c.same, colour: "--m2-chart-3", title: t("{n} the same on both sides", { n: int(c.same) }) },
    { key: "approved", label: t("Approved"), value: c.approved, colour: "--m2-chart-1", title: t("{n} approved", { n: int(c.approved) }) },
    { key: "proposed", label: t("Waiting for approval"), value: c.proposed, colour: "--m2-chart-2", title: t("{n} waiting for approval", { n: int(c.proposed) }) },
    { key: "rejected", label: t("Rejected"), value: c.rejected, colour: "--m2-sev-high", title: t("{n} rejected", { n: int(c.rejected) }) },
    { key: "open", label: t("No target yet"), value: c.open, colour: "--m2-sev-crit", title: t("{n} with no target yet", { n: int(c.open) }) },
  ];
}

function Decision({ m, systemId, listId }: { m: RefMapping; systemId: string; listId: string }) {
  const qc = useQueryClient();
  const fixture = useFixture();
  const { can } = useV2Session();
  const send = useMutation({
    mutationFn: (decision: "approve" | "reject") => decideMapping(m.id, decision),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["ref-list", fixture, systemId, listId] });
      void qc.invalidateQueries({ queryKey: ["ref-lists", fixture, systemId] });
    },
  });
  if (m.status !== "proposed" || !can("approve")) return null;
  return (
    <span>
      <button type="button" className="m2-btn m2-sm" disabled={send.isPending} onClick={() => send.mutate("approve")}>{t("Approve")}</button>{" "}
      <button type="button" className="m2-btn m2-sm" disabled={send.isPending} onClick={() => send.mutate("reject")}>{t("Reject")}</button>
      {send.isError ? <span role="alert" className="m2-meta"> {failureText(send.error)}</span> : null}
    </span>
  );
}

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
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["ref-list", fixture, systemId, list.id] });
    void qc.invalidateQueries({ queryKey: ["ref-lists", fixture, systemId] });
  };
  const propose = useMutation({
    mutationFn: () => proposeMapping({ system_id: systemId, list_id: list.id, target_field: field, source_code: source, target_code: target }),
    onSuccess: () => { setSource(""); setTarget(""); setHint(undefined); refresh(); },
  });
  const suggest = useMutation({
    mutationFn: () => suggestMapping(systemId, list.id, source),
    onSuccess: (r) => { setHint(r.suggestion); if (r.suggestion) setTarget(r.suggestion.target_code); },
  });
  if (!can("analyse")) return <NeedsPermission what={t("Proposing a mapping")} permission="analyse" />;
  return (
    <fieldset className="m2-fld" data-testid="ref-propose">
      <legend>{t("Propose a mapping")}</legend>
      {open.length === 0 ? <p className="m2-meta">{t("Every source code has a target or a mapping.")}</p> : (
        <>
          <label>
            {t("Source code")}{" "}
            <select value={source} onChange={(e) => { setSource(e.target.value); setHint(undefined); }} aria-label={t("Source code")}>
              <option value="">{t("Choose a source code")}</option>
              {open.map((c) => <option key={c.code} value={c.code}>{c.text ? `${c.code}: ${c.text}` : c.code}</option>)}
            </select>
          </label>{" "}
          {list.target_fields.length > 1 ? (
            <label>
              {t("Field")}{" "}
              <select value={field} onChange={(e) => setField(e.target.value)} aria-label={t("Field")}>
                {list.target_fields.map((f) => <option key={f} value={f}>{f}</option>)}
              </select>
            </label>
          ) : null}{" "}
          <label>
            {t("Target code")}{" "}
            <select value={target} onChange={(e) => setTarget(e.target.value)} aria-label={t("Target code")}>
              <option value="">{t("Choose a target code")}</option>
              {list.target.map((c) => <option key={c.code} value={c.code}>{c.text ? `${c.code}: ${c.text}` : c.code}</option>)}
            </select>
          </label>{" "}
          {can("trigger_ai") ? <button type="button" className="m2-btn m2-sm" disabled={!source || suggest.isPending} onClick={() => suggest.mutate()}>{t("Ask Aletheia")}</button> : null}{" "}
          <button type="button" className="m2-btn m2-sm" disabled={!source || !target || propose.isPending} onClick={() => propose.mutate()}>{t("Propose")}</button>
          {hint ? (
            <div data-testid="ref-suggestion">
              <p><Coded code={hint.target_code} text={hint.target_text} /> <span className="m2-meta">{t("Aletheia suggests this target. A second person must still approve it.")}</span></p>
              <p className="m2-meta">{hint.reasoning}</p>
              <ul className="m2-cl-changes">
                {hint.checks.map((c) => <li key={c.code}><Coded code={c.code} text={CHECK_TEXT[c.code]?.()} /> <span className="m2-meta">{c.passed ? t("Passed") : t("Failed")}</span></li>)}
              </ul>
            </div>
          ) : null}
          {hint === null ? <p className="m2-meta" data-testid="ref-no-suggestion">{t("Aletheia has no proved suggestion for this code.")}</p> : null}
          {propose.isError ? <span role="alert" className="m2-meta"> {failureText(propose.error)}</span> : null}
          {suggest.isError ? <span role="alert" className="m2-meta"> {failureText(suggest.error)}</span> : null}
        </>
      )}
    </fieldset>
  );
}

function ListDetail({ systemId, listId, versionId, onVersion }: { systemId: string; listId: string; versionId: string; onVersion: (id: string) => void }) {
  const fixture = useFixture();
  const q = useQuery({ queryKey: ["ref-list", fixture, systemId, listId, versionId], queryFn: () => getRefList(systemId, listId, versionId || undefined), staleTime: 15_000 });
  if (q.isPending) return <Skeleton width="100%" height={240} />;
  if (q.isError) return <ErrorFrame onRetry={() => void q.refetch()}>{t("The code list could not be read.")}</ErrorFrame>;
  const l = q.data;
  const points = [...l.versions].reverse().map((v) => {
    const label = v.finished_at ? formatDate(v.finished_at, "date") : v.load_id;
    return { id: v.load_id, label, title: t("{label}: {n} codes", { label, n: int(v.codes) }), value: v.codes };
  });
  const top = Math.max(2, ...points.map((p) => p.value));
  const byTarget = new Map(l.target.map((c) => [c.code, c.text]));
  const mapOf = new Map(l.mappings.map((m) => [m.source_code, m]));
  return (
    <>
      <Panel title={t("Versions")} meta={t("Each completed load of the check table is a version. Open one to see its codes.")} testId="ref-versions">
        <ChartFrame
          title={t("Codes per version")}
          sub={t("How many codes the source list held at each load")}
          height={140}
          level={2}
          state={points.length < 2 ? "empty" : "ready"}
          empty={t("Two loads are needed to draw a trend.")}
          testId="ref-version-trend"
          table={<ChartTable caption={t("Codes per version")} head={[t("Version"), t("Codes")]} rows={points.map((p) => [p.label, int(p.value)])} />}
        >
          <TrendChart points={points} domain={[0, top] as const} ticks={[0, top / 2, top]} height={140} label={t("Codes per version")} yLabel={t("codes")} format={int} />
        </ChartFrame>
        <ul className="m2-cl-changes">
          {l.versions.map((v) => (
            <li key={v.load_id}>
              <button type="button" className="m2-btn m2-sm" aria-pressed={v.load_id === l.version_id} onClick={() => onVersion(v.load_id)}>
                {v.finished_at ? formatDate(v.finished_at, "date") : v.load_id}
              </button>{" "}
              <span className="m2-meta">{v.origin}, {t("{n} codes", { n: int(v.codes) })}</span>
            </li>
          ))}
        </ul>
      </Panel>
      <Panel title={t("Source codes")} meta={t("Every code of the source list with the target it goes to.")} testId="ref-codes">
        {l.source.length === 0 ? <EmptyFrame>{t("No codes have been extracted for this list yet.")}</EmptyFrame> : (
          <ScrollFrame label={t("Source codes, scrollable")}>
            <table className="m2-tbl">
              <caption className="m2-sr">{t("Source codes and their targets")}</caption>
              <thead><tr><th scope="col">{t("Source code")}</th><th scope="col">{t("Target code")}</th><th scope="col">{t("Result")}</th></tr></thead>
              <tbody>
                {l.source.map((c) => {
                  const m = mapOf.get(c.code);
                  const same = !m && byTarget.has(c.code);
                  return (
                    <tr key={c.code} data-testid={`ref-code-${c.code}`}>
                      <td><Coded code={c.code} text={c.text} /></td>
                      <td>{m ? <Coded code={m.target_code} text={m.target_text} /> : same ? <Coded code={c.code} text={byTarget.get(c.code)} /> : <span className="m2-meta">{t("None")}</span>}</td>
                      <td>{m ? STATUS_TEXT[m.status]() : same ? t("Same code on both sides") : t("No target yet")}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </ScrollFrame>
        )}
      </Panel>
      <Panel title={t("Mappings")} meta={t("A mapping takes effect when a person other than the proposer approves it.")} testId="ref-mappings">
        {l.mappings.length === 0 ? <EmptyFrame>{t("No mapping has been proposed for this list.")}</EmptyFrame> : (
          <ScrollFrame label={t("Mappings, scrollable")}>
            <table className="m2-tbl">
              <caption className="m2-sr">{t("Mappings and their approval")}</caption>
              <thead><tr><th scope="col">{t("Source code")}</th><th scope="col">{t("Target code")}</th><th scope="col">{t("Field")}</th><th scope="col">{t("Result")}</th><th scope="col">{t("Decision")}</th></tr></thead>
              <tbody>
                {l.mappings.map((m) => (
                  <tr key={m.id} data-testid={`ref-map-${m.source_code}`}>
                    <td><Coded code={m.source_code} text={m.source_text} /></td>
                    <td><Coded code={m.target_code} text={m.target_text} /></td>
                    <td><span className="m2-meta">{m.target_field}</span></td>
                    <td>{STATUS_TEXT[m.status]()}</td>
                    <td><Decision m={m} systemId={systemId} listId={listId} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollFrame>
        )}
        <Propose list={l} systemId={systemId} />
      </Panel>
    </>
  );
}

function Summary({ s, current, onPick }: { s: RefListSummary; current: boolean; onPick: () => void }) {
  return (
    <li data-testid={`ref-list-${s.id}`}>
      <button type="button" className="m2-btn m2-sm" aria-pressed={current} onClick={onPick}>{listText(s.id)}</button>{" "}
      <span className="m2-meta">{moduleText(s.module)}, {s.table}, {t("{n} source codes, {m} target codes, {v} versions", { n: int(s.source_codes), m: int(s.target_codes), v: int(s.versions) })}</span>
      <StackedBar parts={coverageParts(s.coverage)} label={t("Mapping coverage of {list}", { list: listText(s.id) })} format={int} />
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
  if (sys.isPending || (!!systemId && lists.isPending)) return <CcPage title={title}><Skeleton width="100%" height={320} /></CcPage>;
  if (sys.isError || lists.isError) return <CcPage title={title}><ErrorFrame onRetry={() => { void sys.refetch(); void lists.refetch(); }}>{t("The reference data could not be read.")}</ErrorFrame></CcPage>;
  if (!systemId || !lists.data) return <CcPage title={title}><EmptyFrame>{t("No system is connected yet.")}</EmptyFrame></CcPage>;
  const all = lists.data.lists;
  const listId = all.some((l) => l.id === pickedList) ? pickedList : (all[0]?.id ?? "");
  const total = (k: keyof RefCoverage) => all.reduce((n, l) => n + l.coverage[k], 0);
  return (
    <CcPage title={title}>
      <Guide
        steps={{ labels: [t("Pick a code list"), t("Map every code to a target"), t("Get a second approval"), t("Use it in the migration")], current: listId ? 1 : 0 }}
        shows={t("Lists the code lists extracted from the source system and the target each code maps to.")}
        next={{ href: "/migration", label: t("Open the migration analysis") }}
        means={[
          [t("Same code on both sides"), t("Codes that keep the same value in source and target.")],
          [t("Waiting for approval"), t("Mappings proposed and waiting for a second person.")],
          [t("No target yet"), t("Codes with no target chosen, which block the migration of records that use them.")],
        ]}
      />
      <CcBanner
        testId="reference-data"
        label={title}
        eyebrow={title}
        headline={t("{n, plural, one {# source code has no target yet} other {# source codes have no target yet}}", { n: total("open") })}
        why={t("Lists come from the check tables Meridian extracts. A mapping reaches the migration only after a second person approves it. Lists with no extracted check table are not shown.")}
        figs={[
          { label: t("Waiting for approval"), value: int(total("proposed")) },
          { label: t("Approved"), value: int(total("approved")) },
          { label: t("No target yet"), value: int(total("open")) },
        ]}
        action={
          <label>
            {t("System")}{" "}
            <select value={systemId} onChange={(e) => { setSystem(e.target.value); setList(""); setVersion(""); }} aria-label={t("System")}>
              {systems.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </label>
        }
      />
      <Panel title={t("Code lists")} meta={t("Coverage of the source codes against {target}.", { target: lists.data.target_label })} testId="ref-lists">
        {all.length === 0 ? <EmptyFrame>{t("This system has no code lists Meridian extracts.")}</EmptyFrame> : (
          <ul className="m2-cl-changes">
            {all.map((s) => <Summary key={s.id} s={s} current={s.id === listId} onPick={() => { setList(s.id); setVersion(""); }} />)}
          </ul>
        )}
      </Panel>
      {listId ? <ListDetail systemId={systemId} listId={listId} versionId={versionId} onVersion={setVersion} /> : null}
    </CcPage>
  );
}
