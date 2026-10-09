// frontend/app/(app)/objects/[object]/records/[key]/page.tsx
"use client";

import { Fragment } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { isAxiosError } from "axios";
import { EmptyState, ErrorState, Mono, RecordPage, Skeleton, type RecordStatus } from "@/design";
import { getObjectRecord } from "@/lib/api/v1/objects";
import { getMaterialDuplicates, getMaterialFindings, getMaterialSupersession } from "@/lib/api/materials";
import { queryKeys } from "@/lib/query-keys";
import { parseRecordKey } from "@/lib/record-key";

const sectionHeading = "text-[14px] font-semibold";

function SectionError({ what, query }: { what: string; query: UseQueryResult }) {
  return (
    <ErrorState
      message={`Couldn't load ${what}. ${query.error?.message ?? ""}`.trim()}
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
  const run = search.get("run") ?? "";
  const { primary, fields } = parseRecordKey(key);
  const plant = fields.WERKS;
  const isMaterial = object === "material_master";

  const recordQuery = useQuery({
    queryKey: queryKeys.record(object, key, run),
    queryFn: () => getObjectRecord(object, primary, { version_id: run, plant }),
    enabled: !!run,
    retry: false,
  });
  const findingsQuery = useQuery({
    queryKey: [...queryKeys.record(object, key, run), "findings"],
    queryFn: () => getMaterialFindings(primary, { version_id: run }),
    enabled: !!run && isMaterial,
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

  if (!run) {
    return <EmptyState title="Select a run to see this record's fix sheet." />;
  }
  if (recordQuery.isLoading) {
    return (
      <div className="flex flex-col gap-2 p-6">
        <Skeleton height={32} />
        <Skeleton height={120} />
      </div>
    );
  }
  if (isAxiosError(recordQuery.error) && recordQuery.error.response?.status === 501) {
    return <EmptyState title={`Not yet available. The record fix sheet for ${object} isn't built yet.`} />;
  }
  if (recordQuery.isError) {
    return (
      <ErrorState
        message={`Couldn't load this record. ${recordQuery.error.message}`}
        onRetry={() => recordQuery.refetch()}
      />
    );
  }
  const material = recordQuery.data;
  if (!material) {
    return <EmptyState title="This record was not found for this run." />;
  }

  const hasMissing = material.views.some((view) => view.cells.some((cell) => cell.state === "missing"));
  const status: RecordStatus = hasMissing ? { label: "failing", tone: "no-go" } : { label: "passing", tone: "go" };

  const findings = findingsQuery.data;
  const supersession = supersessionQuery.data;
  const duplicates = duplicatesQuery.data;

  return (
    <RecordPage recordKey={material.matnr} object={object} status={status}>
      <section className="flex flex-col gap-2">
        <h2 className={sectionHeading} style={{ color: "var(--m-ink)" }}>Identity</h2>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-[13px]">
          <dt style={{ color: "var(--m-ink-3)" }}>Description</dt>
          <dd>{material.description ?? "—"}</dd>
          {isMaterial ? (
            <>
              <dt style={{ color: "var(--m-ink-3)" }}>Material type</dt>
              <dd>{material.labels.MTART ?? "—"}</dd>
              <dt style={{ color: "var(--m-ink-3)" }}>Material group</dt>
              <dd>{material.labels.MATKL ?? "—"}</dd>
              <dt style={{ color: "var(--m-ink-3)" }}>Base unit</dt>
              <dd>{material.labels.MEINS ?? "—"}</dd>
            </>
          ) : (
            Object.entries(material.labels).map(([field, fieldValue]) => (
              <Fragment key={field}>
                <dt style={{ color: "var(--m-ink-3)" }}>{field}</dt>
                <dd>{fieldValue ?? "—"}</dd>
              </Fragment>
            ))
          )}
          <dt style={{ color: "var(--m-ink-3)" }}>Levels</dt>
          <dd>{material.levels_total}</dd>
        </dl>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className={sectionHeading} style={{ color: "var(--m-ink)" }}>View completeness</h2>
        <ul className="flex flex-col gap-1 text-[13px]">
          {material.views.map((view) => {
            const ok = view.cells.filter((cell) => cell.state === "ok").length;
            return (
              <li key={view.view}>
                {view.label}: {ok}/{view.cells.length} maintained
              </li>
            );
          })}
        </ul>
      </section>

      {isMaterial && (
        <section className="flex flex-col gap-2">
          <h2 className={sectionHeading} style={{ color: "var(--m-ink)" }}>Findings</h2>
          {findingsQuery.isError ? (
            <SectionError what="this record's findings" query={findingsQuery} />
          ) : findings && findings.by_view.some((view) => view.failing.length > 0) ? (
            <ul className="flex flex-col gap-1 text-[13px]">
              {findings.by_view.flatMap((view) =>
                view.failing.map((rule) => (
                  <li key={`${view.view}-${rule.check_id}`}>
                    <Mono>{rule.check_id}</Mono> (<Mono>{rule.severity}</Mono>) — {rule.message}
                  </li>
                )),
              )}
            </ul>
          ) : (
            <p className="text-[13px]" style={{ color: "var(--m-ink-3)" }}>No failing rules on this run.</p>
          )}
        </section>
      )}

      {isMaterial && (
        <section className="flex flex-col gap-2">
          <h2 className={sectionHeading} style={{ color: "var(--m-ink)" }}>Supersession</h2>
          {supersessionQuery.isError ? (
            <SectionError what="the supersession chain" query={supersessionQuery} />
          ) : supersession && supersession.plants.some((plant) => plant.chain.length > 1) ? (
            <ul className="flex flex-col gap-1 text-[13px]">
              {supersession.plants.map((plant) => (
                <li key={plant.werks}>
                  Plant {plant.werks}: {plant.chain.length} material{plant.chain.length === 1 ? "" : "s"} in chain
                  {plant.dead_end ? " (dead end)" : ""}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[13px]" style={{ color: "var(--m-ink-3)" }}>Not superseded at any plant.</p>
          )}
        </section>
      )}

      {isMaterial && (
        <section className="flex flex-col gap-2">
          <h2 className={sectionHeading} style={{ color: "var(--m-ink)" }}>Possible duplicates</h2>
          {duplicatesQuery.isError ? (
            <SectionError what="possible duplicates" query={duplicatesQuery} />
          ) : duplicates && duplicates.items.length > 0 ? (
            <ul className="flex flex-col gap-1 text-[13px]">
              {duplicates.items.map((item) => (
                <li key={item.matnr}>
                  <Mono>{item.matnr}</Mono> {item.maktx ?? ""} — matches on {item.matches_on.join(", ")} (score{" "}
                  {item.score})
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[13px]" style={{ color: "var(--m-ink-3)" }}>No duplicates found.</p>
          )}
        </section>
      )}
    </RecordPage>
  );
}
