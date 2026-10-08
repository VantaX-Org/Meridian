// frontend/app/(app)/objects/[object]/records/[key]/page.tsx
"use client";

import { useParams, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { EmptyState, ErrorState, Mono, RecordPage, Skeleton } from "@/design";
import { getObjectRecord } from "@/lib/api/v1/objects";
import { getMaterialDuplicates, getMaterialFindings, getMaterialSupersession } from "@/lib/api/materials";

export default function RecordFixSheetPage() {
  const params = useParams<{ object: string; key: string }>();
  const search = useSearchParams();
  const object = params.object;
  const key = params.key;
  const run = search.get("run") ?? "";

  const recordQuery = useQuery({
    queryKey: ["object-record", object, key, run],
    queryFn: () => getObjectRecord(object, key, { version_id: run }),
    enabled: !!run,
    retry: false,
  });
  const findingsQuery = useQuery({
    queryKey: ["object-record-findings", object, key, run],
    queryFn: () => getMaterialFindings(key, { version_id: run }),
    enabled: !!run,
  });
  const supersessionQuery = useQuery({
    queryKey: ["object-record-supersession", object, key, run],
    queryFn: () => getMaterialSupersession(key, { version_id: run }),
    enabled: !!run,
  });
  const duplicatesQuery = useQuery({
    queryKey: ["object-record-duplicates", object, key, run],
    queryFn: () => getMaterialDuplicates(key, { version_id: run }),
    enabled: !!run,
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
  if (
    (recordQuery.error as { response?: { status?: number } } | null)?.response?.status === 501
  ) {
    return <EmptyState title={`Not yet available. The record fix sheet for ${object} isn't built yet.`} />;
  }
  if (recordQuery.isError) {
    return <ErrorState message="Couldn't load this record. Try again." />;
  }
  const material = recordQuery.data;
  if (!material) {
    return <EmptyState title="This record was not found for this run." />;
  }

  const hasMissing = material.views.some((view) => view.cells.some((cell) => cell.state === "missing"));
  const statusLabel = hasMissing ? "Incomplete" : "Complete";

  const findings = findingsQuery.data;
  const supersession = supersessionQuery.data;
  const duplicates = duplicatesQuery.data;

  return (
    <RecordPage recordKey={material.matnr} object={object} status={statusLabel}>
      <section className="flex flex-col gap-2">
        <h2 className="text-[14px] font-semibold" style={{ color: "var(--m-ink)" }}>Identity</h2>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-[13px]">
          <dt style={{ color: "var(--m-ink-3)" }}>Description</dt>
          <dd>{material.description ?? "—"}</dd>
          <dt style={{ color: "var(--m-ink-3)" }}>Material type</dt>
          <dd>{material.labels.MTART ?? "—"}</dd>
          <dt style={{ color: "var(--m-ink-3)" }}>Material group</dt>
          <dd>{material.labels.MATKL ?? "—"}</dd>
          <dt style={{ color: "var(--m-ink-3)" }}>Base unit</dt>
          <dd>{material.labels.MEINS ?? "—"}</dd>
          <dt style={{ color: "var(--m-ink-3)" }}>Levels</dt>
          <dd>{material.levels_total}</dd>
        </dl>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-[14px] font-semibold" style={{ color: "var(--m-ink)" }}>View completeness</h2>
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

      {findings && findings.by_view.some((view) => view.failing.length > 0) && (
        <section className="flex flex-col gap-2">
          <h2 className="text-[14px] font-semibold" style={{ color: "var(--m-ink)" }}>Findings</h2>
          <ul className="flex flex-col gap-1 text-[13px]">
            {findings.by_view.flatMap((view) =>
              view.failing.map((rule) => (
                <li key={`${view.view}-${rule.check_id}`}>
                  <Mono>{rule.check_id}</Mono> (<Mono>{rule.severity}</Mono>) — {rule.message}
                </li>
              )),
            )}
          </ul>
        </section>
      )}

      {supersession && supersession.plants.some((plant) => plant.chain.length > 1) && (
        <section className="flex flex-col gap-2">
          <h2 className="text-[14px] font-semibold" style={{ color: "var(--m-ink)" }}>Supersession</h2>
          <ul className="flex flex-col gap-1 text-[13px]">
            {supersession.plants.map((plant) => (
              <li key={plant.werks}>
                Plant {plant.werks}: {plant.chain.length} material{plant.chain.length === 1 ? "" : "s"} in chain
                {plant.dead_end ? " (dead end)" : ""}
              </li>
            ))}
          </ul>
        </section>
      )}

      {duplicates && duplicates.items.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-[14px] font-semibold" style={{ color: "var(--m-ink)" }}>Possible duplicates</h2>
          <ul className="flex flex-col gap-1 text-[13px]">
            {duplicates.items.map((item) => (
              <li key={item.matnr}>
                <Mono>{item.matnr}</Mono> {item.maktx ?? ""} — matches on {item.matches_on.join(", ")} (score{" "}
                {item.score})
              </li>
            ))}
          </ul>
        </section>
      )}
    </RecordPage>
  );
}
