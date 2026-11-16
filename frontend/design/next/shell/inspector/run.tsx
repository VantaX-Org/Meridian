"use client";

import { useState, type ComponentType } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getRunExtractTarget, openExtractTargetFile, refillExtractTarget, type TemplateFill } from "@/lib/api/v2/extract-target";
import { getTemplates } from "@/lib/api/v2/migration";
import { errorSentence } from "@/lib/api/v2/client";
import { useFixture } from "@/lib/api/v2/fixture";
import { formatDate } from "@/lib/format";
import { useV2Session } from "@/lib/v2/hooks";
import { t } from "@/lib/v2/i18n";
import { labelText } from "@/lib/v2/labels";
import { useCompareSummary, useTimeline, useVersionHead } from "@/lib/v2/runs-queries";
import { int } from "@/lib/v2/score";
import { kindWord } from "@/design/v2/RunTimeline";
import { V2Link } from "@/design/v2/parts";
import { Button, Code, EmptyState, ErrorState, Skeleton } from "../../kit";
import { Actions, Fact, Facts, InspectorFrame, type BodyProps } from "./frame";

const duration = (seconds: number): string => {
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return m > 0 ? `${m} m ${s} s` : `${s} s`;
};

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** The fill in words: rows, how many are ready and held, and approved fixes left out because the source value changed. */
export function fillSummary(s: Record<string, unknown> | null | undefined): string {
  if (!s) return "";
  const parts: string[] = [];
  const rows = num(s.rows);
  if (rows !== null) parts.push(t("{n, plural, one {# row} other {# rows}}", { n: rows }));
  const ready = num(s.ready);
  if (ready !== null) parts.push(t("{n} ready", { n: ready }));
  const held = num(s.held);
  if (held) parts.push(t("{n} held back", { n: held }));
  const cleansed = num(s.cleansed);
  if (cleansed) parts.push(t("{n, plural, one {# value} other {# values}} cleansed", { n: cleansed }));
  const stale = num(s.stale_fixes);
  if (stale) parts.push(t("{n, plural, one {# approved fix} other {# approved fixes}} not applied because the value changed in the source", { n: stale }));
  return parts.join(", ");
}

function Since({ prev, id }: { prev: string; id: string }) {
  const q = useCompareSummary(prev, id);
  const tot = q.data?.totals;
  if (q.isError) return <ErrorState sentence={t("The change since the run before could not be read.")} onRetry={() => void q.refetch()} />;
  if (!tot) return <Skeleton lines={2} />;
  return (
    <ul className="nx-ib-list" data-testid="run-since">
      <li>{t("{failing} rules started failing, {fixed} stopped", { failing: int(tot.newly_failing), fixed: int(tot.fixed) })}</li>
      <li>{t("{worse} failing rules got worse, {better} got better", { worse: int(tot.worse), better: int(tot.better) })}</li>
    </ul>
  );
}

function OutputRow({ versionId, fill, exists, canExport }: { versionId: string; fill: TemplateFill; exists: boolean | null; canExport: boolean }) {
  const [busy, setBusy] = useState(false);
  const [refilling, setRefilling] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const qc = useQueryClient();
  const word = fill.status === "filled" ? t("Filled") : fill.status === "failed" ? t("Failed") : fill.status === "skipped" ? t("Skipped") : t("Waiting");
  const summary = fillSummary(fill.summary);
  return (
    <li data-testid={`run-output-${fill.module}`}>
      <div className="nx-ib-row">
        <strong>{labelText(fill.module)}</strong>
        <span className="nx-ib-meta" data-testid={`run-output-status-${fill.module}`}>{word}</span>
      </div>
      <div className="nx-ib-meta">
        {fill.template_name ?? fill.template_id}
        {exists === false ? <> {t("(this template has since been deleted)")}</> : null}
        {fill.filled_at ? <> {t("filled {when}", { when: formatDate(fill.filled_at, "datetime") })}</> : null}
      </div>
      {fill.status === "filled" && summary ? <div data-testid={`run-output-summary-${fill.module}`}>{summary}</div> : null}
      {fill.error ? <div role={fill.status === "failed" ? "alert" : undefined}>{fill.error}</div> : null}
      <div className="nx-ib-acts">
        {fill.status === "filled" ? (
          canExport ? (
            <Button
              variant="secondary"
              size={32}
              loading={busy}
              loadingLabel={t("Downloading…")}
              data-testid={`run-output-download-${fill.module}`}
              onClick={async () => {
                setBusy(true);
                setErr(null);
                try {
                  await openExtractTargetFile(versionId, fill.module);
                } catch {
                  setErr(t("The file could not be downloaded. Try again."));
                } finally {
                  setBusy(false);
                }
              }}
            >
              {t("Download")}
            </Button>
          ) : (
            <span className="nx-ib-meta" data-testid={`run-output-noexport-${fill.module}`}>{t("Downloading needs the export permission. Ask an administrator.")}</span>
          )
        ) : null}
        {canExport ? (
          <Button
            variant="secondary"
            size={32}
            loading={refilling}
            loadingLabel={t("Refilling…")}
            data-testid={`run-output-refill-${fill.module}`}
            onClick={async () => {
              setRefilling(true);
              setErr(null);
              try {
                await refillExtractTarget(versionId, fill.module);
                await qc.invalidateQueries({ queryKey: ["v2", "run-extract-target"] });
              } catch (e) {
                setErr(errorSentence(e, t("The template could not be filled again. Try again.")));
              } finally {
                setRefilling(false);
              }
            }}
          >
            {t("Refill")}
          </Button>
        ) : null}
      </div>
      {err ? <div role="alert">{err}</div> : null}
    </li>
  );
}

/** Per object, whether Meridian filled the target template when the run was stored. A run without a target shows nothing. */
function RunOutput({ id }: { id: string }) {
  const fixture = useFixture();
  const canExport = useV2Session().can("export");
  const q = useQuery({ queryKey: ["v2", "run-extract-target", fixture, id], queryFn: () => getRunExtractTarget(id), staleTime: 15_000, retry: false });
  const fills = q.data?.templates ?? [];
  const modules = [...new Set(fills.map((f) => f.module))];
  // A template deleted after the run: look the run's templates up per object, only once there is something to say.
  const live = useQuery({
    queryKey: ["v2", "run-output-templates", fixture, id, modules.join(",")],
    enabled: modules.length > 0,
    retry: false,
    queryFn: async () => Object.fromEntries(await Promise.all(modules.map(async (m) => [m, (await getTemplates(m)).templates.map((x) => x.id)] as const))),
  });
  if (q.isLoading) return <Skeleton lines={2} />;
  if (q.isError) return <ErrorState sentence={t("The output of this run could not be read.")} onRetry={() => void q.refetch()} />;
  if (fills.length === 0 && !q.data?.target_system_id) return null;
  return (
    <section className="nx-ib-sec" aria-label={t("Output")} data-testid="run-output">
      <h3>{t("Output")}</h3>
      {fills.length === 0 ? (
        <EmptyState heading={t("No template was chosen for this run.")}>
          <V2Link href="/migration">{t("Upload a template")}</V2Link>
        </EmptyState>
      ) : (
        <ul className="nx-ib-list">
          {fills.map((f) => (
            <OutputRow key={f.module} versionId={id} fill={f} exists={live.data ? (live.data[f.module] ?? []).includes(f.template_id) : null} canExport={canExport} />
          ))}
        </ul>
      )}
      {fills.some((f) => f.status === "failed" || f.status === "skipped") ? <p className="nx-ib-meta">{t("Refill fills the template again from the newest full extraction of this system.")}</p> : null}
    </section>
  );
}

/** `?open=run:<id>`: the run in brief, its output, and the way to its page and to a comparison with the run before. */
export function RunInspectorNative({ id, onClose }: BodyProps) {
  const head = useVersionHead(id);
  const timeline = useTimeline(null, 50);
  const runs = timeline.data?.runs ?? [];
  const at = runs.findIndex((r) => r.id === id);
  const run = at >= 0 ? runs[at] : null;
  const prev = at > 0 ? runs[at - 1] : null;
  const v = head.data;
  return (
    <InspectorFrame
      title={v ? t("Run {run_at}", { run_at: formatDate(v.run_at, "datetime") }) : t("Run")}
      status={v ? (v.metadata?.baseline ? t("Baseline") : v.status === "failed" ? t("Failed") : undefined) : undefined}
      onClose={onClose}
    >
      {head.isLoading ? (
        <Skeleton lines={4} />
      ) : head.isError || !v ? (
        <ErrorState sentence={t("This run could not be read. It may belong to another tenant or have been removed.")} onRetry={() => void head.refetch()} />
      ) : (
        <>
          <Facts>
            <Fact label={t("Run")}><Code code={id} /></Fact>
            <Fact label={t("Started by")}>{kindWord(run?.kind ?? v.metadata?.trigger)}</Fact>
            <Fact label={t("Records checked")}>{int(run?.records_checked)}</Fact>
            <Fact label={t("Took")}>{run?.duration_s == null ? "—" : duration(run.duration_s)}</Fact>
          </Facts>
          {prev ? (
            <section className="nx-ib-sec">
              <h3>{t("Since")} {formatDate(prev.run_at, "date")}</h3>
              <Since prev={prev.id} id={id} />
            </section>
          ) : null}
          <RunOutput id={id} />
          <Actions>
            <V2Link href={`/run/${id}`} className="nx-btn nx-btn-primary">{t("Open the run")}</V2Link>
            {prev ? <V2Link href={`/run/${prev.id}/vs/${id}`} className="nx-btn">{t("Compare with the run before")}</V2Link> : null}
          </Actions>
        </>
      )}
    </InspectorFrame>
  );
}

export const RUN_BODIES: Record<string, ComponentType<BodyProps>> = { run: RunInspectorNative };
