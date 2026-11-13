"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getRunExtractTarget, openExtractTargetFile, type TemplateFill } from "@/lib/api/v2/extract-target";
import { getTemplates } from "@/lib/api/v2/migration";
import { useFixture } from "@/lib/api/v2/fixture";
import { formatDate } from "@/lib/format";
import { labelText } from "@/lib/v2/labels";
import { t } from "@/lib/v2/i18n";
import { useCan } from "../admin/kit";
import { EmptyFrame, Skeleton, V2Link } from "../parts";

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** The fill in words: rows, how many are ready and held, and how many approved fixes were left out because the source value had changed. */
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

function Row({ versionId, fill, exists, canExport }: { versionId: string; fill: TemplateFill; exists: boolean | null; canExport: boolean }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const word = fill.status === "filled" ? t("Filled") : fill.status === "failed" ? t("Failed") : fill.status === "skipped" ? t("Skipped") : t("Waiting");
  const summary = fillSummary(fill.summary);
  return (
    <li data-testid={`run-output-${fill.module}`}>
      <strong>{labelText(fill.module)}</strong>
      {" "}
      <span className="m2-meta" data-testid={`run-output-status-${fill.module}`}>{word}</span>
      <div className="m2-meta">
        {fill.template_name ?? fill.template_id}
        {exists === false ? <> {t("(this template has since been deleted)")}</> : null}
        {fill.filled_at ? <> {t("filled {when}", { when: formatDate(fill.filled_at, "datetime") })}</> : null}
      </div>
      {fill.status === "filled" && summary ? <div data-testid={`run-output-summary-${fill.module}`}>{summary}</div> : null}
      {fill.error ? <div className="m2-prov" role={fill.status === "failed" ? "alert" : undefined}>{fill.error}</div> : null}
      {fill.status === "filled" ? (
        canExport ? (
          <button type="button" className="m2-btn" disabled={busy} data-testid={`run-output-download-${fill.module}`} onClick={async () => {
            setBusy(true);
            setErr(null);
            try {
              await openExtractTargetFile(versionId, fill.module);
            } catch {
              setErr(t("The file could not be downloaded. Try again."));
            } finally {
              setBusy(false);
            }
          }}>
            {busy ? t("Downloading…") : t("Download")}
          </button>
        ) : (
          <div className="m2-meta" data-testid={`run-output-noexport-${fill.module}`}>{t("Downloading needs the export permission. Ask an administrator.")}</div>
        )
      ) : null}
      {err ? <div className="m2-prov" role="alert">{err}</div> : null}
    </li>
  );
}

/**
 * The Output card of a run: per object, whether Meridian filled the target template when the run was stored, what the
 * fill held, and the filled file. A run started without a target shows nothing at all.
 */
export function RunOutputCard({ id }: { id: string }) {
  const fixture = useFixture();
  const canExport = useCan()("export");
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
  if (q.isLoading) return <Skeleton width="100%" height={48} />;
  if (q.isError) return <EmptyFrame>{t("The output of this run could not be read.")}</EmptyFrame>;
  if (fills.length === 0 && !q.data?.target_system_id) return null;
  return (
    <section aria-label={t("Output")} data-testid="run-output">
      <h3>{t("Output")}</h3>
      {fills.length === 0 ? (
        <EmptyFrame>
          {t("No template was chosen for this run.")}{" "}
          <V2Link href="/migration">{t("Upload a template")}</V2Link>
        </EmptyFrame>
      ) : (
        <ul className="m2-breaches">
          {fills.map((f) => (
            <Row key={f.module} versionId={id} fill={f} exists={live.data ? (live.data[f.module] ?? []).includes(f.template_id) : null} canExport={canExport} />
          ))}
        </ul>
      )}
      {fills.some((f) => f.status === "failed" || f.status === "skipped") ? (
        <p className="m2-meta">
          {t("To fill again, open the object in Migration and fill its template from the full version.")}
        </p>
      ) : null}
    </section>
  );
}
