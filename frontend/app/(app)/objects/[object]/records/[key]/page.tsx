// frontend/app/(app)/objects/[object]/records/[key]/page.tsx
"use client";

import { Fragment } from "react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { Button, Card, DataTable, EmptyState, EntityTabs, ErrorState, ExportMenu, Mono, RecordPage, Skeleton, Status, domainOf, type RecordStatus } from "@/design";
import { getObjectRecord, getObjectRecordFindings } from "@/lib/api/v1/objects";
import { getMaterialDuplicates, getMaterialFindings, getMaterialSupersession } from "@/lib/api/materials";
import { downloadAuthenticated } from "@/lib/api/download";
import { apiErrorMessage, apiErrorState } from "@/lib/error";
import { getRecordReportUrl } from "@/lib/api/reports";
import { queryKeys } from "@/lib/query-keys";
import { parseRecordKey } from "@/lib/record-key";
import { RunScope } from "@/components/run-scope";
import { useRunScope } from "@/hooks/use-run-scope";
import { hrefWithRun } from "@/lib/run-scope";

function SectionError({ what, query }: { what: string; query: UseQueryResult }) {
  return (
    <ErrorState
      message={`Could not load ${what}. ${apiErrorMessage(query.error)}`}
      onRetry={() => query.refetch()}
    />
  );
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

  if (recordQuery.isLoading || (!run && scope.resolving)) {
    return (
      <div className="flex flex-col gap-2 p-6">
        <Skeleton height={32} />
        <Skeleton height={120} />
      </div>
    );
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
  const failing = isMaterial ? hasMissing : failingRules.length > 0;
  const status: RecordStatus = failing ? { label: "failing", tone: "no-go" } : { label: "passing", tone: "go" };
  const fieldRows = Object.entries(material.mara ?? {}).filter(([, v]) => v != null && String(v).trim() !== "");

  const findings = findingsQuery.data;
  const supersession = supersessionQuery.data;
  const duplicates = duplicatesQuery.data;

  const exportOptions = [
    {
      format: "pdf" as const,
      label: "Fix sheet (PDF)",
      run: () =>
        downloadAuthenticated(getRecordReportUrl(run, material.matnr), `meridian-fix-sheet-${material.matnr}.pdf`),
    },
  ];

  return (
    <RecordPage
      recordKey={material.matnr}
      object={object}
      status={status}
      meta={<RunScope scope={scope} hrefFor={(id) => hrefWithRun(`/objects/${object}/records/${encodeURIComponent(key)}`, search, id)} />}
      actions={<ExportMenu options={exportOptions} />}
      stats={isMaterial ? [
        { label: "Missing fields", value: material.views.reduce((n, v) => n + v.cells.filter((c) => c.state === "missing").length, 0), tone: hasMissing ? "no-go" : "go" },
        { label: "Views", value: material.views.length },
      ] : [
        { label: "Failing rules", value: failingRules.length, tone: failingRules.length ? "no-go" : "go" },
        { label: "Fields with a value", value: fieldRows.length },
      ]}
    >
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
          <dt className="m-ink-3">Levels</dt>
          <dd>{material.levels_total}</dd>
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
                  <Link href={hrefWithRun(`/objects/${object}/rules/${encodeURIComponent(rule.check_id)}`, null, scope.explicit ?? null)} className="m-ink-accent"><Mono>{rule.check_id}</Mono></Link>
                  <span>{rule.message ?? ""}</span>
                  {rule.field ? <Mono>{rule.field}</Mono> : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="m-ink-3">No failing rules on this run.</p>
          )}
        </Card>
      )}

      {generic && (
        <Card title="Fields">
          <DataTable
            columns={[
              { id: "field", header: "Field", accessorFn: (r: [string, string | null]) => r[0], cell: ({ row }) => <Mono>{row.original[0]}</Mono> },
              { id: "value", header: "Value", accessorFn: (r: [string, string | null]) => r[1] ?? "", cell: ({ row }) => <Mono>{row.original[1]}</Mono> },
            ]}
            data={fieldRows}
            getRowId={(r) => r[0]}
            maxHeight={420}
          />
        </Card>
      )}

      {isMaterial && (
        <Card title="Findings">
          {findingsQuery.isError ? (
            <SectionError what="this record's findings" query={findingsQuery} />
          ) : findings && findings.by_view.some((view) => view.failing.length > 0) ? (
            <ul className="flex flex-col gap-1">
              {findings.by_view.flatMap((view) =>
                view.failing.map((rule) => (
                  <li key={`${view.view}-${rule.check_id}`}>
                    <Mono>{rule.check_id}</Mono> (<Mono>{rule.severity}</Mono>) — {rule.message}
                  </li>
                )),
              )}
            </ul>
          ) : (
            <p className="m-ink-3">No failing rules on this run.</p>
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
            <p className="m-ink-3">Not superseded at any plant.</p>
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
                <li key={item.matnr}>
                  <Mono>{item.matnr}</Mono> {item.maktx ?? ""} — matches on {item.matches_on.join(", ")} (score{" "}
                  {item.score})
                </li>
              ))}
            </ul>
          ) : (
            <p className="m-ink-3">No duplicate candidates for this record.</p>
          )}
        </Card>
      )}
      </>} />
    </RecordPage>
  );
}
