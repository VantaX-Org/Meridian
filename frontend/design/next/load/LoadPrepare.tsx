"use client";

/** Load, Prepare: choose objects, choose each one's source run, start the analysis. */
import { useState } from "react";
import { t } from "@/lib/v2/i18n";
import { usePortfolio } from "@/lib/api/next/portfolio";
import { startMigration } from "@/lib/api/v2/migration";
import { Button, EmptyState, ErrorState, Skeleton, ToastProvider, useToast } from "../kit";
import { SourceRunPicker } from "./SourceRunPicker";
import "./load.css";

function Prepare() {
  const q = usePortfolio({ limit: 500, sort: "module" });
  const toast = useToast();
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  const [runs, setRuns] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const rows = q.data?.objects ?? [];
  const chosen = rows.filter((r) => picked[r.module] && r.system_id && runs[r.module]);

  async function start() {
    setBusy(true);
    try {
      // The analysis takes one source run, so each object starts on its own.
      for (const r of chosen) await startMigration({ mode: "s4_dry_run", source_system_id: r.system_id as string, source_version_id: runs[r.module], modules: [r.module] });
      toast({ tone: "good", text: t("Analysis started for {n} objects", { n: chosen.length }) });
    } catch {
      toast({ tone: "bad", text: t("Could not start the analysis") });
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="nx-ld" data-testid="load-prepare">
      <header>
        <h1>{t("Prepare")}</h1>
        <p>{t("Pick the objects to load and the run each one loads from.")}</p>
      </header>
      {q.isLoading ? <Skeleton /> : q.isError ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : rows.length === 0 ? (
        <EmptyState heading={t("No objects to load yet")} />
      ) : (
        <ul className="nx-ld-list">
          {rows.map((r) => (
            <li key={`${r.system_id}:${r.module}`} className="nx-ld-row">
              <label className="nx-check-row">
                <input type="checkbox" checked={!!picked[r.module]} onChange={(e) => setPicked({ ...picked, [r.module]: e.target.checked })} />
                {r.label}
              </label>
              {picked[r.module] && r.system_id ? (
                <SourceRunPicker system={r.system_id} module={r.module} label={r.label} value={runs[r.module] ?? null} onChange={(id) => setRuns((p) => (p[r.module] === id ? p : { ...p, [r.module]: id }))} />
              ) : null}
            </li>
          ))}
        </ul>
      )}
      <div><Button variant="primary" disabled={busy || chosen.length === 0} onClick={() => void start()}>{t("Start analysis")}</Button></div>
    </main>
  );
}

export function LoadPrepare() {
  return <ToastProvider><Prepare /></ToastProvider>;
}
