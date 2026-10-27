// frontend/app/(app)/objects/[object]/records/[key]/page.tsx
"use client";

import { Fragment } from "react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { Button, Card, EmptyState, EntityTabs, ErrorState, ExportMenu, Mono, RecordPage, Skeleton, Status, domainOf, type RecordStatus } from "@/design";
import { getObjectRecord, getObjectRecordFindings } from "@/lib/api/v1/objects";
import { getMaterialDuplicates, getMaterialFindings, getMaterialSupersession } from "@/lib/api/materials";
import { downloadAuthenticated } from "@/lib/api/download";
import { apiErrorMessage, apiErrorState, isNotFound } from "@/lib/error";
import { getRecordReportUrl } from "@/lib/api/reports";
import { queryKeys } from "@/lib/query-keys";
import { parseRecordKey } from "@/lib/record-key";
import { RunScope } from "@/components/run-scope";
import { useRunScope } from "@/hooks/use-run-scope";
import { hrefWithRun } from "@/lib/run-scope";
import { RecordPanel, workRecordKey } from "@/components/work/record-panel";
import { getWorkRecord } from "@/lib/api/work";
import { FieldSheet, sheetFields } from "./_field-sheet";

function SectionError({ what, query }: { what: string; query: UseQueryResult }) {
  return (
    <ErrorState
      message={`Could not load ${what}. ${apiErrorMessage(query.error)}`}
      onRetry={() => query.refetch()}
    />
  );
}

/** A duplicate candidate's score as a percentage; the API sends 0-100, a 0-1 ratio is scaled. */
function duplicateScore(score: number): string {
  return `${Math.round(score <= 1 ? score * 100 : score)}%`;
}

export default function RecordFixSheetPage() {
  const params = useParams<{ object: string; key: string }>();
  const search = useSearchParams();
  const object = params.object;
  // useParams() returns the raw path segment (see design/shell/useDrill.ts, which
  // decodes it too for the breadcrumb label) — decode it before splitting on
  // "=" / "|", otherwise a composite key never matches and falls back to the
  // whole encoded string as `primary`, breaking every fetch keyed on it.
  const key = params.key ? decodeURIComponent(params.key) : params.key;
  // `?run=` when the URL pins one, else this object's latest finished run.
  const scope = useRunScope({ object });
  const run = scope.runId ?? "";
  const backHref = hrefWithRun(`/objects/${object}`, null, scope.explicit ?? null);
  const { primary, fields } = parseRecordKey(key);
  const plant = fields.WERKS;
  const isMaterial = object === "material_master";
  // Material master and business partner have their own sheets keyed by the primary id; every
  // other object is looked up by the whole composite key (LIFNR=…|BUKRS=…).
  const generic = !isMaterial && object !== "business_partner";
  const lookupKey = generic ? key : primary;

  const recordQuery = useQuery({
    queryKey: queryKeys.record(object, key, run),
    queryFn: () => getObjectRecord(object, lookupKey, { version_id: run, plant }),
    enabled: !!run,
    retry: false,
  });
  const findingsQuery = useQuery({
    queryKey: [...queryKeys.record(object, key, run), "findings"],
    queryFn: () => getMaterialFindings(primary, { version_id: run }),
    enabled: !!run && isMaterial,
  });
  const genericFindingsQuery = useQuery({
    queryKey: [...queryKeys.record(object, key, run), "record-findings"],
    queryFn: () => getObjectRecordFindings(object, key, { version_id: run }),
    enabled: !!run && !isMaterial,
  });
  const supersessionQuery = useQuery({
    queryKey: [...queryKeys.record(object, key, run), "supersession"],
    queryFn: () => getMaterialSupersession(primary, { version_id: run, plant }),
    enabled: !!run && isMaterial,
  });
  const duplicatesQuery = useQuery({
    queryKey: [...queryKeys.record(object, key, run), "duplicates"],
    queryFn: () => getMaterialDuplicates(primary, { version_id: run }),
    enabled: !!run && isMaterial,
  });

  // The record's decisions for the run: what fails, the suggested values and the fix buttons. A record the run's work
  // list does not hold (it passes, or the work list is not built) answers 404 and the panel is left out.
  const workQuery = useQuery({
    queryKey: workRecordKey(object, key, run),
    queryFn: () => getWorkRecord(object, key, run),
    enabled: !!run && !!key,
    retry: false,
    meta: { ignoreError: true },
  });

  if (recordQuery.isLoading || (!run && scope.resolving)) {
    return (
      <div className="flex flex-col gap-2 p-6">
        <Skeleton height={32} />
        <Skeleton height={120} />
      </div>
    );
  }
  if (!run && scope.error) {
    return <ErrorState {...apiErrorState(scope.error)} onRetry={scope.refetch} />;
  }
  if (!run) {
    return (
      <EmptyState
        title="No run has measured this object"
        action={<Button render={<Link href={`/objects/${object}`}>Back to object</Link>} />}
      />
    );
  }
  if (recordQuery.isError) {
    return (
      <ErrorState
        {...apiErrorState(recordQuery.error)}
        onRetry={() => recordQuery.refetch()}
      />
    );
  }
  const material = recordQuery.data;
  if (!material) {
    return (
      <EmptyState
        title="Record not found in this run"
        detail="The key may belong to another system or run."
        action={<Button render={<Link href={backHref}>Back to object</Link>} />}
      />
    );
  }

  const hasMissing = material.views.some((view) => view.cells.some((cell) => cell.state === "missing"));
  const failingRules = genericFindingsQuery.data?.failing ?? [];
  // A material fails on a missing field or on any rule its findings report, whichever view it sits in.
  const materialRules = new Set((findingsQuery.data?.by_view ?? []).flatMap((view) => view.failing.map((rule) => rule.check_id)));
  const failing = isMaterial ? hasMissing || materialRules.size > 0 : failingRules.length > 0;
  // The verdict waits on the findings: never "passing" while they load or when they could not be read.
  const verdictQuery = isMaterial ? findingsQuery : genericFindingsQuery;
  const status: RecordStatus = failing
    ? { label: "failing", tone: "no-go" }
    : verdictQuery.isError
      ? { label: "unknown", tone: "neutral" }
      : verdictQuery.isPending
        ? { label: "checking", tone: "neutral" }
        : { label: "passing", tone: "go" };
  const fieldRows = Object.entries(material.mara ?? {}).filter(([, v]) => v != null && String(v).trim() !== "");
  // Every field of the sheet plus the fields the checks read, grouped by table, the failing ones highlighted.
  const sheetTable = material.labels.Table ?? (isMaterial ? "MARA" : "Record");
  const sheet = sheetFields(material.mara ?? {}, workQuery.data?.values ?? {}, workQuery.data?.issues ?? [], sheetTable);

  const findings = findingsQuery.data;
  const supersession = supersessionQuery.data;
  const duplicates = duplicatesQuery.data;

  // The record sheet PDF reads a material (MARA/MATNR, api/services/pdf_reports.py:load_record): only a material offers it.
  const exportOptions = isMaterial ? [
    {
      format: "pdf" as const,
      label: "Record sheet (PDF)",
      run: () =>
        downloadAuthenticated(getRecordReportUrl(run, material.matnr), `meridian-fix-sheet-${material.matnr}.pdf`),
    },
  ] : [];

  return (
    <RecordPage
      recordKey={material.matnr}
      object={object}
      status={status}
      meta={<RunScope scope={scope} hrefFor={(id) => hrefWithRun(`/objects/${object}/records/${encodeURIComponent(key)}`, search, id)} />}
      actions={exportOptions.length > 0 ? <ExportMenu options={exportOptions} /> : undefined}
      stats={isMaterial ? [
        verdictQuery.isSuccess
          ? { label: "Failing rules", value: materialRules.size, tone: materialRules.size ? "no-go" : "go" }
          : { label: "Failing rules", value: "—" },
        // No "Views" count: how many MM views the record spans means nothing to a steward fixing it.
        { label: "Missing fields", value: material.views.reduce((n, v) => n + v.cells.filter((c) => c.state === "missing").length, 0), tone: hasMissing ? "no-go" : "go" },
      ] : [
        verdictQuery.isSuccess
          ? { label: "Failing rules", value: failingRules.length, tone: failingRules.length ? "no-go" : "go" }
          : { label: "Failing rules", value: "—" },
        { label: "Fields with a value", value: fieldRows.length },
      ]}
    >
      {workQuery.isError && isNotFound(workQuery.error) ? null : <RecordPanel module={object} recordKey={key} run={run} fullRecordLink={false} />}
      <EntityTabs entityType="objects" entityId={primary} auditPath={`/objects/${object}/records/${primary}`} overview={<>
      <Card title="Identity" domain={domainOf(object)}>
        <dl className="m-text-body grid grid-cols-2 gap-x-6 gap-y-1">
          <dt className="m-ink-3">Description</dt>
          <dd>{material.description ?? "—"}</dd>
          {isMaterial ? (
            <>
              <dt className="m-ink-3">Material type</dt>
              <dd>{material.labels.MTART ?? "—"}</dd>
              <dt className="m-ink-3">Material group</dt>
              <dd>{material.labels.MATKL ?? "—"}</dd>
              <dt className="m-ink-3">Base unit</dt>
              <dd>{material.labels.MEINS ?? "—"}</dd>
            </>
          ) : (
            Object.entries(material.labels).map(([field, fieldValue]) => (
              <Fragment key={field}>
                <dt className="m-ink-3">{field}</dt>
                <dd>{fieldValue ?? "—"}</dd>
              </Fragment>
            ))
          )}
          {isMaterial ? (
            <>
              <dt className="m-ink-3">Organisational levels</dt>
              <dd>{material.levels_total}</dd>
            </>
          ) : null}
        </dl>
      </Card>

      {material.views.length > 0 ? (
        <Card title="View completeness">
          <ul className="flex flex-col gap-1">
            {material.views.map((view) => {
              const ok = view.cells.filter((cell) => cell.state === "ok").length;
              return (
                <li key={view.view}>
                  {view.label}: {ok}/{view.cells.length} maintained
                </li>
              );
            })}
          </ul>
        </Card>
      ) : null}

      {!isMaterial && (
        <Card title="Failing rules">
          {genericFindingsQuery.isError ? (
            <SectionError what="this record's findings" query={genericFindingsQuery} />
          ) : failingRules.length > 0 ? (
            <ul className="flex flex-col gap-2">
              {failingRules.map((rule) => (
                <li key={rule.check_id} className="flex flex-wrap items-baseline gap-2">
                  <Status kind="severity" value={rule.severity} />
                  <Link href={hrefWithRun(`/objects/${object}/rules/${encodeURIComponent(rule.check_id)}`, null, scope.explicit ?? null)} className="m-ink-accent underline underline-offset-2"><Mono>{rule.check_id}</Mono></Link>
                  <span>{rule.message ?? ""}</span>
                  {rule.field ? <Mono>{rule.field}</Mono> : null}
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState variant="inline" title="No failing rules on this run" />
          )}
        </Card>
      )}

      <FieldSheet fields={sheet} />

      {isMaterial && (
        <Card title="Failing rules">
          {findingsQuery.isError ? (
            <SectionError what="this record's findings" query={findingsQuery} />
          ) : findings && findings.by_view.some((view) => view.failing.length > 0) ? (
            <ul className="flex flex-col gap-1">
              {findings.by_view.flatMap((view) =>
                view.failing.map((rule) => (
                  <li key={`${view.view}-${rule.check_id}`} className="flex flex-wrap items-baseline gap-2">
                    <Status kind="severity" value={rule.severity} />
                    <Link href={hrefWithRun(`/objects/${object}/rules/${encodeURIComponent(rule.check_id)}`, null, scope.explicit ?? null)} className="m-ink-accent underline underline-offset-2"><Mono>{rule.check_id}</Mono></Link>
                    <span>{rule.message}</span>
                  </li>
                )),
              )}
            </ul>
          ) : (
            <EmptyState variant="inline" title="No failing rules on this run" />
          )}
        </Card>
      )}

      {isMaterial && (
        <Card title="Supersession">
          {supersessionQuery.isError ? (
            <SectionError what="the supersession chain" query={supersessionQuery} />
          ) : supersession && supersession.plants.some((plant) => plant.chain.length > 1) ? (
            <ul className="flex flex-col gap-1">
              {supersession.plants.map((plant) => (
                <li key={plant.werks}>
                  Plant {plant.werks}: {plant.chain.length} material{plant.chain.length === 1 ? "" : "s"} in chain
                  {plant.dead_end ? " (dead end)" : ""}
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState variant="inline" title="Not superseded at any plant" />
          )}
        </Card>
      )}

      {isMaterial && (
        <Card title="Possible duplicates">
          {duplicatesQuery.isError ? (
            <SectionError what="possible duplicates" query={duplicatesQuery} />
          ) : duplicates && duplicates.items.length > 0 ? (
            <ul className="flex flex-col gap-1">
              {duplicates.items.map((item) => (
                <li key={item.matnr} className="flex flex-wrap items-baseline gap-2">
                  <Link href={hrefWithRun(`/objects/material_master/records/${encodeURIComponent(item.matnr)}`, null, scope.explicit ?? null)} className="m-ink-accent underline underline-offset-2"><Mono>{item.matnr}</Mono></Link>
                  <span>{item.maktx ?? ""}</span>
                  <span className="m-ink-3">matches on {item.matches_on.join(", ")}</span>
                  <span className="tabular-nums">{duplicateScore(item.score)}</span>
                  <Link
                    href={`/mdm/golden/merge?object=material_master&record=${encodeURIComponent(material.matnr)}`}
                    aria-label={`Review pair ${material.matnr} and ${item.matnr}`}
                    className="m-ink-accent underline underline-offset-2"
                  >
                    Review pair
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState variant="inline" title="No duplicate candidates for this record" />
          )}
        </Card>
      )}
      </>} />
    </RecordPage>
  );
}
