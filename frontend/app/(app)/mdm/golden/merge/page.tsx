// frontend/app/(app)/mdm/golden/merge/page.tsx
"use client";

// ponytail: no legacy merge page exists to port (confirmed absent on disk in
// Task 20 Step 1 — see task-20-report.md). This is a fresh field-by-field
// conflict view built from getMasterRecord's golden_fields/source_contributions,
// since that's the only merge-relevant data the brief's named API wrappers expose.
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { EmptyState, Mono, Skeleton } from "@/design";
import { getMasterRecord } from "@/lib/api/master-records";
import { queryKeys } from "@/lib/query-keys";

export default function GoldenRecordMergePage() {
  const sp = useSearchParams();
  const id = sp.get("id") ?? "";

  const query = useQuery({
    queryKey: queryKeys.masterRecord(id),
    queryFn: () => getMasterRecord(id),
    enabled: !!id,
  });

  if (!id) {
    return (
      <EmptyState
        title="Choose a master record to review its merge conflicts."
        action={<Link href="/insights/duplicates" style={{ color: "var(--m-accent)" }}>Review merge candidates</Link>}
      />
    );
  }
  if (query.isLoading) {
    return (
      <div className="flex flex-col gap-2 p-6">
        <Skeleton height={32} />
        <Skeleton height={120} />
      </div>
    );
  }
  const record = query.data;
  if (!record) {
    return <EmptyState title="This master record no longer exists." />;
  }

  const fields = Object.entries(record.golden_fields);
  const sources = Object.entries(record.source_contributions);

  return (
    <div className="flex flex-col gap-4 p-6">
      <h2 className="text-[16px] font-semibold" style={{ color: "var(--m-ink)" }}>
        Merge conflicts for <Mono>{record.sap_object_key}</Mono>
      </h2>
      <p className="text-[13px]" style={{ color: "var(--m-ink-3)" }}>
        Field-by-field comparison of the golden value against every contributing source.
        For a different record, go back to{" "}
        <Link href="/insights/duplicates" className="text-[13px]" style={{ color: "var(--m-accent)" }}>
          merge candidates in duplicates
        </Link>.
      </p>
      {fields.length === 0 ? (
        <p className="text-[13px]" style={{ color: "var(--m-ink-3)" }}>No golden fields to compare.</p>
      ) : (
        <table className="text-[13px]">
          <thead>
            <tr>
              <th className="text-left pr-4">Field</th>
              <th className="text-left pr-4">Golden value</th>
              {sources.map(([system]) => (
                <th key={system} className="text-left pr-4"><Mono>{system}</Mono></th>
              ))}
            </tr>
          </thead>
          <tbody>
            {fields.map(([field, value]) => (
              <tr key={field}>
                <td className="pr-4"><Mono>{field}</Mono></td>
                <td className="pr-4">{value == null ? "None" : String(value)}</td>
                {sources.map(([system, s]) => {
                  const contribution = s as { value: unknown; confidence: number };
                  const conflicts = contribution.value !== value;
                  return (
                    <td key={system} className="pr-4" style={conflicts ? { color: "var(--m-critical)" } : undefined}>
                      {contribution.value == null ? "None" : String(contribution.value)} ({Math.round(contribution.confidence * 100)}%)
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <Link href={`/mdm/golden/${record.id}`} className="text-[13px]" style={{ color: "var(--m-accent)" }}>
        Back to record
      </Link>
    </div>
  );
}
