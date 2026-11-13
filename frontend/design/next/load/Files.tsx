"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { formatInt } from "@/lib/format";
import { t } from "@/lib/v2/i18n";
import { V2Link } from "@/design/v2/parts";
import { errorSentence } from "@/lib/api/v2/client";
import { exportLoadFiles, type LoadFileFormat } from "@/lib/api/v2/migration";
import { loadKeys, useLoadHistory, useLoadOrder, useLoadSimulation } from "@/lib/api/next/load";
import { Button, Chip, ErrorState, SegmentedControl, Skeleton, useToast } from "../kit";
import { eventSentence } from "./History";

/** Step 3: the objects in the order to load them, and the run's files to download. */
export function Files({ runId, objects, onBack }: { runId: string; objects: string[]; onBack: () => void }) {
  const toast = useToast();
  const qc = useQueryClient();
  const sim = useLoadSimulation(runId);
  const order = useLoadOrder(objects);
  const hist = useLoadHistory(5, 0);
  const [fmt, setFmt] = useState<LoadFileFormat>("xlsx");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  if (sim.isLoading || order.isLoading) return <Skeleton lines={5} label={t("Working out the load order")} />;
  if (sim.isError || !sim.data) return <ErrorState sentence={t("The files could not be listed.")} error={sim.error} onRetry={() => void sim.refetch()} />;

  const step = new Map((order.data?.objects ?? []).map((o) => [o.module, o]));
  const rows = sim.data.objects
    .filter((o) => objects.includes(o.module))
    .map((o) => ({ ...o, step: step.get(o.module)?.step ?? null, deps: step.get(o.module)?.blocked_by ?? [] }))
    .sort((a, b) => (a.step ?? 1e9) - (b.step ?? 1e9));
  const nameOf = (m: string) => sim.data?.objects.find((o) => o.module === m)?.label ?? step.get(m)?.label ?? m;

  const download = async () => {
    setBusy(true);
    try {
      await exportLoadFiles(runId, fmt);
      setDone(true);
      void qc.invalidateQueries({ queryKey: loadKeys.all });
      toast({ text: t("Load files downloaded."), tone: "good" });
    } catch (e) {
      toast({ text: errorSentence(e, t("The files could not be built.")), tone: "bad" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="nx-ld-step" data-testid="files" aria-labelledby="nx-ld-h-files">
      <h2 id="nx-ld-h-files">{t("Load files, in the order to load them")}</h2>
      <p className="nx-ld-lede">{t("Load each file in the order shown. The target rejects a child before its parent exists.")}</p>

      <ol className="nx-ld-order">
        {rows.map((r, i) => (
          <li key={r.module} className="nx-ld-file" data-testid={`file-${r.module}`}>
            <span className="nx-ld-num" aria-label={t("Order")}>{i + 1}</span>
            <div>
              <strong>{r.label}</strong>
              <div className="nx-ld-meta">{t("Tables: {tables}", { tables: r.tables.join(", ") })}</div>
              <div className="nx-ld-meta">{t("{n} rows", { n: formatInt(r.would_load) })}</div>
              <div className="nx-ld-meta">
                {r.step === null ? t("Order not known for {object}. Load it after the files above.", { object: r.label }) : r.deps.length ? t("Depends on {list}", { list: r.deps.map(nameOf).join(", ") }) : t("Depends on nothing")}
              </div>
            </div>
          </li>
        ))}
      </ol>

      <div className="nx-ld-fields">
        <SegmentedControl
          label={t("File format")}
          value={fmt}
          onChange={(v) => setFmt(v as LoadFileFormat)}
          items={[{ value: "xlsx", label: t("Excel, one sheet per table") }, { value: "csv", label: t("CSV in a ZIP") }]}
        />
        <p className="nx-ld-meta">{t("Rows that would be rejected are left out of the files.")}</p>
      </div>

      <div className="nx-ld-actions">
        <Button variant="quiet" onClick={onBack}>{t("Back")}</Button>
        <Button variant="primary" loading={busy} loadingLabel={t("Building the files")} onClick={() => void download()}>{t("Download all")}</Button>
      </div>

      {done || (hist.data?.items.length ?? 0) > 0 ? (
        <div className="nx-ld-after" data-testid="history-card">
          <h3>{t("Handed over so far")}</h3>
          <ul>
            {(hist.data?.items ?? []).slice(0, 3).map((e) => <li key={e.id}>{eventSentence(e)}</li>)}
          </ul>
          <V2Link href="/load/history">{t("See all files handed over")}</V2Link>
        </div>
      ) : null}

      <div className="nx-ld-after">
        <h3>{t("After you load")}</h3>
        <Chip tone="neutral">{t("Check the result in the target")}</Chip>
        <p className="nx-ld-meta">{t("Pull the loaded data back from the target and compare it with what you sent.")}</p>
        <V2Link href="/load/analysis#mig-post-load">{t("Check the result in the target")}</V2Link>
      </div>
    </section>
  );
}
