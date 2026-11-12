"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { errorSentence } from "@/lib/api/v2/client";
import { createPair, deletePair, getPairs, runPair, type ComparePair } from "@/lib/api/v2/compare";
import { useFixture } from "@/lib/api/v2/fixture";
import { formatDate, formatModuleName } from "@/lib/format";
import { useUrlParam } from "@/lib/v2/hooks";
import { t } from "@/lib/v2/i18n";
import { f1 } from "@/lib/v2/score";
import { Confirm } from "../admin/kit";
import { EmptyFrame, ErrorFrame, PageTitle, Skeleton, V2Link } from "../parts";
import { useToast } from "../Toast";
import { CcPage } from "./cc-parts";
import { Panel } from "./Mining";
import { SystemComparePair } from "./SystemComparePair";
import { retry, status, Table } from "./WorkAnalytics";

export const STATUS_TEXT: Record<string, () => string> = {
  queued: () => t("Queued"),
  running: () => t("Running"),
  done: () => t("Done"),
  failed: () => t("Failed"),
};

/**
 * Source and target system comparison: every pair of connected systems per object, with the source score, the
 * score the load should reach and the score measured in the target. One pair opens with ?pair=.
 */
export function SystemCompare() {
  const [pair, setPair] = useUrlParam("pair", "");
  if (pair) return <SystemComparePair id={pair} onBack={() => setPair("")} />;
  return <Overview />;
}

function Overview() {
  const fixture = useFixture();
  const q = useQuery({ queryKey: ["system-compare", "pairs", fixture], queryFn: getPairs, staleTime: 60_000, retry });
  const toast = useToast();
  const qc = useQueryClient();
  const [removing, setRemoving] = useState<ComparePair | null>(null);
  const done = () => void qc.invalidateQueries({ queryKey: ["system-compare"] });
  const run = useMutation({
    mutationFn: (id: string) => runPair(id),
    onSuccess: () => { toast.show(t("Comparison started")); done(); },
    onError: (e) => toast.show(errorSentence(e, t("The comparison could not start.")), "error"),
  });
  const remove = useMutation({
    mutationFn: (id: string) => deletePair(id),
    onSuccess: () => { toast.show(t("Pair removed")); setRemoving(null); done(); },
    onError: (e) => { setRemoving(null); toast.show(errorSentence(e, t("The pair could not be removed.")), "error"); },
  });
  const title = t("System comparison");

  if (q.isPending) return <CcPage title={title}><Skeleton width="100%" height={320} /></CcPage>;
  if (q.isError) {
    return (
      <CcPage title={title}>
        {status(q.error) === 403 ? <EmptyFrame>{t("Your role cannot read the system comparisons.")}</EmptyFrame> : (
          <ErrorFrame onRetry={() => void q.refetch()}>{t("The system comparisons could not be read.")}</ErrorFrame>
        )}
      </CcPage>
    );
  }
  const { pairs } = q.data;
  return (
    <CcPage title={title}>
      <PageTitle sub={t("Pair a source and a target system per object. Each comparison reconciles the records, compares the configuration and explains why the target score differs from the source.")}>{title}</PageTitle>
      <Panel title={t("Pairs")} meta={t("{n} pairs", { n: pairs.length })} testId="cmp-pairs">
        {pairs.length === 0 ? (
          <EmptyFrame>{t("No systems are paired yet. Pair a source and a target below.")}</EmptyFrame>
        ) : (
          <Table title={t("Pairs")} head={[t("Object"), t("Source"), t("Target"), t("Source score"), t("Projected"), t("Actual in target"), t("Last comparison"), t("Actions")]}>
            {pairs.map((p) => {
              const s = p.last?.scores;
              return (
                <tr key={p.id}>
                  <th scope="row" className="m2-card-lead"><V2Link href={`/system-compare?pair=${p.id}`}>{formatModuleName(p.module)}</V2Link></th>
                  <td data-label={t("Source")}>{p.source.name}</td>
                  <td data-label={t("Target")}>{p.target.name}</td>
                  <td data-label={t("Source score")} className="m2-num">{f1(s?.source ?? null)}</td>
                  <td data-label={t("Projected")} className="m2-num">{f1(s?.projected ?? null)}</td>
                  <td data-label={t("Actual in target")} className="m2-num">{f1(s?.actual ?? null)}</td>
                  <td data-label={t("Last comparison")}>
                    {p.last ? `${STATUS_TEXT[p.last.status]?.() ?? p.last.status}${p.last.at ? `, ${formatDate(p.last.at, "date")}` : ""}` : t("Not compared yet")}
                  </td>
                  <td data-label={t("Actions")}>
                    <button type="button" className="m2-btn m2-sm" disabled={run.isPending} onClick={() => run.mutate(p.id)}>{t("Compare now")}</button>{" "}
                    <button type="button" className="m2-btn m2-sm" onClick={() => setRemoving(p)}>{t("Remove")}</button>
                  </td>
                </tr>
              );
            })}
          </Table>
        )}
      </Panel>
      <PairForm data={q.data} onDone={done} />
      {removing ? (
        <Confirm
          title={t("Remove the pair {s} to {g}", { s: removing.source.name, g: removing.target.name })}
          body={t("The pair and all its comparisons are removed. The systems and their extractions stay.")}
          confirm={t("Remove the pair")}
          danger
          pending={remove.isPending}
          onCancel={() => setRemoving(null)}
          onConfirm={() => remove.mutate(removing.id)}
        />
      ) : null}
    </CcPage>
  );
}

function PairForm({ data, onDone }: { data: { systems: { id: string; name: string }[]; modules: string[]; suggestions: { source: { id: string; name: string }; target: { id: string; name: string } }[] }; onDone: () => void }) {
  const [moduleKey, setModule] = useState(data.modules[0] ?? "");
  const [src, setSrc] = useState("");
  const [tgt, setTgt] = useState("");
  const toast = useToast();
  const create = useMutation({
    mutationFn: () => createPair({ module: moduleKey, source_system_id: src, target_system_id: tgt }),
    onSuccess: () => { toast.show(t("Pair added")); setSrc(""); setTgt(""); onDone(); },
    onError: (e) => toast.show(errorSentence(e, t("The pair could not be added.")), "error"),
  });
  const ok = moduleKey && src && tgt && src !== tgt;
  return (
    <Panel title={t("Pair two systems")} testId="cmp-new">
      {data.suggestions.length ? (
        <p className="m2-meta">
          {t("Suggested pairs:")}{" "}
          {data.suggestions.map((s) => (
            <button key={`${s.source.id}-${s.target.id}`} type="button" className="m2-btn m2-sm" onClick={() => { setSrc(s.source.id); setTgt(s.target.id); }}>
              {t("{s} to {g}", { s: s.source.name, g: s.target.name })}
            </button>
          ))}
        </p>
      ) : null}
      <form className="m2-rfilters" onSubmit={(e) => { e.preventDefault(); if (ok) create.mutate(); }}>
        <label>{t("Object")}
          <select className="m2-sel" value={moduleKey} onChange={(e) => setModule(e.target.value)}>
            {data.modules.map((m) => <option key={m} value={m}>{formatModuleName(m)}</option>)}
          </select>
        </label>
        <label>{t("Source system")}
          <select className="m2-sel" value={src} onChange={(e) => setSrc(e.target.value)}>
            <option value="">{t("Choose a system")}</option>
            {data.systems.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </label>
        <label>{t("Target system")}
          <select className="m2-sel" value={tgt} onChange={(e) => setTgt(e.target.value)}>
            <option value="">{t("Choose a system")}</option>
            {data.systems.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </label>
        <button type="submit" className="m2-btn m2-next" disabled={!ok || create.isPending}>{t("Add the pair")}</button>
      </form>
      {src && src === tgt ? <p className="m2-meta" role="alert">{t("The source and the target must be different systems.")}</p> : null}
    </Panel>
  );
}
