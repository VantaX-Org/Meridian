"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getDedupCandidates, getDedupCandidatesFor, mergeDedup, previewDedup, type DedupCandidate } from "@/lib/api/v2/cleaning";
import { useFixture } from "@/lib/api/v2/fixture";
import { failureText } from "@/lib/v2/errors";
import { useV2Session } from "@/lib/v2/hooks";
import { t } from "@/lib/v2/i18n";
import { labelText, moduleText } from "@/lib/v2/labels";
import { int } from "@/lib/v2/score";
import { Button, Code, DataTable, Sheet, type Column, useToast } from "../kit";
import type { SheetCtx } from "../shell/SheetHost";
import { QueryView, useSubmitGuard } from "./states";
import "./journey.css";

/**
 * Duplicate records to merge in the new interface (GET /cleaning/dedup, GET /cleaning/dedup?object_type=,
 * POST /cleaning/dedup/preview, POST /cleaning/dedup/{id}/merge). One sheet kind, "dedup":
 * id "" lists the pairs, any other id compares one pair and merges it.
 */

const statusOf = (e: unknown) => (e as { response?: { status?: number }; status?: number } | null)?.response?.status ?? (e as { status?: number } | null)?.status;
const noRetry = (n: number, e: unknown) => n < 2 && ![403, 404].includes(statusOf(e) ?? 0);

function useDedup(objectType: string) {
  const fixture = useFixture();
  return useQuery({
    queryKey: ["cleaning", fixture, objectType ? `dedup-${objectType}` : "dedup"],
    queryFn: () => (objectType ? getDedupCandidatesFor(objectType) : getDedupCandidates()),
    staleTime: 60_000,
    retry: noRetry,
  });
}

const matched = (c: DedupCandidate) => Object.keys(c.match_fields ?? {});

function PairList({ ctx }: { ctx: SheetCtx }) {
  const { can } = useV2Session();
  const [objectType, setObjectType] = useState("");
  const all = useDedup("");
  const q = useDedup(objectType);
  const types = [...new Set((all.data?.items ?? []).map((c) => c.object_type))].sort();
  const columns: Column<DedupCandidate>[] = [
    { id: "r", label: t("Records"), cell: (c) => <><Code code={c.record_key_a} /> {t("and")} <Code code={c.record_key_b} /></> },
    { id: "o", label: t("Object"), cell: (c) => moduleText(c.object_type) },
    { id: "m", label: t("Matched on"), cell: (c) => (matched(c).length ? matched(c).map((f, i) => <span key={f}>{i ? ", " : ""}<Code code={f} text={labelText(f)} /></span>) : "-") },
    { id: "s", label: t("Match score"), align: "end", cell: (c) => c.match_score.toFixed(1) },
    { id: "a", label: t("Action"), cell: (c) => <Button variant="quiet" size={32} onClick={() => ctx.open({ kind: "dedup", id: c.id })}>{can("approve") ? t("Compare and merge") : t("Compare")}</Button> },
  ];
  return (
    <div className="nx-form">
      {q.data ? <p className="nx-sub">{t("{n} pairs the cleaning engine found to be the same record", { n: int(q.data.total) })}</p> : null}
      {types.length > 1 || objectType ? (
        <label className="nx-field">
          {t("Object type")}
          <select className="nx-input" value={objectType} onChange={(e) => setObjectType(e.target.value)}>
            <option value="">{t("All objects")}</option>
            {types.map((o) => <option key={o} value={o}>{moduleText(o)}</option>)}
          </select>
        </label>
      ) : null}
      <div data-testid="dedup-list">
        <DataTable
          caption={t("Duplicate records to merge")}
          rows={q.data?.items ?? []}
          columns={columns}
          rowKey={(c) => c.id}
          rowLabel={(c) => `${c.record_key_a} ${c.record_key_b}`}
          loading={q.isPending}
          error={q.isError ? { sentence: statusOf(q.error) === 403 ? t("Your role cannot see the duplicate records.") : t("The duplicate records could not be read."), onRetry: () => void q.refetch() } : undefined}
          empty={{ heading: t("Duplicate records to merge"), text: t("No duplicate pair is waiting to be merged.") }}
        />
      </div>
    </div>
  );
}

function Merge({ pair, onDone }: { pair: DedupCandidate; onDone: () => void }) {
  const { can } = useV2Session();
  const toast = useToast();
  const qc = useQueryClient();
  const fixture = useFixture();
  const { busy, run } = useSubmitGuard();
  const fields = useQuery({ queryKey: ["cleaning", fixture, "dedup-preview", pair.id], queryFn: () => previewDedup(pair), staleTime: 60_000 });
  const [survivor, setSurvivor] = useState(pair.record_key_a);
  const [reason, setReason] = useState("");
  const rows = Object.entries(fields.data?.merge_preview ?? {});
  const columns: Column<(typeof rows)[number]>[] = [
    { id: "f", label: t("Field"), cell: ([f]) => <Code code={f} text={labelText(f)} /> },
    { id: "a", label: pair.record_key_a, cell: ([, v]) => v.a || "-" },
    { id: "b", label: pair.record_key_b, cell: ([, v]) => v.b || "-" },
    { id: "s", label: t("Suggested value"), cell: ([, v]) => v.survivor || "-" },
  ];
  const merge = () =>
    void run(async () => {
      try {
        await mergeDedup(pair.id, survivor, reason.trim());
        toast({ text: t("{b} was merged into {a}.", { a: survivor, b: survivor === pair.record_key_a ? pair.record_key_b : pair.record_key_a }), tone: "good" });
        await qc.invalidateQueries({ queryKey: ["cleaning"] });
        onDone();
      } catch (e) {
        toast({ text: failureText(e) || t("The records could not be merged."), tone: "bad" });
      }
    });
  return (
    <div className="nx-form" data-testid="dedup-merge">
      <p className="nx-note">{t("Merging keeps the record you pick as the survivor and folds the other into it.")}</p>
      <DataTable
        caption={t("Compare")}
        rows={rows}
        columns={columns}
        rowKey={([f]) => f}
        rowLabel={([f]) => f}
        loading={fields.isPending}
        error={fields.isError ? { sentence: t("The two records could not be compared."), onRetry: () => void fields.refetch() } : undefined}
        empty={{ heading: t("Compare"), text: t("The cleaning queue holds no data for these records.") }}
      />
      {can("approve") ? (
        <form className="nx-form" onSubmit={(e) => { e.preventDefault(); if (reason.trim()) merge(); }}>
          <fieldset className="nx-row nx-row-wrap">
            <legend className="nx-sub">{t("Keep")}</legend>
            {[pair.record_key_a, pair.record_key_b].map((k) => (
              <label key={k} className="nx-check">
                <input type="radio" name={`survivor-${pair.id}`} checked={survivor === k} onChange={() => setSurvivor(k)} /> <Code code={k} />
              </label>
            ))}
          </fieldset>
          <label className="nx-field">
            {t("Why are these the same record?")}
            <input className="nx-input" value={reason} onChange={(e) => setReason(e.target.value)} />
          </label>
          <div className="nx-row">
            <Button variant="primary" type="submit" disabled={!reason.trim()} loading={busy}>{t("Merge")}</Button>
          </div>
        </form>
      ) : null}
    </div>
  );
}

export function DedupSheet({ ctx }: { ctx: SheetCtx }) {
  const q = useDedup("");
  const pair = ctx.id ? q.data?.items.find((c) => c.id === ctx.id) : undefined;
  return (
    <Sheet open onClose={ctx.close} title={pair ? `${pair.record_key_a} ${t("and")} ${pair.record_key_b}` : t("Duplicate records to merge")} meta={pair ? moduleText(pair.object_type) : undefined} size="large" under={ctx.under}
      secondary={ctx.id ? <Button variant="secondary" onClick={() => ctx.open({ kind: "dedup", id: "" })}>{t("Duplicate records to merge")}</Button> : <Button variant="secondary" onClick={ctx.close}>{t("Close")}</Button>}>
      {ctx.id ? (
        <QueryView loading={q.isPending} error={q.isError ? t("The duplicate records could not be read.") : null} onRetry={() => void q.refetch()} empty={!pair} emptyHeading={t("No duplicate pair is waiting to be merged.")} label={t("Duplicate records to merge")}>
          {pair ? <Merge key={pair.id} pair={pair} onDone={() => ctx.open({ kind: "dedup", id: "" })} /> : null}
        </QueryView>
      ) : (
        <PairList ctx={ctx} />
      )}
    </Sheet>
  );
}
